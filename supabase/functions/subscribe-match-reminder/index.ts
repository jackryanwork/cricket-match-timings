import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const encoder = new TextEncoder();
const REMINDER_LEAD_MINUTES = 30;
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

type TelegramUser = {
  id?: number;
};

async function hmacSha256(key: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)),
  );
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
  if (authDate > nowSeconds + 60 || nowSeconds - authDate > MAX_INIT_DATA_AGE_SECONDS) {
    return null;
  }

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
    return Number.isSafeInteger(user.id) && Number(user.id) > 0 ? Number(user.id) : null;
  } catch {
    return null;
  }
}

function getIndiaMatchStart(matchDate: string, matchTime: string) {
  const time = String(matchTime).slice(0, 5);
  const start = new Date(`${matchDate}T${time}:00+05:30`);

  return Number.isNaN(start.getTime()) ? null : start;
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return Response.json({ error: "Reminder service is not configured." }, { status: 500 });
    }

    let body: { initData?: unknown; matchId?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    if (typeof body.initData !== "string") {
      return Response.json({ error: "Telegram verification is required." }, { status: 401 });
    }

    const telegramUserId = await verifyTelegramInitData(body.initData, botToken);
    const matchId = Number(body.matchId);

    if (!telegramUserId || !Number.isSafeInteger(matchId) || matchId <= 0) {
      return Response.json({ error: "Invalid reminder request." }, { status: 400 });
    }

    const { data: match, error: matchError } = await ctx.supabase
      .from("matches")
      .select("id, match_date, match_time")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError) {
      console.error("Unable to load reminder match", matchError.code, matchError.message);
      return Response.json({ error: "Could not load this match right now." }, { status: 500 });
    }

    if (!match) {
      return Response.json({ error: "Match not found." }, { status: 404 });
    }

    const matchStart = getIndiaMatchStart(match.match_date, match.match_time);
    const remindAt = matchStart && new Date(matchStart.getTime() - REMINDER_LEAD_MINUTES * 60_000);

    if (!remindAt || remindAt.getTime() <= Date.now()) {
      return Response.json(
        { error: "This match starts in less than 30 minutes." },
        { status: 422 },
      );
    }

    const { error: userError } = await ctx.supabaseAdmin
      .from("telegram_reminder_users")
      .upsert(
        {
          telegram_user_id: telegramUserId,
          chat_id: telegramUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "telegram_user_id" },
      );

    if (userError) {
      console.error("Unable to save reminder user", userError.code);
      return Response.json({ error: "Could not save reminder preference." }, { status: 500 });
    }

    const { data: existingReminder, error: existingError } = await ctx.supabaseAdmin
      .from("match_reminders")
      .select("id")
      .eq("telegram_user_id", telegramUserId)
      .eq("match_id", matchId)
      .maybeSingle();

    if (existingError) {
      console.error("Unable to check reminder", existingError.code);
      return Response.json({ error: "Could not save reminder." }, { status: 500 });
    }

    if (existingReminder) {
      return Response.json({ success: true, alreadyExists: true });
    }

    const { error: reminderError } = await ctx.supabaseAdmin
      .from("match_reminders")
      .insert({
        telegram_user_id: telegramUserId,
        match_id: matchId,
        remind_at: remindAt.toISOString(),
      });

    if (reminderError) {
      console.error("Unable to create reminder", reminderError.code);
      return Response.json({ error: "Could not save reminder." }, { status: 500 });
    }

    return Response.json({ success: true, remindAt: remindAt.toISOString() });
  }),
};
