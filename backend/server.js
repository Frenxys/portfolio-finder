require("dotenv").config();

const express = require("express");
const path = require("path");
const storage = require("./storage");
const { GitHubSearcher } = require("./github-searcher");
const { refreshGeneratedKeywords } = require("./keyword-generator");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SEARCH_INTERVAL_MS = Number(process.env.SEARCH_INTERVAL_MS) || 60_000;
const WEBSITE_CHECK_TIMEOUT_MS =
  Number(process.env.WEBSITE_CHECK_TIMEOUT_MS) || 8_000;

const BROKEN_WEBSITE_MARKERS = [
  /404:\s*not_found/i,
  /deployment_not_found/i,
  /this deployment cannot be found/i,
];

storage.ensureDataFiles();

const searcher = new GitHubSearcher();
let activeWebsite = null;

async function inspectWebsite(website) {
  if (!website?.websitelink) {
    return { broken: true, reason: "missing websitelink" };
  }

  try {
    const response = await fetch(website.websitelink, {
      redirect: "follow",
      signal: AbortSignal.timeout(WEBSITE_CHECK_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "website-finder-app",
      },
    });

    if (response.status === 404 || response.status === 410) {
      return { broken: true, reason: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const body = (await response.text()).slice(0, 5000);
      if (BROKEN_WEBSITE_MARKERS.some((pattern) => pattern.test(body))) {
        return { broken: true, reason: "deployment not found page" };
      }
    }

    return { broken: false };
  } catch (error) {
    return {
      broken: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveCurrentWebsite() {
  if (activeWebsite) {
    const seen = storage.readSeenSet();
    const key = storage.normalizeUrl(activeWebsite.websitelink);
    if (key && !seen.has(key)) {
      return activeWebsite;
    }
  }

  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = storage.getNextWebsite();
    if (!candidate) {
      activeWebsite = null;
      return null;
    }

    const inspection = await inspectWebsite(candidate);
    if (!inspection.broken) {
      activeWebsite = candidate;
      return activeWebsite;
    }

    console.log(
      `[skip] broken website ${candidate.websitelink} (${inspection.reason})`,
    );
    storage.markSeen(candidate.websitelink);
  }

  activeWebsite = null;
  return null;
}

function clearActiveWebsite() {
  activeWebsite = null;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/mainwebsites", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "mainwebsites.html"));
});

async function sendCurrent(res) {
  const website = await resolveCurrentWebsite();
  const stats = storage.getStats();
  const searchStatus = searcher.getStatus();

  res.json({
    website,
    stats,
    searchStatus,
  });
}

app.get("/api/current", async (_req, res) => {
  try {
    await sendCurrent(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/skip", async (req, res) => {
  const { websitelink } = req.body || {};
  if (!websitelink) {
    return res.status(400).json({ error: "websitelink is required" });
  }

  storage.markSeen(websitelink);
  clearActiveWebsite();

  try {
    await sendCurrent(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/add", async (req, res) => {
  const entry = req.body || {};
  if (!entry.websitelink) {
    return res.status(400).json({ error: "websitelink is required" });
  }

  storage.addToMain(entry);
  storage.markSeen(entry.websitelink);
  clearActiveWebsite();

  refreshGeneratedKeywords()
    .then((result) => {
      console.log(
        `[keywords] generated=${result.count} analyzed=${result.analyzed}`,
      );
    })
    .catch((error) => {
      console.error("[keywords] error:", error.message);
    });

  try {
    await sendCurrent(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

async function refreshKeywordsFromSavedProjects() {
  try {
    const result = await refreshGeneratedKeywords();
    console.log(
      `[keywords] generated=${result.count} analyzed=${result.analyzed}`,
    );
  } catch (error) {
    console.error("[keywords] error:", error.message);
  }
}

async function backgroundSearchLoop() {
  try {
    await searcher.runSearchCycle();
    console.log(
      `[search] keyword="${searcher.lastKeyword}" added=${searcher.lastAddedCount}`,
    );
  } catch (error) {
    console.error("[search] error:", error.message);
  }
}

refreshKeywordsFromSavedProjects();
backgroundSearchLoop();
setInterval(backgroundSearchLoop, SEARCH_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Website Finder running at http://localhost:${PORT}`);
  console.log(
    `Background GitHub search every ${SEARCH_INTERVAL_MS / 1000}s (keyword rotation enabled)`,
  );
  if (!process.env.GITHUB_TOKEN) {
    console.warn(
      "Tip: set GITHUB_TOKEN in .env for higher API rate limits (5000 req/hr)",
    );
  }
});
