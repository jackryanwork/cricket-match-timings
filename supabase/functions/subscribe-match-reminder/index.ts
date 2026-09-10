import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const encoder = new TextEncoder();
const DEFAULT_REMINDER_MINUTES = 30;
const ALLOWED_REMINDER_MINUTES = new Set([5, 15, 30, 120]);
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const requestBuckets = new Map<number, { startedAt: number; count: number }>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cricnivo.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

type TelegramUser = {
  id?: number;
};

function isRateLimited(telegramUserId: number) {
  const now = Date.now();
  const bucket = requestBuckets.get(telegramUserId);
  if (!bucket || now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
    requestBuckets.set(telegramUserId, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

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

function getCanonicalMatchStart(match: {
  match_start_at?: string | null;
  match_date?: string | null;
  match_time?: string | null;
  match_timezone?: string | null;
}) {
  if (match.match_start_at) {
    const canonicalStart = new Date(match.match_start_at);
    if (!Number.isNaN(canonicalStart.getTime())) return canonicalStart;
  }

  // Legacy rows are covered by the migration, but retain a safe fallback.
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
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      guess = new Date(wallClock - (displayed - guess.getTime()));
    }
    return Number.isNaN(guess.getTime()) ? null : guess;
  } catch {
    return null;
  }
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return json({ error: "Reminder service is not configured." }, 500);
    }

    let body: { initData?: unknown; matchId?: unknown; action?: unknown; reminderMinutes?: unknown; timezone?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body." }, 400);
    }

    if (typeof body.initData !== "string") {
      return json({ error: "Telegram verification is required." }, 401);
    }

    const telegramUserId = await verifyTelegramInitData(body.initData, botToken);
    const requestedTimeZone = typeof body.timezone === "string" ? body.timezone.trim() : "";
    let userTimeZone: string | null = null;
    if (requestedTimeZone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: requestedTimeZone }).format();
        userTimeZone = requestedTimeZone;
      } catch {
        return json({ error: "Invalid timezone." }, 400);
      }
    }
    const action = typeof body.action === "string" ? body.action : "set";
    const matchId = Number(body.matchId);
    const reminderMinutes = body.reminderMinutes === undefined
      ? DEFAULT_REMINDER_MINUTES
      : Number(body.reminderMinutes);

    if (!telegramUserId) {
      return json({ error: "Invalid reminder request." }, 400);
    }

    if (userTimeZone) {
      const { error: timezoneError } = await ctx.supabaseAdmin
        .from("telegram_reminder_users")
        .upsert(
          { telegram_user_id: telegramUserId, chat_id: telegramUserId, timezone: userTimeZone, updated_at: new Date().toISOString() },
          { onConflict: "telegram_user_id" },
        );
      if (timezoneError) console.error("Unable to save Telegram timezone", timezoneError.code);
    }

    if (isRateLimited(telegramUserId)) {
      return json({ error: "Too many reminder requests. Please try again shortly." }, 429);
    }

    if (action === "list") {
      const { data: reminderRows, error: reminderError } = await ctx.supabaseAdmin
        .from("match_reminders")
        .select("match_id, remind_at, reminder_minutes")
        .eq("telegram_user_id", telegramUserId)
        .gte("remind_at", new Date().toISOString())
        .order("remind_at", { ascending: true });

      if (reminderError) {
        console.error("Unable to list reminders", reminderError.code, reminderError.message);
        return json({ error: "Could not load reminders." }, 500);
      }

      const matchIds = [...new Set((reminderRows || []).map((row) => Number(row.match_id)))]
        .filter((id) => Number.isSafeInteger(id) && id > 0);

      if (matchIds.length === 0) {
        return json({ success: true, reminders: [] });
      }

      const { data: matches, error: matchesError } = await ctx.supabase
        .from("matches")
        .select("id, team1, team2, competition, match_date, match_time, match_start_at, match_timezone, venue")
        .in("id", matchIds);

      if (matchesError) {
        console.error("Unable to load reminder matches", matchesError.code, matchesError.message);
        return json({ error: "Could not load reminder matches." }, 500);
      }

      const matchesById = new Map((matches || []).map((match) => [Number(match.id), match]));
      const reminders = (reminderRows || []).flatMap((row) => {
        const reminderMatch = matchesById.get(Number(row.match_id));
        return reminderMatch
          ? [{ ...reminderMatch, remind_at: row.remind_at, reminder_minutes: row.reminder_minutes }]
          : [];
      });

      return json({ success: true, reminders });
    }

    if (!Number.isSafeInteger(matchId) || matchId <= 0) {
      return json({ error: "Invalid reminder request." }, 400);
    }

    if (action === "cancel") {
      const { error: cancelError } = await ctx.supabaseAdmin
        .from("match_reminders")
        .delete()
        .eq("telegram_user_id", telegramUserId)
        .eq("match_id", matchId);

      if (cancelError) {
        console.error("Unable to cancel reminder", cancelError.code, cancelError.message);
        return json({ error: "Could not cancel reminder." }, 500);
      }

      return json({ success: true, cancelled: true });
    }

    if (action !== "set") {
      return json({ error: "Unknown reminder action." }, 400);
    }

    if (!Number.isSafeInteger(reminderMinutes) || !ALLOWED_REMINDER_MINUTES.has(reminderMinutes)) {
      return json({ error: "Invalid reminder time." }, 400);
    }

    const { data: match, error: matchError } = await ctx.supabase
      .from("matches")
      .select("id, match_date, match_time, match_start_at, match_timezone")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError) {
      console.error("Unable to load reminder match", matchError.code, matchError.message);
      return json({ error: "Could not load this match right now." }, 500);
    }

    if (!match) {
      return json({ error: "Match not found." }, 404);
    }

    const matchStart = getCanonicalMatchStart(match);
    const remindAt = matchStart && new Date(matchStart.getTime() - reminderMinutes * 60_000);

    if (!matchStart || matchStart.getTime() <= Date.now()) {
      return json({ error: "This match has already started or has no valid start time." }, 422);
    }

    if (!remindAt || remindAt.getTime() <= Date.now()) {
      return json({ error: `This match starts in less than ${reminderMinutes} minutes.` }, 422);
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
      return json({ error: "Could not save reminder preference." }, 500);
    }

    const { data: existingReminder, error: existingError } = await ctx.supabaseAdmin
      .from("match_reminders")
        .select("id, remind_at, reminder_minutes")
        .eq("telegram_user_id", telegramUserId)
        .eq("match_id", matchId)
        .limit(1)
        .maybeSingle();

    if (existingError) {
      console.error("Unable to check reminder", existingError.code);
      return json({ error: "Could not save reminder." }, 500);
    }

    if (existingReminder) {
      const sameReminder = existingReminder.reminder_minutes === reminderMinutes
        && Math.abs(new Date(existingReminder.remind_at).getTime() - remindAt.getTime()) < 1000;
      if (sameReminder) {
        return json({ success: true, alreadyExists: true, reminderMinutes });
      }

      const { error: updateError } = await ctx.supabaseAdmin
        .from("match_reminders")
        .update({ remind_at: remindAt.toISOString(), reminder_minutes: reminderMinutes, processing_at: null })
        .eq("telegram_user_id", telegramUserId)
        .eq("match_id", matchId);

      if (updateError) {
        console.error("Unable to update reminder", updateError.code);
        return json({ error: "Could not update reminder." }, 500);
      }

      return json({ success: true, updated: true, reminderMinutes, remindAt: remindAt.toISOString() });
    }

    const { error: reminderError } = await ctx.supabaseAdmin
      .from("match_reminders")
      .insert({
        telegram_user_id: telegramUserId,
        match_id: matchId,
        remind_at: remindAt.toISOString(),
        reminder_minutes: reminderMinutes,
      });

    if (reminderError) {
      if (reminderError.code === "23505") {
        const { error: raceUpdateError } = await ctx.supabaseAdmin
          .from("match_reminders")
          .update({ remind_at: remindAt.toISOString(), reminder_minutes: reminderMinutes, processing_at: null })
          .eq("telegram_user_id", telegramUserId)
          .eq("match_id", matchId);
        if (!raceUpdateError) {
          return json({ success: true, updated: true, reminderMinutes, remindAt: remindAt.toISOString() });
        }
      }
      console.error("Unable to create reminder", reminderError.code);
        return json({ error: "Could not save reminder." }, 500);
    }

    return json({ success: true, reminderMinutes, remindAt: remindAt.toISOString() });
  }),
};
