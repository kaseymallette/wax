import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_INDEX = new Map<Weekday, number>(WEEKDAYS.map((day, i) => [day, i]));
const DEFAULT_STATIONS = [
  "kasey-alt-rock",
  "kasey-classic-rock",
  "kasey-country-blues",
  "kasey-indie-folk",
  "kasey-pop-hip-hop",
];

type HistoryRow = {
  day_of_week: string;
  rank: number;
  track_id: string;
  name: string;
  artists: string;
  album: string;
  bpm: number | null;
  energy: number | null;
  dance: number | null;
  valence: number | null;
  mood: number | null;
  camelot: string | null;
  spotify_url: string | null;
  last_updated: number;
};

type TrackOut = {
  n: number;
  t: string;
  a: string;
  al: string;
  bpm: number | null;
  e: number | null;
  d: number | null;
  v: number | null;
  m: number | null;
  k: string | null;
  u: string | null;
};

type ExistingWaxData = {
  stations?: Array<{
    id?: string;
    days?: Array<{ day?: string; playlist_url?: string }>;
  }>;
};

function parseWaxArtFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  const prefix = "window.WAX_ART = ";
  if (!raw.startsWith(prefix)) return {};
  const jsonLike = raw.slice(prefix.length).replace(/;\s*$/, "");
  try {
    const parsed = JSON.parse(jsonLike) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [id, url] of Object.entries(parsed)) {
      const key = id.trim();
      const value = String(url ?? "").trim();
      if (!key || !value) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function resolveLastUpdatedColumn(db: Database.Database): "last_updated" | "captured_at" {
  const cols = db.prepare("PRAGMA table_info(daily_playlist_history)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (names.has("last_updated")) return "last_updated";
  if (names.has("captured_at")) return "captured_at";
  throw new Error("daily_playlist_history must contain last_updated or captured_at");
}

function parseWaxDataFile(filePath: string): ExistingWaxData | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8").trim();
  const prefix = "window.WAX_DATA = ";
  if (!raw.startsWith(prefix)) return null;
  const jsonLike = raw.slice(prefix.length).replace(/;\s*$/, "");
  try {
    return JSON.parse(jsonLike) as ExistingWaxData;
  } catch {
    return null;
  }
}

function readExistingPlaylistUrls(dataFilePath: string): Record<string, Record<string, string>> {
  const parsed = parseWaxDataFile(dataFilePath);
  const out: Record<string, Record<string, string>> = {};
  for (const station of parsed?.stations ?? []) {
    const stationId = String(station.id ?? "").trim();
    if (!stationId) continue;
    out[stationId] = {};
    for (const day of station.days ?? []) {
      const dayName = String(day.day ?? "").trim();
      const playlistUrl = String(day.playlist_url ?? "").trim();
      if (!dayName || !playlistUrl) continue;
      out[stationId][dayName] = playlistUrl;
    }
  }
  return out;
}

function normalizeStationList(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function latestWeekStartForStation(db: Database.Database, stationId: string): string {
  const lastUpdatedColumn = resolveLastUpdatedColumn(db);
  const row = db
    .prepare(
      `
        SELECT week_start_date
        FROM daily_playlist_history
        WHERE user = ?
        ORDER BY ${lastUpdatedColumn} DESC, week_start_date DESC
        LIMIT 1
      `,
    )
    .get(stationId) as { week_start_date?: string } | undefined;
  const weekStart = String(row?.week_start_date ?? "").trim();
  if (!weekStart) {
    throw new Error(`No snapshot rows found for station '${stationId}'.`);
  }
  return weekStart;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function loadAlbumArtMap(stations: string[], usersRoot: string, trackIds: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  const ids = [...trackIds];
  if (!ids.length) return out;

  for (const station of stations) {
    const dbPath = path.join(usersRoot, station, "music_library.db");
    if (!fs.existsSync(dbPath)) continue;
    const db = new Database(dbPath, { readonly: true });
    try {
      for (const idChunk of chunk(ids, 300)) {
        const placeholders = idChunk.map(() => "?").join(", ");
        const sql = `
          SELECT id, album_art_url
          FROM tracks
          WHERE id IN (${placeholders})
            AND album_art_url IS NOT NULL
            AND TRIM(album_art_url) <> ''
        `;
        const rows = db.prepare(sql).all(...idChunk) as Array<{ id: string; album_art_url: string }>;
        for (const row of rows) {
          if (!out[row.id]) out[row.id] = row.album_art_url;
        }
      }
    } finally {
      db.close();
    }
  }
  return out;
}

function main() {
  const repoRoot = process.cwd();
  const usersRoot = path.resolve(repoRoot, process.env.WAX_WEEKLY_USERS_ROOT ?? "users");
  const stations = normalizeStationList(process.env.WAX_WEEKLY_STATIONS ?? DEFAULT_STATIONS.join(","));
  if (!stations.length) throw new Error("No stations configured. Set WAX_WEEKLY_STATIONS.");

  const outputPath = path.resolve(repoRoot, process.env.WAX_WEEKLY_DATA_OUT ?? "wax_weekly/data.js");
  const artOutputPath = path.resolve(repoRoot, process.env.WAX_WEEKLY_ART_OUT ?? "wax_weekly/art.js");
  const existingPlaylistUrls = readExistingPlaylistUrls(outputPath);
  const existingArt = parseWaxArtFile(artOutputPath);

  const explicitWeekStart = process.env.WAX_WEEKLY_WEEK_START?.trim() || "";
  const weekStartByStation: Record<string, string> = {};
  const discoveredWeeks: string[] = [];
  for (const stationId of stations) {
    if (explicitWeekStart) {
      weekStartByStation[stationId] = explicitWeekStart;
      discoveredWeeks.push(explicitWeekStart);
      continue;
    }
    const dbPath = path.join(usersRoot, stationId, "weekly-playlists.db");
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Missing weekly snapshot DB for '${stationId}': ${dbPath}`);
    }
    const db = new Database(dbPath, { readonly: true });
    try {
      const latestWeekStart = latestWeekStartForStation(db, stationId);
      weekStartByStation[stationId] = latestWeekStart;
      discoveredWeeks.push(latestWeekStart);
    } finally {
      db.close();
    }
  }

  let maxLastUpdated = 0;
  const allTrackIds = new Set<string>();

  const stationsOut = stations.map((stationId) => {
    const stationWeekStart = weekStartByStation[stationId];
    const dbPath = path.join(usersRoot, stationId, "weekly-playlists.db");
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Missing weekly snapshot DB for '${stationId}': ${dbPath}`);
    }
    const db = new Database(dbPath, { readonly: true });
    let rows: HistoryRow[] = [];
    try {
      const lastUpdatedColumn = resolveLastUpdatedColumn(db);
      rows = db
        .prepare(
          `
            SELECT
              day_of_week,
              rank,
              track_id,
              name,
              artists,
              album,
              bpm,
              energy,
              dance,
              valence,
              mood,
              camelot,
              spotify_url,
              ${lastUpdatedColumn} AS last_updated
            FROM daily_playlist_history
            WHERE user = ? AND week_start_date = ?
          `,
        )
        .all(stationId, stationWeekStart) as HistoryRow[];
    } finally {
      db.close();
    }

    const byDay = new Map<Weekday, TrackOut[]>();
    for (const day of WEEKDAYS) byDay.set(day, []);

    for (const row of rows) {
      if (!WEEKDAY_INDEX.has(row.day_of_week as Weekday)) continue;
      const day = row.day_of_week as Weekday;
      byDay.get(day)?.push({
        n: Number(row.rank),
        t: row.name,
        a: row.artists,
        al: row.album,
        bpm: row.bpm,
        e: row.energy,
        d: row.dance,
        v: row.valence,
        m: row.mood,
        k: row.camelot,
        u: row.spotify_url,
      });
      allTrackIds.add(row.track_id);
      if (row.last_updated > maxLastUpdated) maxLastUpdated = row.last_updated;
    }

    for (const day of WEEKDAYS) {
      byDay.get(day)?.sort((a, b) => a.n - b.n || a.t.localeCompare(b.t));
    }

    const days = WEEKDAYS.map((day) => ({
      day,
      tracks: byDay.get(day) ?? [],
      playlist_url: existingPlaylistUrls[stationId]?.[day] ?? undefined,
    }));

    return { id: stationId, week_start: stationWeekStart, days };
  });

  discoveredWeeks.sort();
  const weekStart = discoveredWeeks[discoveredWeeks.length - 1];

  const waxData = {
    week_start: weekStart,
    last_updated: maxLastUpdated || Date.now(),
    stations: stationsOut,
  };
  fs.writeFileSync(outputPath, `window.WAX_DATA = ${JSON.stringify(waxData)};\n`, "utf8");

  const waxArt = {
    ...existingArt,
    ...loadAlbumArtMap(stations, usersRoot, allTrackIds),
  };
  fs.writeFileSync(artOutputPath, `window.WAX_ART = ${JSON.stringify(waxArt)};\n`, "utf8");

  console.log(`[wax-weekly] week_start=${weekStart}`);
  console.log(`[wax-weekly] by_station=${stations.map((s) => `${s}:${weekStartByStation[s]}`).join(",")}`);
  console.log(`[wax-weekly] stations=${stations.join(",")}`);
  console.log(`[wax-weekly] wrote ${outputPath}`);
  console.log(`[wax-weekly] wrote ${artOutputPath}`);
  console.log(`[wax-weekly] tracks=${allTrackIds.size} album_art=${Object.keys(waxArt).length}`);
}

main();
