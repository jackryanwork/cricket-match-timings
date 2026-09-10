import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const MINI_APP_URL = "https://www.cricnivo.com/";
const ALLOWED_REMINDER_MINUTES = new Set([5, 15, 30, 120]);
const RETRY_WINDOW_MINUTES = 10;

type ReminderRow = {
  id: number;
  telegram_user_id: number;
  match_id: number;
  remind_at: string;
  reminder_minutes: number;
  processing_at: string | null;
};

type Match = {
  id: number;
  team1: string;
  team2: string;
  competition: string | null;
  match_date: string;
  match_time: string;
  match_start_at: string | null;
  match_timezone: string | null;
  venue: string | null;
};

function getCanonicalMatchStart(match: Match) {
  if (match.match_start_at) {
    const canonicalStart = new Date(match.match_start_at);
    if (!Number.isNaN(canonicalStart.getTime())) return canonicalStart;
  }

  if (!match.match_date || !match.match_time) return null;
  const time = String(match.match_time).slice(0, 8);
  const [year, month, day] = String(match.match_date).split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;

  try {
    const timeZone = match.match_timezone || "Asia/Kolkata";
    const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
    let guess = new Date(wallClock);
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(guess)
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value]),
      );
      const displayed = Date.UTC(
        Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        Number(parts.hour), Number(parts.minute), Number(parts.second),
      );
      guess = new Date(wallClock - (displayed - guess.getTime()));
    }
    return Number.isNaN(guess.getTime()) ? null : guess;
  } catch {
    return null;
  }
}

function formatMatchDateTime(start: Date, timeZone: string | null) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: timeZone || "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(start);
  } catch {
    return start.toISOString();
  }
}

async function sendReminder(
  botToken: string,
  chatId: number,
  match: Match,
  reminderMinutes: number,
  userTimeZone: string | null,
) {
  const matchStart = getCanonicalMatchStart(match);
  if (!matchStart) return { ok: false, terminal: true, description: "Invalid match start" };

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          `🔔 Match starts in ${reminderMinutes} minutes!\n\n` +
          `🏏 ${match.team1} vs ${match.team2}\n` +
          `${match.competition || "Cricket match"}\n` +
          `📅 ${formatMatchDateTime(matchStart, userTimeZone || match.match_timezone)}\n` +
          `${match.venue ? `📍 ${match.venue}` : ""}`,
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
      .select("id, telegram_user_id, match_id, remind_at, reminder_minutes, processing_at")
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
          .select("telegram_user_id, chat_id, timezone")
          .in("telegram_user_id", userIds),
        ctx.supabaseAdmin
          .from("matches")
          .select("id, team1, team2, competition, match_date, match_time, match_start_at, match_timezone, venue")
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

    const userById = new Map(
      (users || []).map((user) => [Number(user.telegram_user_id), user]),
    );
    const matchById = new Map(
      ((matches || []) as Match[]).map((match) => [Number(match.id), match]),
    );
    const completedIds: number[] = [];
    let sent = 0;
    let failed = 0;

    for (const reminder of reminders) {
      const user = userById.get(Number(reminder.telegram_user_id));
      const chatId = user?.chat_id;
      const match = matchById.get(Number(reminder.match_id));

      if (!Number.isSafeInteger(Number(chatId)) || !match) {
        completedIds.push(reminder.id);
        failed += 1;
        continue;
      }

      const reminderMinutes = Number(reminder.reminder_minutes);
      const matchStart = getCanonicalMatchStart(match);
      if (!ALLOWED_REMINDER_MINUTES.has(reminderMinutes) || !matchStart) {
        completedIds.push(reminder.id);
        failed += 1;
        continue;
      }

      if (matchStart.getTime() <= now.getTime()) {
        // Never send an old reminder after a match has already started.
        completedIds.push(reminder.id);
        continue;
      }

      const expectedRemindAt = new Date(matchStart.getTime() - reminderMinutes * 60_000);
      if (Math.abs(expectedRemindAt.getTime() - new Date(reminder.remind_at).getTime()) >= 1000) {
        const { error: rescheduleError } = await ctx.supabaseAdmin
          .from("match_reminders")
          .update({ remind_at: expectedRemindAt.toISOString(), processing_at: null })
          .eq("id", reminder.id);
        if (rescheduleError) console.error("Unable to reschedule reminder", reminder.id, rescheduleError.code);
        continue;
      }

      const { data: claimedReminder, error: claimError } = await ctx.supabaseAdmin
        .from("match_reminders")
        .update({ processing_at: now.toISOString() })
        .eq("id", reminder.id)
        .or(`processing_at.is.null,processing_at.lt.${new Date(now.getTime() - RETRY_WINDOW_MINUTES * 60_000).toISOString()}`)
        .select("id")
        .maybeSingle();

      if (claimError || !claimedReminder) continue;

      const result = await sendReminder(
        botToken,
        Number(chatId),
        match,
        reminderMinutes,
        user?.timezone || null,
      );
      if (result.ok) {
        completedIds.push(reminder.id);
        sent += 1;
      } else {
        failed += 1;
        console.error("Telegram reminder failed", reminder.id, result.description);
        if (result.terminal) {
          completedIds.push(reminder.id);
        } else {
          await ctx.supabaseAdmin
            .from("match_reminders")
            .update({ processing_at: null })
            .eq("id", reminder.id);
        }
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
