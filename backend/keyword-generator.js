const storage = require("./storage");

const GITHUB_API = "https://api.github.com";

const STOPWORDS = new Set([
  "a",
  "an", 
  "and",
  "app",
  "apps",
  "best",
  "build",
  "built",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "my",
  "of",
  "on",
  "open",
  "opensource",
  "open-source",
  "project",
  "projects",
  "repo",
  "repository",
  "site",
  "template",
  "templates",
  "that",
  "the",
  "this",
  "to",
  "using",
  "with",
  "your",
]);

const GENERIC_TOKENS = new Set([
  "portfolio",
  "developer",
  "developers",
  "designer",
  "designers",
  "personal",
  "website",
  "websites",
  "homepage",
  "resume",
  "cv",
  "site",
  "template",
  "templates",
  "project",
  "projects",
]);

const NOISE_TOKENS = new Set([
  "agent",
  "blog",
  "boilerplate",
  "claude",
  "cli",
  "code",
  "com",
  "course",
  "demo",
  "docs",
  "documentation",
  "github",
  "landing",
  "mcp",
  "showcase",
  "showcases",
  "skills",
  "starter",
  "tutorial",
]);

const SHORT_TOKEN_ALLOWLIST = new Set(["3d", "ai", "ui", "ux", "vr", "xr"]);

const PORTFOLIO_TOKEN_ALLOWLIST = new Set([
  "astro",
  "bootstrap",
  "css",
  "framer",
  "gsap",
  "html",
  "javascript",
  "motion",
  "nextjs",
  "nuxtjs",
  "react",
  "rust",
  "scss",
  "svelte",
  "tailwind",
  "tailwindcss",
  "threejs",
  "typescript",
  "vue",
  "vuejs",
  "webgl",
]);

function getHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "website-finder-app",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function githubFetch(url) {
  const response = await fetch(url, { headers: getHeaders() });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API error ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  return response.json();
}

function parseRepoRef(githubUrl) {
  try {
    const url = new URL(githubUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/i, ""),
    };
  } catch {
    return null;
  }
}

function normalizePhrase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/next\.js/g, "nextjs")
    .replace(/nuxt\.js/g, "nuxtjs")
    .replace(/vue\.js/g, "vuejs")
    .replace(/[_./-]+/g, " ")
    .replace(/[^a-z0-9+#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLanguage(value) {
  return normalizePhrase(value)
    .replace(/^c\+\+$/, "cpp")
    .replace(/^c#$/, "csharp");
}

function tokenize(text) {
  return normalizePhrase(text)
    .split(" ")
    .filter(Boolean)
    .filter((token) => {
      if (STOPWORDS.has(token)) return false;
      if (/^\d+$/.test(token)) return false;
      return token.length >= 3 || SHORT_TOKEN_ALLOWLIST.has(token);
    });
}

function extractNgrams(tokens, min = 2, max = 3) {
  const phrases = [];

  for (let size = min; size <= max; size++) {
    for (let index = 0; index <= tokens.length - size; index++) {
      const slice = tokens.slice(index, index + size);
      if (slice.every((token) => GENERIC_TOKENS.has(token))) continue;
      phrases.push(slice.join(" "));
    }
  }

  return phrases;
}

function addCount(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function sortEntries(map) {
  return [...map.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });
}

function buildFallbackSignals(entry) {
  const ref = parseRepoRef(entry.githublink);
  return {
    name: ref?.repo || "",
    description: "",
    topics: [],
    language: entry.mainlangused || "",
  };
}

async function loadRepoSignals(entry) {
  const ref = parseRepoRef(entry.githublink);
  if (!ref) return buildFallbackSignals(entry);

  try {
    const repo = await githubFetch(
      `${GITHUB_API}/repos/${ref.owner}/${ref.repo}`,
    );
    return {
      name: repo.name || ref.repo,
      description: repo.description || "",
      topics: Array.isArray(repo.topics) ? repo.topics : [],
      language: repo.language || entry.mainlangused || "",
    };
  } catch {
    return buildFallbackSignals(entry);
  }
}

function isUsefulPhrase(phrase) {
  const words = tokenize(phrase);
  if (words.length === 0 || words.length > 4) return false;
  if (words.every((word) => GENERIC_TOKENS.has(word))) return false;
  if (words.some((word) => NOISE_TOKENS.has(word))) return false;
  return true;
}

function buildGeneratedKeywords(savedEntries, repoSignals) {
  if (savedEntries.length === 0 || repoSignals.length === 0) {
    return [];
  }

  const manualKeywords = new Set(
    storage.readManualKeywords().map((keyword) => keyword.toLowerCase()),
  );
  const minSupport = savedEntries.length >= 4 ? 2 : 1;

  const tokenCounts = new Map();
  const phraseCounts = new Map();
  const topicCounts = new Map();
  const languageCounts = new Map();
  const scoredKeywords = new Map();

  for (const repo of repoSignals) {
    const tokens = tokenize(`${repo.name} ${repo.description}`);
    const uniqueTokens = new Set(tokens);
    const uniquePhrases = new Set(extractNgrams(tokens));
    const uniqueTopics = new Set(
      (repo.topics || []).map(normalizePhrase).filter(isUsefulPhrase),
    );
    const language = normalizeLanguage(repo.language);

    for (const token of uniqueTokens) {
      addCount(tokenCounts, token);
    }

    for (const phrase of uniquePhrases) {
      addCount(phraseCounts, phrase);
    }

    for (const topic of uniqueTopics) {
      addCount(topicCounts, topic);
    }

    if (language) {
      addCount(languageCounts, language);
    }
  }

  for (const [topic, count] of sortEntries(topicCounts)) {
    if (count < minSupport || manualKeywords.has(topic)) continue;
    if (!isUsefulPhrase(topic)) continue;

    if (topic.includes("portfolio") || topic.includes("website")) {
      addCount(scoredKeywords, topic, count + 5);
    } else {
      addCount(scoredKeywords, `${topic} portfolio`, count + 3);
    }
  }

  for (const [phrase, count] of sortEntries(phraseCounts)) {
    if (count < minSupport || !isUsefulPhrase(phrase)) continue;
    if (manualKeywords.has(phrase)) continue;

    if (phrase.includes("portfolio") || phrase.includes("website")) {
      addCount(scoredKeywords, phrase, count + 2);
    } else {
      addCount(scoredKeywords, `${phrase} portfolio`, count + 1);
    }
  }

  for (const [language, count] of sortEntries(languageCounts)) {
    if (count < minSupport || !language || NOISE_TOKENS.has(language)) continue;
    addCount(scoredKeywords, `${language} portfolio`, count + 3);
  }

  for (const [token, count] of sortEntries(tokenCounts)) {
    if (
      count < minSupport ||
      GENERIC_TOKENS.has(token) ||
      NOISE_TOKENS.has(token) ||
      !PORTFOLIO_TOKEN_ALLOWLIST.has(token)
    ) {
      continue;
    }
    addCount(scoredKeywords, `${token} portfolio`, count + 1);
  }

  return sortEntries(scoredKeywords)
    .map(([keyword]) => keyword.trim())
    .filter(Boolean)
    .filter((keyword) => !manualKeywords.has(keyword.toLowerCase()))
    .slice(0, 20);
}

async function refreshGeneratedKeywords() {
  const savedEntries = storage.readMainWebsites();
  if (savedEntries.length === 0) {
    storage.writeGeneratedKeywords([]);
    return { count: 0, analyzed: 0, keywords: [] };
  }

  const repoSignals = await Promise.all(
    savedEntries.map((entry) => loadRepoSignals(entry)),
  );

  const keywords = buildGeneratedKeywords(savedEntries, repoSignals);
  storage.writeGeneratedKeywords(keywords);

  return {
    count: keywords.length,
    analyzed: repoSignals.length,
    keywords,
  };
}

module.exports = { refreshGeneratedKeywords };
