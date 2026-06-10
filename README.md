# Wax

A listening journal for your music library. Upload, shuffle, log what you actually played — and how it felt.

## Introduction

Wax is a local-first listening journal for your music library. Upload your Spotify export (`.db`, `.sqlite`, or Exportify `.csv`), shuffle through your tracks, and log what you actually played — what you were doing, how it felt, whether you'd play it again. Built to help you stop streaming past your library and start curating it.

## Screenshots

<!-- Add screenshots here: shuffle card, library table, recents timeline, stats. -->

## Quick start

```bash
git clone https://github.com/kaseymallette/wax.git
cd wax
npm install
PORT=3000 npm run dev
```

Open **http://localhost:3000**. Express backend and Vite frontend both run on the same port. (Port 5000 conflicts with macOS AirPlay — that's why the default is 3000.)

For full-song playback in the embed, sign into Spotify in any tab of the same browser. Premium plays the whole track; Free gives you 30-second previews.

## Terminal shortcut (zsh)

If you want to launch Wax from anywhere in Terminal, add this function to `~/.zshrc`:

```bash
cat >> ~/.zshrc << 'EOF'

# Wax - launch the listening journal
wax() {
  cd /Users/kaseymallette/github/wax && PORT=3000 npm run dev
}
EOF

source ~/.zshrc
```

Now you can run:

```text
wax
```

Optional: open the app in your browser automatically too:

```bash
wax() {
  cd /Users/kaseymallette/github/wax && open http://localhost:3000 && PORT=3000 npm run dev
}
```

## How it works

1. **Import** — drop your `.db`, `.sqlite`, or `.csv` file on the import page. SQLite uploads use a column mapper (Track ID is the only required field; the rest auto-detects). CSV uploads auto-detect Exportify's standard columns.
2. **Shuffle** — get a random track from your library, listen, and log it. Each entry captures:
   - **Listened** — did you actually play it through?
   - **Want to listen again** — yes / no
   - **Would play again** — yes / no
   - **Keep in library** — keep / remove (logged preference only; does not delete)
   - **Activity tags** — what you were doing (working, working out, cleaning, driving, dancing, singing, active listening, processing, resting, or custom)
   - **Notes** — free text
   - **Era** (set once per track) — recently discovered, recently remembered, core Spotify, core iTunes, core CD, Dance, Radio, Recommended, or your own custom era
3. **Library** — searchable table of every track with listen count, last listened, and would-again count. Click any row to play it, log a new entry, edit its era, or view its full history.
4. **Recents** — timeline of every entry, grouped by day, with filters for activity, era, and would-again.
5. **Stats** — listens over time, top tracks, activity breakdown, would-again ratio, era distribution.

## Data model

Two tables in `data.db`:

- **`tracks`** — your imported library. One row per Spotify track ID. Columns: `id`, `name`, `artists`, `album`, `album_art_url`, `duration_ms`, `added_at`, `spotify_url`, `preview_url`, `imported_at`, `era`.
- **`listens`** — your log entries. One row per logged listen. Columns: `id`, `track_id`, `listened` (0/1), `want_again` (0/1), `would_again` (0/1), `keep_in_library` (0/1), `activity` (JSON array), `notes`, `logged_at` (unix ms).

Indexes on `listens(track_id)` and `listens(logged_at DESC)`.

## Where your data lives

- **`data.db`** in the project root. Back this file up if you care about it.
- CSV export from the API gives you everything in one file:

```bash
curl http://localhost:3000/api/export -o ~/Downloads/wax-listens.csv
```

Columns: `track_id`, `name`, `artists`, `album`, `era`, `listened`, `want_again`, `would_again`, `keep_in_library`, `activity`, `notes`, `logged_at`.

To generate a curated `again-again.db` using each track's latest rating (so mind-changes are respected), run:

```bash
npm run db:again-again
```

This creates/overwrites `again-again.db` with two tables:

- `tracks`: only tracks whose most recent listen has `would_again = 1`
- `listens`: one row per included track (its most recent listen, where `would_again = 1`)

Sample query:

```bash
sqlite3 again-again.db "SELECT COUNT(*) AS tracks FROM tracks;"
```

## Reading your data from Python

```python
import sqlite3, json, pandas as pd

con = sqlite3.connect("wax/data.db")
df = pd.read_sql_query("""
    SELECT t.id AS track_id, t.name, t.artists, t.album, t.era,
           l.listened, l.want_again, l.would_again, l.keep_in_library,
           l.activity, l.notes, l.logged_at
    FROM tracks t
    LEFT JOIN listens l ON l.track_id = t.id
    ORDER BY l.logged_at DESC
""", con)
df["activity"] = df["activity"].apply(lambda s: json.loads(s) if s else [])
df["logged_at"] = pd.to_datetime(df["logged_at"], unit="ms")
```

## Production build (optional)

```bash
npm run build                              # outputs dist/
NODE_ENV=production PORT=3000 node dist/index.cjs
```

## Troubleshooting

- **Port already in use** → `lsof -ti:3000 | xargs kill` then restart. Or run on a different port: `PORT=4000 npm run dev`.
- **macOS AirPlay grabbing port 5000** → use `PORT=3000` (default) or disable AirPlay Receiver in System Settings → General → AirDrop & Handoff.
- **`better-sqlite3` install fails** → needs a C++ toolchain. macOS: `xcode-select --install`. Ubuntu: `sudo apt install build-essential python3`. Node 22+ is recommended; Node 26 has no prebuilt binaries yet.
- **Old UI shows after pulling new code** → Vite cache: `rm -rf node_modules/.vite dist && npm run dev`, then hard-refresh the browser (Cmd+Shift+R).
- **Tracks show as "Unknown track" after CSV import** → your CSV's name column wasn't auto-detected. Wax recognizes `Song`, `Title`, `Track`, `Track Name`, `Song Name`. Rename your column or open an issue.
- **Lost data after rebuild** → `data.db` lives at the project root, not in `dist/`. Don't delete it.

## Tech stack

Express · Vite · React · TypeScript · Tailwind · shadcn/ui · Drizzle ORM · better-sqlite3 · TanStack Query · framer-motion · Recharts · Fontshare (Cabinet Grotesk + Satoshi).

## License

MIT
