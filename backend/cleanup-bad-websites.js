const fs = require("fs");
const path = require("path");
const storage = require("./storage");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILES = [
  path.join(DATA_DIR, "found_websites.txt"),
  path.join(DATA_DIR, "main_websites.txt"),
];

const BAD_URL_PATTERNS = [
  /github-readme-(stats|streak-stats)/i,
  /readme-typing-svg/i,
  /\/api\/top-langs\b/i,
  /[?&]layout=compact\b/i,
  /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?\b/i,
  /\/(docs|documentation)(\/|$)/i,
  /\/(swagger|swagger-ui)(\/|$)/i,
  /\/(redoc|openapi)(\/|$)/i,
  /\/api(\/|$)/i,
  /https?:\/\/(www\.)?(stackblitz|replit)\.com\b/i,
  /https?:\/\/(www\.)?glitch\.me\b/i,
  /https?:\/\/(www\.)?gitpod\.io\b/i,
];

function parseCsvLine(line) {
  const parts = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const ch = line[index];
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

function isBadWebsite(url) {
  const normalized = storage.normalizeUrl(url);
  return BAD_URL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function cleanCsvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { removed: 0, removedUrls: [] };
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return { removed: 0, removedUrls: [] };
  }

  const hasHeader = lines[0].toLowerCase().startsWith("githubuser,");
  const header = hasHeader ? lines[0] : null;
  const body = hasHeader ? lines.slice(1) : lines;

  const kept = [];
  const removedUrls = [];

  for (const line of body) {
    const parts = parseCsvLine(line);
    const website = parts[2] || "";
    if (isBadWebsite(website)) {
      removedUrls.push(website);
      continue;
    }
    kept.push(line);
  }

  const outputLines = [];
  if (header) outputLines.push(header);
  outputLines.push(...kept);
  const output = outputLines.length ? outputLines.join("\n") + "\n" : "";
  fs.writeFileSync(filePath, output, "utf8");

  return { removed: removedUrls.length, removedUrls };
}

function cleanSeenFile(removedUrls) {
  const seenPath = path.join(DATA_DIR, "seen_websites.txt");
  if (!fs.existsSync(seenPath) || removedUrls.length === 0) {
    return 0;
  }

  const removedSet = new Set(
    removedUrls.map((url) => storage.normalizeUrl(url)),
  );
  const lines = fs
    .readFileSync(seenPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const kept = lines.filter(
    (line) => !removedSet.has(storage.normalizeUrl(line)),
  );
  fs.writeFileSync(seenPath, kept.length ? kept.join("\n") + "\n" : "", "utf8");
  return lines.length - kept.length;
}

function main() {
  const summaries = FILES.map((filePath) => ({
    file: path.basename(filePath),
    ...cleanCsvFile(filePath),
  }));

  const removedUrls = [
    ...new Set(summaries.flatMap((summary) => summary.removedUrls)),
  ];
  const removedSeen = cleanSeenFile(removedUrls);

  console.log(JSON.stringify({ summaries, removedSeen }, null, 2));
}

main();
