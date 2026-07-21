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

const REPO_ROOT = process.cwd();
const DB_PATH = path.resolve(REPO_ROOT, process.env.WAX_AUDIT_DB_PATH || "data.db");
const USERS = String(process.env.WAX_USERS || "kasey,kaseysmom,kaseysdad")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SAMPLE_LIMIT = Math.max(1, Number(process.env.WAX_AUDIT_SAMPLE_LIMIT || 10));
const STRICT = ["1", "true", "yes"].includes(String(process.env.WAX_AUDIT_STRICT || "").trim().toLowerCase());

function normalizeRepeatIntent(v: unknown): string {
  const s = String(v ?? "undecided").trim().toLowerCase();
  if (s === "skip") return "skip_for_now";
  return s || "undecided";
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
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Audit DB not found: ${DB_PATH}`);
  }

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const hasTrackStmt = db.prepare(`SELECT id FROM tracks WHERE TRIM(id) = TRIM(?) LIMIT 1`);

    let totalMissing = 0;
    console.log(`[decisions:audit] db=${DB_PATH}`);

    for (const user of USERS) {
      const decisions = loadSnapshot(user);
      const missing: DecisionSnapshot[] = [];
      const presentByIntent = new Map<string, number>();
      const missingByIntent = new Map<string, number>();

      for (const row of decisions) {
        const found = hasTrackStmt.get(row.trackId) as { id: string } | undefined;
        if (found?.id) {
          presentByIntent.set(row.repeatIntent, (presentByIntent.get(row.repeatIntent) || 0) + 1);
        } else {
          missing.push(row);
          missingByIntent.set(row.repeatIntent, (missingByIntent.get(row.repeatIntent) || 0) + 1);
        }
      }

      totalMissing += missing.length;
      const presentCount = decisions.length - missing.length;

      console.log(`\n[decisions:audit] user=${user}`);
      console.log(`  snapshot=${decisions.length} present=${presentCount} missing=${missing.length}`);

      const missingIntentSummary = [...missingByIntent.entries()].sort((a, b) => b[1] - a[1]);
      if (missingIntentSummary.length > 0) {
        console.log(`  missing_by_intent=${missingIntentSummary.map(([intent, count]) => `${intent}:${count}`).join(", ")}`);
      }

      const clMissing = missing.filter((m) => m.repeatIntent === "currently_listening");
      if (clMissing.length > 0) {
        console.log(`  currently_listening_missing=${clMissing.length}`);
      }

      if (missing.length > 0) {
        console.log(`  sample_missing (max ${SAMPLE_LIMIT}):`);
        for (const row of missing.slice(0, SAMPLE_LIMIT)) {
          console.log(`    - ${row.trackId} | ${row.repeatIntent} | ${row.artists} | ${row.name}`);
        }
      }
    }

    if (totalMissing > 0 && STRICT) {
      console.error(`\n[decisions:audit] FAIL: missing tracks detected (${totalMissing})`);
      process.exit(1);
    }

    console.log(`\n[decisions:audit] done total_missing=${totalMissing}`);
  } finally {
    db.close();
  }
}

main();
