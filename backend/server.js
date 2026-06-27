require("dotenv").config();

const express = require("express");
const path = require("path");
const storage = require("./storage");
const { GitHubSearcher } = require("./github-searcher");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SEARCH_INTERVAL_MS = Number(process.env.SEARCH_INTERVAL_MS) || 60_000;

storage.ensureDataFiles();

const searcher = new GitHubSearcher();
let activeWebsite = null;

function resolveCurrentWebsite() {
  if (activeWebsite) {
    const seen = storage.readSeenSet();
    const key = storage.normalizeUrl(activeWebsite.websitelink);
    if (key && !seen.has(key)) {
      return activeWebsite;
    }
  }

  activeWebsite = storage.getNextWebsite();
  return activeWebsite;
}

function clearActiveWebsite() {
  activeWebsite = null;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function sendCurrent(res) {
  const website = resolveCurrentWebsite();
  const stats = storage.getStats();
  const searchStatus = searcher.getStatus();

  res.json({
    website,
    stats,
    searchStatus,
  });
}

app.get("/api/current", (_req, res) => {
  sendCurrent(res);
});

app.post("/api/skip", (req, res) => {
  const { websitelink } = req.body || {};
  if (!websitelink) {
    return res.status(400).json({ error: "websitelink is required" });
  }

  storage.markSeen(websitelink);
  clearActiveWebsite();
  sendCurrent(res);
});

app.post("/api/add", (req, res) => {
  const entry = req.body || {};
  if (!entry.websitelink) {
    return res.status(400).json({ error: "websitelink is required" });
  }

  storage.addToMain(entry);
  storage.markSeen(entry.websitelink);
  clearActiveWebsite();
  sendCurrent(res);
});

app.get("/api/stats", (_req, res) => {
  res.json({
    stats: storage.getStats(),
    searchStatus: searcher.getStatus(),
  });
});

app.get("/api/main", (_req, res) => {
  res.json({ websites: storage.readMainWebsites() });
});

app.post("/api/search-now", async (_req, res) => {
  try {
    const result = await searcher.runSearchCycle();
    res.json({ ok: true, result, stats: storage.getStats() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

async function backgroundSearchLoop() {
  try {
    await searcher.runSearchCycle();
    console.log(
      `[search] keyword="${searcher.lastKeyword}" added=${searcher.lastAddedCount}`
    );
  } catch (error) {
    console.error("[search] error:", error.message);
  }
}

backgroundSearchLoop();
setInterval(backgroundSearchLoop, SEARCH_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Website Finder running at http://localhost:${PORT}`);
  console.log(
    `Background GitHub search every ${SEARCH_INTERVAL_MS / 1000}s (keyword rotation enabled)`
  );
  if (!process.env.GITHUB_TOKEN) {
    console.warn(
      "Tip: set GITHUB_TOKEN in .env for higher API rate limits (5000 req/hr)"
    );
  }
});
