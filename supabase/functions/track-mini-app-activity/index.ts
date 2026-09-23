import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const encoder = new TextEncoder();
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
const MIN_ACTIVITY_INTERVAL_MS = 30 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const SESSION_TOKEN_TTL_SECONDS = 30 * 60;
const SESSION_TOKEN_KEY_LABEL = "CricNivoMiniAppSession";
const ALLOWED_ORIGINS = new Set([
  "https://www.cricnivo.com",
  "https://cricnivo.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

type TelegramUser = { id?: number };
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

async function hmacSha256(key: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
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
  if (!receivedHash || !Number.isSafeInteger(authDate) || !userText) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (authDate > nowSeconds + 60 || nowSeconds - authDate > MAX_INIT_DATA_AGE_SECONDS) return null;

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
  const signingKey = await hmacSha256(encoder.encode(SESSION_TOKEN_KEY_LABEL), botToken);
  const expectedSignature = toHex(await hmacSha256(signingKey, payload));
  return safeEqual(expectedSignature, parts[2]) ? userId : null;
}

function getCorsHeaders(request: Request) {
  const requestOrigin = request.headers.get("origin") || "";
  const origin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "https://www.cricnivo.com";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
  };
}

function json(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return Response.json(body, { status, headers });
}

function getIndiaDate(date = new Date(), offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request, ctx) => {
    const corsHeaders = getCorsHeaders(request);
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, corsHeaders);

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "Activity service is not configured." }, 500, corsHeaders);

    const parsedBody = await readJsonBody<{ initData?: unknown; sessionToken?: unknown }>(request, MAX_BODY_BYTES);
    if (parsedBody.error === "too_large") {
      return json({ error: "Request is too large." }, 413, corsHeaders);
    }
    if (parsedBody.error === "invalid") {
      return json({ error: "Invalid request body." }, 400, corsHeaders);
    }
    const initData = typeof parsedBody.value.initData === "string" ? parsedBody.value.initData : "";
    const sessionToken = typeof parsedBody.value.sessionToken === "string" ? parsedBody.value.sessionToken : "";

    const telegramUserId = (sessionToken ? await verifySessionToken(sessionToken, botToken) : null)
      || (initData ? await verifyTelegramInitData(initData, botToken) : null);
    if (!telegramUserId) return json({ error: "Invalid Telegram user." }, 401, corsHeaders);

    const now = new Date();
    const nowIso = now.toISOString();
    const { data: presence, error: presenceLookupError } = await ctx.supabaseAdmin
      .from("telegram_mini_app_presence")
      .select("last_seen_at")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();

    if (presenceLookupError) {
      console.error("Unable to check Mini App activity", presenceLookupError.code);
      return json({ error: "Could not record Mini App activity." }, 500, corsHeaders);
    }

    const lastSeenAt = presence?.last_seen_at ? Date.parse(presence.last_seen_at) : 0;
    if (lastSeenAt && now.getTime() - lastSeenAt < MIN_ACTIVITY_INTERVAL_MS) {
      return json({ error: "Activity update is too frequent." }, 429, corsHeaders);
    }
    const visitDate = getIndiaDate(now);

    const { error: dailyVisitError } = await ctx.supabaseAdmin
      .from("telegram_mini_app_daily_visits")
      .upsert(
        { telegram_user_id: telegramUserId, visit_date: visitDate },
        { onConflict: "telegram_user_id,visit_date", ignoreDuplicates: true },
      );
    if (dailyVisitError) {
      console.error("Unable to save Mini App daily activity", dailyVisitError.code);
      return json({ error: "Could not record Mini App activity." }, 500, corsHeaders);
    }

    const { error: presenceError } = await ctx.supabaseAdmin
      .from("telegram_mini_app_presence")
      .upsert(
        { telegram_user_id: telegramUserId, last_seen_at: nowIso },
        { onConflict: "telegram_user_id" },
      );
    if (presenceError) {
      console.error("Unable to save Mini App presence", presenceError.code);
      return json({ error: "Could not record Mini App activity." }, 500, corsHeaders);
    }

    return json({ success: true }, 200, corsHeaders);
  }),
};
