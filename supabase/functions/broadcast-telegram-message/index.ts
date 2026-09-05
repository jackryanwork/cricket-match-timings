import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const ADMIN_USER_ID = "749c0b4a-ae6d-41cc-b046-1695089f191c";
const MINI_APP_URL = "https://www.cricnivo.com/";
const MAX_TEXT_LENGTH = 4000;
const MAX_CAPTION_LENGTH = 1024;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const BATCH_SIZE = 20;

type Audience = "all" | "alerts";
type Recipient = { telegram_user_id: number; chat_id: number };
type MediaKind = { method: "sendPhoto" | "sendVideo" | "sendDocument"; field: "photo" | "video" | "document" };

const keyboard = {
  keyboard: [
    [{ text: "🏏 Today’s Matches" }],
    [{ text: "📅 Tomorrow" }, { text: "⭐ Big Matches" }],
    [{ text: "📢 Join our channel" }, { text: "💬 Contact Us" }],
    [{ text: "📲 Open App", web_app: { url: MINI_APP_URL } }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cricnivo.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getMediaKind(file: File): MediaKind {
  if (file.type.startsWith("image/")) return { method: "sendPhoto", field: "photo" };
  if (file.type === "video/mp4") return { method: "sendVideo", field: "video" };
  return { method: "sendDocument", field: "document" };
}

function extractFileId(result: Record<string, unknown>, kind: MediaKind) {
  const message = result.result as Record<string, unknown> | undefined;
  if (!message) return null;
  if (kind.field === "photo") {
    const photos = message.photo as Array<{ file_id?: string }> | undefined;
    return photos?.at(-1)?.file_id || null;
  }
  const media = message[kind.field] as { file_id?: string } | undefined;
  return media?.file_id || null;
}

async function sendTelegram(
  botToken: string,
  recipient: Recipient,
  message: string,
  mediaKind?: MediaKind,
  mediaFile?: File,
  telegramFileId?: string,
) {
  const method = mediaKind?.method || "sendMessage";
  let body: BodyInit;
  let headers: HeadersInit | undefined;

  if (mediaKind && mediaFile && !telegramFileId) {
    const formData = new FormData();
    formData.append("chat_id", String(recipient.chat_id));
    formData.append(mediaKind.field, mediaFile, mediaFile.name);
    if (message) formData.append("caption", message);
    formData.append("reply_markup", JSON.stringify(keyboard));
    body = formData;
  } else {
    const payload: Record<string, unknown> = { chat_id: recipient.chat_id, reply_markup: keyboard };
    if (mediaKind && telegramFileId) {
      payload[mediaKind.field] = telegramFileId;
      if (message) payload.caption = message;
    } else {
      payload.text = message;
      payload.disable_web_page_preview = true;
    }
    headers = { "Content-Type": "application/json" };
    body = JSON.stringify(payload);
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers,
      body,
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      ok: response.ok,
      blocked: response.status === 403,
      fileId: mediaKind && response.ok ? extractFileId(result, mediaKind) : null,
    };
  } catch {
    return { ok: false, blocked: false, fileId: null };
  }
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request, ctx) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "Telegram bot is not configured." }, 500);

    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Admin login is required." }, 401);

    const { data: authData, error: authError } = await ctx.supabaseAdmin.auth.getUser(accessToken);
    if (authError || authData.user?.id !== ADMIN_USER_ID) {
      return json({ error: "You are not authorized to send broadcasts." }, 403);
    }

    const { data: assurance, error: assuranceError } =
      await ctx.supabaseAdmin.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
    if (assuranceError || assurance.currentLevel !== "aal2") {
      return json({ error: "Two-factor authentication is required." }, 403);
    }

    let message = "";
    let audience: Audience = "all";
    let mediaFile: File | undefined;

    try {
      if (request.headers.get("content-type")?.includes("multipart/form-data")) {
        const formData = await request.formData();
        message = String(formData.get("message") || "").trim();
        audience = formData.get("audience") === "alerts" ? "alerts" : "all";
        const media = formData.get("media");
        if (media instanceof File && media.size > 0) mediaFile = media;
      } else {
        const body = await request.json();
        message = typeof body.message === "string" ? body.message.trim() : "";
        audience = body.audience === "alerts" ? "alerts" : "all";
      }
    } catch {
      return json({ error: "Invalid request body." }, 400);
    }

    if (!message && !mediaFile) return json({ error: "Write a message or attach media." }, 400);
    if (!mediaFile && message.length > MAX_TEXT_LENGTH) {
      return json({ error: `Message must be ${MAX_TEXT_LENGTH} characters or fewer.` }, 400);
    }
    if (mediaFile && message.length > MAX_CAPTION_LENGTH) {
      return json({ error: `Media caption must be ${MAX_CAPTION_LENGTH} characters or fewer.` }, 400);
    }
    if (mediaFile && mediaFile.size > MAX_MEDIA_BYTES) {
      return json({ error: "Media must be 8 MB or smaller." }, 400);
    }

    const recipientQuery = audience === "alerts"
      ? ctx.supabaseAdmin.from("telegram_reminder_users").select("telegram_user_id, chat_id")
      : ctx.supabaseAdmin.from("telegram_bot_users").select("telegram_user_id, chat_id").eq("is_active", true);
    const { data, error: recipientError } = await recipientQuery;

    if (recipientError) {
      console.error("Unable to load broadcast recipients", recipientError.code);
      return json({ error: "Could not load broadcast recipients." }, 500);
    }

    const recipients = (data || []) as Recipient[];
    const mediaKind = mediaFile ? getMediaKind(mediaFile) : undefined;
    let telegramFileId: string | undefined;
    let nextRecipientIndex = 0;
    let sent = 0;
    let failed = 0;
    let blocked = 0;

    const recordFailure = async (recipient: Recipient, isBlocked: boolean) => {
      failed += 1;
      if (!isBlocked) return;
      blocked += 1;
      if (audience === "all") {
        await ctx.supabaseAdmin
          .from("telegram_bot_users")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("telegram_user_id", recipient.telegram_user_id);
      }
    };

    if (mediaFile && mediaKind) {
      while (nextRecipientIndex < recipients.length && !telegramFileId) {
        const recipient = recipients[nextRecipientIndex];
        const result = await sendTelegram(botToken, recipient, message, mediaKind, mediaFile);
        nextRecipientIndex += 1;
        if (result.ok) {
          sent += 1;
          telegramFileId = result.fileId || undefined;
        } else {
          await recordFailure(recipient, result.blocked);
        }
      }
    }

    for (let offset = nextRecipientIndex; offset < recipients.length; offset += BATCH_SIZE) {
      const batch = recipients.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (recipient) => ({
        recipient,
        result: await sendTelegram(botToken, recipient, message, mediaKind, undefined, telegramFileId),
      })));
      for (const { recipient, result } of results) {
        if (result.ok) sent += 1;
        else await recordFailure(recipient, result.blocked);
      }
      if (offset + BATCH_SIZE < recipients.length) await wait(1000);
    }

    const { error: logError } = await ctx.supabaseAdmin.from("telegram_broadcasts").insert({
      admin_user_id: authData.user.id,
      audience,
      message: message || `[Media: ${mediaFile?.name || "attachment"}]`,
      total_recipients: recipients.length,
      sent_count: sent,
      failed_count: failed,
      blocked_count: blocked,
    });
    if (logError) console.error("Unable to save broadcast log", logError.code);

    return json({ success: true, total: recipients.length, sent, failed, blocked });
  }),
};
