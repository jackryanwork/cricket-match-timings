const SUPABASE_URL = "https://yhohdbdatbmxzbokjsau.supabase.co";
const SUPABASE_KEY = "sb_publishable_hCY94hitDCrhCYDdbfpw0g_TuDyIA_T";
const REMINDER_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/subscribe-match-reminder`;
const MINI_APP_TRACKING_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/track-mini-app-open`;
const TELEGRAM_INIT_DATA_STORAGE_KEY = "cricketTelegramInitData";
const MY_TEAMS_STORAGE_KEY = "cricketMyTeams";
const FAVOURITE_MATCHES_STORAGE_KEY = "cricketFavouriteMatches";
const MINI_APP_PUBLIC_URL = "https://www.cricnivo.com/";
const DEFAULT_TEAMS = [
    "Afghanistan", "Australia", "Bangladesh", "England", "India", "Ireland",
    "Namibia", "Nepal", "Netherlands", "New Zealand", "Pakistan", "Scotland",
    "South Africa", "Sri Lanka", "United Arab Emirates", "United States of America",
    "West Indies", "Zimbabwe"
];
const TEAM_COUNTRY_CODES = {
    "Afghanistan": "AF", "Argentina": "AR", "Australia": "AU", "Austria": "AT",
    "Bahamas": "BS", "Bahrain": "BH", "Bangladesh": "BD", "Belgium": "BE",
    "Belize": "BZ", "Bermuda": "BM", "Bhutan": "BT", "Botswana": "BW",
    "Brazil": "BR", "Bulgaria": "BG", "Cambodia": "KH", "Cameroon": "CM",
    "Canada": "CA", "Cayman Islands": "KY", "Chile": "CL", "China": "CN",
    "Cook Islands": "CK", "Costa Rica": "CR", "Côte d’Ivoire": "CI", "Croatia": "HR",
    "Cyprus": "CY", "Czech Republic": "CZ", "Denmark": "DK", "Estonia": "EE",
    "Eswatini": "SZ", "Falkland Islands": "FK", "Fiji": "FJ", "Finland": "FI",
    "France": "FR", "Gambia": "GM", "Germany": "DE", "Ghana": "GH",
    "Gibraltar": "GI", "Greece": "GR", "Guernsey": "GG", "Hong Kong": "HK",
    "Hungary": "HU", "India": "IN", "Indonesia": "ID", "Iran": "IR",
    "Ireland": "IE", "Isle of Man": "IM", "Israel": "IL", "Italy": "IT",
    "Japan": "JP", "Jersey": "JE", "Kenya": "KE", "Kuwait": "KW",
    "Lesotho": "LS", "Luxembourg": "LU", "Malawi": "MW", "Malaysia": "MY",
    "Maldives": "MV", "Mali": "ML", "Malta": "MT", "Mexico": "MX",
    "Mongolia": "MN", "Mozambique": "MZ", "Myanmar": "MM", "Namibia": "NA",
    "Nepal": "NP", "Netherlands": "NL", "New Zealand": "NZ", "Nigeria": "NG",
    "Norway": "NO", "Oman": "OM", "Pakistan": "PK", "Panama": "PA",
    "Papua New Guinea": "PG", "Peru": "PE", "Philippines": "PH", "Portugal": "PT",
    "Qatar": "QA", "Romania": "RO", "Rwanda": "RW", "Saint Helena": "SH",
    "Samoa": "WS", "Saudi Arabia": "SA", "Serbia": "RS", "Seychelles": "SC",
    "Sierra Leone": "SL", "Singapore": "SG", "Slovenia": "SI", "South Africa": "ZA",
    "South Korea": "KR", "Spain": "ES", "Sri Lanka": "LK", "Suriname": "SR",
    "Sweden": "SE", "Switzerland": "CH", "Tajikistan": "TJ", "Tanzania": "TZ",
    "Thailand": "TH", "Turkey": "TR", "Turks and Caicos Islands": "TC", "Uganda": "UG",
    "United Arab Emirates": "AE", "United States of America": "US", "Uzbekistan": "UZ",
    "Vanuatu": "VU", "Zimbabwe": "ZW"
};

function flagFromCountryCode(code) {
    return [...code].map(letter => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

function teamFlag(teamName) {
    if (teamName === "England") return "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
    if (teamName === "Scotland") return "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    if (teamName === "West Indies") return "🏏";

    const countryCode = TEAM_COUNTRY_CODES[teamName];
    return countryCode ? flagFromCountryCode(countryCode) : "🏏";
}

function readMyTeams() {
    try {
        const saved = JSON.parse(localStorage.getItem(MY_TEAMS_STORAGE_KEY) || "[]");
        return new Set(Array.isArray(saved) ? saved.filter(team => typeof team === "string") : []);
    } catch {
        return new Set();
    }
}

let myTeams = readMyTeams();

function readFavouriteMatchIds() {
    try {
        const saved = JSON.parse(localStorage.getItem(FAVOURITE_MATCHES_STORAGE_KEY) || "[]");
        return new Set(Array.isArray(saved)
            ? saved.filter(id => Number.isSafeInteger(Number(id)) && Number(id) > 0).map(Number)
            : []);
    } catch {
        return new Set();
    }
}

let favouriteMatchIds = readFavouriteMatchIds();

function saveFavouriteMatchIds() {
    try {
        localStorage.setItem(FAVOURITE_MATCHES_STORAGE_KEY, JSON.stringify([...favouriteMatchIds]));
        return true;
    } catch {
        return false;
    }
}

function isMatchFavourite(match) {
    return favouriteMatchIds.has(Number(match.id));
}

function favouriteButton(match) {
    const active = isMatchFavourite(match);
    const id = Number(match.id);
    return `<button class="favourite-button${active ? " active" : ""}" type="button" data-favourite-match-id="${id}" aria-pressed="${active}" aria-label="${active ? "Remove from favourites" : "Add to favourite"}">${active ? "♥ Favourite" : "♡ Add to favourite"}</button>`;
}

function updateFavouriteButtons(matchId) {
    document.querySelectorAll(`[data-favourite-match-id="${matchId}"]`).forEach(button => {
        const active = favouriteMatchIds.has(matchId);
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
        button.setAttribute("aria-label", active ? "Remove from favourites" : "Add to favourite");
        button.textContent = active ? "♥ Favourite" : "♡ Add to favourite";
    });
}

function toggleFavouriteMatch(matchId) {
    if (favouriteMatchIds.has(matchId)) favouriteMatchIds.delete(matchId);
    else favouriteMatchIds.add(matchId);
    saveFavouriteMatchIds();
    updateFavouriteButtons(matchId);
    updateFavouriteMenuCount();
    renderFavouriteMatches();
}

function updateFavouriteMenuCount() {
    const count = document.getElementById("favouriteMatchesMenuCount");
    if (count) count.textContent = favouriteMatchIds.size ? `${favouriteMatchIds.size} saved` : "Open";
}

function isFavouriteMatch(match) {
    return myTeams.has(match.team1) || myTeams.has(match.team2);
}

function sortFavouriteMatches(matches) {
    return [...matches].sort((left, right) => {
        const favouriteOrder = Number(isFavouriteMatch(right)) - Number(isFavouriteMatch(left));
        if (favouriteOrder !== 0) return favouriteOrder;

        const dateOrder = String(left.match_date || "").localeCompare(String(right.match_date || ""));
        if (dateOrder !== 0) return dateOrder;

        const timeOrder = String(left.match_time || "").localeCompare(String(right.match_time || ""));
        if (timeOrder !== 0) return timeOrder;

        const competitionOrder = String(left.competition || "").localeCompare(String(right.competition || ""));
        if (competitionOrder !== 0) return competitionOrder;

        return Number(left.id || 0) - Number(right.id || 0);
    });
}

function updateMyTeamsMenuCount() {
    const count = document.getElementById("myTeamsMenuCount");
    if (count) count.textContent = myTeams.size ? `${myTeams.size} selected` : "Select";
}

function getTelegramInitData() {
    const telegramApp = window.Telegram?.WebApp;
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    const currentInitData = telegramApp?.initData
        || hashParams.get("tgWebAppData")
        || queryParams.get("tgWebAppData")
        || "";

    if (currentInitData) {
        try {
            sessionStorage.setItem(TELEGRAM_INIT_DATA_STORAGE_KEY, currentInitData);
        } catch {
            // Reminders still work when browser storage is unavailable.
        }
        return currentInitData;
    }

    try {
        return sessionStorage.getItem(TELEGRAM_INIT_DATA_STORAGE_KEY) || "";
    } catch {
        return "";
    }
}

if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
    try {
        window.Telegram.WebApp.setHeaderColor("#f8fcff");
        window.Telegram.WebApp.setBackgroundColor("#eef7ff");
        if (typeof window.Telegram.WebApp.setBottomBarColor === "function") {
            window.Telegram.WebApp.setBottomBarColor("#eef7ff");
        }
    } catch {
        // Older Telegram clients may not support custom interface colors.
    }
    getTelegramInitData();
}

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

async function trackFirstMiniAppOpen() {
    const initData = getTelegramInitData();
    if (!initData) return;
    try {
        await fetch(MINI_APP_TRACKING_FUNCTION_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
            body: JSON.stringify({ initData })
        });
    } catch (error) {
        console.warn("Unable to record Mini App open.", error);
    }
}

trackFirstMiniAppOpen();

    function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

let browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
let localTimeFormatter = createBrowserTimeFormatter(browserTimeZone);
let localMatchTimeFormatter = createLocalMatchTimeFormatter(browserTimeZone);
let localMatchDateFormatter = createLocalMatchDateFormatter(browserTimeZone);

function createBrowserTimeFormatter(timeZone) {
    const options = {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
    };

    if (timeZone) {
        options.timeZone = timeZone;
    }

    return new Intl.DateTimeFormat(undefined, options);
}

function createLocalMatchTimeFormatter(timeZone) {
    const options = {
        hour: "numeric",
        minute: "2-digit"
    };

    if (timeZone) {
        options.timeZone = timeZone;
    }

    return new Intl.DateTimeFormat(undefined, options);
}

function createLocalMatchDateFormatter(timeZone) {
    const options = {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
    };

    if (timeZone) {
        options.timeZone = timeZone;
    }

    return new Intl.DateTimeFormat(undefined, options);
}

function refreshBrowserTimeZone() {
    const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    if (resolvedTimeZone === browserTimeZone) return;

    browserTimeZone = resolvedTimeZone;
    localTimeFormatter = createBrowserTimeFormatter(browserTimeZone);
    localMatchTimeFormatter = createLocalMatchTimeFormatter(browserTimeZone);
    localMatchDateFormatter = createLocalMatchDateFormatter(browserTimeZone);
}

function formatVisitorMatchTime(match) {
    const start = getMatchStart(match);
    if (!start) return "Time not set";

    refreshBrowserTimeZone();
    return localMatchTimeFormatter.format(start);
}

function formatVisitorMatchDate(match) {
    const start = getMatchStart(match);
    if (!start) return "Date to be confirmed";

    refreshBrowserTimeZone();
    return localMatchDateFormatter.format(start);
}

function updateLocalTime() {
    const localTime = document.getElementById("localTime");
    if (!localTime) return;

    refreshBrowserTimeZone();
    localTime.textContent = `Your local time: ${localTimeFormatter.format(new Date())}`;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
    })[character]);
}

function uiIcon(name) {
    return `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function formatIndiaDate(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

    return `${values.year}-${values.month}-${values.day}`;
}

function formatDateLabel(dateText) {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short"
    }).format(new Date(`${dateText}T00:00:00`));
}

function parseZonedDateTime(dateText, timeText, timeZone) {
    const time = String(timeText).slice(0, 8);
    const [year, month, day] = String(dateText).split("-").map(Number);
    const [hour, minute, second = 0] = time.split(":").map(Number);
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;

    try {
        const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
        let guess = new Date(wallClock);
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: timeZone || "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        });

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const parts = Object.fromEntries(
                formatter.formatToParts(guess)
                    .filter(part => part.type !== "literal")
                    .map(part => [part.type, part.value])
            );
            const displayed = Date.UTC(
                Number(parts.year), Number(parts.month) - 1, Number(parts.day),
                Number(parts.hour), Number(parts.minute), Number(parts.second)
            );
            guess = new Date(wallClock - (displayed - guess.getTime()));
        }
        return Number.isNaN(guess.getTime()) ? null : guess;
    } catch {
        return null;
    }
}

function getMatchStart(match) {
    if (match.match_start_at) {
        const canonicalStart = new Date(match.match_start_at);
        if (!Number.isNaN(canonicalStart.getTime())) return canonicalStart;
    }

    if (!match.match_date || !match.match_time) return null;
    return parseZonedDateTime(match.match_date, match.match_time, match.match_timezone);
}

function getLocalDayBounds(offsetDays = 0) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + offsetDays);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, label: formatLocalDate(start) };
}

async function loadMatchesForLocalWindow(start, end, legacyStart, legacyEnd) {
    const canonicalQuery = await supabaseClient
        .from("matches")
        .select("*")
        .gte("match_start_at", start.toISOString())
        .lt("match_start_at", end.toISOString())
        .order("match_start_at", { ascending: true });

    if (!canonicalQuery.error) return canonicalQuery;

    const missingCanonicalColumn = canonicalQuery.error.code === "42703"
        || String(canonicalQuery.error.message || "").includes("match_start_at");
    if (!missingCanonicalColumn) return canonicalQuery;

    return supabaseClient
        .from("matches")
        .select("*")
        .gte("match_date", legacyStart)
        .lt("match_date", legacyEnd)
        .order("match_date", { ascending: true })
        .order("match_time", { ascending: true });
}

function formatCountdown(start) {
    const remaining = start.getTime() - Date.now();

    if (remaining <= 0) return "Live now";

    const totalSeconds = Math.ceil(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];

    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    return `Starts in ${parts.join(" ")}`;
}

function formatMatchCountdown(match, hideWhenStarted = false) {
    const start = getMatchStart(match);
    if (hideWhenStarted && start && start.getTime() <= Date.now()) return "";
    return start ? formatCountdown(start) : "Start time unavailable";
}

let bigMatches = [];
let bigMatchesExpanded = false;
let currentMatchType = "today";
let lastUpdatedAt = null;
let displayedMatches = new Map();
let knownMatches = new Map();

function setDisplayedMatches(matches) {
    displayedMatches = new Map(
        matches
            .filter(match => Number.isFinite(Number(match.id)))
            .map(match => [String(Number(match.id)), match])
    );
    displayedMatches.forEach((match, id) => knownMatches.set(id, match));
}

function renderFavouriteMatches() {
    const list = document.getElementById("favouriteMatchesList");
    if (!list) return;

    const matches = [...favouriteMatchIds]
        .map(id => knownMatches.get(String(id)))
        .filter(Boolean);

    if (matches.length === 0) {
        list.innerHTML = '<p class="reminder-state">You haven’t added any favourite matches yet.</p>';
        return;
    }

    list.innerHTML = matches.map(match => `
        <article class="favourite-item">
            <div class="favourite-item-main">
                <strong>${escapeHtml(match.team1 || "Team 1")} vs ${escapeHtml(match.team2 || "Team 2")}</strong>
                <span>${escapeHtml(formatVisitorMatchDate(match))} · ${escapeHtml(formatVisitorMatchTime(match))}</span>
                <span>${escapeHtml(match.venue || "Venue to be confirmed")}</span>
            </div>
            ${favouriteButton(match)}
        </article>
    `).join("");
}

async function openFavouriteMatches() {
    const modal = document.getElementById("favouriteMatchesModal");
    const list = document.getElementById("favouriteMatchesList");
    modal.classList.add("open");

    if (favouriteMatchIds.size === 0) {
        renderFavouriteMatches();
        return;
    }

    const missingIds = [...favouriteMatchIds].filter(id => !knownMatches.has(String(id)));
    if (missingIds.length) {
        list.innerHTML = '<p class="reminder-state">Loading favourite matches…</p>';
        const { data, error } = await supabaseClient
            .from("matches")
            .select("*")
            .in("id", missingIds);
        if (!error && Array.isArray(data)) data.forEach(match => knownMatches.set(String(Number(match.id)), match));

        if (!error) {
            const availableIds = new Set([...knownMatches.keys()].map(Number));
            const validIds = [...favouriteMatchIds].filter(id => availableIds.has(id));
            if (validIds.length !== favouriteMatchIds.size) {
                favouriteMatchIds = new Set(validIds);
                saveFavouriteMatchIds();
                updateFavouriteMenuCount();
            }
        }
    }

    renderFavouriteMatches();
}

function formatTournamentName(match) {
    const competition = String(match.competition || "Cricket match").trim();
    const escapePattern = value => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pairPatterns = [
        `${escapePattern(match.team1)}\\s+(?:vs\\.?|v)\\s+${escapePattern(match.team2)}`,
        `${escapePattern(match.team2)}\\s+(?:vs\\.?|v)\\s+${escapePattern(match.team1)}`
    ];

    for (const pairPattern of pairPatterns) {
        const cleaned = competition
            .replace(new RegExp(`^${pairPattern}\\s*[-–—:|]*\\s*`, "i"), "")
            .trim();
        if (cleaned !== competition) return cleaned || "Cricket match";
    }

    return competition;
}

function openMatchDetails(match) {
    const detailContent = document.getElementById("matchDetailContent");
    const matchModal = document.getElementById("matchModal");
    const matchId = Number(match.id);
    const reminderButton = Number.isSafeInteger(matchId) && matchId > 0
        ? `<button class="detail-reminder" type="button" data-reminder-match-id="${matchId}" aria-expanded="false">${uiIcon("bell")}Remind me</button>`
        : "";

    detailContent.innerHTML = `
        <div class="detail-tournament">${escapeHtml(match.competition || "Cricket match")}</div>
        <div class="detail-teams">${teamFlag(match.team1)} ${escapeHtml(match.team1)} <span class="vs">VS</span> ${teamFlag(match.team2)} ${escapeHtml(match.team2)}</div>
        <div class="detail-row"><span>Date</span><strong>${escapeHtml(formatVisitorMatchDate(match))}</strong></div>
        <div class="detail-row"><span>Time</span><strong>${escapeHtml(formatVisitorMatchTime(match))}</strong></div>
        <div class="detail-row"><span>Venue</span><strong>${escapeHtml(match.venue || "Venue to be confirmed")}</strong></div>
        <div class="detail-actions">${reminderButton}</div>
        <div class="reminder-picker" data-reminder-picker hidden>
            <fieldset>
                <legend>Reminder</legend>
                <label><input type="radio" name="reminder-minutes" value="5"> 5 minutes before</label>
                <label><input type="radio" name="reminder-minutes" value="15"> 15 minutes before</label>
                <label><input type="radio" name="reminder-minutes" value="30" checked> 30 minutes before</label>
                <label><input type="radio" name="reminder-minutes" value="120"> 2 hours before</label>
            </fieldset>
            <button class="save-reminder" type="button" data-save-reminder-match-id="${matchId}">Save Reminder</button>
        </div>
    `;
    matchModal.classList.add("open");
}

async function requestReminderAction(action, matchId, reminderMinutes) {
    const initData = getTelegramInitData();
    if (!initData) {
        throw new Error("Open from the bot’s Open App button");
    }

    const payload = { initData, action };
    if (Number.isSafeInteger(matchId) && matchId > 0) payload.matchId = matchId;
    if (reminderMinutes !== undefined) payload.reminderMinutes = reminderMinutes;

    const response = await fetch(REMINDER_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(result.error || "Reminder request failed.");
    }

    return result;
}

function setReminderBadge(count) {
    const badge = document.getElementById("notificationBadge");
    const safeCount = Math.max(0, Number(count) || 0);
    badge.textContent = safeCount > 9 ? "9+" : String(safeCount);
    badge.classList.toggle("visible", safeCount > 0);
    badge.setAttribute("aria-hidden", String(safeCount === 0));
}

function renderReminderList(reminders) {
    const reminderList = document.getElementById("reminderList");
    setReminderBadge(reminders.length);

    if (reminders.length === 0) {
        reminderList.innerHTML = '<p class="reminder-state">No match reminders set. Open a match and tap Remind me.</p>';
        return;
    }

    reminderList.innerHTML = reminders.map(reminder => `
        <div class="reminder-item">
            <div class="reminder-item-title">${escapeHtml(reminder.team1)} vs ${escapeHtml(reminder.team2)}</div>
            <div class="reminder-item-meta">
                ${escapeHtml(reminder.competition || "Cricket match")}<br>
                ${escapeHtml(formatVisitorMatchDate(reminder))} · ${escapeHtml(formatVisitorMatchTime(reminder))}<br>
                ${escapeHtml(formatReminderMinutes(reminder.reminder_minutes))} before match
            </div>
            <button class="reminder-cancel" type="button" data-cancel-reminder-id="${Number(reminder.match_id)}">Cancel reminder</button>
        </div>
    `).join("");
}

function formatReminderMinutes(minutes) {
    const value = Number(minutes);
    if (value === 120) return "2 hours";
    return `${value || 30} minutes`;
}

async function loadReminderCenter(showModal = true) {
    const reminderModal = document.getElementById("reminderModal");
    const reminderList = document.getElementById("reminderList");

    if (showModal) reminderModal.classList.add("open");
    if (!getTelegramInitData()) {
        setReminderBadge(0);
        reminderList.innerHTML = `<p class="reminder-state">${uiIcon("phone")} Open this Mini App from the bot’s Open App button to view reminders.</p>`;
        return;
    }

    if (showModal) reminderList.innerHTML = '<p class="reminder-state">Loading reminders…</p>';

    try {
        const result = await requestReminderAction("list");
        renderReminderList(Array.isArray(result.reminders) ? result.reminders : []);
    } catch (error) {
        if (showModal) {
            reminderList.innerHTML = `<p class="reminder-state">${escapeHtml(error.message || "Could not load reminders.")}</p>`;
        }
    }
}

async function cancelReminder(button) {
    const matchId = Number(button.dataset.cancelReminderId);
    if (!Number.isSafeInteger(matchId) || matchId <= 0) return;

    button.disabled = true;
    button.textContent = "Cancelling…";

    try {
        await requestReminderAction("cancel", matchId);
        await loadReminderCenter(false);
    } catch (error) {
        button.disabled = false;
        button.textContent = error.message || "Try again";
    }
}

async function subscribeToReminder(button) {
    const matchId = Number(button.dataset.reminderMatchId);
    const initData = getTelegramInitData();

    if (!initData) {
        button.innerHTML = `${uiIcon("phone")}Open from the bot’s Open App button`;
        return;
    }

    if (!Number.isSafeInteger(matchId) || matchId <= 0) return;

    const picker = button.closest("[data-reminder-picker]");
    const reminderMinutes = Number(picker?.querySelector("input[name='reminder-minutes']:checked")?.value || 30);

    button.disabled = true;
    button.textContent = "Setting reminder…";

    try {
        const result = await requestReminderAction("set", matchId, reminderMinutes);

        button.innerHTML = result.alreadyExists
            ? `${uiIcon("bell")}Reminder already set for ${formatReminderMinutes(reminderMinutes)}`
            : `${uiIcon("check")}Reminder set for ${formatReminderMinutes(reminderMinutes)} before`;
        await loadReminderCenter(false);
    } catch (error) {
        button.disabled = false;
        button.textContent = error.message || "Try setting the reminder again";
    }
}

function closeMatchDetails() {
    document.getElementById("matchModal").classList.remove("open");
}

function isTelegramMiniApp() {
    const telegramApp = window.Telegram?.WebApp;
    const platform = String(telegramApp?.platform || "").toLowerCase();
    return Boolean(getTelegramInitData())
        || (platform !== "" && platform !== "unknown" && Boolean(telegramApp?.initDataUnsafe?.user));
}

async function openMyTeams() {
    const teamPicker = document.getElementById("teamPicker");
    document.getElementById("myTeamsModal").classList.add("open");
    teamPicker.innerHTML = '<p class="reminder-state">Loading teams…</p>';

    const { data, error } = await supabaseClient
        .from("matches")
        .select("team1, team2");

    const availableTeams = new Set(DEFAULT_TEAMS);
    if (!error) {
        (data || []).forEach(match => {
            if (match.team1) availableTeams.add(match.team1);
            if (match.team2) availableTeams.add(match.team2);
        });
    }

    teamPicker.innerHTML = [...availableTeams]
        .sort((left, right) => left.localeCompare(right))
        .map(team => `
            <label class="team-choice">
                <input type="checkbox" value="${escapeHtml(team)}" ${myTeams.has(team) ? "checked" : ""}>
                <span>${teamFlag(team)} ${escapeHtml(team)}</span>
            </label>
        `).join("");
}

async function saveMyTeams() {
    myTeams = new Set(
        [...document.querySelectorAll("#teamPicker input:checked")]
            .map(input => input.value)
    );

    try {
        localStorage.setItem(MY_TEAMS_STORAGE_KEY, JSON.stringify([...myTeams]));
    } catch {
        // Selection still applies for the current session.
    }

    updateMyTeamsMenuCount();
    document.getElementById("myTeamsModal").classList.remove("open");
    await refreshMatches(currentMatchType);
}

async function shareMiniApp(event) {
    const shareText = "🏏 Check cricket match schedules in your local time on CricNivo.";

    // Let Telegram handle the native t.me share link directly. This keeps the
    // action working even when the Mini App JavaScript bridge is unavailable.
    if (isTelegramMiniApp()) {
        return;
    }

    if (navigator.share) {
        event.preventDefault();
        try {
            await navigator.share({ title: "CricNivo", text: shareText, url: MINI_APP_PUBLIC_URL });
            return;
        } catch (error) {
            if (error?.name === "AbortError") return;
        }
    }

    event.preventDefault();
    try {
        await navigator.clipboard.writeText(MINI_APP_PUBLIC_URL);
    } catch {
        const copyField = document.createElement("textarea");
        copyField.value = MINI_APP_PUBLIC_URL;
        copyField.setAttribute("readonly", "");
        copyField.style.position = "fixed";
        copyField.style.opacity = "0";
        document.body.appendChild(copyField);
        copyField.select();
        document.execCommand("copy");
        copyField.remove();
    }
    window.alert("App link copied.");
}

function updateLastUpdated() {
    const lastUpdated = document.getElementById("lastUpdated");

    if (!lastUpdatedAt) {
        lastUpdated.textContent = "Loading matches…";
        return;
    }

    const elapsedSeconds = Math.floor((Date.now() - lastUpdatedAt.getTime()) / 1000);
    if (elapsedSeconds < 60) {
        lastUpdated.textContent = "Last updated just now";
    } else {
        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
        lastUpdated.textContent = `Last updated ${elapsedMinutes}m ago`;
    }
}

function renderBigMatches() {
    const featuredCard = document.getElementById("featuredMatch");
    const featuredContent = document.getElementById("featuredMatchContent");

    if (bigMatches.length === 0) {
        featuredCard.classList.remove("visible", "expanded");
        featuredCard.removeAttribute("role");
        featuredCard.removeAttribute("tabindex");
        featuredCard.removeAttribute("aria-label");
        featuredContent.innerHTML = "";
        return;
    }

    const matchCards = bigMatches.map((match, index) => {
        const start = getMatchStart(match);

        return `
            <article class="big-match-card" data-big-match-index="${index}">
                <div class="featured-teams">${teamFlag(match.team1)} ${escapeHtml(match.team1)} <span class="vs">VS</span> ${teamFlag(match.team2)} ${escapeHtml(match.team2)}</div>
                <div class="featured-meta">
                    <span>${escapeHtml(formatTournamentName(match))}</span>
                    <span>${escapeHtml(formatVisitorMatchDate(match))}<br>${escapeHtml(formatVisitorMatchTime(match))}</span>
                </div>
                <div class="featured-countdown" data-big-countdown-index="${index}">${formatCountdown(start)}</div>
            </article>
        `;
    }).join("");

    featuredContent.innerHTML = `
        <div class="featured-label">Featured Matches</div>
        <div class="big-match-stack">${matchCards}</div>
        ${bigMatches.length > 1
            ? '<span class="big-match-toggle">Tap to see all matches</span>'
            : ''}
    `;
    featuredCard.classList.add("visible");
    updateBigMatchesExpandedState();
}

function updateBigMatchesExpandedState() {
    const featuredCard = document.getElementById("featuredMatch");
    const toggleText = featuredCard.querySelector(".big-match-toggle");

    featuredCard.classList.toggle("expanded", bigMatchesExpanded);
    if (toggleText) {
        toggleText.textContent = bigMatchesExpanded
            ? "Tap anywhere to close"
            : "Tap to see all matches";
    }

    if (bigMatches.length > 1) {
        featuredCard.setAttribute("role", "button");
        featuredCard.setAttribute("tabindex", "0");
        featuredCard.setAttribute("aria-label", bigMatchesExpanded
            ? "Close upcoming big matches list"
            : "Show all upcoming big matches");
    } else {
        featuredCard.removeAttribute("role");
        featuredCard.removeAttribute("tabindex");
        featuredCard.removeAttribute("aria-label");
    }
}

function updateMatchCountdowns() {
    updateTodayMatchStatuses();

    document.querySelectorAll("[data-match-countdown-id]").forEach(countdown => {
        const match = displayedMatches.get(countdown.dataset.matchCountdownId);
        if (!match) return;

        const start = getMatchStart(match);
        const card = countdown.closest("[data-match-id]");
        const isTodayCountdown = Boolean(card?.querySelector("[data-today-match-status]"));
        const hideCountdown = isTodayCountdown && start && start.getTime() <= Date.now();

        countdown.classList.toggle("is-hidden", hideCountdown);
        if (!hideCountdown) countdown.textContent = formatMatchCountdown(match);
    });

    document.querySelectorAll("[data-big-countdown-index]").forEach(countdown => {
        const match = bigMatches[Number(countdown.dataset.bigCountdownIndex)];
        const start = match && getMatchStart(match);

        if (start) countdown.textContent = formatCountdown(start);
    });
}

function updateTodayMatchStatuses() {
    document.querySelectorAll("[data-today-match-status]").forEach(status => {
        const match = displayedMatches.get(status.dataset.matchId);
        const start = match && getMatchStart(match);
        const isLive = Boolean(start && start.getTime() <= Date.now());

        status.classList.toggle("today", !isLive);
        status.classList.toggle("live", isLive);
        status.innerHTML = isLive
            ? '<span class="match-live-dot" aria-hidden="true"></span>LIVE'
            : "TODAY";
    });
}

async function loadBigMatches() {
    let bigMatchQuery = await supabaseClient
        .from("matches")
        .select("team1, team2, competition, match_date, match_time, match_start_at, match_timezone")
        .eq("is_big_match", true)
        .gte("match_start_at", new Date().toISOString());
    if (bigMatchQuery.error && String(bigMatchQuery.error.message || "").includes("match_start_at")) {
        bigMatchQuery = await supabaseClient
            .from("matches")
            .select("team1, team2, competition, match_date, match_time")
            .eq("is_big_match", true)
            .gte("match_date", formatIndiaDate(new Date()));
    }
    const { data: matches, error } = bigMatchQuery;

    if (error) {
        console.error("Error loading big matches:", error);
        return;
    }

    bigMatches = (matches || [])
        .map(match => ({ match, start: getMatchStart(match) }))
        .filter(({ start }) => start && start.getTime() > Date.now())
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .map(({ match }) => match);

    if (bigMatches.length < 2) bigMatchesExpanded = false;
    renderBigMatches();
}

async function refreshMatches(type = currentMatchType) {
    currentMatchType = type;
    const refreshButton = document.getElementById("refreshButton");
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing…";

    const [matchesLoaded] = await Promise.all([showMatches(type), loadBigMatches()]);

    if (matchesLoaded) {
        lastUpdatedAt = new Date();
        updateLastUpdated();
    }

    refreshButton.disabled = false;
    refreshButton.innerHTML = `${uiIcon("refresh")}Update Matches`;
}

    async function showMatches(type) {

    const filters = document.querySelectorAll(".filter");

    filters.forEach(button => {
        button.classList.remove("active");
    });

    if (type === "today") {
        filters[0].classList.add("active");

        const todayBounds = getLocalDayBounds();

     const { data: matches, error } = await loadMatchesForLocalWindow(
        todayBounds.start,
        todayBounds.end,
        todayBounds.label,
        formatLocalDate(todayBounds.end)
    );

if (error) {
    console.error("Error loading matches:", error);
    return false;
}

const today = todayBounds.label;

const todayMatches = sortFavouriteMatches(matches.filter(function(match) {
  return getMatchStart(match)?.getTime() >= todayBounds.start.getTime()
      && getMatchStart(match)?.getTime() < todayBounds.end.getTime();
}));

setDisplayedMatches(todayMatches);

let html = `
    <div class="section-header">
        <h2>Today's Matches</h2>
        <span>${formatDateLabel(today)}</span>
    </div>
`;

if (todayMatches.length === 0) {

    html += `
        <article class="match-card">
            <div class="match-bottom">
                No matches scheduled today.
            </div>
        </article>
    `;

} else {

    todayMatches.forEach(function(match) {

        html += `
            <article class="match-card${isFavouriteMatch(match) ? " favourite-match" : ""}" data-match-id="${Number(match.id)}" role="button" tabindex="0" aria-label="View match details">

                <div class="match-top">
                    <div class="match-type">
                        ${escapeHtml(match.competition)}
                    </div>

                    <div class="match-status today" data-today-match-status data-match-id="${Number(match.id)}">
                        TODAY
                    </div>
                </div>

                <div class="teams">

                    <div class="team">
                        <div class="team-logo" aria-hidden="true">${teamFlag(match.team1)}</div>
                        <div class="team-name-card">
                            ${escapeHtml(match.team1)}
                        </div>
                    </div>

                    <div class="match-vs">
                        <div class="vs">VS</div>
                        <div class="match-countdown" data-match-countdown-id="${Number(match.id)}">${escapeHtml(formatMatchCountdown(match, true))}</div>
                    </div>

                    <div class="team">
                        <div class="team-logo" aria-hidden="true">${teamFlag(match.team2)}</div>
                        <div class="team-name-card">
                            ${escapeHtml(match.team2)}
                        </div>
                    </div>

                </div>

                <div class="match-bottom">

                    <div class="match-schedule">
                        <div class="match-date">${escapeHtml(formatVisitorMatchDate(match))}</div>
                        <div class="match-time">
                            ${escapeHtml(formatVisitorMatchTime(match))}
                        </div>
                    </div>

                    <div class="venue">
                        <span class="venue-label">${uiIcon("pin")}<span>${escapeHtml(match.venue || "Stadium")}</span></span>
                    </div>

                </div>

                <div class="match-actions">
                    ${favouriteButton(match)}
                </div>

            </article>
        `;

    });

}

document.getElementById("matchContent").innerHTML = html;
updateTodayMatchStatuses();
updateMatchCountdowns();
return true;
    }

    if (type === "tomorrow") {
        filters[1].classList.add("active");

const tomorrowBounds = getLocalDayBounds(1);
const tomorrow = tomorrowBounds.label;

        const { data: matches, error } = await loadMatchesForLocalWindow(
            tomorrowBounds.start,
            tomorrowBounds.end,
            tomorrowBounds.label,
            formatLocalDate(tomorrowBounds.end)
        );

if (error) {
    console.error("Error loading matches:", error);
    return false;
}



const tomorrowMatches = sortFavouriteMatches(matches.filter(function(match) {
    return getMatchStart(match)?.getTime() >= tomorrowBounds.start.getTime()
        && getMatchStart(match)?.getTime() < tomorrowBounds.end.getTime();
}));

setDisplayedMatches(tomorrowMatches);

let html = `
    <div class="section-header">
        <h2>Tomorrow's Matches</h2>
        <span>${formatDateLabel(tomorrow)}</span>
    </div>
`;

if (tomorrowMatches.length === 0) {

    html += `
        <article class="match-card">
            <div class="match-bottom">
                No matches available tomorrow.
            </div>
        </article>
    `;

} else {

    tomorrowMatches.forEach(function(match) {

        html += `
            <article class="match-card${isFavouriteMatch(match) ? " favourite-match" : ""}" data-match-id="${Number(match.id)}" role="button" tabindex="0" aria-label="View match details">

                <div class="match-top">
                    <div class="match-type">
                        ${escapeHtml(match.competition)}
                    </div>

                    <div class="match-status upcoming">
                        UPCOMING
                    </div>
                </div>

                <div class="teams">

                    <div class="team">
                        <div class="team-logo" aria-hidden="true">${teamFlag(match.team1)}</div>
                        <div class="team-name-card">
                            ${escapeHtml(match.team1)}
                        </div>
                    </div>

                    <div class="match-vs">
                        <div class="vs">VS</div>
                        <div class="match-countdown" data-match-countdown-id="${Number(match.id)}">${escapeHtml(formatMatchCountdown(match))}</div>
                    </div>

                    <div class="team">
                        <div class="team-logo" aria-hidden="true">${teamFlag(match.team2)}</div>
                        <div class="team-name-card">
                            ${escapeHtml(match.team2)}
                        </div>
                    </div>

                </div>

                <div class="match-bottom">

                    <div class="match-schedule">
                        <div class="match-date">${escapeHtml(formatVisitorMatchDate(match))}</div>
                        <div class="match-time">
                            ${escapeHtml(formatVisitorMatchTime(match))}
                        </div>
                    </div>

                    <div class="venue">
                        <span class="venue-label">${uiIcon("pin")}<span>${escapeHtml(match.venue || "Stadium")}</span></span>
                    </div>

                </div>

                <div class="match-actions">
                    ${favouriteButton(match)}
                </div>

            </article>
        `;

    });

}

document.getElementById("matchContent").innerHTML = html;
updateMatchCountdowns();
return true;
    }

    if (type === "upcoming") {
        filters[2].classList.add("active");

const upcomingStart = getLocalDayBounds(2).start;

        let upcomingQuery = await supabaseClient
            .from("matches")
            .select("*")
            .gte("match_start_at", upcomingStart.toISOString())
            .order("match_start_at", { ascending: true });
        if (upcomingQuery.error && String(upcomingQuery.error.message || "").includes("match_start_at")) {
            upcomingQuery = await supabaseClient
                .from("matches")
                .select("*")
                .gt("match_date", formatLocalDate(getLocalDayBounds(1).start))
                .order("match_date", { ascending: true })
                .order("match_time", { ascending: true });
        }
        const { data: matches, error } = upcomingQuery;

if (error) {
    console.error("Error loading matches:", error);
    return false;
}



const upcomingMatches = sortFavouriteMatches(matches.filter(function(match) {
    const start = getMatchStart(match);
    return start && start.getTime() >= upcomingStart.getTime();
}));

setDisplayedMatches(upcomingMatches);

let html = `
    <div class="section-header">
        <h2>Upcoming Matches</h2>
        <span>Dates shown in your local time</span>
    </div>
`;

if (upcomingMatches.length === 0) {

    html += `
        <article class="match-card">
            <div class="match-bottom">
                No upcoming matches available.
            </div>
        </article>
    `;

} else {

    upcomingMatches.forEach(function(match) {

        html += `
            <article class="match-card${isFavouriteMatch(match) ? " favourite-match" : ""}" data-match-id="${Number(match.id)}" role="button" tabindex="0" aria-label="View match details">

                <div class="match-top">
                    <div class="match-type">
                        ${escapeHtml(match.competition)}
                    </div>

                    <div class="match-status upcoming">
                        UPCOMING
                    </div>
                </div>

                <div class="teams">

                    <div class="team">
                        <div class="team-logo" aria-hidden="true">${teamFlag(match.team1)}</div>
                        <div class="team-name-card">
                            ${escapeHtml(match.team1)}
                        </div>
                    </div>

                    <div class="vs">VS</div>

                    <div class="team">
                        <div class="team-logo" aria-hidden="true">${teamFlag(match.team2)}</div>
                        <div class="team-name-card">
                            ${escapeHtml(match.team2)}
                        </div>
                    </div>

                </div>

                <div class="match-bottom">

                    <div class="match-schedule">
                        <div class="match-date">${escapeHtml(formatVisitorMatchDate(match))}</div>
                        <div class="match-time">
                            ${escapeHtml(formatVisitorMatchTime(match))}
                        </div>
                    </div>

                    <div class="venue">
                        <span class="venue-label">${uiIcon("pin")}<span>${escapeHtml(match.venue || "Stadium")}</span></span>
                    </div>

                </div>

                <div class="match-actions">
                    ${favouriteButton(match)}
                </div>

            </article>
        `;

    });

}

document.getElementById("matchContent").innerHTML = html;
return true;
    }
}

refreshMatches("today");
setInterval(updateMatchCountdowns, 1000);

const menuButton = document.getElementById("menuButton");
const menuPanel = document.getElementById("menuPanel");
const refreshButton = document.getElementById("refreshButton");
const matchContent = document.getElementById("matchContent");
const bigMatchesPanel = document.getElementById("featuredMatch");
const matchModal = document.getElementById("matchModal");
const modalClose = document.getElementById("modalClose");
const notificationButton = document.getElementById("notificationButton");
const remindersMenuButton = document.getElementById("remindersMenuButton");
const reminderModal = document.getElementById("reminderModal");
const reminderModalClose = document.getElementById("reminderModalClose");
const reminderList = document.getElementById("reminderList");
const myTeamsMenuButton = document.getElementById("myTeamsMenuButton");
const favouriteMatchesMenuButton = document.getElementById("favouriteMatchesMenuButton");
const shareMenuButton = document.getElementById("shareMenuButton");
const aboutMenuButton = document.getElementById("aboutMenuButton");
const myTeamsModal = document.getElementById("myTeamsModal");
const myTeamsModalClose = document.getElementById("myTeamsModalClose");
const favouriteMatchesModal = document.getElementById("favouriteMatchesModal");
const favouriteMatchesModalClose = document.getElementById("favouriteMatchesModalClose");
const saveMyTeamsButton = document.getElementById("saveMyTeamsButton");
const aboutModal = document.getElementById("aboutModal");
const aboutModalClose = document.getElementById("aboutModalClose");
const cricketBuddy = document.getElementById("cricketBuddy");
const buddyMessage = document.getElementById("buddyMessage");

document.querySelectorAll("[data-match-filter]").forEach(button => {
    button.addEventListener("click", () => {
        refreshMatches(button.dataset.matchFilter);
    });
});

document.getElementById("buddyMessageClose").addEventListener("click", () => {
    buddyMessage.hidden = true;
    cricketBuddy.focus({ preventScroll: true });
});

cricketBuddy.addEventListener("click", () => {
    cricketBuddy.classList.remove("user-wave");
    void cricketBuddy.offsetWidth;
    cricketBuddy.classList.add("user-wave");
    window.setTimeout(() => cricketBuddy.classList.remove("user-wave"), 800);
});

menuButton.addEventListener("click", () => {
    const isOpen = menuPanel.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
});

document.addEventListener("click", event => {
    if (!menuPanel.classList.contains("open")) return;
    if (menuPanel.contains(event.target) || menuButton.contains(event.target)) return;
    if (event.target.closest("#reminderModal, #myTeamsModal, #favouriteMatchesModal, #aboutModal")) return;

    menuPanel.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
});

function toggleBigMatches(event) {
    if (bigMatches.length < 2) return;

    const clickedPanel = event.target.closest("#featuredMatch");
    if (!clickedPanel) return;

    bigMatchesExpanded = !bigMatchesExpanded;
    updateBigMatchesExpandedState();
}

bigMatchesPanel.addEventListener("click", toggleBigMatches);
bigMatchesPanel.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    toggleBigMatches(event);
});

function openDetailsFromCard(card) {
    const match = displayedMatches.get(card.dataset.matchId);
    if (match) openMatchDetails(match);
}

matchContent.addEventListener("click", event => {
    const favouriteButton = event.target.closest("[data-favourite-match-id]");
    if (favouriteButton) {
        event.stopPropagation();
        toggleFavouriteMatch(Number(favouriteButton.dataset.favouriteMatchId));
        return;
    }

    const card = event.target.closest("[data-match-id]");
    if (card) openDetailsFromCard(card);
});

matchContent.addEventListener("keydown", event => {
    const favouriteButton = event.target.closest("[data-favourite-match-id]");
    if (favouriteButton && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        toggleFavouriteMatch(Number(favouriteButton.dataset.favouriteMatchId));
        return;
    }

    if (event.key !== "Enter" && event.key !== " ") return;

    const card = event.target.closest("[data-match-id]");
    if (!card) return;

    event.preventDefault();
    openDetailsFromCard(card);
});

modalClose.addEventListener("click", closeMatchDetails);
matchModal.addEventListener("click", event => {
    if (event.target === matchModal) closeMatchDetails();

    const reminderButton = event.target.closest("[data-reminder-match-id]");
    if (reminderButton && !reminderButton.disabled) {
        const picker = matchModal.querySelector("[data-reminder-picker]");
        const isOpen = picker && !picker.hidden;
        if (picker) picker.hidden = isOpen;
        reminderButton.setAttribute("aria-expanded", String(!isOpen));
        return;
    }

    const saveReminderButton = event.target.closest("[data-save-reminder-match-id]");
    if (saveReminderButton && !saveReminderButton.disabled) {
        subscribeToReminder(saveReminderButton);
        return;
    }

});

notificationButton.addEventListener("click", () => loadReminderCenter(true));
remindersMenuButton.addEventListener("click", () => {
    loadReminderCenter(true);
});
myTeamsMenuButton.addEventListener("click", () => {
    openMyTeams();
});
favouriteMatchesMenuButton.addEventListener("click", () => {
    menuPanel.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
    openFavouriteMatches();
});
shareMenuButton.addEventListener("click", event => {
    shareMiniApp(event).catch(() => {});
});
aboutMenuButton.addEventListener("click", () => {
    aboutModal.classList.add("open");
});
myTeamsModalClose.addEventListener("click", () => myTeamsModal.classList.remove("open"));
saveMyTeamsButton.addEventListener("click", saveMyTeams);
myTeamsModal.addEventListener("click", event => {
    if (event.target === myTeamsModal) myTeamsModal.classList.remove("open");
});
favouriteMatchesModalClose.addEventListener("click", () => favouriteMatchesModal.classList.remove("open"));
favouriteMatchesModal.addEventListener("click", event => {
    if (event.target === favouriteMatchesModal) favouriteMatchesModal.classList.remove("open");
    const favouriteButton = event.target.closest("[data-favourite-match-id]");
    if (favouriteButton) toggleFavouriteMatch(Number(favouriteButton.dataset.favouriteMatchId));
});
aboutModalClose.addEventListener("click", () => aboutModal.classList.remove("open"));
aboutModal.addEventListener("click", event => {
    if (event.target === aboutModal) aboutModal.classList.remove("open");
});
reminderModalClose.addEventListener("click", () => reminderModal.classList.remove("open"));
reminderModal.addEventListener("click", event => {
    if (event.target === reminderModal) reminderModal.classList.remove("open");

    const cancelButton = event.target.closest("[data-cancel-reminder-id]");
    if (cancelButton && !cancelButton.disabled) cancelReminder(cancelButton);
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeMatchDetails();
        reminderModal.classList.remove("open");
        myTeamsModal.classList.remove("open");
        favouriteMatchesModal.classList.remove("open");
        aboutModal.classList.remove("open");
    }
});

refreshButton.addEventListener("click", () => {
    refreshMatches();
});

setInterval(updateLastUpdated, 30000);
updateLocalTime();
setInterval(updateLocalTime, 1000);
loadReminderCenter(false);
updateMyTeamsMenuCount();
updateFavouriteMenuCount();

const pullIndicator = document.getElementById("pullIndicator");
const pullThreshold = 72;
let touchStartY = null;
let pullDistance = 0;

function resetPullIndicator() {
    pullIndicator.classList.remove("visible", "ready");
    pullIndicator.textContent = "↓ Pull down to refresh";
    touchStartY = null;
    pullDistance = 0;
}

document.addEventListener("touchstart", event => {
    if (window.scrollY <= 0 && event.touches.length === 1) {
        touchStartY = event.touches[0].clientY;
    }
}, { passive: true });

document.addEventListener("touchmove", event => {
    if (touchStartY === null || event.touches.length !== 1) return;

    pullDistance = Math.max(0, event.touches[0].clientY - touchStartY);
    if (pullDistance === 0) return;

    pullIndicator.classList.add("visible");
    const isReady = pullDistance >= pullThreshold;
    pullIndicator.classList.toggle("ready", isReady);
    pullIndicator.textContent = isReady ? "↑ Release to refresh" : "↓ Pull down to refresh";
}, { passive: true });

document.addEventListener("touchend", async () => {
    if (pullDistance >= pullThreshold) {
        pullIndicator.classList.add("visible", "ready");
        pullIndicator.textContent = "Refreshing matches…";
        await refreshMatches();
    }

    resetPullIndicator();
}, { passive: true });

document.addEventListener("touchcancel", resetPullIndicator, { passive: true });
