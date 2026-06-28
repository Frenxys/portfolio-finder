const storage = require("./storage");

const GITHUB_API = "https://api.github.com";
const MIN_STARS = Number(process.env.MIN_STARS) || 5;
const MAX_STARS = Number(process.env.MAX_STARS) || 5000;
const PUSHED_WITHIN_DAYS = Number(process.env.PUSHED_WITHIN_DAYS) || 180;

const SKIP_HOSTS = new Set([
  "github.com",
  "github.io",
  "raw.githubusercontent.com",
  "gist.github.com",
  "npmjs.com",
  "www.npmjs.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "www.linkedin.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "discord.gg",
  "discord.com",
  "t.me",
  "medium.com",
  "dev.to",
  "codepen.io",
  "codesandbox.io",
  "stackoverflow.com",
  "reddit.com",
  "www.reddit.com",
  "google.com",
  "www.google.com",
  "gmail.com",
  "mailto",
  "img.shields.io",
  "shields.io",
  "badge.fury.io",
  "badgen.net",
  "codecov.io",
  "coveralls.io",
  "codeclimate.com",
  "www.codeclimate.com",
]);

const SKIP_URL_PATTERNS = [
  /utm_source=/i,
  /utm_campaign=/i,
  /\/badges?\//i,
  /img\.shields\.io/i,
  /\.(jpg|jpeg|png|gif|svg|webp)(\?|$)/i,
];

const SKIP_REPO_NAME_PATTERNS = [
  /^awesome-/i,
  /awesome-/i,
  /-awesome$/i,
  /^free-for-/i,
  /^public-/i,
  /curated/i,
  /collection/i,
];

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

  if (response.status === 403) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    throw new Error(
      `GitHub rate limit hit (remaining: ${remaining}, reset: ${reset})`,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API error ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  return response.json();
}

function isLikelyPortfolioSite(urlString) {
  try {
    const url = new URL(urlString);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (SKIP_HOSTS.has(host)) return false;
    if (host.endsWith(".github.io")) return false;
    if (!/^https?:$/i.test(url.protocol)) return false;
    if (SKIP_URL_PATTERNS.some((pattern) => pattern.test(urlString))) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isLikelyPortfolioRepo(repo) {
  const name = (repo.name || "").toLowerCase();
  const description = (repo.description || "").toLowerCase();
  const stars = repo.stargazers_count ?? 0;

  if (repo.fork) return false;
  if (stars < MIN_STARS) return false;
  if (stars > MAX_STARS) return false;
  if (SKIP_REPO_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return false;
  }

  const portfolioHints = [
    "portfolio",
    "personal",
    "website",
    "homepage",
    "developer",
    "designer",
    "resume",
    "cv",
  ];

  const haystack = `${name} ${description}`;
  return portfolioHints.some((hint) => haystack.includes(hint));
}

function extractUrlsFromText(text) {
  if (!text) return [];

  const regex = /https?:\/\/[^\s)\]"'<>]+/gi;
  const matches = text.match(regex) || [];

  return matches.map((raw) => raw.replace(/[.,;:!?)]+$/, ""));
}

function pickWebsiteUrl(homepage, readmeText) {
  const candidates = [];

  if (homepage) candidates.push(homepage);
  candidates.push(...extractUrlsFromText(readmeText));

  for (const candidate of candidates) {
    if (isLikelyPortfolioSite(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function fetchReadme(owner, repo) {
  const branches = ["main", "master"];

  for (const branch of branches) {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/readme?ref=${branch}`;
    try {
      const data = await githubFetch(url);
      if (data.content) {
        return Buffer.from(data.content, "base64").toString("utf8");
      }
    } catch {
      // try next branch
    }
  }

  return "";
}

function getPushedSinceDate() {
  const date = new Date();
  date.setDate(date.getDate() - PUSHED_WITHIN_DAYS);
  return date.toISOString().slice(0, 10);
}

function buildSearchQuery(keyword) {
  const trimmed = keyword.trim();
  const pushedSince = getPushedSinceDate();
  return `${trimmed} in:name,description stars:${MIN_STARS}..${MAX_STARS} fork:false pushed:>${pushedSince}`;
}

async function searchRepositories(keyword, page = 1) {
  const query = encodeURIComponent(buildSearchQuery(keyword));
  const url = `${GITHUB_API}/search/repositories?q=${query}&sort=updated&order=desc&per_page=30&page=${page}`;
  return githubFetch(url);
}

async function processRepository(repo) {
  if (!isLikelyPortfolioRepo(repo)) return null;

  if (repo.homepage && isLikelyPortfolioSite(repo.homepage)) {
    return {
      githubuser: repo.owner.login,
      githublink: repo.html_url,
      websitelink: repo.homepage,
      starnumber: String(repo.stargazers_count ?? 0),
      mainlangused: repo.language || "Unknown",
    };
  }

  const readme = await fetchReadme(repo.owner.login, repo.name);
  const readmeUrl = pickWebsiteUrl("", readme);
  if (!readmeUrl) return null;

  return {
    githubuser: repo.owner.login,
    githublink: repo.html_url,
    websitelink: readmeUrl,
    starnumber: String(repo.stargazers_count ?? 0),
    mainlangused: repo.language || "Unknown",
  };
}

class GitHubSearcher {
  constructor() {
    this.keywordIndex = 0;
    this.pageByKeyword = new Map();
    this.running = false;
    this.lastSearchAt = null;
    this.lastKeyword = null;
    this.lastAddedCount = 0;
    this.lastError = null;
  }

  getNextKeyword(keywords) {
    if (keywords.length === 0) return "portfolio";

    const keyword = keywords[this.keywordIndex % keywords.length];
    this.keywordIndex = (this.keywordIndex + 1) % keywords.length;
    return keyword;
  }

  getPageForKeyword(keyword) {
    const current = this.pageByKeyword.get(keyword) || 1;
    this.pageByKeyword.set(keyword, current + 1);
    return current;
  }

  async runSearchCycle() {
    if (this.running) return { skipped: true };

    this.running = true;
    this.lastError = null;
    this.lastAddedCount = 0;

    try {
      const keywords = storage.readKeywords();
      const keyword = this.getNextKeyword(keywords);
      const page = this.getPageForKeyword(keyword);

      this.lastKeyword = keyword;
      this.lastSearchAt = new Date().toISOString();

      const result = await searchRepositories(keyword, page);
      const existing = storage.readFoundWebsites();
      const seen = storage.readSeenSet();

      const knownUrls = new Set(
        existing.map((entry) => storage.normalizeUrl(entry.websitelink)),
      );

      for (const repo of result.items || []) {
        let entry;
        try {
          entry = await processRepository(repo);
        } catch {
          continue;
        }

        if (!entry) continue;

        const normalized = storage.normalizeUrl(entry.websitelink);
        if (!normalized || knownUrls.has(normalized) || seen.has(normalized)) {
          continue;
        }

        storage.appendFoundWebsite(entry);
        knownUrls.add(normalized);
        this.lastAddedCount += 1;
      }

      return {
        keyword,
        page,
        totalCount: result.total_count,
        added: this.lastAddedCount,
      };
    } catch (error) {
      this.lastError = error.message;
      throw error;
    } finally {
      this.running = false;
    }
  }

  getStatus() {
    return {
      running: this.running,
      lastSearchAt: this.lastSearchAt,
      lastKeyword: this.lastKeyword,
      lastAddedCount: this.lastAddedCount,
      lastError: this.lastError,
      nextKeywordIndex: this.keywordIndex,
      filters: {
        minStars: MIN_STARS,
        maxStars: MAX_STARS,
        pushedWithinDays: PUSHED_WITHIN_DAYS,
        pushedSince: getPushedSinceDate(),
      },
    };
  }
}

module.exports = { GitHubSearcher, isLikelyPortfolioSite };
