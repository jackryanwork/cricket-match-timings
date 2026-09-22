import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const ADMIN_USER_ID = "749c0b4a-ae6d-41cc-b046-1695089f191c";
const ALLOWED_ORIGINS = new Set([
  "https://www.cricnivo.com",
  "https://cricnivo.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

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

    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Admin login is required." }, 401, corsHeaders);

    const { data: authData, error: authError } = await ctx.supabaseAdmin.auth.getUser(accessToken);
    if (authError || authData.user?.id !== ADMIN_USER_ID) {
      return json({ error: "You are not authorized to view analytics." }, 403, corsHeaders);
    }

    const { data: assurance, error: assuranceError } =
      await ctx.supabaseAdmin.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
    if (assuranceError || assurance.currentLevel !== "aal2") {
      return json({ error: "Two-factor authentication is required." }, 403, corsHeaders);
    }

    const today = getIndiaDate();
    const sevenDayStart = getIndiaDate(new Date(), -6);
    const activeSince = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data, error } = await ctx.supabaseAdmin.rpc("get_telegram_mini_app_analytics", {
      p_today: today,
      p_active_since: activeSince,
      p_seven_day_start: sevenDayStart,
    });

    if (error || !data?.[0]) {
      console.error("Unable to load Mini App analytics", error?.code || "empty_result");
      return json({ error: "Could not load Mini App analytics." }, 500, corsHeaders);
    }

    return json({
      success: true,
      metrics: {
        activeNow: Number(data[0].active_users || 0),
        today: Number(data[0].today_users || 0),
        last7Days: Number(data[0].seven_day_users || 0),
        lifetime: Number(data[0].lifetime_users || 0),
        reportingDate: today,
      },
    }, 200, corsHeaders);
  }),
};
