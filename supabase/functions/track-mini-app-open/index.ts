import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const encoder = new TextEncoder();
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

type TelegramUser = { id?: number; first_name?: string; username?: string };

async function hmacSha256(key: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

async function verifyTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const userText = params.get("user");
  if (!receivedHash || !authDate || !userText) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (authDate > nowSeconds + 60 || nowSeconds - authDate > MAX_INIT_DATA_AGE_SECONDS) return null;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = await hmacSha256(encoder.encode("WebAppData"), botToken);
  const computedHash = toHex(await hmacSha256(secretKey, dataCheckString));
  if (!safeEqual(computedHash, receivedHash)) return null;

  try {
    const user = JSON.parse(userText) as TelegramUser;
    return Number.isSafeInteger(user.id) && Number(user.id) > 0 ? user : null;
  } catch {
    return null;
  }
}

async function notifyAdmin(botToken: string, adminChatId: number, user: TelegramUser) {
  const firstName = user.first_name?.trim() || "Not provided";
  const username = user.username?.trim();
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: adminChatId,
      text:
        `📲 New Mini App user\n\nName: ${firstName}\n` +
        `Username: ${username ? `@${username}` : "Not provided"}\n` +
        `User ID: ${user.id}\nSource: First Mini App open`,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) throw new Error(`Telegram notification failed with ${response.status}`);
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request, ctx) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const adminChatId = Number(Deno.env.get("ADMIN_TELEGRAM_CHAT_ID"));
    if (!botToken || !Number.isSafeInteger(adminChatId)) {
      return Response.json({ error: "Notification service is not configured." }, { status: 500 });
    }

    let initData = "";
    try {
      const body = await request.json();
      initData = typeof body?.initData === "string" ? body.initData : "";
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const user = await verifyTelegramInitData(initData, botToken);
    if (!user?.id) return Response.json({ error: "Invalid Telegram user." }, { status: 401 });

    const { error } = await ctx.supabaseAdmin.from("telegram_mini_app_users").insert({
      telegram_user_id: Number(user.id),
      first_name: user.first_name?.trim() || null,
      username: user.username?.trim() || null,
    });
    if (error?.code === "23505") {
      return Response.json({ success: true, firstOpen: false });
    }
    if (error) {
      console.error("Unable to save Mini App user", error.code, error.message);
      return Response.json({ error: "Could not record Mini App user." }, { status: 500 });
    }

    try {
      await notifyAdmin(botToken, adminChatId, user);
    } catch (notificationError) {
      console.error("Unable to notify admin", notificationError);
      await ctx.supabaseAdmin.from("telegram_mini_app_users").delete()
        .eq("telegram_user_id", Number(user.id));
      return Response.json({ error: "Could not notify administrator." }, { status: 502 });
    }

    return Response.json({ success: true, firstOpen: true });
  }),
};
