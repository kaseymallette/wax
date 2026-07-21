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

### Import your music library

1. Open the app and go to the import flow.
2. Upload your Spotify export (`.db`, `.sqlite`, or Exportify `.csv`).
3. If prompted, map columns and complete import.

### Export decisions per user

`decisions-latest.json` files are tracked in git for each user. Export your latest keep/remove decisions with:

```bash
WAX_USER=kasey npm run decisions:export  # writes users/kasey/decisions-latest.json
WAX_USER=kaseysdad npm run decisions:export  # writes users/kaseysdad/decisions-latest.json
WAX_USER=kaseysmom npm run decisions:export  # writes users/kaseysmom/decisions-latest.json
```

Use a different `WAX_USER` value per family member (for example: `kasey`, `kaseysdad`, `kaseysmom`) so each person has their own tracked decisions file under `users/`.

### Switch users (per-user DB)

Per-user DBs are now the default workflow. You no longer need to clean and reimport a shared `data.db` to switch users.

Use each user's DB directly:

```bash
WAX_USER=kasey npm run dev:user
WAX_USER=kaseysdad npm run dev:user
WAX_USER=kaseysmom npm run dev:user
```

If you want to reapply the tracked decisions snapshot before starting dev:

```bash
WAX_USER=kasey npm run user:import
WAX_USER=kasey npm run dev:user
```

Build playlists from that same per-user DB:

```bash
WAX_USER=kasey npm run user:playlists
```

Save latest DB decisions back into the tracked JSON snapshot:

```bash
WAX_USER=kasey npm run user:export
```

`dev:user`, `user:import`, `user:playlists`, and `user:export` all target `users/<WAX_USER>/music_library.db` unless you override `WAX_DB_PATH`.

If counts look off after import, audit snapshot coverage against your current `tracks` table:

```bash
npm run decisions:audit
```

This checks `users/<name>/decisions-latest.json` against each user's `users/<name>/music_library.db` by default and reports missing track IDs by repeat-intent. Optional env vars:

- `WAX_USERS` comma-separated users to audit
- `WAX_AUDIT_DB_PATH` override with a single DB path to check for all users
- `WAX_AUDIT_SAMPLE_LIMIT` sample missing rows to print (default `10`)
- `WAX_AUDIT_STRICT=1` exit non-zero if any missing tracks are found

To reset decisions files so they exactly match each user's reviewed library (`full-music-library.csv`) with keep intents only:

```bash
npm run decisions:sync:full-library
```

This rewrites `users/<name>/decisions-latest.json` for default users (`kasey,kaseysmom,kaseysdad`), removing `removed`/`undecided` entries and aligning decision count to the number of songs in `users/<name>/playlists/full-music-library.csv`.

Export missing snapshot tracks to CSV (including an import-ready file for `music:add:csv`):

```bash
npm run decisions:export-missing
```

Writes:

- `outputs/missing-decision-tracks.csv` (detailed per-user missing rows)
- `outputs/missing-tracks-for-music-library.csv` (deduped by `Track_ID`, ready for `music:add:csv`)

Then dry-run add back to `spotify_music_library.db`:

```bash
WAX_ADD_CSV=outputs/missing-tracks-for-music-library.csv npm run music:add:csv:dry
```

### Initialize per-user DB from reviewed library

If you want each user to work from their reviewed set only, bootstrap a per-user DB from `users/<name>/playlists/full-music-library.csv`:

```bash
npm run db:user:init
```

Default users are `kasey,kaseysmom,kaseysdad`, and the DB file written is `users/<name>/music_library.db`.

Then run follow-up commands against that user DB:

```bash
WAX_USER=kaseysmom npm run user:import
WAX_USER=kaseysmom npm run user:playlists
```

Optional env vars for `db:user:init`:

- `WAX_USERS` comma-separated users
- `WAX_USER_DB_FILENAME` output DB filename (default `music_library.db`)
- `WAX_FULL_LIBRARY_FILENAME` source CSV filename (default `full-music-library.csv`)
- `WAX_PLAYLISTS_SUBDIR` source subfolder under each user (default `playlists`)

### Add songs to `music-library` DB

Add new songs from a CSV directly into `data/music-library/spotify_music_library.db` (table: `tracks`).

1. Prepare a CSV from a Spotify playlist:

   - Build or open a playlist in Spotify.
   - Copy the playlist link.
   - Go to [Chosic Playlist Exporter](https://www.chosic.com/spotify-playlist-exporter/) and export the playlist as CSV.
   - Save the exported file in `data/music-library/` (for example: `data/music-library/new_music.csv`).

2. Dry-run first:

```bash
python3 src/add_to_music_library.py \
  --csv data/music-library/new_music.csv \
  --db data/music-library/spotify_music_library.db
```

3. Apply with backup:

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

### Review removes in a spreadsheet (recommended)

If you want to approve removals one-by-one (yes/no) before deleting from `music-library`:

1. Generate a review CSV for a user:

```bash
WAX_USER=kaseysmom npm run music:remove:review
```

This writes:

- `outputs/kaseysmom-removal-review.csv`

2. Open the CSV in Excel/Google Sheets and fill `your_decision` with `yes` or `no`.

- `yes` = approve removal
- `no` (or blank) = keep song in DB
- Use `notes` for comments

3. Dry-run the approved removals:

```bash
WAX_USER=kaseysmom npm run music:remove:approved:dry
```

4. Apply approved removals (with backup):

```bash
WAX_USER=kaseysmom npm run music:remove:approved
```

Review CSV columns include safety context:

- `kept_by_other_user` (`yes`/`no`)
- `eligible_for_delete` (`yes`/`no`)
- `in_music_library_db` (`yes`/`no`)

Only rows with `your_decision=yes` and `eligible_for_delete=yes` are deleted.

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

### Back up your data

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
