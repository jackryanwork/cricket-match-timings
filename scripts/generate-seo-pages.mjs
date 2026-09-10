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
await fs.writeFile(path.join(root, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.cricnivo.com/</loc><changefreq>daily</changefreq><priority>1.0</priority></url><url><loc>https://www.cricnivo.com/today-matches.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url><url><loc>https://www.cricnivo.com/upcoming-cricket-matches.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url><url><loc>https://www.cricnivo.com/today-cricket-match.html</loc><changefreq>daily</changefreq><priority>0.8</priority></url><url><loc>https://www.cricnivo.com/privacy.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url><url><loc>https://www.cricnivo.com/terms.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url></urlset>
`);
console.log(`Generated ${today.length} today's matches and ${upcoming.length} upcoming matches.`);
