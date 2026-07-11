import { tracks, listens, CURRENTLY_LISTENING_CAPACITY } from "@shared/schema";
import type {
  Track,
  TrackImport,
  FeatureImportRow,
  ListenPayload,
  TrackWithStats,
  ListenWithTrack,
  Listen,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// --- Schema bootstrap + destructive migration (user has no ratings to keep) ---
sqlite.exec(`
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
    imported_at INTEGER NOT NULL
  );
`);

// 1) Drop the old ratings table if it exists.
sqlite.exec(`DROP TABLE IF EXISTS ratings;`);

// 2) Add sticky track metadata columns if missing.
const trackCols = sqlite.prepare(`PRAGMA table_info(tracks)`).all() as { name: string }[];
if (!trackCols.some((c) => c.name === "repeat_intent")) {
  sqlite.exec(`ALTER TABLE tracks ADD COLUMN repeat_intent TEXT NOT NULL DEFAULT 'undecided';`);
}

function normText(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeaturePercent(v: unknown): number | null {
  const n = numOrNull(v);
  if (n == null) return null;
  if (n >= 0 && n <= 1) return Number((n * 100).toFixed(3));
  return n;
}

const SHUFFLE_FEATURE_KEYS = ["bpm", "energy", "dance", "valence", "albumYear"] as const;
type ShuffleFeatureKey = (typeof SHUFFLE_FEATURE_KEYS)[number];
type ShuffleFeatureStats = Record<ShuffleFeatureKey, { mean: number; std: number }>;
type ShuffleFeatureCentroid = Partial<Record<ShuffleFeatureKey, number>>;

type ShuffleFeatureRow = {
  id: string;
  loggedAt: number | null;
  keepInLibrary: number | null;
  repeatIntent: string | null;
  bpm: number | null;
  energy: number | null;
  dance: number | null;
  valence: number | null;
  albumYear: number | null;
};

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function hasShuffleFeatures(row: ShuffleFeatureRow): boolean {
  for (const key of SHUFFLE_FEATURE_KEYS) {
    const v = row[key];
    if (v != null && Number.isFinite(v)) return true;
  }
  return false;
}

function repeatIntentWeight(intent: string | null): number {
  if (intent === "currently_listening") return 1;
  if (intent === "favorites_archive") return 0.75;
  if (intent === "undecided") return 0.2;
  if (intent === "save_for_later") return 0.35;
  if (intent === "skip") return 0;
  return 0.2;
}

function computeShuffleFeatureStats(rows: ShuffleFeatureRow[]): ShuffleFeatureStats {
  const stats = {} as ShuffleFeatureStats;
  for (const key of SHUFFLE_FEATURE_KEYS) {
    const values: number[] = [];
    for (const row of rows) {
      const v = row[key];
      if (v != null && Number.isFinite(v)) values.push(v);
    }
    if (!values.length) {
      stats[key] = { mean: 0, std: 1 };
      continue;
    }
    const mean = values.reduce((s, n) => s + n, 0) / values.length;
    const variance = values.reduce((s, n) => s + (n - mean) * (n - mean), 0) / values.length;
    const std = Math.sqrt(variance) || 1;
    stats[key] = { mean, std };
  }
  return stats;
}

function zValue(row: ShuffleFeatureRow, key: ShuffleFeatureKey, stats: ShuffleFeatureStats): number | null {
  const v = row[key];
  if (v == null || !Number.isFinite(v)) return null;
  return (v - stats[key].mean) / stats[key].std;
}

function buildWeightedCentroid(
  rows: ShuffleFeatureRow[],
  stats: ShuffleFeatureStats,
  rowWeight: (row: ShuffleFeatureRow) => number,
): ShuffleFeatureCentroid {
  const numerator = {} as Record<ShuffleFeatureKey, number>;
  const denom = {} as Record<ShuffleFeatureKey, number>;

  for (const key of SHUFFLE_FEATURE_KEYS) {
    numerator[key] = 0;
    denom[key] = 0;
  }

  for (const row of rows) {
    const w = rowWeight(row);
    if (!(w > 0)) continue;
    for (const key of SHUFFLE_FEATURE_KEYS) {
      const z = zValue(row, key, stats);
      if (z == null) continue;
      numerator[key] += z * w;
      denom[key] += w;
    }
  }

  const centroid: ShuffleFeatureCentroid = {};
  for (const key of SHUFFLE_FEATURE_KEYS) {
    if (denom[key] > 0) centroid[key] = numerator[key] / denom[key];
  }
  return centroid;
}

function similarityToCentroid(
  row: ShuffleFeatureRow,
  centroid: ShuffleFeatureCentroid,
  stats: ShuffleFeatureStats,
): number | null {
  let dims = 0;
  let sq = 0;
  for (const key of SHUFFLE_FEATURE_KEYS) {
    const center = centroid[key];
    if (center == null) continue;
    const z = zValue(row, key, stats);
    if (z == null) continue;
    const d = z - center;
    sq += d * d;
    dims += 1;
  }
  if (!dims) return null;
  const dist = Math.sqrt(sq / dims);
  return 1 / (1 + dist);
}

export type TrackFeaturePoint = {
  trackId: string;
  name: string;
  artists: string;
  album: string;
  bpm: number;
  camelot: string | null;
  energy: number;
  dance: number;
  valence: number;
  popularity: number | null;
  albumYear: number | null;
  source: string | null;
};

export type FeatureImportSummary = {
  imported: number;
  matchedByTrackId: number;
  matchedByArtistSong: number;
  unmatched: number;
};

// 3) Create the listens table + indexes.
sqlite.exec(`
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
`);

const listenCols = sqlite.prepare(`PRAGMA table_info(listens)`).all() as { name: string }[];
if (!listenCols.some((c) => c.name === "want_again")) {
  sqlite.exec(`ALTER TABLE listens ADD COLUMN want_again INTEGER NOT NULL DEFAULT 1;`);
}
if (!listenCols.some((c) => c.name === "keep_in_library")) {
  sqlite.exec(`ALTER TABLE listens ADD COLUMN keep_in_library INTEGER NOT NULL DEFAULT 1;`);
}

// 4) Track-level features used by playlist builder.
sqlite.exec(`
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

sqlite.exec(`
  UPDATE track_features
  SET
    energy = ROUND(energy * 100, 3),
    dance = ROUND(dance * 100, 3),
    valence = ROUND(valence * 100, 3)
  WHERE
    energy IS NOT NULL AND dance IS NOT NULL AND valence IS NOT NULL
    AND energy >= 0 AND energy <= 1
    AND dance >= 0 AND dance <= 1
    AND valence >= 0 AND valence <= 1;
`);

export const db = drizzle(sqlite);

function safeParseTags(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function rowToTrackWithStats(r: any): TrackWithStats {
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
    repeatIntent: r.repeat_intent ?? "undecided",
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

function rowToListenWithTrack(r: any): ListenWithTrack {
  return {
    id: r.id,
    trackId: r.track_id,
    repeatIntent: r.repeat_intent ?? "undecided",
    listened: r.listened,
    wantAgain: r.want_again,
    wouldAgain: r.would_again,
    keepInLibrary: r.keep_in_library,
    activity: safeParseTags(r.activity),
    notes: r.notes ?? "",
    loggedAt: r.logged_at,
    name: r.name,
    artists: r.artists,
    album: r.album,
    albumArtUrl: r.album_art_url ?? null,
    spotifyUrl: r.spotify_url ?? null,
    previewUrl: r.preview_url ?? null,
  };
}

export interface IStorage {
  importTracks(items: TrackImport[]): { imported: number; total: number };
  listTracks(opts: { status?: string; q?: string; sort?: string; includeFeatures?: boolean }): TrackWithStats[];
  listTracksByIds(ids: string[], includeFeatures?: boolean): TrackWithStats[];
  getRandomTrack(status: string, keepOnly?: boolean, includeFeatures?: boolean, excludeTrackIds?: string[]): TrackWithStats | undefined;
  getTrack(id: string, includeFeatures?: boolean): TrackWithStats | undefined;
  setRepeatIntent(id: string, repeatIntent: Track["repeatIntent"]):
    | TrackWithStats
    | { error: string }
    | undefined;
  addListen(payload: ListenPayload): { listen: Listen; track: TrackWithStats } | { error: string };
  listListens(opts: {
    trackId?: string;
    activity?: string[];
    repeatIntent?: string[];
    keepOnly?: boolean;
    from?: number;
    to?: number;
    listenedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): ListenWithTrack[];
  getListen(id: number): ListenWithTrack | undefined;
  deleteListen(id: number): { changes: number };
  clearLibrary(): void;
  getStats(): any;
  trackCount(): number;
  importFeatureRows(rows: FeatureImportRow[]): FeatureImportSummary;
  getTrackFeaturePoint(trackId: string): TrackFeaturePoint | undefined;
  listKeepTrackFeaturePoints(): TrackFeaturePoint[];
}

// Aggregate listen stats joined onto tracks.
const TRACK_AGG_SELECT = `
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
`;

const TRACK_AGG_SELECT_NO_FEATURES = `
  SELECT t.*,
    COUNT(l.id) AS listen_count,
    COALESCE(SUM(l.listened), 0) AS actual_listen_count,
    MAX(l.logged_at) AS last_listened_at,
    COALESCE(SUM(l.would_again), 0) AS would_again_count,
    COALESCE(SUM(CASE WHEN l.would_again = 0 THEN 1 ELSE 0 END), 0) AS would_not_again_count,
    NULL AS bpm,
    NULL AS camelot,
    NULL AS energy,
    NULL AS dance,
    NULL AS valence,
    NULL AS album_year
  FROM tracks t
  LEFT JOIN listens l ON l.track_id = t.id
`;

const LISTEN_JOIN_SELECT = `
  SELECT l.id, l.track_id, l.listened, l.want_again, l.would_again, l.keep_in_library, l.activity, l.notes, l.logged_at,
         t.name, t.artists, t.album, t.album_art_url, t.spotify_url, t.preview_url, t.repeat_intent
  FROM listens l
  JOIN tracks t ON t.id = l.track_id
`;

export class DatabaseStorage implements IStorage {
  private importStmt = sqlite.prepare(`
    INSERT INTO tracks (id, name, artists, album, album_art_url, duration_ms, added_at, spotify_url, preview_url, imported_at, repeat_intent)
    VALUES (@id, @name, @artists, @album, @albumArtUrl, @durationMs, @addedAt, @spotifyUrl, @previewUrl, @importedAt, @repeatIntent)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      artists = excluded.artists,
      album = excluded.album,
      album_art_url = excluded.album_art_url,
      duration_ms = excluded.duration_ms,
      added_at = excluded.added_at,
      spotify_url = excluded.spotify_url,
      preview_url = excluded.preview_url
  `);

  private importFeatureStmt = sqlite.prepare(`
    INSERT INTO track_features
      (track_id, bpm, camelot, energy, dance, valence, popularity, album_year, source, updated_at)
    VALUES
      (@trackId, @bpm, @camelot, @energy, @dance, @valence, @popularity, @albumYear, @source, @updatedAt)
    ON CONFLICT(track_id) DO UPDATE SET
      bpm = excluded.bpm,
      camelot = excluded.camelot,
      energy = excluded.energy,
      dance = excluded.dance,
      valence = excluded.valence,
      popularity = excluded.popularity,
      album_year = excluded.album_year,
      source = excluded.source,
      updated_at = excluded.updated_at
  `);

  private findTrackByArtistSongStmt = sqlite.prepare(`
    SELECT id
    FROM tracks
    WHERE LOWER(name) = ?
      AND INSTR(LOWER(artists), ?) > 0
    ORDER BY imported_at DESC
    LIMIT 1
  `);

  importTracks(items: TrackImport[]): { imported: number; total: number } {
    const now = Date.now();
    const findExistingTrackIdByTrim = sqlite.prepare(`SELECT id FROM tracks WHERE TRIM(id) = TRIM(?) LIMIT 1`);
    const tx = sqlite.transaction((rows: TrackImport[]) => {
      for (const it of rows) {
        const rawId = String(it.id ?? "").trim();
        if (!rawId) continue;
        const existing = findExistingTrackIdByTrim.get(rawId) as { id: string } | undefined;
        const id = existing?.id ?? rawId;
        this.importStmt.run({
          id,
          name: it.name && it.name.trim() ? it.name : "Unknown track",
          artists: it.artists ?? "",
          album: it.album ?? "",
          albumArtUrl: it.albumArtUrl ?? null,
          durationMs: it.durationMs ?? null,
          addedAt: it.addedAt ?? null,
          spotifyUrl: it.spotifyUrl ?? `https://open.spotify.com/track/${id}`,
          previewUrl: it.previewUrl ?? null,
          importedAt: now,
          repeatIntent: "undecided",
        });
      }
    });
    tx(items);
    const total = this.trackCount();
    return { imported: items.length, total };
  }

  importFeatureRows(rows: FeatureImportRow[]): FeatureImportSummary {
    let imported = 0;
    let matchedByTrackId = 0;
    let matchedByArtistSong = 0;
    let unmatched = 0;
    const now = Date.now();

    const hasTrackStmt = sqlite.prepare(`SELECT id FROM tracks WHERE TRIM(id) = TRIM(?) LIMIT 1`);

    const tx = sqlite.transaction((items: FeatureImportRow[]) => {
      for (const row of items) {
        let matchedTrackId: string | null = null;
        const byId = row.trackId?.trim();
        if (byId) {
          const exists = hasTrackStmt.get(byId) as { id: string } | undefined;
          if (exists?.id) {
            matchedTrackId = exists.id;
            matchedByTrackId += 1;
          }
        }

        if (!matchedTrackId) {
          const song = normText(row.song);
          const artist = normText(row.artist);
          if (song && artist) {
            const found = this.findTrackByArtistSongStmt.get(song, artist) as { id: string } | undefined;
            if (found?.id) {
              matchedTrackId = found.id;
              matchedByArtistSong += 1;
            }
          }
        }

        if (!matchedTrackId) {
          unmatched += 1;
          continue;
        }

        this.importFeatureStmt.run({
          trackId: String(matchedTrackId).trim(),
          bpm: numOrNull(row.bpm),
          camelot: row.camelot?.trim() || null,
          energy: normalizeFeaturePercent(row.energy),
          dance: normalizeFeaturePercent(row.dance),
          valence: normalizeFeaturePercent(row.valence),
          popularity: numOrNull(row.popularity),
          albumYear: row.albumYear ?? null,
          source: row.source?.trim() || null,
          updatedAt: now,
        });
        imported += 1;
      }
    });

    tx(rows);
    return { imported, matchedByTrackId, matchedByArtistSong, unmatched };
  }

  getTrackFeaturePoint(trackId: string): TrackFeaturePoint | undefined {
    const row = sqlite
      .prepare(`
        SELECT
          t.id AS track_id,
          t.name,
          t.artists,
          t.album,
          tf.bpm,
          tf.camelot,
          tf.energy,
          tf.dance,
          tf.valence,
          tf.popularity,
          tf.album_year,
          tf.source
        FROM tracks t
        JOIN track_features tf ON TRIM(tf.track_id) = TRIM(t.id)
        WHERE TRIM(t.id) = TRIM(?)
          AND tf.bpm IS NOT NULL
          AND tf.valence IS NOT NULL
          AND tf.dance IS NOT NULL
          AND tf.energy IS NOT NULL
        LIMIT 1
      `)
      .get(trackId) as any;

    if (!row) return undefined;
    return {
      trackId: row.track_id,
      name: row.name,
      artists: row.artists,
      album: row.album,
      bpm: Number(row.bpm),
      camelot: row.camelot ?? null,
      energy: Number(row.energy),
      dance: Number(row.dance),
      valence: Number(row.valence),
      popularity: row.popularity == null ? null : Number(row.popularity),
      albumYear: row.album_year == null ? null : Number(row.album_year),
      source: row.source ?? null,
    };
  }

  listKeepTrackFeaturePoints(): TrackFeaturePoint[] {
    const rows = sqlite
      .prepare(`
        SELECT
          t.id AS track_id,
          t.name,
          t.artists,
          t.album,
          tf.bpm,
          tf.camelot,
          tf.energy,
          tf.dance,
          tf.valence,
          tf.popularity,
          tf.album_year,
          tf.source
        FROM tracks t
        JOIN track_features tf ON TRIM(tf.track_id) = TRIM(t.id)
        WHERE tf.bpm IS NOT NULL
          AND tf.valence IS NOT NULL
          AND tf.dance IS NOT NULL
          AND tf.energy IS NOT NULL
          AND (
            SELECT l2.keep_in_library
            FROM listens l2
            WHERE l2.track_id = t.id
            ORDER BY l2.logged_at DESC, l2.id DESC
            LIMIT 1
          ) = 1
      `)
      .all() as any[];

    return rows.map((row) => ({
      trackId: row.track_id,
      name: row.name,
      artists: row.artists,
      album: row.album,
      bpm: Number(row.bpm),
      camelot: row.camelot ?? null,
      energy: Number(row.energy),
      dance: Number(row.dance),
      valence: Number(row.valence),
      popularity: row.popularity == null ? null : Number(row.popularity),
      albumYear: row.album_year == null ? null : Number(row.album_year),
      source: row.source ?? null,
    }));
  }

  listTracks(opts: { status?: string; q?: string; sort?: string; includeFeatures?: boolean }): TrackWithStats[] {
    const status = opts.status || "all";
    const q = opts.q || "";
    const sort = opts.sort || "added";
    const includeFeatures = opts.includeFeatures !== false;
    const having: string[] = [];
    const where: string[] = [];
    const params: any = {};

    if (q && q.trim()) {
      where.push("(LOWER(t.name) LIKE @q OR LOWER(t.artists) LIKE @q OR LOWER(t.album) LIKE @q)");
      params.q = `%${q.toLowerCase()}%`;
    }
    if (status === "logged") having.push("listen_count > 0");
    else if (status === "unlogged") having.push("listen_count = 0");
    else if (status === "keep") {
      having.push(`(
        SELECT l2.keep_in_library
        FROM listens l2
        WHERE l2.track_id = t.id
        ORDER BY l2.logged_at DESC, l2.id DESC
        LIMIT 1
      ) = 1`);
    } else if (status === "remove") {
      having.push(`(
        SELECT l2.keep_in_library
        FROM listens l2
        WHERE l2.track_id = t.id
        ORDER BY l2.logged_at DESC, l2.id DESC
        LIMIT 1
      ) = 0`);
    }

    let orderBy = "t.imported_at DESC, t.name COLLATE NOCASE ASC";
    if (sort === "listens") orderBy = "listen_count DESC, t.name COLLATE NOCASE ASC";
    else if (sort === "last") orderBy = "last_listened_at DESC NULLS LAST, t.name COLLATE NOCASE ASC";
    else if (sort === "name") orderBy = "t.name COLLATE NOCASE ASC";

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const havingClause = having.length ? `HAVING ${having.join(" AND ")}` : "";
    const trackAggSelect = includeFeatures ? TRACK_AGG_SELECT : TRACK_AGG_SELECT_NO_FEATURES;
    const rows = sqlite
      .prepare(`${trackAggSelect} ${whereClause} GROUP BY t.id ${havingClause} ORDER BY ${orderBy}`)
      .all(params) as any[];
    return rows.map(rowToTrackWithStats);
  }

  listTracksByIds(ids: string[], includeFeatures = true): TrackWithStats[] {
    const uniqueIds = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => "?").join(",");
    const trackAggSelect = includeFeatures ? TRACK_AGG_SELECT : TRACK_AGG_SELECT_NO_FEATURES;
    const rows = sqlite
      .prepare(`${trackAggSelect} WHERE t.id IN (${placeholders}) GROUP BY t.id`)
      .all(...uniqueIds) as any[];
    return rows.map(rowToTrackWithStats);
  }

  getRandomTrack(status: string, keepOnly = false, includeFeatures = true, excludeTrackIds: string[] = []): TrackWithStats | undefined {
    const whereParts: string[] = [];
    whereParts.push(`COALESCE(t.repeat_intent, 'undecided') != 'skip'`);
    if (status !== "all") {
      whereParts.push("latest.track_id IS NULL");
    }
    if (keepOnly) {
      whereParts.push("latest.keep_in_library = 1");
    }

    const uniqueExcludeIds = Array.from(new Set(excludeTrackIds.map((id) => String(id).trim()).filter(Boolean)));
    if (uniqueExcludeIds.length) {
      whereParts.push(`TRIM(t.id) NOT IN (${uniqueExcludeIds.map(() => "?").join(",")})`);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const orderBy =
      status === "all"
        ? "ORDER BY CASE WHEN latest.logged_at IS NULL THEN 0 ELSE 1 END ASC, latest.logged_at ASC, RANDOM()"
        : "ORDER BY RANDOM()";

    const candidates = sqlite
      .prepare(`
        WITH latest AS (
          SELECT ranked.track_id, ranked.keep_in_library, ranked.logged_at
          FROM (
            SELECT
              l.track_id,
              l.keep_in_library,
              l.logged_at,
              l.id,
              ROW_NUMBER() OVER (PARTITION BY l.track_id ORDER BY l.logged_at DESC, l.id DESC) AS rn
            FROM listens l
          ) ranked
          WHERE ranked.rn = 1
        )
        SELECT
          t.id,
          latest.keep_in_library,
          latest.logged_at,
          t.repeat_intent,
          tf.bpm,
          tf.energy,
          tf.dance,
          tf.valence,
          tf.album_year
        FROM tracks t
        LEFT JOIN latest ON latest.track_id = t.id
        LEFT JOIN track_features tf ON TRIM(tf.track_id) = TRIM(t.id)
        ${whereClause}
        ${orderBy}
        LIMIT 250
      `)
      .all(...uniqueExcludeIds) as any[];

    const candidateRows: ShuffleFeatureRow[] = candidates.map((row) => ({
      id: String(row.id),
      keepInLibrary: row.keep_in_library == null ? null : Number(row.keep_in_library),
      loggedAt: row.logged_at == null ? null : Number(row.logged_at),
      repeatIntent: row.repeat_intent == null ? null : String(row.repeat_intent),
      bpm: numOrNull(row.bpm),
      energy: numOrNull(row.energy),
      dance: numOrNull(row.dance),
      valence: numOrNull(row.valence),
      albumYear: numOrNull(row.album_year),
    }));

    if (!candidateRows.length) return undefined;

    const profileRowsRaw = sqlite
      .prepare(`
        WITH latest AS (
          SELECT ranked.track_id, ranked.keep_in_library, ranked.logged_at
          FROM (
            SELECT
              l.track_id,
              l.keep_in_library,
              l.logged_at,
              l.id,
              ROW_NUMBER() OVER (PARTITION BY l.track_id ORDER BY l.logged_at DESC, l.id DESC) AS rn
            FROM listens l
          ) ranked
          WHERE ranked.rn = 1
        )
        SELECT
          t.id,
          latest.keep_in_library,
          latest.logged_at,
          t.repeat_intent,
          tf.bpm,
          tf.energy,
          tf.dance,
          tf.valence,
          tf.album_year
        FROM tracks t
        JOIN latest ON latest.track_id = t.id
        LEFT JOIN track_features tf ON TRIM(tf.track_id) = TRIM(t.id)
      `)
      .all() as any[];

    const profileRows: ShuffleFeatureRow[] = profileRowsRaw.map((row) => ({
      id: String(row.id),
      keepInLibrary: row.keep_in_library == null ? null : Number(row.keep_in_library),
      loggedAt: row.logged_at == null ? null : Number(row.logged_at),
      repeatIntent: row.repeat_intent == null ? null : String(row.repeat_intent),
      bpm: numOrNull(row.bpm),
      energy: numOrNull(row.energy),
      dance: numOrNull(row.dance),
      valence: numOrNull(row.valence),
      albumYear: numOrNull(row.album_year),
    }));

    const profileWithFeatures = profileRows.filter(hasShuffleFeatures);
    const candidatesWithFeatures = candidateRows.filter(hasShuffleFeatures);

    if (!profileWithFeatures.length || !candidatesWithFeatures.length) {
      return this.getTrack(candidateRows[0].id, includeFeatures);
    }

    const keepRows = profileWithFeatures.filter((r) => r.keepInLibrary === 1);
    const removeRows = profileWithFeatures.filter((r) => r.keepInLibrary === 0);
    const stats = computeShuffleFeatureStats([...profileWithFeatures, ...candidatesWithFeatures]);

    const keepCentroid = buildWeightedCentroid(keepRows, stats, (r) => repeatIntentWeight(r.repeatIntent));
    const removeCentroid = buildWeightedCentroid(removeRows, stats, () => 1);

    const labeledCount = keepRows.length + removeRows.length;
    const confidence = clamp01(labeledCount / 50);
    const keepConfidence = clamp01(keepRows.length / 15);
    const removeConfidence = clamp01(removeRows.length / 20);

    const maxIndex = Math.max(candidateRows.length - 1, 1);
    let best = candidateRows[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < candidateRows.length; i += 1) {
      const row = candidateRows[i];
      const baseline = 1 - i / maxIndex;
      const keepSimilarity = similarityToCentroid(row, keepCentroid, stats) ?? 0;
      const removeSimilarity = similarityToCentroid(row, removeCentroid, stats) ?? 0;
      const preference = keepConfidence * keepSimilarity - 0.85 * removeConfidence * removeSimilarity;
      const score = confidence * preference + (1 - confidence) * baseline + Math.random() * 0.03;

      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }

    return this.getTrack(best.id, includeFeatures);
  }

  private applyRepeatIntent(trackId: string, repeatIntent: Track["repeatIntent"]): { ok: true } | { error: string } {
    if (repeatIntent !== "currently_listening") {
      sqlite.prepare(`UPDATE tracks SET repeat_intent = ? WHERE id = ?`).run(repeatIntent, trackId);
      return { ok: true };
    }

    const current = sqlite
      .prepare(`SELECT repeat_intent FROM tracks WHERE id = ?`)
      .get(trackId) as { repeat_intent: string } | undefined;

    if (!current) return { error: "Track not found" };
    if (current.repeat_intent === "currently_listening") return { ok: true };

    const currentlyListeningCount = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM tracks WHERE repeat_intent = 'currently_listening'`)
      .get() as { c: number };

    if (currentlyListeningCount.c >= CURRENTLY_LISTENING_CAPACITY) {
      return {
        error: `Currently Listening is full (${CURRENTLY_LISTENING_CAPACITY}/${CURRENTLY_LISTENING_CAPACITY}). Move tracks to another tag first.`,
      };
    }

    sqlite.prepare(`UPDATE tracks SET repeat_intent = ? WHERE id = ?`).run(repeatIntent, trackId);
    return { ok: true };
  }

  getTrack(id: string, includeFeatures = true): TrackWithStats | undefined {
    const trackAggSelect = includeFeatures ? TRACK_AGG_SELECT : TRACK_AGG_SELECT_NO_FEATURES;
    const row = sqlite
      .prepare(`${trackAggSelect} WHERE t.id = ? GROUP BY t.id`)
      .get(id) as any;
    return row ? rowToTrackWithStats(row) : undefined;
  }

  setRepeatIntent(id: string, repeatIntent: Track["repeatIntent"]):
    | TrackWithStats
    | { error: string }
    | undefined {
    const result = this.applyRepeatIntent(id, repeatIntent);
    if ("error" in result) return result;
    return this.getTrack(id);
  }

  addListen(payload: ListenPayload) {
    const track = sqlite.prepare(`SELECT * FROM tracks WHERE id = ?`).get(payload.trackId) as any;
    if (!track) return { error: "Track not found" } as const;

    if (payload.repeatIntent) {
      const result = this.applyRepeatIntent(payload.trackId, payload.repeatIntent);
      if ("error" in result) return { error: result.error } as const;
    }

    const now = Date.now();
    const listened = typeof payload.listened === "boolean" ? (payload.listened ? 1 : 0) : payload.listened;
    const wantAgain = typeof payload.wantAgain === "boolean" ? (payload.wantAgain ? 1 : 0) : payload.wantAgain;
    const wouldAgain = typeof payload.wouldAgain === "boolean" ? (payload.wouldAgain ? 1 : 0) : payload.wouldAgain;
    const keepInLibrary = typeof payload.keepInLibrary === "boolean" ? (payload.keepInLibrary ? 1 : 0) : payload.keepInLibrary;
    const activity = JSON.stringify(payload.activity ?? []);

    const inserted = sqlite
      .prepare(`
        INSERT INTO listens (track_id, listened, want_again, would_again, keep_in_library, activity, notes, logged_at)
        VALUES (@trackId, @listened, @wantAgain, @wouldAgain, @keepInLibrary, @activity, @notes, @loggedAt)
        RETURNING *
      `)
      .get({
        trackId: payload.trackId,
        listened,
        wantAgain,
        wouldAgain,
        keepInLibrary,
        activity,
        // Notes are currently hidden in the Shuffle UI, but this field is kept so it can be re-enabled later.
        notes: payload.notes ?? "",
        loggedAt: now,
      }) as any;

    const listen: Listen = {
      id: inserted.id,
      trackId: inserted.track_id,
      listened: inserted.listened,
      wantAgain: inserted.want_again,
      wouldAgain: inserted.would_again,
      keepInLibrary: inserted.keep_in_library,
      activity: inserted.activity,
      notes: inserted.notes,
      loggedAt: inserted.logged_at,
    };

    const updatedTrack = this.getTrack(payload.trackId)!;
    return { listen, track: updatedTrack };
  }

  listListens(opts: {
    trackId?: string;
    activity?: string[];
    repeatIntent?: string[];
    keepOnly?: boolean;
    from?: number;
    to?: number;
    listenedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): ListenWithTrack[] {
    const where: string[] = [];
    const params: any[] = [];

    if (opts.trackId) {
      where.push("l.track_id = ?");
      params.push(opts.trackId);
    }
    if (opts.keepOnly) {
      where.push("l.keep_in_library = 1");
    }
    if (opts.repeatIntent && opts.repeatIntent.length) {
      where.push(`t.repeat_intent IN (${opts.repeatIntent.map(() => "?").join(",")})`);
      params.push(...opts.repeatIntent);
    }
    if (typeof opts.from === "number") {
      where.push("l.logged_at >= ?");
      params.push(opts.from);
    }
    if (typeof opts.to === "number") {
      where.push("l.logged_at <= ?");
      params.push(opts.to);
    }
    if (opts.listenedOnly) {
      where.push("l.listened = 1");
    }
    // Activity filter: match if listen's activity JSON contains any requested tag.
    if (opts.activity && opts.activity.length) {
      const ors = opts.activity.map(() => "l.activity LIKE ?");
      where.push(`(${ors.join(" OR ")})`);
      for (const a of opts.activity) params.push(`%${JSON.stringify(a).slice(1, -1)}%`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = sqlite
      .prepare(`${LISTEN_JOIN_SELECT} ${whereClause} ORDER BY l.logged_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as any[];
    return rows.map(rowToListenWithTrack);
  }

  getListen(id: number): ListenWithTrack | undefined {
    const row = sqlite.prepare(`${LISTEN_JOIN_SELECT} WHERE l.id = ?`).get(id) as any;
    return row ? rowToListenWithTrack(row) : undefined;
  }

  deleteListen(id: number): { changes: number } {
    const r = sqlite.prepare(`DELETE FROM listens WHERE id = ?`).run(id);
    return { changes: r.changes };
  }

  clearLibrary(): void {
    sqlite.exec("DELETE FROM listens; DELETE FROM tracks;");
  }

  trackCount(): number {
    const r = sqlite.prepare("SELECT COUNT(*) as c FROM tracks").get() as any;
    return r.c;
  }

  getStats() {
    const tracksTotal = this.trackCount();
    const totalListens = (sqlite.prepare("SELECT COUNT(*) c FROM listens").get() as any).c;
    const actualListens = (sqlite.prepare("SELECT COALESCE(SUM(listened),0) c FROM listens").get() as any).c;
    const uniqueTracksLogged = (sqlite.prepare("SELECT COUNT(DISTINCT track_id) c FROM listens").get() as any).c;

    // Listens per day, last 30 days (local-ish, using ms -> ISO date).
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const dayRows = sqlite
      .prepare("SELECT logged_at FROM listens WHERE logged_at >= ?")
      .all(since) as any[];
    const byDayMap: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      byDayMap[key] = 0;
    }
    for (const row of dayRows) {
      const key = new Date(row.logged_at).toISOString().slice(0, 10);
      if (key in byDayMap) byDayMap[key] += 1;
    }
    const listensByDay = Object.entries(byDayMap).map(([date, count]) => ({ date, count }));

    // Top 10 tracks by listen count.
    const topRows = sqlite
      .prepare(`
        SELECT t.id AS track_id, t.name, t.artists, COUNT(l.id) AS count
        FROM listens l JOIN tracks t ON t.id = l.track_id
        GROUP BY t.id ORDER BY count DESC LIMIT 10
      `)
      .all() as any[];
    const topTracks = topRows.map((r) => ({
      trackId: r.track_id,
      name: r.name,
      artists: r.artists,
      count: Number(r.count),
    }));

    // Activity breakdown.
    const activityCounts: Record<string, number> = {};
    const actRows = sqlite.prepare("SELECT activity FROM listens WHERE activity != '[]'").all() as any[];
    for (const row of actRows) {
      for (const a of safeParseTags(row.activity)) {
        activityCounts[a] = (activityCounts[a] || 0) + 1;
      }
    }
    const activityBreakdown = Object.entries(activityCounts)
      .map(([activity, count]) => ({ activity, count }))
      .sort((a, b) => b.count - a.count);

    // Keep/remove ratio by unique track (latest decision per track).
    const keepRemove = sqlite
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN latest.keep_in_library = 1 THEN 1 ELSE 0 END), 0) AS keep_count,
          COALESCE(SUM(CASE WHEN latest.keep_in_library = 0 THEN 1 ELSE 0 END), 0) AS remove_count
        FROM (
          SELECT l.keep_in_library
          FROM listens l
          WHERE l.id = (
            SELECT l2.id
            FROM listens l2
            WHERE l2.track_id = l.track_id
            ORDER BY l2.logged_at DESC, l2.id DESC
            LIMIT 1
          )
        ) latest
      `)
      .get() as any;
    const keepRemoveRatio = {
      keep: Number(keepRemove.keep_count ?? 0),
      remove: Number(keepRemove.remove_count ?? 0),
    };

    // Keep/remove feature summary from latest decision per track.
    const featureRows = sqlite
      .prepare(`
        SELECT
          latest.keep_in_library,
          tf.bpm,
          tf.energy,
          tf.dance,
          tf.valence,
          tf.camelot,
          tf.album_year
        FROM (
          SELECT l.track_id, l.keep_in_library
          FROM listens l
          WHERE l.id = (
            SELECT l2.id
            FROM listens l2
            WHERE l2.track_id = l.track_id
            ORDER BY l2.logged_at DESC, l2.id DESC
            LIMIT 1
          )
        ) latest
        JOIN track_features tf ON TRIM(tf.track_id) = TRIM(latest.track_id)
      `)
      .all() as any[];

    const buildFeatureBucket = () => ({
      trackCount: 0,
      bpmSum: 0,
      bpmCount: 0,
      bpmMin: null as number | null,
      bpmMax: null as number | null,
      energySum: 0,
      energyCount: 0,
      energyMin: null as number | null,
      energyMax: null as number | null,
      danceSum: 0,
      danceCount: 0,
      danceMin: null as number | null,
      danceMax: null as number | null,
      valenceSum: 0,
      valenceCount: 0,
      valenceMin: null as number | null,
      valenceMax: null as number | null,
      moodSum: 0,
      moodCount: 0,
      moodMin: null as number | null,
      moodMax: null as number | null,
      bpmModeCounts: new Map<string, number>(),
      energyModeCounts: new Map<string, number>(),
      danceModeCounts: new Map<string, number>(),
      valenceModeCounts: new Map<string, number>(),
      moodModeCounts: new Map<string, number>(),
      keyCounts: new Map<string, number>(),
      decadeCounts: new Map<string, number>(),
    });

    const updateRange = (bucket: { [k: string]: any }, minKey: string, maxKey: string, value: number) => {
      if (bucket[minKey] == null || value < bucket[minKey]) bucket[minKey] = value;
      if (bucket[maxKey] == null || value > bucket[maxKey]) bucket[maxKey] = value;
    };

    const bumpMode = (m: Map<string, number>, value: number, digits: number) => {
      const k = value.toFixed(digits);
      m.set(k, (m.get(k) ?? 0) + 1);
    };

    const keepBucket = buildFeatureBucket();
    const removeBucket = buildFeatureBucket();

    for (const row of featureRows) {
      const target = Number(row.keep_in_library) === 1 ? keepBucket : removeBucket;
      target.trackCount += 1;

      if (row.bpm != null) {
        const n = Number(row.bpm);
        if (Number.isFinite(n)) {
          target.bpmSum += n;
          target.bpmCount += 1;
          updateRange(target, "bpmMin", "bpmMax", n);
          bumpMode(target.bpmModeCounts, n, 1);
        }
      }
      if (row.energy != null) {
        const n = Number(row.energy);
        if (Number.isFinite(n)) {
          target.energySum += n;
          target.energyCount += 1;
          updateRange(target, "energyMin", "energyMax", n);
          bumpMode(target.energyModeCounts, n, 3);
        }
      }
      if (row.dance != null) {
        const n = Number(row.dance);
        if (Number.isFinite(n)) {
          target.danceSum += n;
          target.danceCount += 1;
          updateRange(target, "danceMin", "danceMax", n);
          bumpMode(target.danceModeCounts, n, 3);
        }
      }
      if (row.valence != null) {
        const n = Number(row.valence);
        if (Number.isFinite(n)) {
          target.valenceSum += n;
          target.valenceCount += 1;
          updateRange(target, "valenceMin", "valenceMax", n);
          bumpMode(target.valenceModeCounts, n, 3);
        }
      }

      const energy = Number(row.energy);
      const dance = Number(row.dance);
      const valence = Number(row.valence);
      if (Number.isFinite(energy) && Number.isFinite(dance) && Number.isFinite(valence)) {
        const mood = energy + dance + valence;
        target.moodSum += mood;
        target.moodCount += 1;
        updateRange(target, "moodMin", "moodMax", mood);
        bumpMode(target.moodModeCounts, mood, 3);
      }

      const key = String(row.camelot ?? "").trim();
      if (key) {
        target.keyCounts.set(key, (target.keyCounts.get(key) ?? 0) + 1);
      }

      const year = Number(row.album_year);
      if (Number.isFinite(year) && year >= 1900 && year <= 2099) {
        const decade = `${Math.floor(year / 10) * 10}s`;
        target.decadeCounts.set(decade, (target.decadeCounts.get(decade) ?? 0) + 1);
      }
    }

    const topEntry = (m: Map<string, number>): string | null => {
      let bestKey: string | null = null;
      let bestCount = -1;
      m.forEach((c, k) => {
        if (c > bestCount) {
          bestKey = k;
          bestCount = c;
        }
      });
      return bestKey;
    };

    const avg = (sum: number, count: number): number | null => {
      if (!count) return null;
      return Number((sum / count).toFixed(3));
    };

    const numericMode = (m: Map<string, number>): number | null => {
      let bestValue: number | null = null;
      let bestCount = -1;
      m.forEach((count, key) => {
        if (count > bestCount) {
          bestCount = count;
          bestValue = Number(key);
        }
      });
      return bestValue;
    };

    const asRange = (min: number | null, max: number | null): { min: number | null; max: number | null } => ({ min, max });

    const featureSummaryKeepRemove = {
      keep: {
        trackCount: keepBucket.trackCount,
        bpm: avg(keepBucket.bpmSum, keepBucket.bpmCount),
        bpmMode: numericMode(keepBucket.bpmModeCounts),
        bpmRange: asRange(keepBucket.bpmMin, keepBucket.bpmMax),
        energy: avg(keepBucket.energySum, keepBucket.energyCount),
        energyMode: numericMode(keepBucket.energyModeCounts),
        energyRange: asRange(keepBucket.energyMin, keepBucket.energyMax),
        dance: avg(keepBucket.danceSum, keepBucket.danceCount),
        danceMode: numericMode(keepBucket.danceModeCounts),
        danceRange: asRange(keepBucket.danceMin, keepBucket.danceMax),
        valence: avg(keepBucket.valenceSum, keepBucket.valenceCount),
        valenceMode: numericMode(keepBucket.valenceModeCounts),
        valenceRange: asRange(keepBucket.valenceMin, keepBucket.valenceMax),
        moodScore: avg(keepBucket.moodSum, keepBucket.moodCount),
        moodMode: numericMode(keepBucket.moodModeCounts),
        moodRange: asRange(keepBucket.moodMin, keepBucket.moodMax),
        topKey: topEntry(keepBucket.keyCounts),
        topDecade: topEntry(keepBucket.decadeCounts),
      },
      remove: {
        trackCount: removeBucket.trackCount,
        bpm: avg(removeBucket.bpmSum, removeBucket.bpmCount),
        bpmMode: numericMode(removeBucket.bpmModeCounts),
        bpmRange: asRange(removeBucket.bpmMin, removeBucket.bpmMax),
        energy: avg(removeBucket.energySum, removeBucket.energyCount),
        energyMode: numericMode(removeBucket.energyModeCounts),
        energyRange: asRange(removeBucket.energyMin, removeBucket.energyMax),
        dance: avg(removeBucket.danceSum, removeBucket.danceCount),
        danceMode: numericMode(removeBucket.danceModeCounts),
        danceRange: asRange(removeBucket.danceMin, removeBucket.danceMax),
        valence: avg(removeBucket.valenceSum, removeBucket.valenceCount),
        valenceMode: numericMode(removeBucket.valenceModeCounts),
        valenceRange: asRange(removeBucket.valenceMin, removeBucket.valenceMax),
        moodScore: avg(removeBucket.moodSum, removeBucket.moodCount),
        moodMode: numericMode(removeBucket.moodModeCounts),
        moodRange: asRange(removeBucket.moodMin, removeBucket.moodMax),
        topKey: topEntry(removeBucket.keyCounts),
        topDecade: topEntry(removeBucket.decadeCounts),
      },
    };

    // Album-year decade distribution from imported track features.
    const decadeRows = sqlite
      .prepare(`
        SELECT CAST(tf.album_year / 10 AS INTEGER) * 10 AS decade_start, COUNT(*) c
        FROM track_features tf
        JOIN tracks t ON t.id = tf.track_id
        WHERE tf.album_year IS NOT NULL
          AND tf.album_year BETWEEN 1900 AND 2099
          AND (
            SELECT l2.keep_in_library
            FROM listens l2
            WHERE l2.track_id = t.id
            ORDER BY l2.logged_at DESC, l2.id DESC
            LIMIT 1
          ) = 1
        GROUP BY CAST(tf.album_year / 10 AS INTEGER) * 10
        ORDER BY decade_start ASC
      `)
      .all() as any[];
    const decadeDistribution = decadeRows.map((r) => ({
      decade: `${Number(r.decade_start)}s`,
      count: Number(r.c ?? 0),
    }));

    // Want-vs-would comparison from latest keep=1 decision per track.
    const wantWould = sqlite
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN latest.want_again = 1 THEN 1 ELSE 0 END), 0) AS want_yes,
          COALESCE(SUM(CASE WHEN latest.want_again = 0 THEN 1 ELSE 0 END), 0) AS want_no,
          COALESCE(SUM(CASE WHEN latest.would_again = 1 THEN 1 ELSE 0 END), 0) AS would_yes,
          COALESCE(SUM(CASE WHEN latest.would_again = 0 THEN 1 ELSE 0 END), 0) AS would_no
        FROM (
          SELECT l.want_again, l.would_again, l.keep_in_library
          FROM listens l
          WHERE l.id = (
            SELECT l2.id
            FROM listens l2
            WHERE l2.track_id = l.track_id
            ORDER BY l2.logged_at DESC, l2.id DESC
            LIMIT 1
          )
            AND l.keep_in_library = 1
        ) latest
      `)
      .get() as any;
    const wantWouldComparison = {
      wantYes: Number(wantWould.want_yes ?? 0),
      wantNo: Number(wantWould.want_no ?? 0),
      wouldYes: Number(wantWould.would_yes ?? 0),
      wouldNo: Number(wantWould.would_no ?? 0),
    };

    // Recent 10 logs.
    const recent = this.listListens({ limit: 10 });

    return {
      totals: { tracks: tracksTotal, totalListens, actualListens, uniqueTracksLogged },
      listensByDay,
      topTracks,
      activityBreakdown,
      keepRemoveRatio,
      featureSummaryKeepRemove,
      decadeDistribution,
      wantWouldComparison,
      recent,
    };
  }
}

export const storage = new DatabaseStorage();
