import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

type FullLibraryCsvRow = {
  track_id?: string;
  name?: string;
  artists?: string;
  album?: string;
  repeat_intent?: string;
  bpm?: string;
  energy?: string;
  dance?: string;
  valence?: string;
  camelot?: string;
  listen_count?: string;
  last_listened_at?: string;
  spotify_url?: string;
};

type ParsedRow = {
  trackId: string;
  name: string;
  artists: string;
  album: string;
  repeatIntent: string;
  bpm: number | null;
  energy: number | null;
  dance: number | null;
  valence: number | null;
  camelot: string | null;
  listenCount: number;
  lastListenedAtMs: number;
  spotifyUrl: string | null;
};

const REPO_ROOT = process.cwd();
const USERS = String(process.env.WAX_USERS || "kasey,kaseysmom,kaseysdad")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const USER_DB_FILENAME = String(process.env.WAX_USER_DB_FILENAME || "music_library.db").trim() || "music_library.db";
const FULL_LIBRARY_FILENAME = String(process.env.WAX_FULL_LIBRARY_FILENAME || "full-music-library.csv").trim() || "full-music-library.csv";
const PLAYLISTS_SUBDIR = String(process.env.WAX_PLAYLISTS_SUBDIR || path.join("playlists")).trim() || "playlists";
const SOURCE = "full-music-library.csv";

function normalizeRepeatIntent(v: unknown): string {
  const s = String(v ?? "undecided").trim().toLowerCase();
  if (s === "skip") return "skip_for_now";
  if (
    s === "currently_listening" ||
    s === "favorites_archive" ||
    s === "save_for_later" ||
    s === "skip_for_now" ||
    s === "off_rotation" ||
    s === "removed" ||
    s === "undecided"
  ) {
    return s;
  }
  return "undecided";
}

function parseNumberOrNull(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrDefault(v: unknown, fallback: number): number {
  const n = parseNumberOrNull(v);
  if (n == null) return fallback;
  return Number.isInteger(n) ? n : Math.round(n);
}

function keepInLibraryFromIntent(intent: string): 0 | 1 {
  if (intent === "removed" || intent === "off_rotation") return 0;
  return 1;
}

function deriveAgainFlags(keepInLibrary: 0 | 1, repeatIntent: string): { wantAgain: 0 | 1; wouldAgain: 0 | 1 } {
  if (!keepInLibrary) return { wantAgain: 0, wouldAgain: 0 };
  const wantAgain: 0 | 1 =
    repeatIntent === "currently_listening" ||
    repeatIntent === "favorites_archive" ||
    repeatIntent === "save_for_later"
      ? 1
      : 0;
  const wouldAgain: 0 | 1 =
    repeatIntent === "currently_listening" || repeatIntent === "favorites_archive"
      ? 1
      : 0;
  return { wantAgain, wouldAgain };
}

function parseIsoDateMs(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function parseFullLibraryCsv(filePath: string): ParsedRow[] {
  const csvRaw = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse<FullLibraryCsvRow>(csvRaw, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length) {
    throw new Error(`Could not parse CSV ${filePath}: ${parsed.errors[0].message}`);
  }

  const rows: ParsedRow[] = [];
  for (const row of parsed.data) {
    const trackId = String(row.track_id ?? "").trim();
    if (!trackId) continue;

    const repeatIntent = normalizeRepeatIntent(row.repeat_intent);
    const now = Date.now();
    const lastListenedAtMs = parseIsoDateMs(row.last_listened_at) ?? now;

    rows.push({
      trackId,
      name: String(row.name ?? "Unknown track").trim() || "Unknown track",
      artists: String(row.artists ?? "").trim(),
      album: String(row.album ?? "").trim(),
      repeatIntent,
      bpm: parseNumberOrNull(row.bpm),
      energy: parseNumberOrNull(row.energy),
      dance: parseNumberOrNull(row.dance),
      valence: parseNumberOrNull(row.valence),
      camelot: String(row.camelot ?? "").trim() || null,
      listenCount: Math.max(1, parseIntOrDefault(row.listen_count, 1)),
      lastListenedAtMs,
      spotifyUrl: String(row.spotify_url ?? "").trim() || `https://open.spotify.com/track/${trackId}`,
    });
  }

  return rows;
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      artists TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      album_art_url TEXT,
      duration_ms INTEGER,
      added_at TEXT,
      spotify_url TEXT,
      preview_url TEXT,
      imported_at INTEGER NOT NULL,
      repeat_intent TEXT NOT NULL DEFAULT 'undecided',
      daily_playlist_status TEXT NOT NULL DEFAULT 'include'
    );

    CREATE TABLE IF NOT EXISTS listens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      listened INTEGER NOT NULL,
      want_again INTEGER NOT NULL DEFAULT 1,
      would_again INTEGER NOT NULL,
      keep_in_library INTEGER NOT NULL DEFAULT 1,
      activity TEXT NOT NULL DEFAULT '[]',
      notes TEXT DEFAULT '',
      logged_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_listens_track ON listens(track_id);
    CREATE INDEX IF NOT EXISTS idx_listens_logged ON listens(logged_at DESC);

    CREATE TABLE IF NOT EXISTS track_features (
      track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      bpm REAL,
      camelot TEXT,
      energy REAL,
      dance REAL,
      valence REAL,
      popularity REAL,
      album_year INTEGER,
      source TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_track_features_camelot ON track_features(camelot);
  `);
}

function timestampTag() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function initUserDb(user: string): void {
  const userDir = path.join(REPO_ROOT, "users", user);
  const csvPath = path.join(userDir, PLAYLISTS_SUBDIR, FULL_LIBRARY_FILENAME);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing full library CSV for ${user}: ${csvPath}`);
  }

  const dbPath = path.join(userDir, USER_DB_FILENAME);
  if (fs.existsSync(dbPath)) {
    const backupPath = path.join(REPO_ROOT, "backups", "user-db-init", user, `${USER_DB_FILENAME}.${timestampTag()}.bak`);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(dbPath, backupPath);
    fs.rmSync(dbPath, { force: true });
    console.log(`[db:user:init] backed up existing DB -> ${backupPath}`);
  }

  const rows = parseFullLibraryCsv(csvPath);
  const db = new Database(dbPath);
  try {
    ensureSchema(db);

    const insertTrack = db.prepare(`
      INSERT INTO tracks (
        id, name, artists, album, album_art_url, duration_ms, added_at,
        spotify_url, preview_url, imported_at, repeat_intent, daily_playlist_status
      ) VALUES (
        @id, @name, @artists, @album, NULL, NULL, NULL,
        @spotifyUrl, NULL, @importedAt, @repeatIntent, 'include'
      )
    `);

    const insertListen = db.prepare(`
      INSERT INTO listens (
        track_id, listened, want_again, would_again, keep_in_library, activity, notes, logged_at
      ) VALUES (
        @trackId, 1, @wantAgain, @wouldAgain, @keepInLibrary, '[]', '[user-db-init]', @loggedAt
      )
    `);

    const insertFeature = db.prepare(`
      INSERT INTO track_features (
        track_id, bpm, camelot, energy, dance, valence, popularity, album_year, source, updated_at
      ) VALUES (
        @trackId, @bpm, @camelot, @energy, @dance, @valence, NULL, NULL, @source, @updatedAt
      )
    `);

    const tx = db.transaction((items: ParsedRow[]) => {
      for (const row of items) {
        insertTrack.run({
          id: row.trackId,
          name: row.name,
          artists: row.artists,
          album: row.album,
          spotifyUrl: row.spotifyUrl,
          importedAt: row.lastListenedAtMs,
          repeatIntent: row.repeatIntent,
        });

        const keepInLibrary = keepInLibraryFromIntent(row.repeatIntent);
        const { wantAgain, wouldAgain } = deriveAgainFlags(keepInLibrary, row.repeatIntent);

        for (let i = 0; i < row.listenCount; i += 1) {
          const loggedAt = row.lastListenedAtMs - (row.listenCount - i - 1) * 1000;
          insertListen.run({
            trackId: row.trackId,
            wantAgain,
            wouldAgain,
            keepInLibrary,
            loggedAt,
          });
        }

        if (
          row.bpm != null ||
          row.camelot != null ||
          row.energy != null ||
          row.dance != null ||
          row.valence != null
        ) {
          insertFeature.run({
            trackId: row.trackId,
            bpm: row.bpm,
            camelot: row.camelot,
            energy: row.energy,
            dance: row.dance,
            valence: row.valence,
            source: SOURCE,
            updatedAt: row.lastListenedAtMs,
          });
        }
      }
    });

    tx(rows);

    const trackCount = Number((db.prepare(`SELECT COUNT(*) AS c FROM tracks`).get() as { c: number }).c || 0);
    const clCount = Number(
      (db.prepare(`SELECT COUNT(*) AS c FROM tracks WHERE repeat_intent = 'currently_listening'`).get() as { c: number }).c || 0,
    );

    console.log(`[db:user:init] user=${user} csv_rows=${rows.length} tracks=${trackCount} currently_listening=${clCount}`);
    console.log(`[db:user:init] db=${dbPath}`);
  } finally {
    db.close();
  }
}

function main() {
  if (USERS.length === 0) {
    throw new Error("No users supplied. Set WAX_USERS.");
  }

  console.log(`[db:user:init] users=${USERS.join(",")}`);
  console.log(`[db:user:init] source_file=${FULL_LIBRARY_FILENAME}`);
  console.log(`[db:user:init] db_file=${USER_DB_FILENAME}`);

  for (const user of USERS) {
    initUserDb(user);
  }

  console.log("[db:user:init] complete");
}

main();
