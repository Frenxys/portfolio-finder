const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FOUND_FILE = path.join(DATA_DIR, "found_websites.txt");
const SEEN_FILE = path.join(DATA_DIR, "seen_websites.txt");
const MAIN_FILE = path.join(DATA_DIR, "main_websites.txt");
const KEYWORDS_FILE = path.join(DATA_DIR, "keywords.txt");

const CSV_HEADER =
  "githubuser,githublink,websitelink,starnumber,mainlangused";

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(FOUND_FILE)) {
    fs.writeFileSync(FOUND_FILE, CSV_HEADER + "\n", "utf8");
  }

  for (const file of [SEEN_FILE, MAIN_FILE]) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "", "utf8");
    }
  }
}

function parseCsvLine(line) {
  const parts = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function escapeCsv(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function serializeEntry(entry) {
  return [
    escapeCsv(entry.githubuser),
    escapeCsv(entry.githublink),
    escapeCsv(entry.websitelink),
    escapeCsv(entry.starnumber),
    escapeCsv(entry.mainlangused),
  ].join(",");
}

function normalizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    let normalized = parsed.toString();
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readFoundWebsites() {
  const lines = readLines(FOUND_FILE);
  if (lines.length === 0) return [];

  const startIndex =
    lines[0].toLowerCase().startsWith("githubuser,") ? 1 : 0;

  const entries = [];
  for (let i = startIndex; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    if (parts.length < 5) continue;

    entries.push({
      githubuser: parts[0],
      githublink: parts[1],
      websitelink: parts[2],
      starnumber: parts[3],
      mainlangused: parts[4],
    });
  }
  return entries;
}

function readSeenSet() {
  return new Set(readLines(SEEN_FILE).map(normalizeUrl));
}

function readMainWebsites() {
  const lines = readLines(MAIN_FILE);
  if (lines.length === 0) return [];

  const startIndex =
    lines[0].toLowerCase().startsWith("githubuser,") ? 1 : 0;

  const entries = [];
  for (let i = startIndex; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    if (parts.length < 5) continue;

    entries.push({
      githubuser: parts[0],
      githublink: parts[1],
      websitelink: parts[2],
      starnumber: parts[3],
      mainlangused: parts[4],
    });
  }
  return entries;
}

function readKeywords() {
  return readLines(KEYWORDS_FILE);
}

function appendFoundWebsite(entry) {
  const line = serializeEntry(entry);
  fs.appendFileSync(FOUND_FILE, line + "\n", "utf8");
}

function markSeen(websitelink) {
  const normalized = normalizeUrl(websitelink);
  const seen = readSeenSet();
  if (seen.has(normalized)) return;

  fs.appendFileSync(SEEN_FILE, normalized + "\n", "utf8");
}

function addToMain(entry) {
  const existing = readMainWebsites();
  const normalized = normalizeUrl(entry.websitelink);
  const alreadyAdded = existing.some(
    (item) => normalizeUrl(item.websitelink) === normalized
  );
  if (alreadyAdded) return;

  const hasHeader =
    fs.existsSync(MAIN_FILE) &&
    fs.readFileSync(MAIN_FILE, "utf8").trim().length > 0;

  if (!hasHeader) {
    fs.writeFileSync(MAIN_FILE, CSV_HEADER + "\n", "utf8");
  }

  fs.appendFileSync(MAIN_FILE, serializeEntry(entry) + "\n", "utf8");
}

function getNextWebsite() {
  const seen = readSeenSet();
  const found = readFoundWebsites();

  for (const entry of found) {
    const key = normalizeUrl(entry.websitelink);
    if (!key || seen.has(key)) continue;
    return entry;
  }
  return null;
}

function getStats() {
  const found = readFoundWebsites();
  const seen = readSeenSet();
  const main = readMainWebsites();
  const pending = found.filter(
    (entry) => !seen.has(normalizeUrl(entry.websitelink))
  ).length;

  return {
    found: found.length,
    seen: seen.size,
    main: main.length,
    pending,
  };
}

module.exports = {
  ensureDataFiles,
  readKeywords,
  readFoundWebsites,
  readSeenSet,
  readMainWebsites,
  appendFoundWebsite,
  markSeen,
  addToMain,
  getNextWebsite,
  getStats,
  normalizeUrl,
};
