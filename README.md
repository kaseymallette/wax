# Wax

A listening journal for your music library. Upload, shuffle, log recent plays, and track keep/remove decisions. Mood playlist generation is in development, with an agent-powered workflow planned.

## Introduction

Wax is a local-first listening journal for your music library. Upload your Spotify export (`.db`, `.sqlite`, or Exportify `.csv`), shuffle through your tracks, and log what you actually played, what you were doing, how it felt, and whether you'd play it again. Built to help you stop streaming past your library and start curating it.

For kept songs, you can set a repeat-intent category: *undecided*, *on repeat*, *yes*, *maybe*, or *nah I'm good*. Newly imported tracks default to *undecided* until you tag them. These categories power weighted shuffle and playlist generation.

Wax also tracks core music features for stats and recommendations: BPM, key (Camelot), valence, dance, and energy. Mood score is a cumulative score out of 300 (`valence + dance + energy`, each on a 0-100 scale), and harmonic key flow uses the Camelot wheel so key movement stays DJ-friendly.

## Screenshots

### Dashboard stats

![Wax dashboard stats](images/wax_dashboard.png)

### Shuffle view

![Wax shuffle](images/wax_shuffle.png)

### Keep/remove stats

![Wax keep remove stats](images/wax_keep_remove_stats.png)

## Quick start

```bash
git clone https://github.com/kaseymallette/wax.git
cd wax
npm install

```

Open **http://localhost:3000**. Express backend and Vite frontend both run on the same port. (Port 5000 conflicts with macOS AirPlay — that's why the default is 3000.)

For full-song playback in the embed, sign into Spotify in any tab of the same browser. Premium plays the whole track; Free gives you 30-second previews.

### Back up your data

`data.db` is your local listening history and is not tracked in git. You can back it up and restore it with:

```bash
npm run backup-db   # creates backups/data.db.<timestamp>.bak
npm run restore-db  # restores latest backup in backups/
```

### Track decisions per user

`decisions-latest.json` files are tracked in git for each user. You can export and import your latest keep/remove decisions with:

```bash
WAX_USER=kasey npm run decisions:export  # writes users/kasey/decisions-latest.json
WAX_USER=kasey npm run decisions:import  # reapplies that file into local data.db
```

This snapshot stores one latest decision per track (`keep_in_library` + `repeat_intent`) so you can reimport your library and restore your curation quickly.

Use a different `WAX_USER` value per family member (for example: `mom`, `dad`, `kasey`) so each person has their own tracked decisions file under `users/`.

### Remove songs from `music-library` DB

If you want to physically remove tracks from `data/music-library/spotify_music_library.db` based on your latest **Remove from library** decisions:

1. Run a dry-run first:

```bash
python3 src/remove_from_music_library.py \
  --owner-user kasey \
  --decisions users/kasey/decisions-latest.json \
  --users-root users \
  --db data/music-library/spotify_music_library.db
```

2. Then apply (with backup):

```bash
python3 src/remove_from_music_library.py \
  --owner-user kasey \
  --decisions users/kasey/decisions-latest.json \
  --users-root users \
  --db data/music-library/spotify_music_library.db \
  --apply --backup
```

`--backup` writes a timestamped DB backup into `backups/`.

Safety behavior:

- Deletion candidates come from the owner user's latest `keepInLibrary=0` decisions.
- Tracks are protected if any other user's latest decision keeps them (`keepInLibrary=1`).
- Script is dry-run by default unless `--apply` is provided.

### Add songs to `music-library` DB

Add new songs from a CSV directly into `data/music-library/spotify_music_library.db` (table: `tracks`).

1. Dry-run first:

```bash
python3 src/add_to_music_library.py \
  --csv data/music-library/new_music.csv \
  --db data/music-library/spotify_music_library.db
```

2. Apply with backup:

```bash
python3 src/add_to_music_library.py \
  --csv data/music-library/new_music.csv \
  --db data/music-library/spotify_music_library.db \
  --apply --backup
```

NPM shortcuts (set CSV path via `WAX_ADD_CSV`):

```bash
WAX_ADD_CSV=data/music-library/new_music.csv npm run music:add:csv:dry
WAX_ADD_CSV=data/music-library/new_music.csv npm run music:add:csv
```

Notes:

- Script is dry-run by default unless `--apply` is provided.
- New rows are detected by `Track_ID`; existing IDs are skipped.
- `--backup` writes a timestamped DB backup into `backups/`.
- CSV should include a track-id column (`Track_ID`, `track_id`, `Track Id`, `Spotify Track Id`, `Track URI`, or `id`).

### Check duplicate tracks in `music-library` DB

Use this to find duplicate `Track_Key` values in the `tracks` table, with optional normalization that ignores common `remaster` / `remastered` text and year/version suffixes like `2019 Digital Master`.

Quick command (exports CSV):

```bash
npm run music:dupes:csv
```

This writes:

- `outputs/duplicate-track-keys.csv`

Direct script usage (more options):

```bash
python3 src/check_duplicate_track_keys.py \
  --db data/music-library/spotify_music_library.db \
  --table tracks \
  --column Track_Key \
  --ignore-remaster \
  --ignore-year-version \
  --show-rows \
  --csv-out outputs/duplicate-track-keys.csv
```

Interpretation notes:

- Duplicate groups are review candidates, not automatic deletes.
- Many duplicates are expected from remasters, deluxe editions, and compilation releases.
- Confirm by `Track_ID`, album, and version details before removing anything.

### Reimport library + restore decisions

If you want a clean reimport (no duplicate old imports/listens), do this:

1. Stop the app.
2. Remove your local DB files:

```bash
npm run clean-db
```

3. Start the app again:

```bash
npm run dev
```

4. Reimport your library in the UI.
5. Reapply your decisions snapshot:

```bash
WAX_USER=kasey npm run decisions:import
```

This restores each track's latest keep/remove + repeat-intent decision. It does not restore full listen history, notes, or activity timeline.


## How it works

1. **Import** — drop your `.db`, `.sqlite`, or `.csv` file on the import page. SQLite uploads use a column mapper (Track ID is the only required field; the rest auto-detects). CSV uploads auto-detect Exportify's standard columns.
2. **Shuffle** — get a random track from your library, listen, and log it. Each entry captures:
   - **Listened** — did you actually play it through?
   - **Keep in library** — keep / remove (logged preference only; does not delete)
   - **Hear again (Keep only)** — `undecided`, `on_repeat`, `yes`, `maybe`, `nah`
   - **Activity tags** — what you were doing (working, working out, cleaning, driving, dancing, singing, active listening, processing, resting, or custom)
   - **Notes** — free text
3. **Keeps** — keep-only view with repeat-intent filters and inline intent updates.
4. **Library** — searchable table of every track with listen count and last listened. Click any row to play it, log a new entry, edit repeat intent, or view full history.
5. **Recents** — timeline of every entry, grouped by day, with keep/remove and repeat-intent context.
6. **Stats** — listens over time, keep vs remove, and feature summaries for keeps and removes (including top keys and album-year metrics).

## Spotify API playlists

Wax supports two playlist-generation methods, both CSV-first for review and then Spotify push.

### Method 1: Mood playlists (Low / Medium / High)

- Goal: partition kept tracks (`on_repeat`, `yes`, `maybe`) into three mood playlists with no overlaps or leftovers.
- Mood score: `mood = valence + dance + energy` (0–300 from `track_features`).
- Bands: user-specific terciles (recomputed each run):
  - Low: `mood < tercile_1`
  - Medium: `tercile_1 <= mood < tercile_2`
  - High: `mood >= tercile_2`
- In-band ranking uses tier weight (`on_repeat` > `yes` > `maybe`), recency, listen-count boost, and jitter.

Run:

```bash
WAX_USER=kasey npm run mood:build
WAX_USER=kaseysdad npm run mood:build
```

Mood outputs:

- `users/<name>/playlists/mood/low.csv`
- `users/<name>/playlists/mood/medium.csv`
- `users/<name>/playlists/mood/high.csv`
- `users/<name>/missing-tracks.log` *(only when tracks are missing from `data.db` or missing features)*

If Spotify API is configured (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`), create Method 1 playlists on Spotify with:

```bash
WAX_USER=kasey WAX_PLAYLIST_METHOD=mood npm run spotify:push:dry
WAX_USER=kasey WAX_PLAYLIST_METHOD=mood npm run spotify:push

WAX_USER=kaseysdad WAX_PLAYLIST_METHOD=mood npm run spotify:push:dry
WAX_USER=kaseysdad WAX_PLAYLIST_METHOD=mood npm run spotify:push
```

### Method 2: KNN packet playlists

- Builds packeted nearest-neighbor groups from keeps (`on_repeat`, `yes`, `maybe`) using builder-style feature space (`BPM`, `Mood Score`, `Key Step`).
- Allows partial packets based on distance rules and then appends sorted leftovers.
- Also auto-splits packet centroids into 3 balanced playlists (`a`, `b`, `c`).

Run:

```bash
WAX_USER=kasey npm run knn:build
WAX_USER=kaseysdad npm run knn:build
```

KNN outputs:

- `users/<name>/playlists/knn/knn-packets.csv`
- `users/<name>/playlists/knn/knn-playlist-a.csv` *(Maybe/Sure)*
- `users/<name>/playlists/knn/knn-playlist-b.csv` *(Yes/Maybe)*
- `users/<name>/playlists/knn/knn-playlist-c.csv` *(Love/Like)*

If Spotify API is configured (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`), create Method 2 playlists on Spotify with:

```bash
WAX_USER=kasey WAX_PLAYLIST_METHOD=knn npm run spotify:push:dry
WAX_USER=kasey WAX_PLAYLIST_METHOD=knn npm run spotify:push

WAX_USER=kaseysdad WAX_PLAYLIST_METHOD=knn npm run spotify:push:dry
WAX_USER=kaseysdad WAX_PLAYLIST_METHOD=knn npm run spotify:push
```

### Multi-user playlist outputs

The model is one shared `data.db` (master tracks/features) plus per-user decision snapshots in `users/<name>/decisions-latest.json`. 

```text
wax/
├── data.db
├── script/
│   ├── decisions.ts
│   ├── buildMoodPlaylists.ts
│   └── buildKNNPackets.ts
├── users/
│   ├── kasey/
│   │   ├── decisions-latest.json
│   │   ├── playlists/
│   │   │   ├── mood/
│   │   │   │   ├── low.csv
│   │   │   │   ├── medium.csv
│   │   │   │   └── high.csv
│   │   │   └── knn/
│   │   │       ├── knn-packets.csv
│   │   │       ├── knn-playlist-a.csv
│   │   │       ├── knn-playlist-b.csv
│   │   │       └── knn-playlist-c.csv
│   │   └── missing-tracks.log
│   ├── kaseysdad/
│   └── kaseysmom/
```

### Spotify push agent (mood or KNN)

Once your CSV outputs look right, you can push them to Spotify playlists.

You only do setup once (steps 1–4). After that, pushing is a single command.

1. Register a Spotify app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
   - App name: `Wax`
   - App description: `WAX mood playlists`
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
```

4. Authorize once to get a refresh token:

```bash
npm run spotify:auth
```

Copy the `SPOTIFY_REFRESH_TOKEN=...` line from terminal output into `.env`.

5. Push playlists:

Mood mode (default):

Dry run first (no writes):

```bash
WAX_USER=kasey npm run spotify:push:dry
```

Then push for real:

```bash
WAX_USER=kasey npm run spotify:push
```

KNN mode:

```bash
WAX_USER=kasey WAX_PLAYLIST_METHOD=knn npm run spotify:push:dry
WAX_USER=kasey WAX_PLAYLIST_METHOD=knn npm run spotify:push
```

Push behavior:

- `WAX_PLAYLIST_METHOD=mood` (default): pushes `low/medium/high` mood CSVs from `users/<WAX_USER>/playlists/mood/`
- `WAX_PLAYLIST_METHOD=knn`: pushes `knn-playlist-a/b/c.csv` from `users/<WAX_USER>/playlists/knn/`
- Finds or creates `WAX – {User} ...` playlists and full-replaces each in CSV order on every run
- Writes `push.log` in the selected method folder (`mood` or `knn`)
- Supports multi-user by changing `WAX_USER`

Common issues:

- `INVALID_CLIENT: Invalid redirect URI` → ensure `.env` URI exactly matches Spotify app settings.
- `Failed to refresh access token` → run `npm run spotify:auth` again.
- Playlists not updating → verify you authorized the same Spotify account that owns the playlists.

For full setup details and troubleshooting, see `SETUP.md`.

### Back up decisions + generated playlists

To save a per-user snapshot (decisions + playlists + missing-tracks log):

```bash
WAX_USER=kasey npm run snapshot:user
```

This writes to a timestamped folder:

- `backups/user-snapshots/<user>/<timestamp>/decisions-latest.json`
- `backups/user-snapshots/<user>/<timestamp>/playlists/` *(if present)*
- `backups/user-snapshots/<user>/<timestamp>/missing-tracks.log` *(if present)*

To restore the latest snapshot for a user:

```bash
WAX_USER=kasey npm run restore:user
```

To restore a specific snapshot timestamp:
```bash
WAX_USER=kasey npm run restore:user -- 20260618-180500
```

## Use Wax

### Where your data lives

- **`data.db`** in the project root. Back this file up if you care about it.

- CSV export from the API gives you everything in one file:

```bash
curl http://localhost:3000/api/export -o ~/Downloads/wax-listens.csv
```

Columns include: `track_id`, `name`, `artists`, `album`, `repeat_intent`, `listened`, `want_again`, `would_again`, `keep_in_library`, `activity`, `notes`, `logged_at`.

### Data model

Three core tables in `data.db`:

- **`tracks`** — your imported library. One row per Spotify track ID. Includes `repeat_intent` (track-level keep preference tag).
- **`listens`** — your log entries. One row per logged listen. Columns include `listened` (0/1), `want_again` (0/1), `would_again` (0/1), `keep_in_library` (0/1), `activity` (JSON array), `notes`, `logged_at` (unix ms).
- **`track_features`** — imported audio/music features keyed by track ID (`bpm`, `camelot`, `energy`, `dance`, `valence`, `popularity`, `album_year`, `source`, `updated_at`).

Indexes on `listens(track_id)` and `listens(logged_at DESC)`.

### Reading your data from Python

```python
import sqlite3, json, pandas as pd

con = sqlite3.connect("wax/data.db")
df = pd.read_sql_query("""
    SELECT t.id AS track_id, t.name, t.artists, t.album, t.repeat_intent,
           l.listened, l.want_again, l.would_again, l.keep_in_library,
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
- `on_repeat`
- `yes`
- `maybe`
- `nah`

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
- **Lost data after rebuild** → `data.db` lives at the project root, not in `dist/`. Don't delete it.

### Tech stack

Express · Vite · React · TypeScript · Tailwind · shadcn/ui · Drizzle ORM · better-sqlite3 · TanStack Query · framer-motion · Recharts · Fontshare (Cabinet Grotesk + Satoshi).

### License

MIT
