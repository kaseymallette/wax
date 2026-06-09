# Wax — Spotify Library Rater

A personal tool for rediscovering your music. Upload your SQLite library, shuffle through random songs, and rate each one (verdict + listen-frequency + hear-again + mood tags + free-text notes). Ratings are saved locally and exportable as CSV for downstream projects.

## What you need

- **Node.js 18+** (check: `node --version`)
- **npm** (ships with Node)

That's it — no other dependencies, no API keys, no cloud accounts.

## Setup (one time)

```bash
cd wax
npm install
```

This installs everything (Express, Vite, React, better-sqlite3, etc.) into `node_modules/`. Takes ~30 seconds.

## Run it

```bash
npm run dev
```

Open **http://localhost:5000** in your browser. The Express backend and the Vite frontend both run on port 5000.

For full-song playback in the embed, log into Spotify in the same browser (any other tab is fine). Premium = full track, Free = 30 seconds.

## Use it

1. **Import** → drop your `.db` / `.sqlite` file. Pick the tracks table, confirm the column mapping (Track ID is the only required field — auto-detect handles the rest), import.
2. **Shuffle** → rate songs. Keyboard: `Y` / `M` / `N` for verdict, `1`–`5` for frequency, `→` to skip, `Enter` to save.
3. **Library** → searchable table of every track + rating. Click a row to re-rate.
4. **Stats** → verdict counts, frequency distribution, top mood tags, recent ratings.
5. **Import → Export ratings as CSV** → grab your ratings for your other Spotify projects anytime.

## Where your data lives

- **`data.db`** in the project root — SQLite file with two tables: `tracks` (your imported library) and `ratings` (your verdicts/scores/notes). Back this file up if you care about it.
- The CSV export from the Import page is the cleanest way to pipe ratings into pandas / your other tools. Columns: `track_id`, `name`, `artists`, `album`, `verdict`, `frequency`, `hear_again`, `mood_tags` (JSON array), `notes`, `rated_at`, `updated_at`, `spotify_url`.

## Reading the ratings DB directly from Python

```python
import sqlite3, json, pandas as pd

con = sqlite3.connect("wax/data.db")
df = pd.read_sql_query("""
    SELECT t.track_id, t.name, t.artists, t.album,
           r.verdict, r.frequency, r.hear_again,
           r.mood_tags, r.notes, r.rated_at
    FROM tracks t
    LEFT JOIN ratings r ON r.track_id = t.track_id
""", con)
df["mood_tags"] = df["mood_tags"].apply(lambda s: json.loads(s) if s else [])
```

## Production build (optional)

If you want a single bundled artifact instead of running the dev server:

```bash
npm run build              # outputs dist/
NODE_ENV=production node dist/index.cjs   # serves on port 5000
```

## Troubleshooting

- **Port 5000 already in use** → kill whatever's there (`lsof -ti:5000 | xargs kill`) or change the port in `server/index.ts`.
- **`better-sqlite3` install fails** → needs a C++ build toolchain. On macOS: `xcode-select --install`. On Ubuntu: `sudo apt install build-essential python3`.
- **Embed shows the wrong song** → means your imported track is missing or has a bad `track_id`. Re-map the Track ID column on `/import`.
- **Lost ratings after rebuild** → `data.db` is at the project root, not inside `dist/`. Don't delete it.

## Tech stack

Express · Vite · React · Tailwind · shadcn/ui · Drizzle ORM · better-sqlite3 · TanStack Query · framer-motion · Fontshare (Cabinet Grotesk + Satoshi).
