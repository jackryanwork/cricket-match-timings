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

function formatCompetition(matchType?: string) {
  const labels: Record<string, string> = {
    odi: "ODI",
    test: "Test",
    t20: "T20",
    t10: "T10",
  };

  const value = (matchType || "").toLowerCase();
  return labels[value] || matchType || "Cricket Match";
}

function getIndiaDateAndTime(match: CricketDataMatch) {
  const fallbackDate = match.date?.slice(0, 10);

  if (!match.dateTimeGMT) {
    return { date: fallbackDate, time: "00:00:00" };
  }

  const value = match.dateTimeGMT.endsWith("Z")
    ? match.dateTimeGMT
    : `${match.dateTimeGMT}Z`;

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

export default {
  fetch: withSupabase({ auth: "secret" }, async (_req, ctx) => {
    const apiKey = Deno.env.get("CRICKETDATA_API_KEY");

    if (!apiKey) {
      return Response.json(
        { error: "CRICKETDATA_API_KEY is not configured." },
        { status: 500 },
      );
    }

    const apiUrl = new URL("https://api.cricapi.com/v1/matches");
    apiUrl.searchParams.set("apikey", apiKey);
    apiUrl.searchParams.set("offset", "0");

let apiResponse: Response | null = null;

for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    apiResponse = await fetch(apiUrl);
    break;
  } catch {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

if (!apiResponse) {
  console.error("CricketData connection failed after 3 attempts");
  return Response.json(
    { error: "CricketData is temporarily unavailable. Please try again later." },
    { status: 502 },
  );
}

const apiBody = await apiResponse.json();

    if (!apiResponse.ok || apiBody.status !== "success") {
      return Response.json(
        { error: "CricketData could not provide matches." },
        { status: 502 },
      );
    }

    const matches = (apiBody.data || []) as CricketDataMatch[];

    const rows = matches
      .map((match) => {
        const teams = match.teams?.filter(Boolean) ||
          match.teamInfo?.map((team) => team.name || "").filter(Boolean) ||
          [];

        const { date, time } = getIndiaDateAndTime(match);

        if (!match.id || teams.length < 2 || !date) return null;

        return {
          cricketdata_match_id: match.id,
          source: "cricketdata",
          team1: teams[0],
          team2: teams[1],
          match_date: date,
          match_time: time,
          competition: formatCompetition(match.matchType),
          venue: match.venue || "Venue to be confirmed",
        };
      })
      .filter(Boolean);

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
      importedMatches: rows.length,
    });
  }),
};