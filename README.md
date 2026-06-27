# Website Finder

Discover open-source developer portfolios by searching GitHub with rotating keywords, preview them in an iframe, and save the ones you like.

## Features

- **Background GitHub search** — runs continuously, rotating through keywords in `data/keywords.txt` (starts with `portfolio`). Only repos with **5+ stars** that were **updated recently** (default: last 180 days) are included.
- **Found websites log** — `data/found_websites.txt` with `githubuser,githublink,websitelink,starnumber,mainlangused`
- **Seen blacklist** — skipped or saved sites go into `data/seen_websites.txt` and won't show again
- **Main list** — saved portfolios in `data/main_websites.txt`
- **Web UI** — iframe preview with **Skip** and **Add to main list** buttons (keyboard: `S` / `A`)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and add a GitHub token (recommended):

```bash
copy .env.example .env
```

Create a token at [github.com/settings/tokens](https://github.com/settings/tokens) with no scopes (public repo read is enough). Without a token you get ~60 API requests/hour; with a token ~5000/hour.

3. Start the server:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Customization

- **Keywords** — edit `data/keywords.txt` (one keyword per line). The backend alternates through them on each search cycle.
- **Search interval** — set `SEARCH_INTERVAL_MS` in `.env` (default: 60000 = 1 minute).
- **Port** — set `PORT` in `.env` (default: 3000).
- **Star filter** — set `MIN_STARS` (default: 5) and `MAX_STARS` (default: 5000).
- **Recency filter** — set `PUSHED_WITHIN_DAYS` (default: 180). Only repos pushed within that window are searched; results are sorted by most recently updated.

## Data files

| File | Purpose |
|------|---------|
| `data/found_websites.txt` | All discovered portfolio sites from GitHub |
| `data/seen_websites.txt` | Blacklist of URLs you've already reviewed |
| `data/main_websites.txt` | Portfolios you chose to keep |
| `data/keywords.txt` | Search keywords (rotated automatically) |

## How discovery works

1. The backend searches GitHub repos matching the current keyword (name, description, readme).
2. It extracts a personal website from the repo homepage field or README links.
3. GitHub/social/npm links are filtered out; custom domains are kept.
4. New sites are appended to `found_websites.txt`.
5. The UI shows the next unseen site in an iframe.

## Notes

- Some sites block iframe embedding (`X-Frame-Options`); use **Open in new tab** for those.
- Forks are skipped to focus on original portfolios.
