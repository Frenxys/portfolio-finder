let currentWebsite = null;
let loadSeq = 0;

const els = {
  frame: document.getElementById("site-frame"),
  emptyState: document.getElementById("empty-state"),
  repoInfo: document.getElementById("repo-info"),
  btnSkip: document.getElementById("btn-skip"),
  btnAdd: document.getElementById("btn-add"),
  btnOpen: document.getElementById("btn-open"),
  btnRefresh: document.getElementById("btn-refresh"),
  statPending: document.getElementById("stat-pending"),
  statFound: document.getElementById("stat-found"),
  statSeen: document.getElementById("stat-seen"),
  statMain: document.getElementById("stat-main"),
  searchStatus: document.getElementById("search-status"),
  mainList: document.getElementById("main-list"),
};

function setButtonsEnabled(enabled) {
  els.btnSkip.disabled = !enabled;
  els.btnAdd.disabled = !enabled;
  els.btnOpen.disabled = !enabled;
}

function renderRepoInfo(website) {
  if (!website) {
    els.repoInfo.className = "repo-info empty";
    els.repoInfo.textContent = "Waiting for the next website…";
    return;
  }

  els.repoInfo.className = "repo-info";
  els.repoInfo.innerHTML = `
    <div class="field">
      <span class="label">GitHub user</span>
      ${escapeHtml(website.githubuser)}
    </div>
    <div class="field">
      <span class="label">Repository</span>
      <a href="${escapeAttr(website.githublink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(website.githublink)}</a>
    </div>
    <div class="field">
      <span class="label">Website</span>
      <a href="${escapeAttr(website.websitelink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(website.websitelink)}</a>
    </div>
    <div class="field">
      <span class="label">Stars / Language</span>
      ${escapeHtml(website.starnumber)} ★ · ${escapeHtml(website.mainlangused)}
    </div>
  `;
}

function renderWebsite(website, stats) {
  if (website) {
    currentWebsite = website;
  } else if (stats?.pending > 0 && currentWebsite) {
    website = currentWebsite;
  } else {
    currentWebsite = null;
  }

  if (!website) {
    els.frame.hidden = true;
    els.frame.removeAttribute("src");
    els.frame.dataset.websitelink = "";
    els.emptyState.hidden = false;
    updateEmptyState(stats);
    setButtonsEnabled(false);
    renderRepoInfo(null);
    return;
  }

  els.emptyState.hidden = true;
  els.frame.hidden = false;

  if (els.frame.dataset.websitelink !== website.websitelink) {
    els.frame.dataset.websitelink = website.websitelink;
    els.frame.src = website.websitelink;
  }

  setButtonsEnabled(true);
  renderRepoInfo(website);
}

function updateEmptyState(stats) {
  const title = els.emptyState.querySelector("h2");
  const text = els.emptyState.querySelector("p");

  if (stats?.pending > 0) {
    title.textContent = "Loading next portfolio…";
    text.textContent = `${stats.pending} sites are queued. The preview should appear in a moment.`;
    return;
  }

  title.textContent = "No websites to review yet";
  text.textContent =
    "The backend is searching GitHub with rotating keywords. New portfolios will appear here automatically.";
}

function renderStats(stats) {
  els.statPending.textContent = stats.pending;
  els.statFound.textContent = stats.found;
  els.statSeen.textContent = stats.seen;
  els.statMain.textContent = stats.main;
}

function renderSearchStatus(status) {
  if (!status) {
    els.searchStatus.textContent = "Search status unavailable";
    return;
  }

  if (status.running) {
    els.searchStatus.textContent = "Searching GitHub now…";
    return;
  }

  const parts = [];
  if (status.lastKeyword) {
    parts.push(`Last keyword: "${status.lastKeyword}"`);
  }
  if (status.lastAddedCount != null) {
    parts.push(`+${status.lastAddedCount} new`);
  }
  if (status.lastSearchAt) {
    parts.push(`at ${new Date(status.lastSearchAt).toLocaleTimeString()}`);
  }
  if (status.lastError) {
    parts.push(`Error: ${status.lastError}`);
  }

  els.searchStatus.textContent = parts.join(" · ") || "Waiting for next search…";
}

async function loadCurrent() {
  const seq = ++loadSeq;

  try {
    const response = await fetch("/api/current");
    if (!response.ok || seq !== loadSeq) return;

    const data = await response.json();
    if (seq !== loadSeq) return;

    renderStats(data.stats);
    renderSearchStatus(data.searchStatus);
    renderWebsite(data.website, data.stats);
  } catch {
    if (seq !== loadSeq) return;
  }
}

async function loadMainList() {
  const response = await fetch("/api/main");
  const data = await response.json();

  if (!data.websites.length) {
    els.mainList.innerHTML = `<li class="meta">No saved portfolios yet.</li>`;
    return;
  }

  els.mainList.innerHTML = data.websites
    .slice()
    .reverse()
    .map(
      (site) => `
      <li>
        <a href="${escapeAttr(site.websitelink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.githubuser)}</a>
        <div class="meta">${escapeHtml(site.starnumber)} ★ · ${escapeHtml(site.mainlangused)}</div>
      </li>
    `
    )
    .join("");
}

async function postAction(endpoint) {
  if (!currentWebsite) return;

  setButtonsEnabled(false);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentWebsite),
  });

  const data = await response.json();
  renderStats(data.stats);
  renderSearchStatus(data.searchStatus);
  renderWebsite(data.website, data.stats);
  await loadMainList();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

els.btnSkip.addEventListener("click", () => postAction("/api/skip"));
els.btnAdd.addEventListener("click", () => postAction("/api/add"));
els.btnOpen.addEventListener("click", () => {
  if (currentWebsite?.websitelink) {
    window.open(currentWebsite.websitelink, "_blank", "noopener,noreferrer");
  }
});

els.btnRefresh.addEventListener("click", async () => {
  els.btnRefresh.disabled = true;
  try {
    await fetch("/api/search-now", { method: "POST" });
    await loadCurrent();
  } finally {
    els.btnRefresh.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (!currentWebsite) return;
  if (event.target.matches("input, textarea")) return;

  if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    postAction("/api/skip");
  }

  if (event.key === "a" || event.key === "A") {
    event.preventDefault();
    postAction("/api/add");
  }
});

loadCurrent();
loadMainList();
setInterval(loadCurrent, 15_000);
