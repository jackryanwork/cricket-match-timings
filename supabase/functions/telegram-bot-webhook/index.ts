import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const MINI_APP_URL = "https://jackryanwork.github.io/cricket-match-timings/?v=2";
const INDIA_TIME_ZONE = "Asia/Kolkata";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
    from?: { id?: number; first_name?: string; username?: string };
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
    [{ text: "📢 Join our channel" }, { text: "💬 Contact Us" }],
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

async function sendAdminNotification(botToken: string, adminChatId: number, text: string) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: adminChatId, text, disable_web_page_preview: true }),
    });
    if (!response.ok) console.error("Unable to send new bot user notification.");
  } catch {
    console.error("New bot user notification request failed.");
  }
}

async function sendContactMessage(botToken: string, chatId: number) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Need help? Contact @MembersHelpDesk.",
        reply_markup: {
          inline_keyboard: [[{
            text: "💬 Open @MembersHelpDesk",
            url: "https://t.me/MembersHelpDesk",
          }]],
        },
        disable_web_page_preview: true,
      }),
    });
  } catch {
    console.error("Unable to send contact link.");
  }
}

async function sendChannelMessage(botToken: string, chatId: number) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Join our channel for cricket match updates.",
        reply_markup: {
          inline_keyboard: [[{
            text: "📢 Join our channel",
            url: "https://t.me/cricketmatchupdatesicc",
          }]],
        },
        disable_web_page_preview: true,
      }),
    });
  } catch {
    console.error("Unable to send channel link.");
  }
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request, ctx) => {
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    const adminChatId = Number(Deno.env.get("ADMIN_TELEGRAM_CHAT_ID"));
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

    let isNewBotUser = false;
    if (Number.isSafeInteger(telegramUserId)) {
      const { data: existingBotUser, error: lookupError } = await ctx.supabaseAdmin
        .from("telegram_bot_users")
        .select("telegram_user_id")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();
      if (lookupError) {
        console.error("Unable to check bot user", lookupError.code, lookupError.message);
      } else {
        isNewBotUser = !existingBotUser;
      }

      const { error: botUserError } = await ctx.supabaseAdmin
        .from("telegram_bot_users")
        .upsert(
          {
            telegram_user_id: telegramUserId,
            chat_id: chatId,
            first_name: update.message?.from?.first_name?.trim() || null,
            username: update.message?.from?.username?.trim() || null,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "telegram_user_id" },
        );

      if (botUserError) {
        console.error("Unable to save bot user", botUserError.code, botUserError.message);
      }
    }

    if (text === "/start" || text.startsWith("/start ")) {
      if (Number.isSafeInteger(telegramUserId)) {
        const { error: alertsError } = await ctx.supabaseAdmin
          .from("telegram_reminder_users")
          .upsert(
            {
              telegram_user_id: telegramUserId,
              chat_id: chatId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "telegram_user_id" },
          );
        if (alertsError) console.error("Unable to enable automatic alerts", alertsError.code);
      }

      const name = update.message?.from?.first_name?.trim();
      const welcome = name ? `🏏 Welcome, ${name}!` : "🏏 Welcome!";
      await sendMessage(
        botToken,
        chatId,
        `${welcome}\n\n` +
          "Get today’s, tomorrow’s and upcoming big-match schedules in India Standard Time.\n\n" +
          "🔔 Open any match and set a Telegram reminder for 30 minutes before it starts.\n" +
          "📲 Tap Open App for the complete match list and details.\n\n" +
          "Choose an option below to begin.",
      );
      if (isNewBotUser && Number.isSafeInteger(adminChatId)) {
        const firstName = update.message?.from?.first_name?.trim() || "Not provided";
        const username = update.message?.from?.username?.trim();
        await sendAdminNotification(
          botToken,
          adminChatId,
          `🆕 New bot user\n\nName: ${firstName}\n` +
            `Username: ${username ? `@${username}` : "Not provided"}\n` +
            `User ID: ${telegramUserId}\nSource: Bot /start`,
        );
      }
      return new Response("OK");
    }

    if (text === "💬 Contact Us") {
      await sendContactMessage(botToken, chatId);
      return new Response("OK");
    }

    if (text === "📢 Join our channel") {
      await sendChannelMessage(botToken, chatId);
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

    await sendMessage(botToken, chatId, "Please choose an option from the keyboard below.");
    return new Response("OK");
  }),
};
