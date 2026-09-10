import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const RETRY_WINDOW_MINUTES = 10;
const MINI_APP_URL = "https://www.cricnivo.com/?v=4";

function matchStart(match: { match_start_at?: string | null; match_date?: string | null; match_time?: string | null; match_timezone?: string | null }) {
  if (match.match_start_at) {
    const start = new Date(match.match_start_at);
    if (!Number.isNaN(start.getTime())) return start;
  }
  if (!match.match_date || !match.match_time) return null;
  const [year, month, day] = match.match_date.split("-").map(Number);
  const [hour, minute, second = 0] = match.match_time.slice(0, 8).split(":").map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  try {
    const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
    let guess = new Date(wallClock);
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: match.match_timezone || "Asia/Kolkata", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(guess)
        .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
      const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      guess = new Date(wallClock - (displayed - guess.getTime()));
    }
    return Number.isNaN(guess.getTime()) ? null : guess;
  } catch {
    return null;
  }
}

async function sendTelegram(botToken: string, chatId: number, text: string, matchUrl: string) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: [[{ text: "📲 Open Match Timings", web_app: { url: matchUrl } }]] } }),
    });
    const result = await response.json().catch(() => ({}));
    return { ok: response.ok && result.ok === true, terminal: response.status === 400 || response.status === 403, description: result.description || "" };
  } catch {
    return { ok: false, terminal: false, description: "Telegram request failed" };
  }
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (request, ctx) => {
    if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return Response.json({ error: "Telegram bot is not configured." }, { status: 500 });

    const now = new Date();
    const retryStart = new Date(now.getTime() - RETRY_WINDOW_MINUTES * 60_000);
    const { data: reminders, error } = await ctx.supabaseAdmin.from("match_reminders")
      .select("id, telegram_user_id, match_id, remind_at, reminder_minutes, processing_at")
      .gte("remind_at", retryStart.toISOString()).lte("remind_at", now.toISOString())
      .order("remind_at", { ascending: true }).limit(100);
    if (error) return Response.json({ error: "Could not load due reminders." }, { status: 500 });
    if (!reminders?.length) return Response.json({ success: true, due: 0, sent: 0, failed: 0 });

    const userIds = [...new Set(reminders.map((row) => Number(row.telegram_user_id)))];
    const matchIds = [...new Set(reminders.map((row) => Number(row.match_id)))];
    const [{ data: users, error: usersError }, { data: matches, error: matchesError }] = await Promise.all([
      ctx.supabaseAdmin.from("telegram_reminder_users").select("telegram_user_id, chat_id, timezone").in("telegram_user_id", userIds),
      ctx.supabaseAdmin.from("matches").select("id, team1, team2, competition, match_date, match_time, match_start_at, match_timezone, venue").in("id", matchIds),
    ]);
    if (usersError || matchesError) return Response.json({ error: "Could not prepare reminders." }, { status: 500 });

    const userById = new Map((users || []).map((user) => [Number(user.telegram_user_id), user]));
    const matchById = new Map((matches || []).map((match) => [Number(match.id), match]));
    let sent = 0;
    let failed = 0;
    const completedIds: number[] = [];

    for (const reminder of reminders) {
      const match = matchById.get(Number(reminder.match_id));
      const user = userById.get(Number(reminder.telegram_user_id));
      const start = match && matchStart(match);
      const expected = start && new Date(start.getTime() - Number(reminder.reminder_minutes) * 60_000);
      if (!match || !user?.chat_id || !start || !expected || expected.getTime() <= now.getTime() - RETRY_WINDOW_MINUTES * 60_000) {
        completedIds.push(Number(reminder.id));
        continue;
      }
      if (Math.abs(new Date(reminder.remind_at).getTime() - expected.getTime()) >= 1000) {
        await ctx.supabaseAdmin.from("match_reminders").update({ remind_at: expected.toISOString(), processing_at: null }).eq("id", reminder.id);
        continue;
      }

      const { data: claimed } = await ctx.supabaseAdmin.from("match_reminders")
        .update({ processing_at: now.toISOString() }).eq("id", reminder.id)
        .or(`processing_at.is.null,processing_at.lt.${new Date(now.getTime() - RETRY_WINDOW_MINUTES * 60_000).toISOString()}`)
        .select("id").maybeSingle();
      if (!claimed) continue;

      const displayTime = new Intl.DateTimeFormat("en-IN", { timeZone: user.timezone || match.match_timezone || "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(start);
      const result = await sendTelegram(botToken, Number(user.chat_id), `🔔 Match starts in ${reminder.reminder_minutes} minutes!\n\n🏏 ${match.team1} vs ${match.team2}\n${match.competition || "Cricket match"}\n📅 ${displayTime}\n${match.venue ? `📍 ${match.venue}` : ""}`, MINI_APP_URL);
      if (result.ok || result.terminal) completedIds.push(Number(reminder.id));
      if (result.ok) sent += 1;
      else {
        failed += 1;
        if (!result.terminal) await ctx.supabaseAdmin.from("match_reminders").update({ processing_at: null }).eq("id", reminder.id);
        else if (result.description) console.error("Terminal Telegram reminder failure", reminder.id, result.description);
      }
    }

    if (completedIds.length) await ctx.supabaseAdmin.from("match_reminders").delete().in("id", completedIds);
    return Response.json({ success: true, due: reminders.length, sent, failed });
  }),
};
