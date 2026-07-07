let savedWebsites = [];
let currentIndex = 0;

const els = {
  frame: document.getElementById("saved-site-frame"),
  emptyState: document.getElementById("saved-empty-state"),
  repoInfo: document.getElementById("saved-repo-info"),
  list: document.getElementById("saved-list"),
  total: document.getElementById("saved-total"),
  position: document.getElementById("saved-position"),
  status: document.getElementById("saved-status"),
  btnPrev: document.getElementById("btn-prev"),
  btnNext: document.getElementById("btn-next"),
  btnOpen: document.getElementById("btn-open-saved"),
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function getCurrentWebsite() {
  if (savedWebsites.length === 0) return null;
  return savedWebsites[currentIndex] || null;
}

function setButtonsState() {
  const hasWebsites = savedWebsites.length > 0;
  els.btnPrev.disabled = !hasWebsites || currentIndex === 0;
  els.btnNext.disabled = !hasWebsites || currentIndex >= savedWebsites.length - 1;
  els.btnOpen.disabled = !hasWebsites;
}

function renderRepoInfo(website) {
  if (!website) {
    els.repoInfo.className = "repo-info empty";
    els.repoInfo.textContent = "No saved website selected.";
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

function renderList() {
  if (!savedWebsites.length) {
    els.list.innerHTML = '<li class="meta">No saved portfolios yet.</li>';
    return;
  }

  els.list.innerHTML = savedWebsites
    .map(
      (site, index) => `
        <li>
          <button class="saved-list-item${index === currentIndex ? " is-active" : ""}" data-index="${index}">
            <span class="saved-list-user">${escapeHtml(site.githubuser)}</span>
            <span class="meta">${escapeHtml(site.starnumber)} ★ · ${escapeHtml(site.mainlangused)}</span>
          </button>
        </li>
      `,
    )
    .join("");
}

function renderViewer() {
  const website = getCurrentWebsite();

  els.total.textContent = String(savedWebsites.length);
  els.position.textContent = savedWebsites.length
    ? `${currentIndex + 1} / ${savedWebsites.length}`
    : "0 / 0";

  if (!website) {
    els.status.textContent = "No saved portfolios yet";
    els.emptyState.hidden = false;
    els.frame.hidden = true;
    els.frame.removeAttribute("src");
    els.frame.dataset.websitelink = "";
    renderRepoInfo(null);
    setButtonsState();
    renderList();
    return;
  }

  els.status.textContent = `Viewing ${website.githubuser}`;
  els.emptyState.hidden = true;
  els.frame.hidden = false;

  if (els.frame.dataset.websitelink !== website.websitelink) {
    els.frame.dataset.websitelink = website.websitelink;
    els.frame.src = website.websitelink;
  }

  renderRepoInfo(website);
  setButtonsState();
  renderList();
}

async function loadSavedWebsites() {
  const response = await fetch("/api/main");
  const data = await response.json();

  savedWebsites = (data.websites || []).slice().reverse();
  if (currentIndex >= savedWebsites.length) {
    currentIndex = Math.max(0, savedWebsites.length - 1);
  }

  renderViewer();
}

function showIndex(index) {
  if (index < 0 || index >= savedWebsites.length) return;
  currentIndex = index;
  renderViewer();
}

els.btnPrev.addEventListener("click", () => showIndex(currentIndex - 1));
els.btnNext.addEventListener("click", () => showIndex(currentIndex + 1));
els.btnOpen.addEventListener("click", () => {
  const website = getCurrentWebsite();
  if (!website?.websitelink) return;
  window.open(website.websitelink, "_blank", "noopener,noreferrer");
});

els.list.addEventListener("click", (event) => {
  const button = event.target.closest(".saved-list-item");
  if (!button) return;

  const index = Number(button.dataset.index);
  if (Number.isNaN(index)) return;
  showIndex(index);
});

document.addEventListener("keydown", (event) => {
  if (!savedWebsites.length) return;
  if (event.target.matches("input, textarea")) return;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    showIndex(currentIndex - 1);
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    showIndex(currentIndex + 1);
  }
});

loadSavedWebsites().catch(() => {
  els.status.textContent = "Could not load saved portfolios";
  renderViewer();
});
