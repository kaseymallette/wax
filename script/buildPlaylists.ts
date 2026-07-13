import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { buildDailyPlaylists } from "../server/dailyPlaylists";
import type { TrackWithStats } from "../shared/schema";

type RepeatIntent = "currently_listening" | "favorites_archive" | "save_for_later" | "skip_for_now" | "undecided";

type TrackAggRow = {
  id: string;
  name: string;
  artists: string;
  album: string;
  album_art_url: string | null;
  duration_ms: number | null;
  added_at: string | null;
  spotify_url: string | null;
  preview_url: string | null;
  imported_at: number;
  repeat_intent: RepeatIntent | null;
  listen_count: number;
  actual_listen_count: number;
  last_listened_at: number | null;
  would_again_count: number;
  would_not_again_count: number;
  bpm: number | null;
  camelot: string | null;
  energy: number | null;
  dance: number | null;
  valence: number | null;
  album_year: number | null;
};

const WAX_USER = (process.env.WAX_USER || "default").trim() || "default";
const REPO_ROOT = process.cwd();
const DB_PATH = path.resolve(REPO_ROOT, process.env.WAX_DB_PATH || "data.db");
const PLAYLISTS_DIR = path.resolve(
  REPO_ROOT,
  process.env.WAX_PLAYLISTS_DIR || path.join("users", WAX_USER, "playlists"),
);
const SUMMARY_PATH = path.join(PLAYLISTS_DIR, "summary.json");
const MISSING_FEATURES_PATH = path.join(PLAYLISTS_DIR, "missing-features.log");
const WEEKDAY_MAP_PATH = path.join(PLAYLISTS_DIR, "weekday-map.json");
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
type Weekday = (typeof WEEKDAYS)[number];
const WEEKDAY_SET = new Set<Weekday>(WEEKDAYS);

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function loadWeekdayMap(): Record<number, Weekday> {
  const fallback: Record<number, Weekday> = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
  };

  try {
    if (!fs.existsSync(WEEKDAY_MAP_PATH)) return fallback;
    const raw = fs.readFileSync(WEEKDAY_MAP_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<number, Weekday> = { ...fallback };
    const seen = new Set<Weekday>();

    for (const [rawIndex, rawDay] of Object.entries(parsed)) {
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || index < 1 || index > 5) continue;
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

function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return Number(n).toFixed(digits);
}

function normalizeRepeatIntent(v: unknown): RepeatIntent {
  const s = String(v ?? "undecided").trim().toLowerCase();
  if (s === "skip") return "skip_for_now";
  if (
    s === "currently_listening" ||
    s === "favorites_archive" ||
    s === "save_for_later" ||
    s === "skip_for_now" ||
    s === "undecided"
  ) {
    return s;
  }
  return "undecided";
}

function rowToTrackWithStats(r: TrackAggRow): TrackWithStats {
  return {
    id: r.id,
    name: r.name,
    artists: r.artists,
    album: r.album,
    albumArtUrl: r.album_art_url ?? null,
    durationMs: r.duration_ms ?? null,
    addedAt: r.added_at ?? null,
    spotifyUrl: r.spotify_url ?? null,
    previewUrl: r.preview_url ?? null,
    importedAt: r.imported_at,
    repeatIntent: normalizeRepeatIntent(r.repeat_intent),
    listenCount: Number(r.listen_count ?? 0),
    actualListenCount: Number(r.actual_listen_count ?? 0),
    lastListenedAt: r.last_listened_at ?? null,
    wouldAgainCount: Number(r.would_again_count ?? 0),
    wouldNotAgainCount: Number(r.would_not_again_count ?? 0),
    bpm: r.bpm == null ? null : Number(r.bpm),
    camelot: r.camelot ?? null,
    energy: r.energy == null ? null : Number(r.energy),
    dance: r.dance == null ? null : Number(r.dance),
    valence: r.valence == null ? null : Number(r.valence),
    albumYear: r.album_year == null ? null : Number(r.album_year),
  };
}

function loadTrackAggRows(db: Database.Database): TrackWithStats[] {
  const rows = db
    .prepare(`
      SELECT t.*,
        COUNT(l.id) AS listen_count,
        COALESCE(SUM(l.listened), 0) AS actual_listen_count,
        MAX(l.logged_at) AS last_listened_at,
        COALESCE(SUM(l.would_again), 0) AS would_again_count,
        COALESCE(SUM(CASE WHEN l.would_again = 0 THEN 1 ELSE 0 END), 0) AS would_not_again_count,
        MAX(tf.bpm) AS bpm,
        MAX(tf.camelot) AS camelot,
        MAX(tf.energy) AS energy,
        MAX(tf.dance) AS dance,
        MAX(tf.valence) AS valence,
        MAX(tf.album_year) AS album_year
      FROM tracks t
      LEFT JOIN listens l ON l.track_id = t.id
      LEFT JOIN track_features tf ON TRIM(tf.track_id) = TRIM(t.id)
      GROUP BY t.id
    `)
    .all() as TrackAggRow[];

  return rows.map(rowToTrackWithStats);
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeCsv(filePath: string, header: string[], lines: string[][]) {
  ensureDir(filePath);
  const body = [header.join(","), ...lines.map((line) => line.map(escapeCsv).join(","))].join("\n");
  fs.writeFileSync(filePath, `${body}\n`, "utf8");
}

function writeDailyPlaylistCsv(
  filePath: string,
  tracks: ReturnType<typeof buildDailyPlaylists>["playlists"][number]["tracks"],
  byId: Map<string, TrackWithStats>,
) {
  const header = [
    "rank",
    "track_id",
    "name",
    "artists",
    "album",
    "repeat_intent",
    "bpm",
    "mood",
    "energy",
    "dance",
    "valence",
    "camelot",
    "listen_count",
    "last_listened_at",
    "spotify_url",
  ];

  const lines = tracks.map((t, i) => {
    const full = byId.get(t.id);
    return [
      String(i + 1),
      t.id,
      t.name,
      t.artists,
      t.album,
      "currently_listening",
      fmtNum(t.bpm, 2),
      fmtNum(t.mood, 2),
      fmtNum(t.energy, 2),
      fmtNum(t.dance, 2),
      fmtNum(t.valence, 2),
      t.camelot ?? "",
      String(full?.listenCount ?? 0),
      full?.lastListenedAt ? new Date(full.lastListenedAt).toISOString() : "",
      t.spotifyUrl ?? "",
    ];
  });

  writeCsv(filePath, header, lines);
}

function writeIntentPlaylistCsv(
  filePath: string,
  tracks: TrackWithStats[],
  intent: "favorites_archive" | "save_for_later",
) {
  const compareArtistThenName = (a: TrackWithStats, b: TrackWithStats) =>
    a.artists.localeCompare(b.artists) || a.name.localeCompare(b.name);

  const sorted = [...tracks].sort((a, b) => {
    const aYear = a.albumYear;
    const bYear = b.albumYear;

    if (intent === "favorites_archive") {
      if (aYear == null && bYear == null) return compareArtistThenName(a, b);
      if (aYear == null) return 1;
      if (bYear == null) return -1;
      if (bYear !== aYear) return bYear - aYear;
      return compareArtistThenName(a, b);
    }

    if (aYear == null && bYear == null) return a.name.localeCompare(b.name);
    if (aYear == null) return 1;
    if (bYear == null) return -1;
    if (aYear !== bYear) return aYear - bYear;
    return a.name.localeCompare(b.name);
  });

  const header = [
    "rank",
    "track_id",
    "name",
    "artists",
    "album",
    "repeat_intent",
    "bpm",
    "mood",
    "energy",
    "dance",
    "valence",
    "camelot",
    "listen_count",
    "last_listened_at",
    "spotify_url",
  ];

  const lines = sorted.map((t, i) => {
    const mood =
      t.energy != null && t.dance != null && t.valence != null
        ? t.energy + t.dance + t.valence
        : null;

    return [
      String(i + 1),
      t.id,
      t.name,
      t.artists,
      t.album,
      t.repeatIntent,
      fmtNum(t.bpm, 2),
      fmtNum(mood, 2),
      fmtNum(t.energy, 2),
      fmtNum(t.dance, 2),
      fmtNum(t.valence, 2),
      t.camelot ?? "",
      String(t.listenCount),
      t.lastListenedAt ? new Date(t.lastListenedAt).toISOString() : "",
      t.spotifyUrl ?? "",
    ];
  });

  writeCsv(filePath, header, lines);
}

function writeMissingFeaturesLog(tracks: TrackWithStats[]): string | null {
  const missing = tracks.filter(
    (t) =>
      t.repeatIntent === "currently_listening" &&
      (t.bpm == null || t.energy == null || t.dance == null || t.valence == null),
  );

  if (missing.length === 0) {
    if (fs.existsSync(MISSING_FEATURES_PATH)) fs.unlinkSync(MISSING_FEATURES_PATH);
    return null;
  }

  ensureDir(MISSING_FEATURES_PATH);
  const lines: string[] = [
    "# buildPlaylists missing-features report",
    `# user: ${WAX_USER}`,
    `# generated: ${new Date().toISOString()}`,
    `# db: ${DB_PATH}`,
    "",
    `Currently Listening tracks missing one or more of BPM/Energy/Dance/Valence (${missing.length})`,
    "trackId | name | artists | bpm | energy | dance | valence",
  ];

  for (const t of missing) {
    lines.push(
      `${t.id} | ${t.name} | ${t.artists} | ${t.bpm ?? ""} | ${t.energy ?? ""} | ${t.dance ?? ""} | ${t.valence ?? ""}`,
    );
  }

  fs.writeFileSync(MISSING_FEATURES_PATH, `${lines.join("\n")}\n`, "utf8");
  return MISSING_FEATURES_PATH;
}

function main() {
  console.log(`[buildPlaylists] user=${WAX_USER}`);
  console.log(`[buildPlaylists] db=${DB_PATH}`);
  console.log(`[buildPlaylists] out=${PLAYLISTS_DIR}`);

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  let tracks: TrackWithStats[] = [];
  try {
    tracks = loadTrackAggRows(db);
  } finally {
    db.close();
  }

  const byId = new Map(tracks.map((t) => [t.id, t]));
  const daily = buildDailyPlaylists(tracks);
  const weekdayMap = loadWeekdayMap();
  const dailyByIndex = new Map(daily.playlists.map((p) => [p.index, p]));
  const dailyIndexByWeekday = new Map<Weekday, number>();
  for (const [index, day] of Object.entries(weekdayMap)) {
    dailyIndexByWeekday.set(day, Number(index));
  }

  const dailyFiles: string[] = [];
  for (let slot = 0; slot < WEEKDAYS.length; slot += 1) {
    const day = WEEKDAYS[slot];
    const sourceIndex = dailyIndexByWeekday.get(day) ?? slot + 1;
    const playlist = dailyByIndex.get(sourceIndex) ?? dailyByIndex.get(slot + 1);
    if (!playlist) continue;

    const outPath = path.join(PLAYLISTS_DIR, `daily-${slot + 1}.csv`);
    writeDailyPlaylistCsv(outPath, playlist.tracks, byId);
    dailyFiles.push(outPath);
  }

  const favorites = tracks.filter((t) => t.repeatIntent === "favorites_archive");
  const saveForLater = tracks.filter((t) => t.repeatIntent === "save_for_later");

  const favoritesPath = path.join(PLAYLISTS_DIR, "favorites-archive.csv");
  const saveForLaterPath = path.join(PLAYLISTS_DIR, "save-for-later.csv");

  writeIntentPlaylistCsv(favoritesPath, favorites, "favorites_archive");
  writeIntentPlaylistCsv(saveForLaterPath, saveForLater, "save_for_later");

  const missingPath = writeMissingFeaturesLog(tracks);

  ensureDir(SUMMARY_PATH);
  const summary = {
    user: WAX_USER,
    generatedAt: Date.now(),
    dbPath: DB_PATH,
    diagnostics: daily.diagnostics,
    counts: {
      favoritesArchive: favorites.length,
      saveForLater: saveForLater.length,
    },
    files: {
      daily: dailyFiles,
      favoritesArchive: favoritesPath,
      saveForLater: saveForLaterPath,
      missingFeatures: missingPath,
    },
  };
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`[buildPlaylists] wrote ${dailyFiles.length} daily playlist CSVs`);
  dailyFiles.forEach((f) => console.log(`[buildPlaylists] wrote ${f}`));
  console.log(`[buildPlaylists] wrote ${favoritesPath}`);
  console.log(`[buildPlaylists] wrote ${saveForLaterPath}`);
  console.log(`[buildPlaylists] wrote ${SUMMARY_PATH}`);
  if (missingPath) {
    console.log(`[buildPlaylists] warning: missing features log -> ${missingPath}`);
  }
}

main();
