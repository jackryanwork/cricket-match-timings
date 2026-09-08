import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

type CricketDataMatch = {
  id?: string;
  date?: string;
  dateTimeGMT?: string;
  teams?: string[];
  teamInfo?: Array<{ name?: string }>;
  matchType?: string;
  venue?: string;
};

type MatchRow = {
  cricketdata_match_id: string;
  source: "cricketdata";
  team1: string;
  team2: string;
  match_date: string;
  match_time: string;
  match_start_at: string;
  match_timezone: string;
  competition: string;
  venue: string;
};

function formatCompetition(matchType?: string) {
  const labels: Record<string, string> = {
    odi: "ODI",
    test: "Test",
    t20: "T20",
    t20i: "T20 International",
    t10: "T10",
  };
  const value = (matchType || "").toLowerCase();
  return labels[value] || matchType || "Cricket Match";
}

function indiaDateAndTime(dateTimeText?: string, fallbackDate?: string) {
  if (!dateTimeText) return { date: fallbackDate, time: "00:00:00", startAt: null };

  const value = /(?:Z|[+-]\d\d:\d\d)$/.test(dateTimeText)
    ? dateTimeText
    : `${dateTimeText}Z`;
  const dateTime = new Date(value);
  if (Number.isNaN(dateTime.getTime())) {
    return { date: fallbackDate, time: "00:00:00", startAt: null };
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(dateTime);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
    startAt: dateTime.toISOString(),
  };
}

async function fetchWithRetry(url: URL, provider: string) {
  let response: Response | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(url);
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  if (!response) {
    const reason = lastError instanceof Error
      ? `${lastError.name}: ${lastError.message}`
      : String(lastError || "unknown connection error");
    const safeUrl = `${url.origin}${url.pathname}`;
    const safeReason = reason.replace(url.toString(), safeUrl);
    throw new Error(
      `${provider} connection failed after 3 attempts: ${safeReason}`,
    );
  }
  return response;
}

async function loadCricketDataRows(apiKey: string): Promise<MatchRow[]> {
  const apiUrl = new URL("https://api.cricapi.com/v1/matches");
  apiUrl.searchParams.set("apikey", apiKey);
  apiUrl.searchParams.set("offset", "0");
  const response = await fetchWithRetry(apiUrl, "CricketData");
  const body = await response.json();
  if (!response.ok || body?.status !== "success") {
    throw new Error(`CricketData returned HTTP ${response.status}.`);
  }

  return ((body.data || []) as CricketDataMatch[])
    .map((match) => {
      const teams =
        match.teams?.filter(Boolean) ||
        match.teamInfo?.map((team) => team.name || "").filter(Boolean) ||
        [];
      const { date, time, startAt } = indiaDateAndTime(
        match.dateTimeGMT,
        match.date?.slice(0, 10),
      );
      if (!match.id || teams.length < 2 || !date) return null;
      return {
        cricketdata_match_id: match.id,
        source: "cricketdata" as const,
        team1: teams[0],
        team2: teams[1],
        match_date: date,
        match_time: time,
        match_start_at: startAt || new Date(`${date}T${time}+05:30`).toISOString(),
        match_timezone: "Asia/Kolkata",
        competition: formatCompetition(match.matchType),
        venue: match.venue || "Venue to be confirmed",
      };
    })
    .filter((row): row is MatchRow => row !== null);
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (_request, ctx) => {
    const cricketDataKey = Deno.env.get("CRICKETDATA_API_KEY");
    let provider: MatchRow["source"];
    let rows: MatchRow[];

    try {
      if (!cricketDataKey) {
        return Response.json(
          {
            error: "CRICKETDATA_API_KEY is not configured.",
          },
          { status: 502 },
        );
      }
      rows = await loadCricketDataRows(cricketDataKey);
      provider = "cricketdata";
    } catch (error) {
      console.error("CricketData sync failed.", error);
      return Response.json(
        { error: "Match provider is temporarily unavailable." },
        { status: 502 },
      );
    }

    if (rows.length === 0) {
      return Response.json({ success: true, provider, importedMatches: 0 });
    }

    const { error } = await ctx.supabaseAdmin
      .from("matches")
      .upsert(rows, { onConflict: "cricketdata_match_id" });
    if (error) {
      return Response.json(
        { error: `Supabase save failed: ${error.message}` },
        { status: 500 },
      );
    }
    return Response.json({
      success: true,
      provider,
      importedMatches: rows.length,
    });
  }),
};
