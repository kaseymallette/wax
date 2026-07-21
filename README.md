# Wax

A local-first listening journal for your music library. Upload tracks, shuffle with intent, tag what to keep, and generate export-ready playlists you can push to Spotify.

## Introduction

Wax is built for deliberate curation instead of endless skipping. Import your library (`.db`, `.sqlite`, or Exportify `.csv`), run Shuffle, and log decisions quickly with keep/remove plus repeat intent.

Tracks start as *Undecided*, and keeps are organized into five intent buckets: *Currently Listening*, *Save for Later*, *Off the Rotation*, *Favorites Archive*, and *Skip for Now*. These intents drive weighted shuffle, Keeps/Stats views, and playlist generation.

The default playlist flow creates 7 daily playlists from *Currently Listening* (BPM + mood clustering, dynamic per-playlist cap tiers from 5 up to 30 tracks), plus one playlist each for *Currently Listening* (all tracks), *Save for Later*, and *Favorites Archive*. Everything exports to CSV first, then can be pushed to Spotify with the built-in push script.

Wax also tracks core audio features for analysis and ordering: BPM, key (Camelot), energy, dance, and valence. Mood score is `energy + dance + valence` on a 0–300 scale.

## Screenshots

### 01. Dev setup + launch

![Dev setup + launch](images/01_run_dev.png)

### 02. Import library source

![Import library source](images/02_import_library.png)

### 03. Map import columns

![Map import columns](images/03_map_columns.png)

### 04. Import confirmation

![Import confirmation](images/04_import_complete.png)

### 05. Shuffle

![Shuffle](images/05_shuffle_up_next.png)

### 06. Keep Workflow

![Shuffle keep workflow](images/06_shuffle_keep.png)

### 07. Library search + browse

![Library search and browse](images/07_library_search.png)

### 08. Recents timeline

![Recents timeline](images/08_recents.png)

### 09. Keeps workspace

![Keeps workspace](images/09_keeps.png)

### 10. Playlists workspace

![Playlists workspace](images/10_playlists.png)

### 11. Stats dashboard

![Stats dashboard](images/11_stats.png)

## Quick start

```bash
git clone https://github.com/kaseymallette/wax.git
cd wax
npm install
npm run dev

```

Then open **http://127.0.0.1:3000**.

### Import your music library

You can import a Spotify export (`.db`, `.sqlite`, or Exportify `.csv`) directly in the app.

If you need a playlist CSV from Spotify:

1. Build or open a playlist in Spotify.
2. Copy the playlist link.
3. Go to [Chosic Playlist Exporter](https://www.chosic.com/spotify-playlist-exporter/) and export as CSV.
4. Upload that CSV in Wax Import.

In Wax:

1. Open the app and go to the Import flow.
2. Upload your `.db`, `.sqlite`, or exported `.csv` file.
3. If prompted, map columns and complete import.

### Navigate the app

Wax lands on **Import** by default (`/`). The top nav order is **Import → Evaluate → Shuffle → Library → Recents → Keeps → Playlists → Stats**.

- Use **Import** to load your library CSV/DB.
- Use **Evaluate** to review a playlist CSV and apply keep/remove decisions in bulk.
- Use **Shuffle** for one-by-one listening decisions.
- Use **Library** to browse/search tracks and edit repeat-intent tags directly.
- Use **Recents** to review your latest logged decisions timeline.
- Use **Keeps** to manage all keep-tagged songs and move tracks between keep buckets.
- Use **Playlists** to inspect daily + intent playlists before Spotify push.
- Use **Stats** to view totals, activity trends, and tag distribution.

For full-song playback in the embed, sign into Spotify in any tab of the same browser. Premium plays the whole track; Free gives you 30-second previews.

## Users

### Switch between users

This starts the app using that user's DB file (`users/<name>/music_library.db`).
Use this when you want to work in one person's library/decisions without touching another user's DB.

```bash
WAX_USER=kasey npm run dev:user
WAX_USER=kaseysdad npm run dev:user
WAX_USER=kaseysmom npm run dev:user
```

### Export decisions for each user

This writes the latest decisions from that user's DB (`users/<name>/music_library.db`) to
`users/<name>/decisions-latest.json` so it can be tracked in git/history.

```bash
WAX_USER=kasey npm run user:export
WAX_USER=kaseysdad npm run user:export
WAX_USER=kaseysmom npm run user:export
```

### Build playlists for each user

This reads that user's DB (`users/<name>/music_library.db`) and generates playlist CSVs in
`users/<name>/playlists/`.

```bash
WAX_USER=kasey npm run user:playlists
WAX_USER=kaseysdad npm run user:playlists
WAX_USER=kaseysmom npm run user:playlists
```

### Remove songs marked `removed` from each user DB

This deletes tracks marked with repeat intent `removed` from that user's DB (`users/<name>/music_library.db`).

```bash
WAX_USER=kasey npm run user:remove
WAX_USER=kaseysdad npm run user:remove
WAX_USER=kaseysmom npm run user:remove
```

### Check duplicate tracks in each user DB

This checks a user's `users/<name>/music_library.db` for duplicate artist+song groups and writes a per-user CSV report.

```bash
WAX_USER=kasey npm run user:dupes
WAX_USER=kaseysdad npm run user:dupes
WAX_USER=kaseysmom npm run user:dupes
```

This writes:

- `users/<user>/duplicate-tracks.csv`

### Back up user data

Each user DB (`users/<name>/music_library.db`) is local and not tracked in git. You can back up and restore a user's DB with:

```bash
WAX_USER=kasey npm run backup-db
WAX_USER=kasey npm run restore-db
```

## Spotify API playlists

Wax uses one default playlist-generation flow (CSV-first for review, then Spotify push).

### Default playlist flow

- Uses the same generation logic as the in-app `Playlists` tab.
- Builds 7 daily playlists from `currently_listening` using k-means on BPM + mood (`energy + dance + valence`) with nearest-neighbor ordering.
- Uses dynamic per-playlist caps based on current `currently_listening` count:
  - `0–35` tracks → max `5` per playlist
  - `36–70` tracks → max `10` per playlist
  - `71–105` tracks → max `15` per playlist
  - `106–140` tracks → max `20` per playlist
  - `141–175` tracks → max `25` per playlist
  - `176+` tracks → max `30` per playlist
- Also writes one CSV each for `currently_listening`, `favorites_archive`, and `save_for_later`.

Run:

```bash
WAX_USER=kasey npm run user:playlists
WAX_USER=kaseysdad npm run user:playlists
WAX_USER=kaseysmom npm run user:playlists
```

Capture a weekly snapshot of `daily-1..7.csv` for all users into a separate SQLite DB (`data/wax_daily_playlists.db` by default):

```bash
npm run playlists:capture:weekly
```

Optional env vars:

- `WAX_USERS` comma-separated user list (default: `kasey,kaseysmom,kaseysdad`)
- `WAX_WEEK_START` reference date (`YYYY-MM-DD`); capture is keyed to that ISO week (Monday start)
- `WAX_DAILY_DB_PATH` output DB path (default: `data/wax_daily_playlists.db`)

Examples:

```bash
WAX_WEEK_START=2026-07-20 npm run playlists:capture:weekly
WAX_USERS=kasey,kaseysmom,kaseysdad WAX_DAILY_DB_PATH=data/wax_daily_playlists.db npm run playlists:capture:weekly
```

Outputs:

- `users/<name>/playlists/daily-1.csv`
- `users/<name>/playlists/daily-2.csv`
- `users/<name>/playlists/daily-3.csv`
- `users/<name>/playlists/daily-4.csv`
- `users/<name>/playlists/daily-5.csv`
- `users/<name>/playlists/daily-6.csv`
- `users/<name>/playlists/daily-7.csv`
- `users/<name>/playlists/currently-listening.csv`
- `users/<name>/playlists/favorites-archive.csv`
- `users/<name>/playlists/save-for-later.csv`
- `users/<name>/playlists/summary.json`
- `users/<name>/playlists/missing-features.log` *(only when currently-listening tracks are missing BPM/energy/dance/valence)*

If Spotify API is configured (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`), push playlists to Spotify with:

```bash
WAX_USER=kasey npm run spotify:push:dry
WAX_USER=kasey npm run spotify:push
WAX_USER=kaseysdad npm run spotify:push:dry
WAX_USER=kaseysdad npm run spotify:push
WAX_USER=kaseysmom npm run spotify:push:dry
WAX_USER=kaseysmom npm run spotify:push
```

### Spotify push agent

Once your CSV outputs look right, you can push them to Spotify playlists.

You only do setup once (steps 1–4). After that, pushing is a single command.

1. Register a Spotify app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
   - App name: `Wax`
   - App description: `WAX playlists`
   - Add redirect URI exactly: `http://127.0.0.1:8888/callback`
   - Enable **Web API** and save.

2. Copy the app credentials from Spotify app settings:
   - `Client ID`
   - `Client secret`

3. Create `.env` from the example and fill in credentials:

```bash
cp .env.example .env
```

```bash
SPOTIFY_CLIENT_ID=paste_your_client_id_here
SPOTIFY_CLIENT_SECRET=paste_your_client_secret_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
SPOTIFY_REFRESH_TOKEN=
WAX_USER=kasey
# or WAX_USER=kaseysdad
# or WAX_USER=kaseysmom
```

4. Authorize once to get a refresh token:

```bash
npm run spotify:auth
```

Copy the `SPOTIFY_REFRESH_TOKEN=...` line from terminal output into `.env`.

5. Push playlists:

Dry run first (no writes):

```bash
WAX_USER=kasey npm run spotify:push:dry
WAX_USER=kaseysdad npm run spotify:push:dry
WAX_USER=kaseysmom npm run spotify:push:dry
```

Then push for real:

```bash
WAX_USER=kasey npm run spotify:push
WAX_USER=kaseysdad npm run spotify:push
WAX_USER=kaseysmom npm run spotify:push
```

Push behavior:

- Pushes `daily-1..7.csv`, `currently-listening.csv`, `favorites-archive.csv`, and `save-for-later.csv` from `users/<WAX_USER>/playlists/`
- Finds or creates `WAX – {User} ...` playlists and full-replaces each in CSV order on every run
- Writes `push.log` in `users/<WAX_USER>/playlists/`
- Supports multi-user by changing `WAX_USER`

Common issues:

- `INVALID_CLIENT: Invalid redirect URI` → ensure `.env` URI exactly matches Spotify app settings.
- `Failed to refresh access token` → run `npm run spotify:auth` again.
- Playlists not updating → verify you authorized the same Spotify account that owns the playlists.

For full setup details and troubleshooting, see `SETUP.md`.

### Back up decisions + generated playlists

To save a per-user snapshot (decisions + playlists + missing-features log):

```bash
WAX_USER=kasey npm run snapshot:user
WAX_USER=kaseysdad npm run snapshot:user
WAX_USER=kaseysmom npm run snapshot:user
```

This writes to a timestamped folder:

- `backups/user-snapshots/<user>/<timestamp>/decisions-latest.json`
- `backups/user-snapshots/<user>/<timestamp>/playlists/` *(if present)*
- `backups/user-snapshots/<user>/<timestamp>/missing-features.log` *(if present)*

To restore the latest snapshot for a user:

```bash
WAX_USER=kasey npm run restore:user
WAX_USER=kaseysdad npm run restore:user
WAX_USER=kaseysmom npm run restore:user
```

To restore a specific snapshot timestamp:
```bash
WAX_USER=kasey npm run restore:user -- 20260618-180500
WAX_USER=kaseysdad npm run restore:user -- 20260618-180500
WAX_USER=kaseysmom npm run restore:user -- 20260618-180500
```

## Use Wax

### Where your data lives

- **`users/<name>/music_library.db`** is the default app DB (selected by `WAX_USER`, or `kasey` when unset).
- **`data/wax_daily_playlists.db`** weekly snapshots of each user's `daily-1..7` playlists (cross-user history table: `daily_playlist_history`).
- **`users/<name>/decisions-latest.json`** for each user's latest keep/remove + repeat-intent snapshot.
- **`users/<name>/playlists/`** for generated CSV playlists and `summary.json`.

- CSV export from the API gives you everything in one file:

```bash
curl http://127.0.0.1:3000/api/export -o ~/Downloads/wax-listens.csv
```

Columns include: `track_id`, `name`, `artists`, `album`, `repeat_intent`, `keep_in_library`, `activity`, `notes`, and `logged_at`.

### Family branch merge workflow

If your family uses separate branches (for example `dev-kasey`, `dev-kaseysdad-v1`, `dev-kaseysmom`) and you only want to sync user state, copy only these paths from each branch into `dev`:

- `users/<name>/decisions-latest.json`
- `users/<name>/playlists/`

From `dev`, run per user branch:

```bash
git checkout dev
git pull origin dev
git checkout origin/dev-kasey -- users/kasey/decisions-latest.json users/kasey/playlists/
git checkout origin/dev-kaseysdad-v1 -- users/kaseysdad/decisions-latest.json users/kaseysdad/playlists/
git checkout origin/dev-kaseysmom -- users/kaseysmom/decisions-latest.json users/kaseysmom/playlists/
git add users/
git commit -m "Sync family decisions/playlists into dev"
git push origin dev
```

Then promote `dev` to `main`:

```bash
git checkout main
git pull origin main
git merge origin/dev
git push origin main
```

This keeps merges focused on user decision/playlist files and avoids pulling unrelated branch changes.



### Data model

Three core tables in each user's DB (`users/<name>/music_library.db`):

- **`tracks`** — your imported library. One row per Spotify track ID. Includes `repeat_intent` (track-level keep preference tag).
- **`listens`** — your decision log. One row per Shuffle/Library log event, including `keep_in_library` (0/1), `repeat_intent`-driven decisions, `activity` (JSON array), `notes`, and `logged_at` (unix ms).
- **`track_features`** — imported audio/music features keyed by track ID (`bpm`, `camelot`, `energy`, `dance`, `valence`, `popularity`, `album_year`, `source`, `updated_at`).

Indexes on `listens(track_id)` and `listens(logged_at DESC)`.

Playlist outputs are file-based (`users/<name>/playlists/*.csv`), not separate DB tables.

### Reading your data from Python

```python
import sqlite3, json, pandas as pd

con = sqlite3.connect("users/kasey/music_library.db")
df = pd.read_sql_query("""
    SELECT t.id AS track_id, t.name, t.artists, t.album, t.repeat_intent,
           l.keep_in_library,
           l.activity, l.notes, l.logged_at
    FROM tracks t
    LEFT JOIN listens l ON l.track_id = t.id
    ORDER BY l.logged_at DESC
""", con)
df["activity"] = df["activity"].apply(lambda s: json.loads(s) if s else [])
df["logged_at"] = pd.to_datetime(df["logged_at"], unit="ms")
```

### Repeat-intent presets

Current repeat-intent presets are:

- `undecided` *(default for newly imported tracks)*
- `currently_listening`
- `favorites_archive`
- `save_for_later`
- `skip_for_now`
- `off_rotation`
- `removed` *(label: "Nah, I'm good")*

Want to change these labels/options?

- Edit `shared/schema.ts`
- Find `REPEAT_INTENT_OPTIONS`
- Update entries in this shape: `{ value: "my_value", label: "My Label" }`
- Keep `value` lowercase/slug-style (saved data), and `label` human-friendly (UI)

### Production build (optional)

```bash
npm run build                              # outputs dist/
NODE_ENV=production PORT=3000 node dist/index.cjs
```

## Support

### Troubleshooting

- **Port already in use** → `lsof -ti:3000 | xargs kill` then restart. Or run on a different port: `PORT=4000 npm run dev`.
- **macOS AirPlay grabbing port 5000** → use `PORT=3000` (default) or disable AirPlay Receiver in System Settings → General → AirDrop & Handoff.
- **`better-sqlite3` install fails** → needs a C++ toolchain. macOS: `xcode-select --install`. Ubuntu: `sudo apt install build-essential python3`. Node 22+ is recommended; Node 26 has no prebuilt binaries yet.
- **Old UI shows after pulling new code** → Vite cache: `rm -rf node_modules/.vite dist && npm run dev`, then hard-refresh the browser (Cmd+Shift+R).
- **Tracks show as "Unknown track" after CSV import** → your CSV's name column wasn't auto-detected. Wax recognizes `Song`, `Title`, `Track`, `Track Name`, `Song Name`. Rename your column or open an issue.
- **Lost data after rebuild** → your active DB is `users/<WAX_USER>/music_library.db` (default user is `kasey`). Don't delete it.

### Tech stack

Express · Vite · React · TypeScript · Tailwind · shadcn/ui · Drizzle ORM · better-sqlite3 · TanStack Query · framer-motion · Recharts · Fontshare (Cabinet Grotesk + Satoshi).

### License

MIT
