import type { Express } from "express";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  buildDailyPlaylists,
  DAILY_PLAYLIST_ORDERING_MODE,
  type DailyPlaylistsResult,
} from "./dailyPlaylists";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
type Weekday = (typeof WEEKDAYS)[number];
const WEEKDAY_SET = new Set<Weekday>(WEEKDAYS);

const STATE_DIR = path.resolve(process.cwd(), "state");
const WEEKDAY_MAP_PATH = path.join(STATE_DIR, "weekday-map.json");
const DAILY_LOCK_PATH = path.join(STATE_DIR, "daily-lock.json");
const DAILY_ORDERING_PATH = path.join(STATE_DIR, "daily-ordering.json");

type DailyOrderingFile = {
  firstTrackByPlaylist: Record<string, string>;
};

type DailyLockFile = {
  lockedAt: number;
  data: DailyPlaylistsResult;
};

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

function normalizeFirstTrackMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [rawIndex, rawTrackId] of Object.entries(input as Record<string, unknown>)) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 1 || index > 7) continue;
    if (typeof rawTrackId !== "string") continue;
    const trackId = rawTrackId.trim();
    if (!trackId) continue;
    out[String(index)] = trackId;
  }
  return out;
}

function readWeekdayMap(): Record<string, Weekday> {
  try {
    if (!fs.existsSync(WEEKDAY_MAP_PATH)) return {};
    const raw = fs.readFileSync(WEEKDAY_MAP_PATH, "utf8");
    return normalizeWeekdayMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeWeekdayMap(mapping: Record<string, Weekday>): void {
  fs.mkdirSync(path.dirname(WEEKDAY_MAP_PATH), { recursive: true });
  fs.writeFileSync(WEEKDAY_MAP_PATH, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
}

function readDailyOrdering(): DailyOrderingFile {
  try {
    if (!fs.existsSync(DAILY_ORDERING_PATH)) return { firstTrackByPlaylist: {} };
    const raw = fs.readFileSync(DAILY_ORDERING_PATH, "utf8");
    const parsed = JSON.parse(raw) as { firstTrackByPlaylist?: unknown; mapping?: unknown };
    return {
      firstTrackByPlaylist: normalizeFirstTrackMap(parsed.firstTrackByPlaylist ?? parsed.mapping),
    };
  } catch {
    return { firstTrackByPlaylist: {} };
  }
}

function writeDailyOrdering(ordering: DailyOrderingFile): void {
  fs.mkdirSync(path.dirname(DAILY_ORDERING_PATH), { recursive: true });
  fs.writeFileSync(DAILY_ORDERING_PATH, `${JSON.stringify(ordering, null, 2)}\n`, "utf8");
}

function readDailyLock(): DailyLockFile | null {
  try {
    if (!fs.existsSync(DAILY_LOCK_PATH)) return null;
    const raw = fs.readFileSync(DAILY_LOCK_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DailyLockFile>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Number.isFinite(parsed.lockedAt)) return null;
    if (!parsed.data || typeof parsed.data !== "object") return null;
    if (!Array.isArray((parsed.data as DailyPlaylistsResult).playlists)) return null;
    return {
      lockedAt: Number(parsed.lockedAt),
      data: parsed.data as DailyPlaylistsResult,
    };
  } catch {
    return null;
  }
}

function writeDailyLock(lock: DailyLockFile): void {
  fs.mkdirSync(path.dirname(DAILY_LOCK_PATH), { recursive: true });
  fs.writeFileSync(DAILY_LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

function removeDailyLock(): void {
  if (fs.existsSync(DAILY_LOCK_PATH)) fs.unlinkSync(DAILY_LOCK_PATH);
}

function buildLiveDailyPlaylists(ordering = readDailyOrdering()): DailyPlaylistsResult {
  // Phase 1 intentionally disconnects V1 persistent library/user DB models.
  // Phase 2 will hydrate playlists from validated profile CSVs.
  return buildDailyPlaylists([], {
    firstTrackByPlaylist: ordering.firstTrackByPlaylist,
  });
}

function buildLockedDailyPlaylists(lockData: DailyPlaylistsResult): DailyPlaylistsResult {
  return {
    playlists: lockData.playlists.map((playlist) => ({
      ...playlist,
      orderingMode: DAILY_PLAYLIST_ORDERING_MODE,
      trackCount: playlist.tracks.length,
    })),
    diagnostics: lockData.diagnostics,
  };
}

export async function registerRoutes(
  _httpServer: Server,
  app: Express,
): Promise<Server> {
  app.get("/api/runtime", (_req, res) => {
    res.json({
      mode: "v2-phase1",
      stateDir: STATE_DIR,
    });
  });

  app.get("/api/playlists/daily", (_req, res) => {
    try {
      const lock = readDailyLock();
      if (lock) {
        const lockedView = buildLockedDailyPlaylists(lock.data);
        return res.json({
          ...lockedView,
          isLocked: true,
          lockedAt: lock.lockedAt,
        });
      }
      const live = buildLiveDailyPlaylists();
      return res.json({
        ...live,
        isLocked: false,
        lockedAt: null,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "Could not generate daily playlists." });
    }
  });

  app.post("/api/playlists/daily-lock", (_req, res) => {
    try {
      const live = buildLiveDailyPlaylists();
      const lock: DailyLockFile = {
        lockedAt: Date.now(),
        data: live,
      };
      writeDailyLock(lock);
      return res.json({
        ok: true,
        ...live,
        isLocked: true,
        lockedAt: lock.lockedAt,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "Could not lock daily playlists." });
    }
  });

  app.delete("/api/playlists/daily-lock", (_req, res) => {
    try {
      removeDailyLock();
      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: "Could not unlock daily playlists." });
    }
  });

  app.post("/api/playlists/daily-recluster", (_req, res) => {
    try {
      const live = buildLiveDailyPlaylists();
      const existingLock = readDailyLock();
      if (existingLock) {
        const nextLock: DailyLockFile = {
          lockedAt: Date.now(),
          data: live,
        };
        writeDailyLock(nextLock);
        return res.json({
          ok: true,
          ...live,
          isLocked: true,
          lockedAt: nextLock.lockedAt,
        });
      }
      return res.json({
        ok: true,
        ...live,
        isLocked: false,
        lockedAt: null,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "Could not recluster daily playlists." });
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
    if (!parsed.success) return res.status(400).json({ error: "Invalid weekday map" });

    const mapping = normalizeWeekdayMap(parsed.data.mapping);
    const assignedDays = Object.values(mapping);
    if (assignedDays.length !== new Set(assignedDays).size) {
      return res.status(400).json({ error: "Weekdays must be unique" });
    }

    try {
      writeWeekdayMap(mapping);
      return res.json({ ok: true, mapping });
    } catch {
      return res.status(500).json({ error: "Could not save weekday map" });
    }
  });

  const dailyOrderingSchema = z.object({
    playlistIndex: z.number().int().min(1).max(7),
    firstTrackId: z.string().trim().min(1).nullable(),
  });
  app.get("/api/playlists/daily-ordering", (_req, res) => {
    const ordering = readDailyOrdering();
    res.json({
      mode: DAILY_PLAYLIST_ORDERING_MODE,
      firstTrackByPlaylist: ordering.firstTrackByPlaylist,
    });
  });
  app.put("/api/playlists/daily-ordering", (req, res) => {
    const parsed = dailyOrderingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid daily ordering payload" });
    }
    const { playlistIndex, firstTrackId } = parsed.data;
    const current = readDailyOrdering();
    const nextFirstTrackByPlaylist = { ...current.firstTrackByPlaylist };
    if (firstTrackId === null) delete nextFirstTrackByPlaylist[String(playlistIndex)];
    else nextFirstTrackByPlaylist[String(playlistIndex)] = firstTrackId;

    const next: DailyOrderingFile = {
      firstTrackByPlaylist: nextFirstTrackByPlaylist,
    };
    try {
      writeDailyOrdering(next);
      return res.json({
        ok: true,
        mode: DAILY_PLAYLIST_ORDERING_MODE,
        firstTrackByPlaylist: next.firstTrackByPlaylist,
      });
    } catch {
      return res.status(500).json({ error: "Could not save daily first track" });
    }
  });

  return _httpServer;
}
