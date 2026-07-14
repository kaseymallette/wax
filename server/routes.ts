import type { Express, Request } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import multer from "multer";
import Database from "better-sqlite3";
import { storage } from "./storage";
import { buildDailyPlaylists } from "./dailyPlaylists";
import {
  listenPayloadSchema,
  repeatIntentUpdateSchema,
  trackImportSchema,
  featureImportRowSchema,
  type FeatureImportRow,
} from "@shared/schema";
import { z } from "zod";

const UPLOAD_DIR = path.join(os.tmpdir(), "wax-uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const WAX_USER = (process.env.WAX_USER ?? "kasey").trim() || "kasey";
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
type Weekday = (typeof WEEKDAYS)[number];
const WEEKDAY_SET = new Set<Weekday>(WEEKDAYS);
const WEEKDAY_MAP_PATH = path.resolve(
  process.cwd(),
  path.join("users", WAX_USER, "playlists", "weekday-map.json"),
);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB
});

// In-memory registry of uploaded DB files (token -> path)
const uploadedFiles = new Map<string, { path: string; expires: number }>();

function normalizeWeekdayMap(input: unknown): Record<string, Weekday> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, Weekday> = {};
  for (const [rawIndex, rawDay] of Object.entries(input as Record<string, unknown>)) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 1 || index > 7) continue;
    if (typeof rawDay !== "string") continue;
    if (!WEEKDAY_SET.has(rawDay as Weekday)) continue;
    out[String(index)] = rawDay as Weekday;
  }
  return out;
}

function readWeekdayMap(): Record<string, Weekday> {
  try {
    if (!fs.existsSync(WEEKDAY_MAP_PATH)) return {};
    const raw = fs.readFileSync(WEEKDAY_MAP_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeWeekdayMap(parsed);
  } catch {
    return {};
  }
}

function writeWeekdayMap(mapping: Record<string, Weekday>): void {
  fs.mkdirSync(path.dirname(WEEKDAY_MAP_PATH), { recursive: true });
  fs.writeFileSync(WEEKDAY_MAP_PATH, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
}

function cleanupExpired() {
  const now = Date.now();
  uploadedFiles.forEach((info, token) => {
    if (info.expires < now) {
      fs.promises.unlink(info.path).catch(() => {});
      uploadedFiles.delete(token);
    }
  });
}
setInterval(cleanupExpired, 60_000).unref();

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // --- Upload a SQLite file and inspect its schema ---
  app.post("/api/upload", upload.single("file"), (req: Request, res) => {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    let probe: Database.Database | null = null;
    try {
      probe = new Database(file.path, { readonly: true, fileMustExist: true });
      const tablesRaw = probe
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[];

      const tables = tablesRaw.map((t) => {
        const cols = probe!
          .prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`)
          .all() as { name: string }[];
        let rowCount = 0;
        try {
          const c = probe!
            .prepare(`SELECT COUNT(*) AS c FROM "${t.name.replace(/"/g, '""')}"`)
            .get() as any;
          rowCount = c.c;
        } catch {}
        return { name: t.name, columns: cols.map((c) => c.name), rowCount };
      });

      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      uploadedFiles.set(token, {
        path: file.path,
        expires: Date.now() + 30 * 60_000, // 30 min
      });
      cleanupExpired();

      res.json({ token, tables });
    } catch (e: any) {
      if (probe) try { probe.close(); } catch {}
      fs.promises.unlink(file.path).catch(() => {});
      res.status(400).json({
        error:
          "Could not open that file as a SQLite database. Make sure it is a valid .db or .sqlite file.",
      });
      return;
    } finally {
      if (probe) try { probe.close(); } catch {}
    }
  });

  // --- Preview a few rows from a chosen table given a column mapping ---
  const previewSchema = z.object({
    token: z.string(),
    table: z.string(),
    mapping: z.record(z.string().nullable()),
  });

  app.post("/api/upload/preview", (req, res) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
    const { token, table } = parsed.data;
    const info = uploadedFiles.get(token);
    if (!info) return res.status(404).json({ error: "Upload expired. Please re-upload." });

    let probe: Database.Database | null = null;
    try {
      probe = new Database(info.path, { readonly: true, fileMustExist: true });
      const safeTable = table.replace(/"/g, '""');
      const total = (probe.prepare(`SELECT COUNT(*) c FROM "${safeTable}"`).get() as any).c;
      const rows = probe.prepare(`SELECT * FROM "${safeTable}" LIMIT 5`).all();
      res.json({ total, rows });
    } catch (e: any) {
      res.status(400).json({ error: "Could not read that table." });
    } finally {
      if (probe) try { probe.close(); } catch {}
    }
  });

  // --- Import using a token + table + column mapping (chunked) ---
  const importSchema = z.object({
    token: z.string(),
    table: z.string(),
    mapping: z.object({
      id: z.string(), // REQUIRED
      name: z.string().nullable().optional(),
      artists: z.string().nullable().optional(),
      album: z.string().nullable().optional(),
      albumArtUrl: z.string().nullable().optional(),
      durationMs: z.string().nullable().optional(),
      addedAt: z.string().nullable().optional(),
      spotifyUrl: z.string().nullable().optional(),
      previewUrl: z.string().nullable().optional(),
    }),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(2000).default(500),
  });

  // Minimal RFC-4180 CSV parser (handles quoted fields, escaped quotes, commas/newlines in quotes).
  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let field = "";
    let row: string[] = [];
    let i = 0;
    let inQuotes = false;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    // flush last field/row if file doesn't end with newline
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  // Extract the bare Spotify track ID from a value (handles spotify:track:ID and URLs).
  function extractId(v: any): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    let m = s.match(/spotify:track:([A-Za-z0-9]+)/);
    if (m) return m[1];
    m = s.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
    if (m) return m[1];
    return s;
  }

  function num(v: any): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function toFeatureNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function parseFeatureYear(v: unknown): number | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const m = s.match(/(19|20)\d{2}/);
    if (!m) return null;
    const y = Number(m[0]);
    return Number.isFinite(y) ? y : null;
  }

  function parseFeatureCsvRows(rows: string[][], source: string): { items: FeatureImportRow[]; skipped: number } {
    if (rows.length <= 1) {
      throw new Error("Feature CSV is empty or unparseable.");
    }

    const header = rows[0].map((h) => h.trim());
    const idx = (...names: string[]) => {
      for (const n of names) {
        const i = header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
        if (i !== -1) return i;
      }
      return -1;
    };

    const iTrackId = idx("Spotify Track Id", "Track Id", "track_id", "id", "Track URI");
    const iSong = idx("Song", "Track Name", "Title", "name", "song_name");
    const iArtist = idx("Artist", "Artists", "Artist Name", "Artist Name(s)", "artists");
    const iAlbum = idx("Album", "Album Name");
    const iBpm = idx("BPM", "Tempo", "bpm");
    const iCamelot = idx("Camelot", "Key", "camelot", "key");
    const iEnergy = idx("Energy", "energy");
    const iDance = idx("Dance", "Danceability", "dance", "danceability");
    const iValence = idx("Valence", "valence");
    const iPopularity = idx("Popularity", "popularity");
    const iAlbumDate = idx("Album Date", "album_date", "Release Date", "release_date", "Year", "year");

    if (iSong === -1 || iArtist === -1) {
      throw new Error("Feature CSV must include Song and Artist columns.");
    }
    if (iBpm === -1 || iEnergy === -1 || iDance === -1 || iValence === -1) {
      throw new Error("Feature CSV must include BPM, Energy, Dance, and Valence columns.");
    }

    const items: FeatureImportRow[] = [];
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0 || (r.length === 1 && !r[0])) continue;

      const parsed = featureImportRowSchema.safeParse({
        trackId: iTrackId !== -1 ? extractId(r[iTrackId]) ?? undefined : undefined,
        song: r[iSong] ?? "",
        artist: r[iArtist] ?? "",
        album: iAlbum !== -1 ? (r[iAlbum] ?? "") : "",
        bpm: toFeatureNumber(r[iBpm]),
        camelot: iCamelot !== -1 ? (r[iCamelot] || null) : null,
        energy: toFeatureNumber(r[iEnergy]),
        dance: toFeatureNumber(r[iDance]),
        valence: toFeatureNumber(r[iValence]),
        popularity: iPopularity !== -1 ? toFeatureNumber(r[iPopularity]) : null,
        albumYear: iAlbumDate !== -1 ? parseFeatureYear(r[iAlbumDate]) : null,
        source,
      });

      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      items.push(parsed.data);
    }

    return { items, skipped };
  }

  type DefaultFeatureImportTotals = {
    importedRows: number;
    skipped: number;
    imported: number;
    matchedByTrackId: number;
    matchedByArtistSong: number;
    unmatched: number;
  };

  type DefaultFeatureImportSource = {
    source: string;
    importedRows: number;
    skipped: number;
    imported: number;
  };

  function importDefaultFeatureSources(): {
    totals: DefaultFeatureImportTotals;
    sources: DefaultFeatureImportSource[];
    errors: string[];
  } {
    const totals: DefaultFeatureImportTotals = {
      importedRows: 0,
      skipped: 0,
      imported: 0,
      matchedByTrackId: 0,
      matchedByArtistSong: 0,
      unmatched: 0,
    };

    const sources: DefaultFeatureImportSource[] = [];
    const errors: string[] = [];

    const addSummary = (label: string, importedRows: number, skipped: number, summary: {
      imported: number;
      matchedByTrackId: number;
      matchedByArtistSong: number;
      unmatched: number;
    }) => {
      totals.importedRows += importedRows;
      totals.skipped += skipped;
      totals.imported += summary.imported;
      totals.matchedByTrackId += summary.matchedByTrackId;
      totals.matchedByArtistSong += summary.matchedByArtistSong;
      totals.unmatched += summary.unmatched;
      sources.push({ source: label, importedRows, skipped, imported: summary.imported });
    };

    let sourceDb: Database.Database | null = null;
    try {
      const dbPath = path.resolve(process.cwd(), "data", "music-library", "spotify_music_library.db");
      if (fs.existsSync(dbPath)) {
        sourceDb = new Database(dbPath, { readonly: true, fileMustExist: true });
        const rows = sourceDb
          .prepare(`
            SELECT
              Track_ID AS trackId,
              Song AS song,
              Artist AS artist,
              Album AS album,
              BPM AS bpm,
              COALESCE(Camelot, Key) AS camelot,
              Energy AS energy,
              Dance AS dance,
              Valence AS valence,
              Popularity AS popularity,
              Album_Year AS albumYear,
              "Album Date" AS albumDate
            FROM tracks
          `)
          .all() as any[];

        const dbItems: FeatureImportRow[] = [];
        let dbSkipped = 0;
        for (const row of rows) {
          const parsed = featureImportRowSchema.safeParse({
            trackId: extractId(row.trackId) ?? undefined,
            song: row.song ?? "",
            artist: row.artist ?? "",
            album: row.album ?? "",
            bpm: toFeatureNumber(row.bpm),
            camelot: row.camelot != null ? String(row.camelot) : null,
            energy: toFeatureNumber(row.energy),
            dance: toFeatureNumber(row.dance),
            valence: toFeatureNumber(row.valence),
            popularity: toFeatureNumber(row.popularity),
            albumYear: parseFeatureYear(row.albumYear ?? row.albumDate),
            source: "spotify_music_library.db",
          });

          if (!parsed.success) {
            dbSkipped += 1;
            continue;
          }
          dbItems.push(parsed.data);
        }

        const dbSummary = storage.importFeatureRows(dbItems);
        addSummary("data/music-library/spotify_music_library.db", dbItems.length, dbSkipped, dbSummary);
      }
    } catch (e: any) {
      errors.push(e?.message || "Could not import features from spotify_music_library.db");
    } finally {
      if (sourceDb) {
        try { sourceDb.close(); } catch {}
      }
    }

    const defaultCsvs = ["Vinyl.csv", "new_new_red_car.csv"];
    for (const fileName of defaultCsvs) {
      const csvPath = path.resolve(process.cwd(), "data", "music-library", fileName);
      if (!fs.existsSync(csvPath)) continue;

      try {
        const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
        const rows = parseCsv(raw);
        const { items, skipped } = parseFeatureCsvRows(rows, fileName);
        const summary = storage.importFeatureRows(items);
        addSummary(`data/music-library/${fileName}`, items.length, skipped, summary);
      } catch (e: any) {
        errors.push(e?.message || `Could not import features from ${fileName}`);
      }
    }

    return { totals, sources, errors };
  }

  app.post("/api/import", (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid mapping. track_id is required." });
    }
    const { token, table, mapping, offset, limit } = parsed.data;
    const info = uploadedFiles.get(token);
    if (!info) return res.status(404).json({ error: "Upload expired. Please re-upload." });

    let probe: Database.Database | null = null;
    try {
      probe = new Database(info.path, { readonly: true, fileMustExist: true });
      const safeTable = table.replace(/"/g, '""');
      const total = (probe.prepare(`SELECT COUNT(*) c FROM "${safeTable}"`).get() as any).c;
      const rows = probe
        .prepare(`SELECT * FROM "${safeTable}" LIMIT ? OFFSET ?`)
        .all(limit, offset) as any[];

      const get = (row: any, col: string | null | undefined) =>
        col ? row[col] : undefined;

      const items = [];
      let skipped = 0;
      for (const row of rows) {
        const id = extractId(get(row, mapping.id));
        if (!id) {
          skipped++;
          continue;
        }
        const nameRaw = get(row, mapping.name);
        const artistsRaw = get(row, mapping.artists);
        const parsedItem = trackImportSchema.safeParse({
          id,
          name: nameRaw != null && String(nameRaw).trim() ? String(nameRaw) : "Unknown track",
          artists: artistsRaw != null ? String(artistsRaw) : "",
          album: get(row, mapping.album) != null ? String(get(row, mapping.album)) : "",
          albumArtUrl: get(row, mapping.albumArtUrl) != null ? String(get(row, mapping.albumArtUrl)) : null,
          durationMs: num(get(row, mapping.durationMs)),
          addedAt: get(row, mapping.addedAt) != null ? String(get(row, mapping.addedAt)) : null,
          spotifyUrl: get(row, mapping.spotifyUrl) != null
            ? String(get(row, mapping.spotifyUrl))
            : `https://open.spotify.com/track/${id}`,
          previewUrl: get(row, mapping.previewUrl) != null ? String(get(row, mapping.previewUrl)) : null,
        });
        if (parsedItem.success) items.push(parsedItem.data);
        else skipped++;
      }

      storage.importTracks(items);
      const nextOffset = offset + rows.length;
      const done = nextOffset >= total;
      const autoFeatureImport = done ? importDefaultFeatureSources() : null;

      // Auto-delete the temp file after the final chunk.
      if (done) {
        try { probe.close(); } catch {}
        probe = null;
        fs.promises.unlink(info.path).catch(() => {});
        uploadedFiles.delete(token);
      }

      res.json({
        imported: items.length,
        skipped,
        processed: nextOffset,
        total,
        done,
        libraryTotal: storage.trackCount(),
        autoFeatureImport:
          autoFeatureImport && autoFeatureImport.sources.length > 0
            ? {
                ok: true,
                source: "combined-defaults",
                sources: autoFeatureImport.sources,
                ...autoFeatureImport.totals,
              }
            : undefined,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Import failed" });
    } finally {
      if (probe) try { probe.close(); } catch {}
    }
  });

  // --- Upload a CSV (Exportify format) and import directly ---
  // No token / no mapper: Exportify columns are well-known. Merge mode by default
  // (existing tracks upsert by Spotify track ID; ratings table is untouched, so
  // your existing verdicts/notes are preserved).
  app.post("/api/upload/csv", upload.single("file"), async (req: Request, res) => {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    try {
      const raw = await fs.promises.readFile(file.path, "utf8");
      // strip UTF-8 BOM if present
      const text = raw.replace(/^\uFEFF/, "");
      const rows = parseCsv(text);
      fs.promises.unlink(file.path).catch(() => {});

      if (rows.length === 0) {
        return res.status(400).json({ error: "CSV is empty or unparseable." });
      }

      const header = rows[0].map((h) => h.trim());
      const idx = (...names: string[]) => {
        for (const n of names) {
          const i = header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
          if (i !== -1) return i;
        }
        return -1;
      };

      const iId       = idx("Track URI", "Spotify Track Id", "Track Id", "track_id", "id");
      const iName     = idx("Song", "Track Name", "Title", "Song Name", "Track", "name", "track_name", "song_name");
      const iArtists  = idx("Artist Name(s)", "Artist Name", "Artists", "Artist", "Performer", "Performers", "artist", "artists");
      const iAlbum    = idx("Album Name", "Album", "album");
      const iArt      = idx("Album Image URL", "Cover URL", "Cover Image", "album_art_url", "image_url", "cover_url");
      const iDuration = idx("Track Duration (ms)", "Duration (ms)", "Duration", "duration_ms", "length_ms");
      const iAdded    = idx("Added At", "Date Added", "added_at", "date_added");
      const iPreview  = idx("Track Preview URL", "Preview URL", "Preview", "preview_url");

      if (iId === -1) {
        return res.status(400).json({
          error:
            "Couldn't find a Track ID column. Expected one of: 'Track URI', 'Spotify Track Id', 'Track Id'. (Exportify CSVs include 'Track URI'.)",
        });
      }

      const beforeCount = storage.trackCount();
      const items = [];
      let skipped = 0;
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length === 0 || (r.length === 1 && !r[0])) continue;
        const id = extractId(r[iId]);
        if (!id) { skipped++; continue; }
        const name = iName !== -1 && r[iName]?.trim() ? r[iName] : "Unknown track";
        const artists = iArtists !== -1 ? (r[iArtists] ?? "") : "";
        const album = iAlbum !== -1 ? (r[iAlbum] ?? "") : "";
        const albumArtUrl = iArt !== -1 && r[iArt]?.trim() ? r[iArt] : null;
        const durationMs = iDuration !== -1 ? num(r[iDuration]) : null;
        const addedAt = iAdded !== -1 && r[iAdded]?.trim() ? r[iAdded] : null;
        const previewUrl = iPreview !== -1 && r[iPreview]?.trim() ? r[iPreview] : null;

        const parsedItem = trackImportSchema.safeParse({
          id, name, artists, album, albumArtUrl, durationMs, addedAt,
          spotifyUrl: `https://open.spotify.com/track/${id}`,
          previewUrl,
        });
        if (parsedItem.success) items.push(parsedItem.data);
        else skipped++;
      }

      storage.importTracks(items);
      const afterCount = storage.trackCount();
      const newTracks = afterCount - beforeCount; // tracks that didn't already exist
      const updated = items.length - newTracks;   // tracks that already existed (metadata refreshed, ratings untouched)
      const autoFeatureImport = importDefaultFeatureSources();

      res.json({
        ok: true,
        format: "csv",
        rowsInFile: rows.length - 1,
        imported: items.length,
        newTracks,
        updated,
        skipped,
        libraryTotal: afterCount,
        autoFeatureImport:
          autoFeatureImport.sources.length > 0
            ? {
                ok: true,
                source: "combined-defaults",
                sources: autoFeatureImport.sources,
                ...autoFeatureImport.totals,
              }
            : undefined,
      });
    } catch (e: any) {
      fs.promises.unlink(file.path).catch(() => {});
      res.status(400).json({ error: e?.message || "Could not parse that CSV." });
    }
  });

  // --- Tracks list with aggregate listen stats joined ---
  app.get("/api/tracks", (req, res) => {
    const status = (req.query.status as string) || "all";
    const q = (req.query.q as string) || "";
    const sort = (req.query.sort as string) || "added";
    const includeFeaturesRaw = String(req.query.includeFeatures ?? "true").toLowerCase();
    const includeFeatures = !(includeFeaturesRaw === "0" || includeFeaturesRaw === "false");
    res.json(storage.listTracks({ status, q, sort, includeFeatures }));
  });

  app.get("/api/tracks/by-ids", (req, res) => {
    const idsRaw = String(req.query.ids ?? "");
    const ids = idsRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const includeFeaturesRaw = String(req.query.includeFeatures ?? "true").toLowerCase();
    const includeFeatures = !(includeFeaturesRaw === "0" || includeFeaturesRaw === "false");
    res.json(storage.listTracksByIds(ids, includeFeatures));
  });

  app.get("/api/tracks/random", (req, res) => {
    const status = (req.query.status as string) || "unlogged";
    const keepOnlyRaw = String(req.query.keepOnly ?? "false").toLowerCase();
    const keepOnly = keepOnlyRaw === "1" || keepOnlyRaw === "true";
    const includeFeaturesRaw = String(req.query.includeFeatures ?? "true").toLowerCase();
    const includeFeatures = !(includeFeaturesRaw === "0" || includeFeaturesRaw === "false");
    const excludeTrackIds = String(req.query.excludeTrackIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const track = storage.getRandomTrack(status, keepOnly, includeFeatures, excludeTrackIds);
    if (!track) return res.status(404).json({ error: "No tracks" });
    res.json(track);
  });

  app.get("/api/tracks/:id", (req, res) => {
    const track = storage.getTrack(req.params.id);
    if (!track) return res.status(404).json({ error: "Not found" });
    res.json(track);
  });

  // --- Update repeat intent for a track ---
  app.patch("/api/tracks/:id/repeat-intent", (req, res) => {
    const parsed = repeatIntentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid repeat intent" });
    }
    const track = storage.setRepeatIntent(req.params.id, parsed.data.repeatIntent);
    if (track && "error" in track) return res.status(400).json({ error: track.error });
    if (!track) return res.status(404).json({ error: "Track not found" });
    res.json(track);
  });

  // --- Listens ---
  app.post("/api/listens", (req, res) => {
    const parsed = listenPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid listen", details: parsed.error.flatten() });
    }
    const result = storage.addListen(parsed.data);
    if ("error" in result) {
      const code = result.error === "Track not found" ? 404 : 400;
      return res.status(code).json({ error: result.error });
    }
    res.json(result);
  });

  app.get("/api/listens", (req, res) => {
    const q = req.query;
    const splitCsv = (v: any): string[] | undefined => {
      if (v === undefined || v === null || v === "") return undefined;
      const arr = String(v).split(",").map((s) => s.trim()).filter(Boolean);
      return arr.length ? arr : undefined;
    };
    const numOrUndef = (v: any) => {
      if (v === undefined || v === null || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    res.json(
      storage.listListens({
        trackId: (q.trackId as string) || undefined,
        activity: splitCsv(q.activity),
        repeatIntent: splitCsv(q.repeatIntent),
        keepOnly: q.keepOnly === "1" || q.keepOnly === "true",
        from: numOrUndef(q.from),
        to: numOrUndef(q.to),
        listenedOnly: q.listenedOnly === "1" || q.listenedOnly === "true",
        limit: numOrUndef(q.limit),
        offset: numOrUndef(q.offset),
      }),
    );
  });

  app.get("/api/listens/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const listen = storage.getListen(id);
    if (!listen) return res.status(404).json({ error: "Not found" });
    res.json(listen);
  });

  app.delete("/api/listens/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const r = storage.deleteListen(id);
    if (r.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  // --- Clear library ---
  app.delete("/api/library", (req, res) => {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: "Must confirm" });
    }
    storage.clearLibrary();
    res.json({ ok: true });
  });

  // --- Stats ---
  app.get("/api/stats", (_req, res) => {
    res.json(storage.getStats());
  });

  app.get("/api/playlists/daily", (_req, res) => {
    try {
      const keepTracks = storage.listTracks({ status: "keep", sort: "last", q: "" });
      res.json(buildDailyPlaylists(keepTracks));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Could not generate daily playlists." });
    }
  });

  const weekdayMapSchema = z.object({
    mapping: z.record(z.string()),
  });

  app.get("/api/playlists/weekday-map", (_req, res) => {
    res.json({ mapping: readWeekdayMap() });
  });

  app.put("/api/playlists/weekday-map", (req, res) => {
    const parsed = weekdayMapSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid weekday map" });
    }

    const mapping = normalizeWeekdayMap(parsed.data.mapping);
    const assignedDays = Object.values(mapping);
    const hasDuplicateDays = assignedDays.length !== new Set(assignedDays).size;
    if (hasDuplicateDays) {
      return res.status(400).json({ error: "Weekdays must be unique" });
    }

    try {
      writeWeekdayMap(mapping);
      res.json({ ok: true, mapping });
    } catch {
      res.status(500).json({ error: "Could not save weekday map" });
    }
  });

  // --- Export listens as CSV (one row per log entry) ---
  app.get("/api/export", (_req, res) => {
    const rows = storage.listListens({ limit: 500, offset: 0 });
    // listListens caps at 500; page through to capture everything.
    const all = [...rows];
    let offset = rows.length;
    while (true) {
      const more = storage.listListens({ limit: 500, offset });
      if (more.length === 0) break;
      all.push(...more);
      offset += more.length;
      if (more.length < 500) break;
    }
    const headers = [
      "logged_at", "track_id", "name", "artists", "album", "repeat_intent",
      "listened", "want_again", "would_again", "keep_in_library", "activity", "notes", "spotify_url",
    ];
    const esc = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of all) {
      lines.push([
        r.loggedAt ? new Date(r.loggedAt).toISOString() : "",
        r.trackId, r.name, r.artists, r.album, r.repeatIntent,
        r.listened, r.wantAgain, r.wouldAgain, r.keepInLibrary, JSON.stringify(r.activity), r.notes ?? "",
        r.spotifyUrl ?? "",
      ].map(esc).join(","));
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="wax-listens.csv"');
    res.send(lines.join("\n"));
  });

  return httpServer;
}
