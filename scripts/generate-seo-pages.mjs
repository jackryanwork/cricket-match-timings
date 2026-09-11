import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supabaseUrl = process.env.SUPABASE_URL || "https://yhohdbdatbmxzbokjsau.supabase.co";
const select = "id,team1,team2,competition,venue,match_start_at,match_date,match_time";

const htmlEscape = value => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const getStart = match => {
  const start = match.match_start_at
    ? new Date(match.match_start_at)
    : new Date(`${match.match_date}T${match.match_time || "00:00:00"}Z`);
  return Number.isNaN(start.getTime()) ? null : start;
};

const dateText = date => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric",
}).format(date);

const timeText = date => `${new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(date)} UTC`;

const teamFlag = team => ({
  Afghanistan: "🇦🇫", Australia: "🇦🇺", Bangladesh: "🇧🇩", England: "🏴", India: "🇮🇳",
  Ireland: "🇮🇪", "New Zealand": "🇳🇿", Pakistan: "🇵🇰", "South Africa": "🇿🇦",
  "Sri Lanka": "🇱🇰", "West Indies": "🏏", Zimbabwe: "🇿🇼",
}[team] || "🏏");

const teamSlug = team => String(team).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const readKey = async () => {
  if (process.env.SUPABASE_KEY) return process.env.SUPABASE_KEY;
  const script = await fs.readFile(path.join(root, "js/script.js"), "utf8");
  const key = script.match(/const SUPABASE_KEY = ["']([^"']+)["']/)?.[1];
  if (!key) throw new Error("A Supabase publishable key is required.");
  return key;
};

const loadMatches = async () => {
  const key = await readKey();
  const url = new URL(`${supabaseUrl}/rest/v1/matches`);
  url.searchParams.set("select", select);
  url.searchParams.set("match_start_at", `gte.${new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()}`);
  url.searchParams.set("order", "match_start_at.asc");
  url.searchParams.set("limit", "100");
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}.`);
  return (await response.json()).map(match => ({ match, start: getStart(match) })).filter(item => item.start);
};

const page = ({ title, description, canonical, heading, intro, matches }) => {
  const cards = matches.length ? matches.map(({ match, start }) => `
        <article class="seo-match-card">
            <h2>${htmlEscape(teamFlag(match.team1))} ${htmlEscape(match.team1)} vs ${htmlEscape(match.team2)} ${htmlEscape(teamFlag(match.team2))}</h2>
            <p class="seo-competition">${htmlEscape(match.competition || "Cricket match")}</p>
            <p><strong>Date:</strong> <time datetime="${start.toISOString()}">${htmlEscape(dateText(start))}</time></p>
            <p><strong>Start time:</strong> <time datetime="${start.toISOString()}">${htmlEscape(timeText(start))}</time></p>
            <p><strong>Venue:</strong> ${htmlEscape(match.venue || "Venue to be confirmed")}</p>
        </article>`).join("") : "<p class=\"seo-empty\">No matches are currently listed for this period.</p>";
  const events = matches.map(({ match, start }) => ({
    "@type": "SportsEvent", name: `${match.team1} vs ${match.team2}`, sport: "Cricket",
    startDate: start.toISOString(), eventStatus: "https://schema.org/EventScheduled",
    image: ["https://www.cricnivo.com/assets/icon-512x512.png"],
    description: `${match.team1} vs ${match.team2} cricket match${match.competition ? ` in ${match.competition}` : ""}. View the scheduled start time and venue on CricNivo.`,
    location: { "@type": "Place", name: match.venue || "Venue to be confirmed" },
  }));
  const schema = JSON.stringify({ "@context": "https://schema.org", "@graph": [
    { "@type": "CollectionPage", url: canonical, name: title, description, inLanguage: "en" }, ...events,
  ] }).replaceAll("<", "\\u003c");
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${htmlEscape(title)}</title><meta name="description" content="${htmlEscape(description)}"><meta name="robots" content="index, follow">
<link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${htmlEscape(title)}"><meta property="og:description" content="${htmlEscape(description)}"><meta property="og:url" content="${canonical}">
<link rel="stylesheet" href="css/style.css?v=11"><style>.seo-match-list{display:grid;gap:12px;margin-top:20px}.seo-match-card{padding:16px;border:1px solid var(--border);border-radius:15px;background:var(--card)}.seo-match-card h2{margin:0 0 7px;font-size:17px}.seo-match-card p{margin:5px 0 0;color:var(--muted);font-size:13px}.seo-competition{color:var(--accent);font-weight:800;text-transform:uppercase}.seo-empty{padding:16px;border-radius:14px;background:var(--card);color:var(--muted)}</style>
<script type="application/ld+json">${schema}</script></head><body><main class="content-page">
<header class="content-header"><a class="content-logo" href="index.html" aria-label="CricNivo home"><img class="brand-logo" src="assets/cricnivo-logo-small.png" width="750" height="202" alt="CricNivo"></a><a class="content-home-link" href="index.html">Open live schedule</a></header>
<article class="content-card"><p class="welcome-label">Cricket match schedule</p><h1>${htmlEscape(heading)}</h1><p class="content-lead">${htmlEscape(intro)}</p><section class="seo-match-list" aria-label="Cricket matches">${cards}</section><p class="seo-empty">Times on this page are shown in UTC. Open the live schedule to view local times, countdowns, reminders, and favourites.</p></article>
<footer class="footer"><p class="footer-note">Match times are shown in your local time on the live schedule</p><p class="footer-copyright">© 2026 CricNivo. All rights reserved.</p><nav class="footer-links"><a href="index.html">Home</a> <a href="today-cricket-match.html">Schedule guide</a> <a href="privacy.html">Privacy Policy</a> <a href="terms.html">Terms</a></nav></footer>
</main></body></html>`;
};

const teamDirectoryPage = teams => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cricket Team Schedules &amp; Fixtures | CricNivo</title><meta name="description" content="Browse cricket team schedules, upcoming fixtures, venues, and start times on CricNivo."><meta name="robots" content="index, follow"><link rel="canonical" href="https://www.cricnivo.com/team-schedules.html"><link rel="stylesheet" href="css/style.css?v=11"><style>.team-directory{display:grid;gap:9px;margin-top:20px}.team-directory a{display:block;padding:13px 14px;border:1px solid var(--border);border-radius:12px;background:var(--card);color:var(--accent);font-size:14px;font-weight:800;text-decoration:none}</style></head><body><main class="content-page"><header class="content-header"><a class="content-logo" href="index.html" aria-label="CricNivo home"><img class="brand-logo" src="assets/cricnivo-logo-small.png" width="750" height="202" alt="CricNivo"></a><a class="content-home-link" href="index.html">Open live schedule</a></header><article class="content-card"><p class="welcome-label">Team schedules</p><h1>Cricket Team Schedules</h1><p class="content-lead">Browse upcoming cricket fixtures by team, including competitions, venues, dates, and scheduled start times.</p><nav class="team-directory" aria-label="Cricket team schedules">${teams.map(team => `<a href="${teamSlug(team)}-cricket-schedule.html">${htmlEscape(team)} cricket schedule</a>`).join("")}</nav></article><footer class="footer"><p class="footer-note">Match times are shown in your local time on the live schedule</p><p class="footer-copyright">© 2026 CricNivo. All rights reserved.</p><nav class="footer-links"><a href="index.html">Home</a> <a href="today-matches.html">Today’s matches</a> <a href="upcoming-cricket-matches.html">Upcoming matches</a></nav></footer></main></body></html>`;

const matches = (await loadMatches()).sort((a, b) => a.start - b.start);
const now = new Date();
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const fortnight = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
const today = matches.filter(({ start }) => start >= now && start < tomorrow);
const upcoming = matches.filter(({ start }) => start >= now && start < fortnight);

await fs.writeFile(path.join(root, "today-matches.html"), page({
  title: "Today's Cricket Matches & Schedule | CricNivo",
  description: "Check today's cricket matches, fixtures, venues, and start times on CricNivo.",
  canonical: "https://www.cricnivo.com/today-matches.html", heading: "Today’s Cricket Matches",
  intro: "Browse today’s scheduled cricket fixtures with teams, competitions, venues, and start times.", matches: today,
}));
await fs.writeFile(path.join(root, "upcoming-cricket-matches.html"), page({
  title: "Upcoming Cricket Matches & Fixtures | CricNivo",
  description: "Find upcoming cricket matches, fixtures, venues, and start times on CricNivo.",
  canonical: "https://www.cricnivo.com/upcoming-cricket-matches.html", heading: "Upcoming Cricket Matches",
  intro: "See upcoming cricket fixtures, including teams, competitions, venues, and scheduled start times.", matches: upcoming,
}));

const teamNames = [...new Set(upcoming.flatMap(({ match }) => [match.team1, match.team2]).filter(Boolean))].sort();
for (const team of teamNames) {
  const slug = teamSlug(team);
  await fs.writeFile(path.join(root, `${slug}-cricket-schedule.html`), page({
    title: `${team} Cricket Schedule & Fixtures | CricNivo`,
    description: `Find upcoming ${team} cricket matches, fixtures, venues, and start times on CricNivo.`,
    canonical: `https://www.cricnivo.com/${slug}-cricket-schedule.html`,
    heading: `${team} Cricket Schedule`,
    intro: `Follow upcoming ${team} matches with fixture details, competitions, venues, and scheduled start times.`,
    matches: upcoming.filter(({ match }) => match.team1 === team || match.team2 === team),
  }));
}
await fs.writeFile(path.join(root, "team-schedules.html"), teamDirectoryPage(teamNames));

// Keep older team pages valid when a team temporarily disappears from the feed.
// These pages can remain published and should receive the same complete event markup.
const generatedTeamFiles = new Set(teamNames.map(team => `${teamSlug(team)}-cricket-schedule.html`));
const existingTeamFiles = (await fs.readdir(root)).filter(file => file.endsWith("-cricket-schedule.html"));
for (const file of existingTeamFiles.filter(file => !generatedTeamFiles.has(file))) {
  const filePath = path.join(root, file);
  const html = await fs.readFile(filePath, "utf8");
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) continue;
  const schema = JSON.parse(match[1]);
  let changed = false;
  for (const event of schema["@graph"] || []) {
    if (event["@type"] !== "SportsEvent") continue;
    if (!event.image) {
      event.image = ["https://www.cricnivo.com/assets/icon-512x512.png"];
      changed = true;
    }
    if (!event.description) {
      event.description = `${event.name} cricket match. View the scheduled start time and venue on CricNivo.`;
      changed = true;
    }
  }
  if (changed) {
    const updatedSchema = JSON.stringify(schema).replaceAll("<", "\\u003c");
    await fs.writeFile(filePath, html.slice(0, match.index) + `<script type="application/ld+json">${updatedSchema}</script>` + html.slice(match.index + match[0].length));
  }
}

const urls = [
  ["/", "daily", "1.0"],
  ["/today-matches.html", "daily", "0.9"],
  ["/upcoming-cricket-matches.html", "daily", "0.9"],
  ["/team-schedules.html", "daily", "0.8"],
  ["/today-cricket-match.html", "daily", "0.8"],
  ...teamNames.map(team => [`/${teamSlug(team)}-cricket-schedule.html`, "daily", "0.7"]),
  ["/privacy.html", "monthly", "0.3"],
  ["/terms.html", "monthly", "0.3"],
];
const sitemapRows = urls.map(([url, frequency, priority]) => `<url><loc>https://www.cricnivo.com${url}</loc><changefreq>${frequency}</changefreq><priority>${priority}</priority></url>`).join("");
await fs.writeFile(path.join(root, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapRows}</urlset>\n`);
console.log(`Generated ${today.length} today's matches, ${upcoming.length} upcoming matches, and ${teamNames.length} team pages.`);
