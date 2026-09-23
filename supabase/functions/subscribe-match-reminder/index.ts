import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const encoder = new TextEncoder();
const ALLOWED_MINUTES = new Set([5, 30, 60, 120]);
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_BODY_BYTES = 32 * 1024;
const SESSION_TOKEN_TTL_SECONDS = 30 * 60;
const SESSION_TOKEN_KEY_LABEL = "CricNivoMiniAppSession";
const requestBuckets = new Map<number, { startedAt: number; count: number }>();
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cricnivo.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

type JsonBodyResult<T> = { value: T } | { error: "too_large" | "invalid" };

async function readJsonBody<T>(request: Request, maxBytes: number): Promise<JsonBodyResult<T>> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) return { error: "invalid" };
    if (contentLength > maxBytes) return { error: "too_large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { error: "invalid" };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) return { error: "invalid" };
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The request is already being rejected; cancellation failure is non-fatal.
        }
        return { error: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "invalid" };
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { value: JSON.parse(new TextDecoder().decode(bodyBytes)) as T };
  } catch {
    return { error: "invalid" };
  }
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

async function hmac(key: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

async function verifyInitData(initData: string, botToken: string) {
  if (!initData || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const userText = params.get("user");
  if (!receivedHash || !Number.isSafeInteger(authDate) || !userText) return null;

  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 60 || now - authDate > MAX_INIT_DATA_AGE_SECONDS) return null;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = await hmac(encoder.encode("WebAppData"), botToken);
  const computedHash = [...await hmac(secretKey, dataCheckString)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!safeEqual(computedHash, receivedHash)) return null;

  try {
    const user = JSON.parse(userText) as { id?: number };
    return Number.isSafeInteger(user.id) && Number(user.id) > 0 ? Number(user.id) : null;
  } catch {
    return null;
  }
}

async function verifySessionToken(token: string, botToken: string) {
  if (!token || token.length > 256) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const userId = Number(parts[0]);
  const expiresAt = Number(parts[1]);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  if (!Number.isSafeInteger(expiresAt) || expiresAt < nowSeconds || expiresAt > nowSeconds + SESSION_TOKEN_TTL_SECONDS + 60) {
    return null;
  }

  const payload = `${userId}.${expiresAt}`;
  const signingKey = await hmac(encoder.encode(SESSION_TOKEN_KEY_LABEL), botToken);
  const expectedSignature = [...await hmac(signingKey, payload)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return safeEqual(expectedSignature, parts[2]) ? userId : null;
}

function isRateLimited(userId: number) {
  const now = Date.now();
  const bucket = requestBuckets.get(userId);
  if (!bucket || now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
    requestBuckets.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

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

function validTimeZone(timeZone: unknown) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return null;
  try {
    const value = timeZone.trim();
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return null;
  }
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request, ctx) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);


    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "Reminder service is not configured." }, 500);

    const parsedBody = await readJsonBody<{
      initData?: unknown;
      sessionToken?: unknown;
      action?: unknown;
      matchId?: unknown;
      reminderMinutes?: unknown;
      timezone?: unknown;
    }>(request, MAX_BODY_BYTES);
    if (parsedBody.error === "too_large") {
      return json({ error: "Request is too large." }, 413);
    }
    if (parsedBody.error === "invalid") {
      return json({ error: "Invalid request body." }, 400);
    }
    const body = parsedBody.value;

    const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";
    const initData = typeof body.initData === "string" ? body.initData : "";
    const userId = (sessionToken ? await verifySessionToken(sessionToken, botToken) : null)
      || (initData ? await verifyInitData(initData, botToken) : null);
    if (!userId) return json({ error: "Telegram verification is required." }, 401);
    if (isRateLimited(userId)) return json({ error: "Too many reminder requests. Please try again shortly." }, 429);

    const action = typeof body.action === "string" ? body.action : "set";
    if (action === "list") {
      const { data: reminders, error: remindersError } = await ctx.supabaseAdmin.from("match_reminders")
        .select("match_id, remind_at, reminder_minutes")
        .eq("telegram_user_id", userId)
        .gt("remind_at", new Date().toISOString())
        .order("remind_at", { ascending: true });
      if (remindersError) return json({ error: "Could not load reminders." }, 500);
      const matchIds = (reminders || []).map((reminder) => Number(reminder.match_id));
      if (!matchIds.length) return json({ success: true, reminders: [] });
      const { data: matches, error: matchesError } = await ctx.supabaseAdmin.from("matches")
        .select("id, team1, team2, competition, competition_name")
        .in("id", matchIds);
      if (matchesError) return json({ error: "Could not load reminder matches." }, 500);
      const matchById = new Map((matches || []).map((match) => [Number(match.id), match]));
      return json({
        success: true,
        reminders: (reminders || []).map((reminder) => ({
          matchId: Number(reminder.match_id),
          remindAt: reminder.remind_at,
          reminderMinutes: Number(reminder.reminder_minutes),
          ...(matchById.get(Number(reminder.match_id)) || {}),
        })),
      });
    }
    const matchId = Number(body.matchId);
    if (!Number.isSafeInteger(matchId) || matchId <= 0) return json({ error: "Invalid match." }, 400);
    if (action === "cancel") {
      const { error } = await ctx.supabaseAdmin.from("match_reminders")
        .delete().eq("telegram_user_id", userId).eq("match_id", matchId);
      return error ? json({ error: "Could not cancel reminder." }, 500) : json({ success: true, cancelled: true });
    }
    if (action !== "set") return json({ error: "Unknown reminder action." }, 400);

    const reminderMinutes = Number(body.reminderMinutes);
    if (!Number.isSafeInteger(reminderMinutes) || !ALLOWED_MINUTES.has(reminderMinutes)) {
      return json({ error: "Invalid reminder time." }, 400);
    }

    const { data: match, error: matchError } = await ctx.supabaseAdmin.from("matches")
      .select("id, match_date, match_time, match_start_at, match_timezone, match_status")
      .eq("id", matchId).maybeSingle();
    if (matchError) return json({ error: "Could not load this match right now." }, 500);
    if (!match) return json({ error: "Match not found." }, 404);

    const start = matchStart(match);
    const remindAt = start ? new Date(start.getTime() - reminderMinutes * 60_000) : null;
    if (match.match_status === "finished") return json({ error: "Finished matches cannot have reminders." }, 422);
    if (!start || start.getTime() <= Date.now()) return json({ error: "This match has already started or has no valid start time." }, 422);
    if (!remindAt || remindAt.getTime() <= Date.now()) return json({ error: `This match starts in less than ${reminderMinutes} minutes.` }, 422);

    const { data: botUser, error: botUserError } = await ctx.supabaseAdmin.from("telegram_bot_users")
      .select("chat_id").eq("telegram_user_id", userId).eq("is_active", true).maybeSingle();
    if (botUserError || !botUser?.chat_id) return json({ error: "Start the CricNivo bot before setting a reminder." }, 403);

    const timeZone = validTimeZone(body.timezone);
    const { error: userError } = await ctx.supabaseAdmin.from("telegram_reminder_users").upsert({
      telegram_user_id: userId, chat_id: Number(botUser.chat_id), ...(timeZone ? { timezone: timeZone } : {}),
    }, { onConflict: "telegram_user_id" });
    if (userError) return json({ error: "Could not save reminder preference." }, 500);

    const { error: reminderError } = await ctx.supabaseAdmin.from("match_reminders").upsert({
      telegram_user_id: userId, match_id: matchId, remind_at: remindAt.toISOString(), reminder_minutes: reminderMinutes, processing_at: null,
    }, { onConflict: "telegram_user_id,match_id" });
    if (reminderError) {
      console.error("Unable to save reminder", reminderError.code, reminderError.message);
      return json({ error: "Could not save reminder." }, 500);
    }
    return json({ success: true, reminderMinutes, remindAt: remindAt.toISOString() });
  }),
};
