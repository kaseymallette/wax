import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_SET = new Set<Weekday>(WEEKDAYS);

type DailyPlaylistCsvRow = {
  rank?: string;
  track_id?: string;
  name?: string;
  artists?: string;
  album?: string;
  repeat_intent?: string;
  bpm?: string;
  mood?: string;
  energy?: string;
  dance?: string;
  valence?: string;
  camelot?: string;
  listen_count?: string;
  last_listened_at?: string;
  spotify_url?: string;
};

type NormalizedDailyPlaylistRow = {
  rank: number;
  trackId: string;
  name: string;
  artists: string;
  album: string;
  repeatIntent: string;
  bpm: number | null;
  mood: number | null;
  energy: number | null;
  dance: number | null;
  valence: number | null;
  camelot: string | null;
  listenCount: number | null;
  lastListenedAt: string | null;
  spotifyUrl: string | null;
};

function parseNumberOrNull(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(v: unknown): number | null {
  const n = parseNumberOrNull(v);
  if (n == null) return null;
  return Number.isInteger(n) ? n : Math.round(n);
}

function toIsoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfIsoWeekUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayFromMonday);
  return d;
}

function computeIsoWeekInfo(referenceDateUtc: Date): { isoYear: number; isoWeek: number; weekStartDate: string } {
  const weekStart = startOfIsoWeekUtc(referenceDateUtc);

  const thursday = new Date(weekStart);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));

  const isoWeek = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  return {
    isoYear,
    isoWeek,
    weekStartDate: toIsoDateUtc(weekStart),
  };
}

function parseWeekStartFromEnv(raw: string | undefined): Date {
  const s = String(raw ?? "").trim();
  if (!s) return new Date();

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    throw new Error(`WAX_WEEK_START must be YYYY-MM-DD. Received '${s}'.`);
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Error(`WAX_WEEK_START is not a valid calendar date: '${s}'.`);
  }
  return d;
}

function loadWeekdayMap(playlistsDir: string): Record<number, Weekday> {
  const fallback: Record<number, Weekday> = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
  };

  const mapPath = path.join(playlistsDir, "weekday-map.json");
  if (!fs.existsSync(mapPath)) return fallback;

  try {
    const parsed = JSON.parse(fs.readFileSync(mapPath, "utf8")) as Record<string, unknown>;
    const next: Record<number, Weekday> = { ...fallback };
    const seen = new Set<Weekday>();

    for (const [rawIndex, rawDay] of Object.entries(parsed)) {
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || index < 1 || index > 7) continue;
      if (typeof rawDay !== "string") continue;
      if (!WEEKDAY_SET.has(rawDay as Weekday)) continue;
      if (seen.has(rawDay as Weekday)) continue;
      next[index] = rawDay as Weekday;
      seen.add(rawDay as Weekday);
    }

    return next;
  } catch {
    return fallback;
  }
}

function parseDailyCsv(filePath: string): NormalizedDailyPlaylistRow[] {
  const csv = fs.readFileSync(filePath, "utf8");
  const result = Papa.parse<DailyPlaylistCsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length) {
    const first = result.errors[0];
    throw new Error(`Failed to parse CSV ${filePath}: ${first.message}`);
  }

  const rows: NormalizedDailyPlaylistRow[] = [];
  for (const raw of result.data) {
    const rank = parseIntOrNull(raw.rank);
    const trackId = String(raw.track_id ?? "").trim();
    const name = String(raw.name ?? "").trim();
    const artists = String(raw.artists ?? "").trim();
    const album = String(raw.album ?? "").trim();

    if (rank == null || !trackId || !name) continue;

    rows.push({
      rank,
      trackId,
      name,
      artists,
      album,
      repeatIntent: String(raw.repeat_intent ?? "").trim() || "currently_listening",
      bpm: parseNumberOrNull(raw.bpm),
      mood: parseNumberOrNull(raw.mood),
      energy: parseNumberOrNull(raw.energy),
      dance: parseNumberOrNull(raw.dance),
      valence: parseNumberOrNull(raw.valence),
      camelot: String(raw.camelot ?? "").trim() || null,
      listenCount: parseIntOrNull(raw.listen_count),
      lastListenedAt: String(raw.last_listened_at ?? "").trim() || null,
      spotifyUrl: String(raw.spotify_url ?? "").trim() || null,
    });
  }

  return rows;
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_playlist_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      week_start_date TEXT NOT NULL,
      iso_year INTEGER NOT NULL,
      iso_week INTEGER NOT NULL,
      playlist_number INTEGER NOT NULL,
      day_of_week TEXT NOT NULL,
      rank INTEGER NOT NULL,
      track_id TEXT NOT NULL,
      name TEXT NOT NULL,
      artists TEXT NOT NULL,
      album TEXT NOT NULL,
      repeat_intent TEXT NOT NULL,
      bpm REAL,
      mood REAL,
      energy REAL,
      dance REAL,
      valence REAL,
      camelot TEXT,
      listen_count INTEGER,
      last_listened_at TEXT,
      spotify_url TEXT,
      captured_at INTEGER NOT NULL,
      UNIQUE(user, week_start_date, playlist_number, rank, track_id)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_playlist_history_user_week
      ON daily_playlist_history(user, week_start_date);

    CREATE INDEX IF NOT EXISTS idx_daily_playlist_history_week
      ON daily_playlist_history(iso_year, iso_week);
  `);
}

function main() {
  const repoRoot = process.cwd();
  const users = String(process.env.WAX_USERS ?? "kasey,kaseysmom,kaseysdad")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const dbPath = path.resolve(repoRoot, process.env.WAX_DAILY_DB_PATH ?? path.join("data", "wax_daily_playlists.db"));
  const playlistsRoot = path.resolve(repoRoot, process.env.WAX_PLAYLISTS_ROOT ?? "users");
  const referenceDate = parseWeekStartFromEnv(process.env.WAX_WEEK_START);
  const week = computeIsoWeekInfo(referenceDate);
  const capturedAt = Date.now();

  if (!users.length) {
    throw new Error("No users supplied. Set WAX_USERS (comma-separated).");
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  console.log(`[playlists:capture:weekly] db=${dbPath}`);
  console.log(`[playlists:capture:weekly] users=${users.join(",")}`);
  console.log(
    `[playlists:capture:weekly] week_start=${week.weekStartDate} iso_year=${week.isoYear} iso_week=${week.isoWeek}`,
  );

  ensureSchema(db);

  const insertStmt = db.prepare(`
    INSERT INTO daily_playlist_history (
      user,
      week_start_date,
      iso_year,
      iso_week,
      playlist_number,
      day_of_week,
      rank,
      track_id,
      name,
      artists,
      album,
      repeat_intent,
      bpm,
      mood,
      energy,
      dance,
      valence,
      camelot,
      listen_count,
      last_listened_at,
      spotify_url,
      captured_at
    ) VALUES (
      @user,
      @weekStartDate,
      @isoYear,
      @isoWeek,
      @playlistNumber,
      @dayOfWeek,
      @rank,
      @trackId,
      @name,
      @artists,
      @album,
      @repeatIntent,
      @bpm,
      @mood,
      @energy,
      @dance,
      @valence,
      @camelot,
      @listenCount,
      @lastListenedAt,
      @spotifyUrl,
      @capturedAt
    )
    ON CONFLICT(user, week_start_date, playlist_number, rank, track_id) DO UPDATE SET
      day_of_week = excluded.day_of_week,
      name = excluded.name,
      artists = excluded.artists,
      album = excluded.album,
      repeat_intent = excluded.repeat_intent,
      bpm = excluded.bpm,
      mood = excluded.mood,
      energy = excluded.energy,
      dance = excluded.dance,
      valence = excluded.valence,
      camelot = excluded.camelot,
      listen_count = excluded.listen_count,
      last_listened_at = excluded.last_listened_at,
      spotify_url = excluded.spotify_url,
      captured_at = excluded.captured_at
  `);

  let totalRows = 0;
  const tx = db.transaction(() => {
    for (const user of users) {
      const playlistsDir = path.join(playlistsRoot, user, "playlists");
      if (!fs.existsSync(playlistsDir)) {
        console.warn(`[playlists:capture:weekly] skip user='${user}' (missing dir: ${playlistsDir})`);
        continue;
      }

      const weekdayMap = loadWeekdayMap(playlistsDir);
      let userRows = 0;

      for (let playlistNumber = 1; playlistNumber <= 7; playlistNumber += 1) {
        const csvPath = path.join(playlistsDir, `daily-${playlistNumber}.csv`);
        if (!fs.existsSync(csvPath)) {
          console.warn(`[playlists:capture:weekly] skip ${user} daily-${playlistNumber} (missing file)`);
          continue;
        }

        const rows = parseDailyCsv(csvPath);
        const dayOfWeek = weekdayMap[playlistNumber] ?? WEEKDAYS[playlistNumber - 1];

        for (const row of rows) {
          insertStmt.run({
            user,
            weekStartDate: week.weekStartDate,
            isoYear: week.isoYear,
            isoWeek: week.isoWeek,
            playlistNumber,
            dayOfWeek,
            rank: row.rank,
            trackId: row.trackId,
            name: row.name,
            artists: row.artists,
            album: row.album,
            repeatIntent: row.repeatIntent,
            bpm: row.bpm,
            mood: row.mood,
            energy: row.energy,
            dance: row.dance,
            valence: row.valence,
            camelot: row.camelot,
            listenCount: row.listenCount,
            lastListenedAt: row.lastListenedAt,
            spotifyUrl: row.spotifyUrl,
            capturedAt,
          });
          userRows += 1;
          totalRows += 1;
        }
      }

      console.log(`[playlists:capture:weekly] captured user='${user}' rows=${userRows}`);
    }
  });

  try {
    tx();
  } finally {
    db.close();
  }

  console.log(`[playlists:capture:weekly] done rows=${totalRows}`);
}

main();
