import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type DecisionSnapshot = {
  trackId: string;
  name: string;
  artists: string;
  keepInLibrary: 0 | 1;
  repeatIntent: string;
  loggedAt: number;
};

type DecisionSnapshotFile = {
  exportedAt: number;
  sourceDbPath: string;
  count: number;
  decisions: DecisionSnapshot[];
};

type MissingRow = {
  user: string;
  trackId: string;
  name: string;
  artists: string;
  repeatIntent: string;
  keepInLibrary: 0 | 1;
  loggedAt: number;
};

const REPO_ROOT = process.cwd();
const DB_PATH_OVERRIDE_RAW = String(process.env.WAX_AUDIT_DB_PATH || "").trim();
const DB_PATH_OVERRIDE = DB_PATH_OVERRIDE_RAW ? path.resolve(REPO_ROOT, DB_PATH_OVERRIDE_RAW) : "";
const USERS = String(process.env.WAX_USERS || "kasey,kaseysmom,kaseysdad")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const OUT_DETAIL_PATH = path.resolve(
  REPO_ROOT,
  process.env.WAX_MISSING_DECISIONS_OUT || path.join("outputs", "missing-decision-tracks.csv"),
);

const OUT_IMPORT_PATH = path.resolve(
  REPO_ROOT,
  process.env.WAX_MISSING_MUSICLIB_OUT || path.join("outputs", "missing-tracks-for-music-library.csv"),
);

function dbPathForUser(user: string): string {
  if (DB_PATH_OVERRIDE) return DB_PATH_OVERRIDE;
  return path.resolve(REPO_ROOT, "users", user, "music_library.db");
}

function normalizeRepeatIntent(v: unknown): string {
  const s = String(v ?? "undecided").trim().toLowerCase();
  if (s === "skip") return "skip_for_now";
  return s || "undecided";
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(filePath: string, header: string[], lines: Array<Array<string | number | null | undefined>>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = [header.join(","), ...lines.map((line) => line.map(escapeCsv).join(","))].join("\n");
  fs.writeFileSync(filePath, `${content}\n`, "utf8");
}

function loadSnapshot(user: string): DecisionSnapshot[] {
  const snapshotPath = path.join(REPO_ROOT, "users", user, "decisions-latest.json");
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found for '${user}': ${snapshotPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as Partial<DecisionSnapshotFile>;
  const rawRows = Array.isArray(parsed.decisions) ? parsed.decisions : [];

  return rawRows
    .map((row) => {
      const trackId = String((row as any)?.trackId ?? "").trim();
      if (!trackId) return null;
      return {
        trackId,
        name: String((row as any)?.name ?? "").trim(),
        artists: String((row as any)?.artists ?? "").trim(),
        keepInLibrary: Number((row as any)?.keepInLibrary) === 0 ? 0 : 1,
        repeatIntent: normalizeRepeatIntent((row as any)?.repeatIntent),
        loggedAt: Number((row as any)?.loggedAt) || 0,
      } as DecisionSnapshot;
    })
    .filter((row): row is DecisionSnapshot => Boolean(row));
}

function main() {
  if (USERS.length === 0) {
    throw new Error("No users specified. Set WAX_USERS.");
  }
  const missingRows: MissingRow[] = [];

  for (const user of USERS) {
    const dbPath = dbPathForUser(user);
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Audit DB not found for '${user}': ${dbPath}`);
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const hasTrackStmt = db.prepare(`SELECT id FROM tracks WHERE TRIM(id) = TRIM(?) LIMIT 1`);
      const decisions = loadSnapshot(user);
      let userMissing = 0;

      for (const row of decisions) {
        const found = hasTrackStmt.get(row.trackId) as { id: string } | undefined;
        if (!found?.id) {
          missingRows.push({
            user,
            trackId: row.trackId,
            name: row.name,
            artists: row.artists,
            repeatIntent: row.repeatIntent,
            keepInLibrary: row.keepInLibrary,
            loggedAt: row.loggedAt,
          });
          userMissing += 1;
        }
      }

      console.log(`[decisions:export-missing] user=${user} db=${dbPath} missing=${userMissing}`);
    } finally {
      db.close();
    }
  }

  missingRows.sort((a, b) => {
    if (a.user !== b.user) return a.user.localeCompare(b.user);
    if (a.repeatIntent !== b.repeatIntent) return a.repeatIntent.localeCompare(b.repeatIntent);
    return a.trackId.localeCompare(b.trackId);
  });

  const detailLines = missingRows.map((r) => [
    r.user,
    r.trackId,
    r.name,
    r.artists,
    r.repeatIntent,
    String(r.keepInLibrary),
    r.loggedAt ? new Date(r.loggedAt).toISOString() : "",
    r.loggedAt,
    `https://open.spotify.com/track/${r.trackId}`,
  ]);

  writeCsv(
    OUT_DETAIL_PATH,
    [
      "user",
      "track_id",
      "name",
      "artists",
      "repeat_intent",
      "keep_in_library",
      "logged_at_iso",
      "logged_at_unix_ms",
      "spotify_url",
    ],
    detailLines,
  );

  const uniqueByTrack = new Map<string, MissingRow>();
  for (const row of missingRows) {
    const existing = uniqueByTrack.get(row.trackId);
    if (!existing || row.loggedAt > existing.loggedAt) {
      uniqueByTrack.set(row.trackId, row);
    }
  }

  const importRows = [...uniqueByTrack.values()].sort((a, b) => a.trackId.localeCompare(b.trackId));
  const importLines = importRows.map((r) => [
    r.trackId,
    r.name,
    r.artists,
    r.user,
    r.repeatIntent,
    r.keepInLibrary,
    r.loggedAt ? new Date(r.loggedAt).toISOString() : "",
    `https://open.spotify.com/track/${r.trackId}`,
  ]);

  writeCsv(
    OUT_IMPORT_PATH,
    [
      "Track_ID",
      "Song",
      "Artist",
      "Source_User",
      "Source_Repeat_Intent",
      "Source_Keep_In_Library",
      "Source_Logged_At",
      "Track_URL",
    ],
    importLines,
  );

  console.log(`[decisions:export-missing] wrote detail CSV: ${OUT_DETAIL_PATH}`);
  console.log(`[decisions:export-missing] wrote import-ready CSV: ${OUT_IMPORT_PATH}`);
  console.log(`[decisions:export-missing] detail_rows=${missingRows.length} unique_track_ids=${importRows.length}`);
}

main();
