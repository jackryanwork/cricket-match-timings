import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const MINI_APP_URL = "https://jackryanwork.github.io/cricket-match-timings/?v=2";

async function callTelegram(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    return { ok: response.ok && result.ok === true, description: result.description };
  } catch {
    console.error(`Telegram ${method} request failed.`);
    return { ok: false, description: "Telegram request failed." };
  }
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (request) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!botToken || !webhookSecret || !supabaseUrl) {
      return Response.json(
        { error: "Telegram setup secrets are not configured." },
        { status: 500 },
      );
    }

    const webhook = await callTelegram(botToken, "setWebhook", {
      url: `${supabaseUrl}/functions/v1/telegram-bot-webhook`,
      secret_token: webhookSecret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });

    const menuButton = await callTelegram(botToken, "setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "Open APP",
        web_app: { url: MINI_APP_URL },
      },
    });

    const ok = webhook.ok && menuButton.ok;
    return Response.json(
      { ok, webhook, menuButton },
      { status: ok ? 200 : 502 },
    );
  }),
};
