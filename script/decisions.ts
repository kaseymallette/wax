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

const DB_PATH = path.resolve(process.cwd(), process.env.WAX_DB_PATH || "data.db");
const SNAPSHOT_USER = String(process.env.WAX_USER || "default").trim() || "default";
const SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  process.env.WAX_DECISIONS_PATH || path.join("users", SNAPSHOT_USER, "decisions-latest.json"),
);
const IMPORT_NOTE = "[decisions-import]";

function usage(): never {
  console.error("Usage: tsx script/decisions.ts <export|import>");
  process.exit(1);
}

function normalizeRepeatIntent(v: unknown): string {
  const s = String(v ?? "undecided").trim().toLowerCase();
  if (
    s === "undecided" ||
    s === "currently_listening" ||
    s === "favorites_archive" ||
    s === "save_for_later" ||
    s === "skip"
  ) return s;
  return "undecided";
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
    repeatIntent === "currently_listening" ||
    repeatIntent === "favorites_archive"
      ? 1
      : 0;
  return { wantAgain, wouldAgain };
}

function exportDecisions() {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const rows = db
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
          t.id AS trackId,
          t.name AS name,
          t.artists AS artists,
          latest.keep_in_library AS keepInLibrary,
          t.repeat_intent AS repeatIntent,
          latest.logged_at AS loggedAt
        FROM tracks t
        JOIN latest ON latest.track_id = t.id
        ORDER BY latest.logged_at DESC, t.id ASC
      `)
      .all() as Array<{
      trackId: string;
      name: string;
      artists: string;
      keepInLibrary: number;
      repeatIntent: string;
      loggedAt: number;
    }>;

    const decisions: DecisionSnapshot[] = rows.map((r) => ({
      trackId: String(r.trackId).trim(),
      name: r.name ?? "",
      artists: r.artists ?? "",
      keepInLibrary: r.keepInLibrary === 0 ? 0 : 1,
      repeatIntent: normalizeRepeatIntent(r.repeatIntent),
      loggedAt: Number.isFinite(r.loggedAt) ? Number(r.loggedAt) : Date.now(),
    }));

    const payload: DecisionSnapshotFile = {
      exportedAt: Date.now(),
      sourceDbPath: DB_PATH,
      count: decisions.length,
      decisions,
    };

    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Exported ${payload.count} latest track decisions -> ${SNAPSHOT_PATH}`);
  } finally {
    db.close();
  }
}

function importDecisions() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(`Snapshot not found: ${SNAPSHOT_PATH}`);
  }

  const raw = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<DecisionSnapshotFile>;
  const rawDecisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];

  const decisions: DecisionSnapshot[] = rawDecisions
    .map((row) => {
      const trackId = String((row as any)?.trackId ?? "").trim();
      if (!trackId) return null;
      const keepInLibrary: 0 | 1 = Number((row as any)?.keepInLibrary) === 0 ? 0 : 1;
      const repeatIntent = normalizeRepeatIntent((row as any)?.repeatIntent);
      const loggedAtRaw = Number((row as any)?.loggedAt);
      const loggedAt = Number.isFinite(loggedAtRaw) ? loggedAtRaw : Date.now();
      return {
        trackId,
        name: String((row as any)?.name ?? ""),
        artists: String((row as any)?.artists ?? ""),
        keepInLibrary,
        repeatIntent,
        loggedAt,
      } as DecisionSnapshot;
    })
    .filter((d): d is DecisionSnapshot => Boolean(d));

  const db = new Database(DB_PATH);
  try {
    const hasTrackStmt = db.prepare("SELECT id FROM tracks WHERE TRIM(id) = TRIM(?) LIMIT 1");
    const updateIntentStmt = db.prepare("UPDATE tracks SET repeat_intent = ? WHERE TRIM(id) = TRIM(?)");
    const clearImportedListensStmt = db.prepare("DELETE FROM listens WHERE notes = ?");
    const insertListenStmt = db.prepare(`
      INSERT INTO listens (
        track_id,
        listened,
        want_again,
        would_again,
        keep_in_library,
        activity,
        notes,
        logged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction((rows: DecisionSnapshot[]) => {
      clearImportedListensStmt.run(IMPORT_NOTE);

      let applied = 0;
      let skipped = 0;
      for (const row of rows) {
        const found = hasTrackStmt.get(row.trackId) as { id: string } | undefined;
        if (!found?.id) {
          skipped += 1;
          continue;
        }

        const repeatIntent = normalizeRepeatIntent(row.repeatIntent);
        const { wantAgain, wouldAgain } = deriveAgainFlags(row.keepInLibrary, repeatIntent);

        updateIntentStmt.run(repeatIntent, found.id);
        insertListenStmt.run(
          found.id,
          1,
          wantAgain,
          wouldAgain,
          row.keepInLibrary,
          "[]",
          IMPORT_NOTE,
          Number.isFinite(row.loggedAt) ? row.loggedAt : Date.now(),
        );
        applied += 1;
      }

      return { applied, skipped };
    });

    const { applied, skipped } = tx(decisions);
    console.log(`Imported ${applied} decisions from ${SNAPSHOT_PATH}${skipped ? ` (${skipped} skipped: track not found)` : ""}`);
  } finally {
    db.close();
  }
}

const mode = process.argv[2];
if (mode !== "export" && mode !== "import") {
  usage();
}

if (mode === "export") {
  exportDecisions();
} else {
  importDecisions();
}
