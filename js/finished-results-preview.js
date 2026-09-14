const PREVIEW_STORAGE_KEY = "cricnivo:finished-results-preview";

function previewDate(offsetDays) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offsetDays);
    return date.toISOString().slice(0, 10);
}

const PREVIEW_MATCHES = [
    {
        id: 1,
        team1: "India",
        team2: "Australia",
        date: previewDate(0),
        time: "19:30",
        competition: "ODI",
        venue: "Wankhede Stadium",
        status: "scheduled",
        resultType: "",
        resultSummary: ""
    },
    {
        id: 2,
        team1: "England",
        team2: "Sri Lanka",
        date: previewDate(1),
        time: "17:30",
        competition: "T20 International",
        venue: "The Rose Bowl",
        status: "scheduled",
        resultType: "",
        resultSummary: ""
    },
    {
        id: 3,
        team1: "South Africa",
        team2: "New Zealand",
        date: previewDate(2),
        time: "14:00",
        competition: "Test",
        venue: "Cape Town",
        status: "scheduled",
        resultType: "",
        resultSummary: ""
    }
];

const resultLabels = {
    team1: match => `${match.team1} won`,
    team2: match => `${match.team2} won`,
    tie: () => "Match tied",
    draw: () => "Match drawn",
    no_result: () => "No result",
    abandoned: () => "Match abandoned"
};

let previewMatches = readPreviewMatches();

function escapePreviewHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
}

function readPreviewMatches() {
    try {
        const saved = JSON.parse(localStorage.getItem(PREVIEW_STORAGE_KEY) || "null");
        return Array.isArray(saved) && saved.length ? saved : structuredClone(PREVIEW_MATCHES);
    } catch {
        return structuredClone(PREVIEW_MATCHES);
    }
}

function writePreviewMatches() {
    localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(previewMatches));
    renderPreview();
}

function formatPreviewDate(value) {
    return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function resultLabel(match) {
    return match.resultType && resultLabels[match.resultType]
        ? resultLabels[match.resultType](match)
        : "Result pending";
}

function renderAdminPreview() {
    const container = document.getElementById("adminPreviewMatches");
    container.innerHTML = previewMatches.map(match => {
        const finished = match.status === "finished";
        return `
            <article class="preview-match" data-preview-match-id="${match.id}">
                <div class="preview-match-teams">${escapePreviewHtml(match.team1)} vs ${escapePreviewHtml(match.team2)}</div>
                <div class="preview-match-meta">${escapePreviewHtml(formatPreviewDate(match.date))} · ${escapePreviewHtml(match.time)} · ${escapePreviewHtml(match.competition)}</div>
                ${finished ? `
                    <span class="preview-result-badge">Finished · ${escapePreviewHtml(resultLabel(match))}</span>
                    <div class="preview-result-editor">
                        <label for="result-${match.id}">Match result</label>
                        <select class="preview-select" id="result-${match.id}" data-result-type>
                            <option value="">Result pending</option>
                            <option value="team1"${match.resultType === "team1" ? " selected" : ""}>${escapePreviewHtml(match.team1)} won</option>
                            <option value="team2"${match.resultType === "team2" ? " selected" : ""}>${escapePreviewHtml(match.team2)} won</option>
                            <option value="tie"${match.resultType === "tie" ? " selected" : ""}>Match tied</option>
                            <option value="draw"${match.resultType === "draw" ? " selected" : ""}>Match drawn</option>
                            <option value="no_result"${match.resultType === "no_result" ? " selected" : ""}>No result</option>
                            <option value="abandoned"${match.resultType === "abandoned" ? " selected" : ""}>Match abandoned</option>
                        </select>
                        <label for="summary-${match.id}">Result details (optional)</label>
                        <input class="preview-input" id="summary-${match.id}" data-result-summary value="${escapePreviewHtml(match.resultSummary)}" placeholder="India won by 7 wickets">
                        <div class="preview-actions">
                            <button class="preview-button" type="button" data-save-result>Save result</button>
                            <button class="preview-button secondary" type="button" data-reopen-match>Reopen match</button>
                        </div>
                    </div>
                ` : `
                    <div class="preview-actions">
                        <button class="preview-button" type="button" data-finish-match>Mark as finished</button>
                    </div>
                `}
            </article>
        `;
    }).join("");
}

function renderPublicPreview() {
    const container = document.getElementById("finishedResultsPreview");
    const finishedMatches = previewMatches.filter(match => match.status === "finished");
    if (!finishedMatches.length) {
        container.innerHTML = '<p class="preview-empty">No finished matches yet. Mark one as finished above.</p>';
        return;
    }

    container.innerHTML = finishedMatches.map(match => `
        <article class="preview-match">
            <span class="preview-result-badge">Finished</span>
            <div class="preview-match-teams">${escapePreviewHtml(match.team1)} vs ${escapePreviewHtml(match.team2)}</div>
            <div class="preview-match-meta">${escapePreviewHtml(formatPreviewDate(match.date))} · ${escapePreviewHtml(match.competition)} · ${escapePreviewHtml(match.venue)}</div>
            <strong>${escapePreviewHtml(resultLabel(match))}</strong>
            ${match.resultSummary ? `<div class="preview-match-meta">${escapePreviewHtml(match.resultSummary)}</div>` : ""}
        </article>
    `).join("");
}

function renderPreview() {
    renderAdminPreview();
    renderPublicPreview();
}

document.getElementById("adminPreviewMatches").addEventListener("click", event => {
    const card = event.target.closest("[data-preview-match-id]");
    if (!card) return;
    const match = previewMatches.find(item => item.id === Number(card.dataset.previewMatchId));
    if (!match) return;

    if (event.target.closest("[data-finish-match]")) {
        match.status = "finished";
        match.resultType = "";
        match.resultSummary = "";
        writePreviewMatches();
    }

    if (event.target.closest("[data-reopen-match]")) {
        match.status = "scheduled";
        match.resultType = "";
        match.resultSummary = "";
        writePreviewMatches();
    }

    if (event.target.closest("[data-save-result]")) {
        match.resultType = card.querySelector("[data-result-type]").value;
        match.resultSummary = card.querySelector("[data-result-summary]").value.trim();
        writePreviewMatches();
    }
});

document.getElementById("resetPreview").addEventListener("click", () => {
    localStorage.removeItem(PREVIEW_STORAGE_KEY);
    previewMatches = structuredClone(PREVIEW_MATCHES);
    renderPreview();
});

window.addEventListener("storage", event => {
    if (event.key !== PREVIEW_STORAGE_KEY) return;
    previewMatches = readPreviewMatches();
    renderPreview();
});

renderPreview();
