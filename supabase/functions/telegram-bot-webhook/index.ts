import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const MINI_APP_URL = "https://jackryanwork.github.io/cricket-match-timings/?v=2";
const INDIA_TIME_ZONE = "Asia/Kolkata";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
    from?: { id?: number; first_name?: string };
  };
};

type Match = {
  team1: string;
  team2: string;
  competition: string | null;
  match_date: string;
  match_time: string;
};

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

function indiaDate(offsetDays = 0) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map(({ type, value }) => [type, value]),
  );
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function formatTime(time: string) {
  const [hourText, minute = "00"] = String(time).slice(0, 5).split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return time;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function formatMatches(title: string, matches: Match[]) {
  if (matches.length === 0) return `${title}\n\nNo matches found.`;

  const rows = matches.slice(0, 12).map((match, index) => {
    const competition = match.competition ? `\n${match.competition}` : "";
    return `${index + 1}. ${match.team1} vs ${match.team2}${competition}\n🕒 ${formatTime(match.match_time)} IST`;
  });

  const extra = matches.length > 12
    ? `\n\nOpen the app to see ${matches.length - 12} more matches.`
    : "";
  return `${title}\n\n${rows.join("\n\n")}${extra}`;
}

async function sendMessage(botToken: string, chatId: number, text: string) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          reply_markup: keyboard,
          disable_web_page_preview: true,
        }),
      },
    );
    return response.ok;
  } catch {
    console.error("Telegram sendMessage request failed.");
    return false;
  }
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request, ctx) => {
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");

    if (!botToken || !webhookSecret) {
      return new Response("Not configured", { status: 500 });
    }
    if (receivedSecret !== webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update: TelegramUpdate;
    try {
      update = await request.json();
    } catch {
      return new Response("Invalid request", { status: 400 });
    }

    const chatId = Number(update.message?.chat?.id);
    const telegramUserId = Number(update.message?.from?.id);
    const text = update.message?.text?.trim();
    if (!Number.isSafeInteger(chatId) || !text) {
      return new Response("OK");
    }

    if (text === "/start" || text.startsWith("/start ")) {
      const name = update.message?.from?.first_name;
      const greeting = name ? `Welcome, ${name}!` : "Welcome!";
      await sendMessage(
        botToken,
        chatId,
        `${greeting}\n\nUse the buttons below to check cricket matches or manage alerts.`,
      );
      return new Response("OK");
    }

    if (text === "🏏 Today’s Matches" || text === "📅 Tomorrow") {
      const isTomorrow = text === "📅 Tomorrow";
      const matchDate = indiaDate(isTomorrow ? 1 : 0);
      const { data, error } = await ctx.supabase
        .from("matches")
        .select("team1, team2, competition, match_date, match_time")
        .eq("match_date", matchDate)
        .order("match_time", { ascending: true });
      if (error) {
        console.error("Match date query failed", error.code, error.message);
      }
      const reply = error
        ? "Sorry, matches could not be loaded right now."
        : formatMatches(isTomorrow ? "📅 Tomorrow’s Matches" : "🏏 Today’s Matches", data || []);
      await sendMessage(botToken, chatId, reply);
      return new Response("OK");
    }

    if (text === "⭐ Big Matches") {
      const { data, error } = await ctx.supabase
        .from("matches")
        .select("team1, team2, competition, match_date, match_time")
        .eq("is_big_match", true)
        .gte("match_date", indiaDate())
        .order("match_date", { ascending: true })
        .order("match_time", { ascending: true });
      if (error) {
        console.error("Big match query failed", error.code, error.message);
      }
      const reply = error
        ? "Sorry, big matches could not be loaded right now."
        : formatMatches("⭐ Upcoming Big Matches", data || []);
      await sendMessage(botToken, chatId, reply);
      return new Response("OK");
    }

    if (text === "🔔 Enable Alerts") {
      if (!Number.isSafeInteger(telegramUserId)) {
        await sendMessage(botToken, chatId, "Telegram could not verify your account.");
        return new Response("OK");
      }
      const { error } = await ctx.supabaseAdmin
        .from("telegram_reminder_users")
        .upsert(
          {
            telegram_user_id: telegramUserId,
            chat_id: chatId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "telegram_user_id" },
        );
      await sendMessage(
        botToken,
        chatId,
        error ? "Alerts could not be enabled right now." : "🔔 Match alerts are enabled.",
      );
      return new Response("OK");
    }

    if (text === "🔕 Stop Alerts") {
      if (!Number.isSafeInteger(telegramUserId)) return new Response("OK");
      const { error } = await ctx.supabaseAdmin
        .from("telegram_reminder_users")
        .delete()
        .eq("telegram_user_id", telegramUserId);
      await sendMessage(
        botToken,
        chatId,
        error ? "Alerts could not be stopped right now." : "🔕 Match alerts are stopped.",
      );
      return new Response("OK");
    }

    await sendMessage(botToken, chatId, "Please choose an option from the keyboard below.");
    return new Response("OK");
  }),
};
