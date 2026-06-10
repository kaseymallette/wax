import { tracks, listens } from "@shared/schema";
import type {
  Track,
  TrackImport,
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

// 2) Add the sticky `era` column to tracks if missing.
const trackCols = sqlite.prepare(`PRAGMA table_info(tracks)`).all() as { name: string }[];
if (!trackCols.some((c) => c.name === "era")) {
  sqlite.exec(`ALTER TABLE tracks ADD COLUMN era TEXT;`);
}

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
    era: r.era ?? null,
    listenCount: Number(r.listen_count ?? 0),
    actualListenCount: Number(r.actual_listen_count ?? 0),
    lastListenedAt: r.last_listened_at ?? null,
    wouldAgainCount: Number(r.would_again_count ?? 0),
    wouldNotAgainCount: Number(r.would_not_again_count ?? 0),
  };
}

function rowToListenWithTrack(r: any): ListenWithTrack {
  return {
    id: r.id,
    trackId: r.track_id,
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
    era: r.era ?? null,
  };
}

export interface IStorage {
  importTracks(items: TrackImport[]): { imported: number; total: number };
  listTracks(opts: { status?: string; q?: string; sort?: string }): TrackWithStats[];
  getRandomTrack(status: string): TrackWithStats | undefined;
  getTrack(id: string): TrackWithStats | undefined;
  setEra(id: string, era: string): TrackWithStats | undefined;
  addListen(payload: ListenPayload): { listen: Listen; track: TrackWithStats } | { error: string };
  listListens(opts: {
    trackId?: string;
    activity?: string[];
    era?: string[];
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
}

// Aggregate listen stats joined onto tracks.
const TRACK_AGG_SELECT = `
  SELECT t.*,
    COUNT(l.id) AS listen_count,
    COALESCE(SUM(l.listened), 0) AS actual_listen_count,
    MAX(l.logged_at) AS last_listened_at,
    COALESCE(SUM(l.would_again), 0) AS would_again_count,
    COALESCE(SUM(CASE WHEN l.would_again = 0 THEN 1 ELSE 0 END), 0) AS would_not_again_count
  FROM tracks t
  LEFT JOIN listens l ON l.track_id = t.id
`;

const LISTEN_JOIN_SELECT = `
  SELECT l.id, l.track_id, l.listened, l.want_again, l.would_again, l.keep_in_library, l.activity, l.notes, l.logged_at,
         t.name, t.artists, t.album, t.album_art_url, t.spotify_url, t.preview_url, t.era
  FROM listens l
  JOIN tracks t ON t.id = l.track_id
`;

export class DatabaseStorage implements IStorage {
  private importStmt = sqlite.prepare(`
    INSERT INTO tracks (id, name, artists, album, album_art_url, duration_ms, added_at, spotify_url, preview_url, imported_at)
    VALUES (@id, @name, @artists, @album, @albumArtUrl, @durationMs, @addedAt, @spotifyUrl, @previewUrl, @importedAt)
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

  importTracks(items: TrackImport[]): { imported: number; total: number } {
    const now = Date.now();
    const tx = sqlite.transaction((rows: TrackImport[]) => {
      for (const it of rows) {
        const id = it.id;
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
        });
      }
    });
    tx(items);
    const total = this.trackCount();
    return { imported: items.length, total };
  }

  listTracks(opts: { status?: string; q?: string; sort?: string }): TrackWithStats[] {
    const status = opts.status || "all";
    const q = opts.q || "";
    const sort = opts.sort || "added";
    const having: string[] = [];
    const where: string[] = [];
    const params: any = {};

    if (q && q.trim()) {
      where.push("(LOWER(t.name) LIKE @q OR LOWER(t.artists) LIKE @q OR LOWER(t.album) LIKE @q)");
      params.q = `%${q.toLowerCase()}%`;
    }
    if (status === "logged") having.push("listen_count > 0");
    else if (status === "unlogged") having.push("listen_count = 0");

    let orderBy = "t.imported_at DESC, t.name COLLATE NOCASE ASC";
    if (sort === "listens") orderBy = "listen_count DESC, t.name COLLATE NOCASE ASC";
    else if (sort === "last") orderBy = "last_listened_at DESC NULLS LAST, t.name COLLATE NOCASE ASC";
    else if (sort === "name") orderBy = "t.name COLLATE NOCASE ASC";

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const havingClause = having.length ? `HAVING ${having.join(" AND ")}` : "";
    const rows = sqlite
      .prepare(`${TRACK_AGG_SELECT} ${whereClause} GROUP BY t.id ${havingClause} ORDER BY ${orderBy}`)
      .all(params) as any[];
    return rows.map(rowToTrackWithStats);
  }

  getRandomTrack(status: string): TrackWithStats | undefined {
    // Prefer tracks the user hasn't logged. Default behavior driven by `status`.
    let havingClause = "HAVING listen_count = 0";
    let orderBy = "RANDOM()";
    if (status === "all") {
      havingClause = "";
      // Bias toward least-recently / least-logged tracks, then random.
      orderBy = "last_listened_at ASC NULLS FIRST, RANDOM()";
    }
    const row = sqlite
      .prepare(`${TRACK_AGG_SELECT} GROUP BY t.id ${havingClause} ORDER BY ${orderBy} LIMIT 1`)
      .get() as any;
    return row ? rowToTrackWithStats(row) : undefined;
  }

  getTrack(id: string): TrackWithStats | undefined {
    const row = sqlite
      .prepare(`${TRACK_AGG_SELECT} WHERE t.id = ? GROUP BY t.id`)
      .get(id) as any;
    return row ? rowToTrackWithStats(row) : undefined;
  }

  setEra(id: string, era: string): TrackWithStats | undefined {
    sqlite.prepare(`UPDATE tracks SET era = ? WHERE id = ?`).run(era, id);
    return this.getTrack(id);
  }

  addListen(payload: ListenPayload) {
    const track = sqlite.prepare(`SELECT * FROM tracks WHERE id = ?`).get(payload.trackId) as any;
    if (!track) return { error: "Track not found" } as const;

    const currentEra = track.era ?? null;
    const providedEra = payload.era ?? null;
    if (!currentEra) {
      if (!providedEra) {
        return { error: "Era required for first log" } as const;
      }
      sqlite.prepare(`UPDATE tracks SET era = ? WHERE id = ?`).run(providedEra, payload.trackId);
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
    era?: string[];
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
    if (opts.era && opts.era.length) {
      where.push(`t.era IN (${opts.era.map(() => "?").join(",")})`);
      params.push(...opts.era);
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

    // Would-again ratio.
    const yes = (sqlite.prepare("SELECT COALESCE(SUM(would_again),0) c FROM listens").get() as any).c;
    const no = totalListens - yes;
    const wouldAgainRatio = { yes, no };

    // Era distribution (includes "unset").
    const eraRows = sqlite
      .prepare("SELECT COALESCE(era, 'unset') era, COUNT(*) c FROM tracks GROUP BY COALESCE(era, 'unset')")
      .all() as any[];
    const eraDistribution = eraRows
      .map((r) => ({ era: r.era, count: Number(r.c) }))
      .sort((a, b) => b.count - a.count);

    // Recent 10 logs.
    const recent = this.listListens({ limit: 10 });

    return {
      totals: { tracks: tracksTotal, totalListens, actualListens, uniqueTracksLogged },
      listensByDay,
      topTracks,
      activityBreakdown,
      wouldAgainRatio,
      eraDistribution,
      recent,
    };
  }
}

export const storage = new DatabaseStorage();
