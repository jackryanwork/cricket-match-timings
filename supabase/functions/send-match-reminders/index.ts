import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const MINI_APP_URL = "https://jackryanwork.github.io/cricket-match-timings/";
const INDIA_TIME_ZONE = "Asia/Kolkata";
const RETRY_WINDOW_MINUTES = 10;

type ReminderRow = {
  id: number;
  telegram_user_id: number;
  match_id: number;
  remind_at: string;
};

type Match = {
  id: number;
  team1: string;
  team2: string;
  competition: string | null;
  match_date: string;
  match_time: string;
};

function formatTime(time: string) {
  const [hourText, minute = "00"] = String(time).slice(0, 5).split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return time;

  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function formatDate(dateText: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${dateText}T00:00:00+05:30`));
}

async function sendReminder(botToken: string, chatId: number, match: Match) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          `🔔 Match starts in 30 minutes!\n\n` +
          `🏏 ${match.team1} vs ${match.team2}\n` +
          `${match.competition || "Cricket match"}\n` +
          `📅 ${formatDate(match.match_date)}\n` +
          `🕒 ${formatTime(match.match_time)} IST`,
        reply_markup: {
          inline_keyboard: [[{
            text: "📲 Open Match Timings",
            web_app: { url: MINI_APP_URL },
          }]],
        },
      }),
    });

    const result = await response.json().catch(() => ({}));
    return {
      ok: response.ok && result.ok === true,
      terminal: response.status === 400 || response.status === 403,
      description: typeof result.description === "string" ? result.description : "",
    };
  } catch {
    return { ok: false, terminal: false, description: "Telegram request failed" };
  }
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (request, ctx) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return Response.json({ error: "Telegram bot is not configured." }, { status: 500 });
    }

    const now = new Date();
    const retryStart = new Date(now.getTime() - RETRY_WINDOW_MINUTES * 60 * 1000);
    const { data, error } = await ctx.supabaseAdmin
      .from("match_reminders")
      .select("id, telegram_user_id, match_id, remind_at")
      .gte("remind_at", retryStart.toISOString())
      .lte("remind_at", now.toISOString())
      .order("remind_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("Unable to load due reminders", error.code, error.message);
      return Response.json({ error: "Could not load due reminders." }, { status: 500 });
    }

    const reminders = (data || []) as ReminderRow[];
    if (reminders.length === 0) {
      return Response.json({ success: true, due: 0, sent: 0, failed: 0 });
    }

    const userIds = [...new Set(reminders.map((reminder) => reminder.telegram_user_id))];
    const matchIds = [...new Set(reminders.map((reminder) => reminder.match_id))];
    const [{ data: users, error: usersError }, { data: matches, error: matchesError }] =
      await Promise.all([
        ctx.supabaseAdmin
          .from("telegram_reminder_users")
          .select("telegram_user_id, chat_id")
          .in("telegram_user_id", userIds),
        ctx.supabaseAdmin
          .from("matches")
          .select("id, team1, team2, competition, match_date, match_time")
          .in("id", matchIds),
      ]);

    if (usersError || matchesError) {
      console.error(
        "Unable to prepare reminders",
        usersError?.code || matchesError?.code,
        usersError?.message || matchesError?.message,
      );
      return Response.json({ error: "Could not prepare reminders." }, { status: 500 });
    }

    const chatByUserId = new Map(
      (users || []).map((user) => [Number(user.telegram_user_id), Number(user.chat_id)]),
    );
    const matchById = new Map(
      ((matches || []) as Match[]).map((match) => [Number(match.id), match]),
    );
    const completedIds: number[] = [];
    let sent = 0;
    let failed = 0;

    for (const reminder of reminders) {
      const chatId = chatByUserId.get(Number(reminder.telegram_user_id));
      const match = matchById.get(Number(reminder.match_id));

      if (!Number.isSafeInteger(Number(chatId)) || !match) {
        completedIds.push(reminder.id);
        failed += 1;
        continue;
      }

      const result = await sendReminder(botToken, Number(chatId), match);
      if (result.ok) {
        completedIds.push(reminder.id);
        sent += 1;
      } else {
        failed += 1;
        console.error("Telegram reminder failed", reminder.id, result.description);
        if (result.terminal) completedIds.push(reminder.id);
      }
    }

    if (completedIds.length > 0) {
      const { error: deleteError } = await ctx.supabaseAdmin
        .from("match_reminders")
        .delete()
        .in("id", completedIds);

      if (deleteError) {
        console.error("Unable to clear delivered reminders", deleteError.code, deleteError.message);
        return Response.json(
          { error: "Reminders were processed but could not be cleared." },
          { status: 500 },
        );
      }
    }

    return Response.json({ success: true, due: reminders.length, sent, failed });
  }),
};
