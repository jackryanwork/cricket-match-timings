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

type SportMonksFixture = {
  id?: number;
  starting_at?: string;
  type?: string;
  localteam?: { name?: string };
  visitorteam?: { name?: string };
  league?: { name?: string };
  venue?: { name?: string };
};

type MatchRow = {
  cricketdata_match_id: string;
  source: "cricketdata" | "sportmonks";
  team1: string;
  team2: string;
  match_date: string;
  match_time: string;
  competition: string;
  venue: string;
};

const MAX_SPORTMONKS_PAGES = 3;

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
  if (!dateTimeText) return { date: fallbackDate, time: "00:00:00" };

  const value = /(?:Z|[+-]\d\d:\d\d)$/.test(dateTimeText)
    ? dateTimeText
    : `${dateTimeText}Z`;
  const dateTime = new Date(value);
  if (Number.isNaN(dateTime.getTime())) {
    return { date: fallbackDate, time: "00:00:00" };
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
  };
}

function utcDateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fetchWithRetry(url: URL, provider: string) {
  let response: Response | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(url);
      break;
    } catch {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  if (!response)
    throw new Error(`${provider} connection failed after 3 attempts.`);
  return response;
}

async function loadSportMonksRows(apiToken: string): Promise<MatchRow[]> {
  const fixtures: SportMonksFixture[] = [];
  for (let page = 1; page <= MAX_SPORTMONKS_PAGES; page += 1) {
    const apiUrl = new URL("https://cricket.sportmonks.com/api/v2.0/fixtures");
    apiUrl.searchParams.set("api_token", apiToken);
    apiUrl.searchParams.set("include", "localteam,visitorteam,league,venue");
    apiUrl.searchParams.set(
      "filter[starts_between]",
      `${utcDateOffset(-1)},${utcDateOffset(60)}`,
    );
    apiUrl.searchParams.set("sort", "starting_at");
    apiUrl.searchParams.set("page", String(page));

    const response = await fetchWithRetry(apiUrl, "SportMonks");
    const body = await response.json();
    if (!response.ok || !Array.isArray(body?.data)) {
      throw new Error(`SportMonks returned HTTP ${response.status}.`);
    }

    fixtures.push(...body.data);
    const pagination = body?.meta?.pagination;
    if (
      !pagination ||
      Number(pagination.current_page) >= Number(pagination.total_pages)
    )
      break;
  }

  return fixtures
    .map((fixture) => {
      const { date, time } = indiaDateAndTime(fixture.starting_at);
      const team1 = fixture.localteam?.name?.trim();
      const team2 = fixture.visitorteam?.name?.trim();
      if (!fixture.id || !team1 || !team2 || !date) return null;
      return {
        cricketdata_match_id: `sportmonks:${fixture.id}`,
        source: "sportmonks" as const,
        team1,
        team2,
        match_date: date,
        match_time: time,
        competition:
          fixture.league?.name?.trim() || formatCompetition(fixture.type),
        venue: fixture.venue?.name?.trim() || "Venue to be confirmed",
      };
    })
    .filter((row): row is MatchRow => row !== null);
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
      const { date, time } = indiaDateAndTime(
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
        competition: formatCompetition(match.matchType),
        venue: match.venue || "Venue to be confirmed",
      };
    })
    .filter((row): row is MatchRow => row !== null);
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (_request, ctx) => {
    const sportMonksToken = Deno.env.get("SPORTMONKS_API_TOKEN");
    const cricketDataKey = Deno.env.get("CRICKETDATA_API_KEY");
    let provider: MatchRow["source"];
    let rows: MatchRow[];

    try {
      if (!sportMonksToken)
        throw new Error("SPORTMONKS_API_TOKEN is not configured.");
      rows = await loadSportMonksRows(sportMonksToken);
      provider = "sportmonks";
    } catch (sportMonksError) {
      console.error(
        "SportMonks sync failed; using CricketData fallback.",
        sportMonksError,
      );
      if (!cricketDataKey) {
        return Response.json(
          {
            error: "Neither SportMonks nor CricketData could provide matches.",
          },
          { status: 502 },
        );
      }
      try {
        rows = await loadCricketDataRows(cricketDataKey);
        provider = "cricketdata";
      } catch (cricketDataError) {
        console.error("CricketData fallback failed.", cricketDataError);
        return Response.json(
          { error: "Match providers are temporarily unavailable." },
          { status: 502 },
        );
      }
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
