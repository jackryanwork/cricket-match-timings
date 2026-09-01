import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const ADMIN_USER_ID = "749c0b4a-ae6d-41cc-b046-1695089f191c";
const MINI_APP_URL = "https://jackryanwork.github.io/cricket-match-timings/";
const MAX_MESSAGE_LENGTH = 4000;
const BATCH_SIZE = 20;

type Audience = "all" | "alerts";
type BroadcastBody = { message?: unknown; audience?: unknown };
type Recipient = { telegram_user_id: number; chat_id: number };

const keyboard = {
  keyboard: [
    [{ text: "🏏 Today’s Matches" }],
    [{ text: "📅 Tomorrow" }, { text: "⭐ Big Matches" }],
    [{ text: "🔔 Enable Alerts" }, { text: "🔕 Stop Alerts" }],
    [{ text: "📲 Open App", web_app: { url: MINI_APP_URL } }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://jackryanwork.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendTelegramMessage(botToken: string, recipient: Recipient, message: string) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: recipient.chat_id,
        text: message,
        reply_markup: keyboard,
        disable_web_page_preview: true,
      }),
    });

    const result = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      blocked: response.status === 403,
      description: typeof result.description === "string" ? result.description : null,
    };
  } catch {
    return { ok: false, blocked: false, description: "Network request failed" };
  }
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request, ctx) => {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "Telegram bot is not configured." }, 500);

    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Admin login is required." }, 401);

    const { data: authData, error: authError } = await ctx.supabaseAdmin.auth.getUser(accessToken);
    if (authError || authData.user?.id !== ADMIN_USER_ID) {
      return json({ error: "You are not authorized to send broadcasts." }, 403);
    }

    let body: BroadcastBody;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request body." }, 400);
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const audience: Audience = body.audience === "alerts" ? "alerts" : "all";
    if (!message) return json({ error: "Write a message before sending." }, 400);
    if (message.length > MAX_MESSAGE_LENGTH) {
      return json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` }, 400);
    }

    const recipientQuery = audience === "alerts"
      ? ctx.supabaseAdmin
        .from("telegram_reminder_users")
        .select("telegram_user_id, chat_id")
      : ctx.supabaseAdmin
        .from("telegram_bot_users")
        .select("telegram_user_id, chat_id")
        .eq("is_active", true);

    const { data, error: recipientError } = await recipientQuery;
    if (recipientError) {
      console.error("Unable to load broadcast recipients", recipientError.code);
      return json({ error: "Could not load broadcast recipients." }, 500);
    }

    const recipients = (data || []) as Recipient[];
    let sent = 0;
    let failed = 0;
    let blocked = 0;

    for (let offset = 0; offset < recipients.length; offset += BATCH_SIZE) {
      const batch = recipients.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (recipient) => ({
          recipient,
          result: await sendTelegramMessage(botToken, recipient, message),
        })),
      );

      for (const { recipient, result } of results) {
        if (result.ok) {
          sent += 1;
          continue;
        }

        failed += 1;
        if (result.blocked) {
          blocked += 1;
          if (audience === "all") {
            await ctx.supabaseAdmin
              .from("telegram_bot_users")
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq("telegram_user_id", recipient.telegram_user_id);
          }
        }
      }

      if (offset + BATCH_SIZE < recipients.length) await wait(1000);
    }

    const { error: logError } = await ctx.supabaseAdmin
      .from("telegram_broadcasts")
      .insert({
        admin_user_id: authData.user.id,
        audience,
        message,
        total_recipients: recipients.length,
        sent_count: sent,
        failed_count: failed,
        blocked_count: blocked,
      });

    if (logError) console.error("Unable to save broadcast log", logError.code);

    return json({ success: true, total: recipients.length, sent, failed, blocked });
  }),
};
