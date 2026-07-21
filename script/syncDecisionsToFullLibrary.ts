import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

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

type FullLibraryCsvRow = {
  track_id?: string;
  name?: string;
  artists?: string;
  repeat_intent?: string;
};

const REPO_ROOT = process.cwd();
const USERS = String(process.env.WAX_USERS || "kasey,kaseysmom,kaseysdad")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const KEEP_INTENTS = new Set(["currently_listening", "favorites_archive", "save_for_later", "skip_for_now"]);

function normalizeRepeatIntent(v: unknown): string {
  const s = String(v ?? "undecided").trim().toLowerCase();
  if (s === "skip") return "skip_for_now";
  return s;
}

function keepInLibraryFromIntent(intent: string): 0 | 1 {
  return KEEP_INTENTS.has(intent) ? 1 : 0;
}

function loadFullLibraryRows(user: string): Array<{ trackId: string; name: string; artists: string; repeatIntent: string }> {
  const csvPath = path.join(REPO_ROOT, "users", user, "playlists", "full-music-library.csv");
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing full-music-library.csv for ${user}: ${csvPath}`);
  }

  const parsed = Papa.parse<FullLibraryCsvRow>(fs.readFileSync(csvPath, "utf8"), {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse failed for ${user}: ${parsed.errors[0].message}`);
  }

  const rows: Array<{ trackId: string; name: string; artists: string; repeatIntent: string }> = [];
  const seen = new Set<string>();

  for (const row of parsed.data) {
    const trackId = String(row.track_id ?? "").trim();
    if (!trackId || seen.has(trackId)) continue;
    seen.add(trackId);

    const repeatIntent = normalizeRepeatIntent(row.repeat_intent);
    if (!KEEP_INTENTS.has(repeatIntent)) continue;

    rows.push({
      trackId,
      name: String(row.name ?? "").trim(),
      artists: String(row.artists ?? "").trim(),
      repeatIntent,
    });
  }

  return rows;
}

function loadDecisions(user: string): DecisionSnapshot[] {
  const decisionsPath = path.join(REPO_ROOT, "users", user, "decisions-latest.json");
  if (!fs.existsSync(decisionsPath)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(decisionsPath, "utf8")) as Partial<DecisionSnapshotFile>;
  return Array.isArray(parsed.decisions) ? parsed.decisions : [];
}

function backupFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const stamp = Date.now();
  fs.copyFileSync(filePath, `${filePath}.bak.${stamp}`);
}

function syncUser(user: string): { decisions: number; fullLibrary: number } {
  const fullRows = loadFullLibraryRows(user);
  const existing = loadDecisions(user);

  const existingByTrack = new Map<string, DecisionSnapshot>();
  for (const row of existing) {
    const trackId = String(row.trackId ?? "").trim();
    if (!trackId) continue;
    const current = existingByTrack.get(trackId);
    const nextLoggedAt = Number(row.loggedAt) || 0;
    const currLoggedAt = Number(current?.loggedAt) || 0;
    if (!current || nextLoggedAt >= currLoggedAt) {
      existingByTrack.set(trackId, {
        trackId,
        name: String(row.name ?? ""),
        artists: String(row.artists ?? ""),
        keepInLibrary: Number(row.keepInLibrary) === 0 ? 0 : 1,
        repeatIntent: normalizeRepeatIntent(row.repeatIntent),
        loggedAt: nextLoggedAt,
      });
    }
  }

  const now = Date.now();
  const nextDecisions: DecisionSnapshot[] = fullRows.map((row, index) => {
    const prior = existingByTrack.get(row.trackId);
    const fallbackLoggedAt = now - (fullRows.length - index);

    return {
      trackId: row.trackId,
      name: prior?.name?.trim() || row.name || "Unknown track",
      artists: prior?.artists?.trim() || row.artists || "",
      keepInLibrary: 1,
      repeatIntent: KEEP_INTENTS.has(prior?.repeatIntent || "") ? (prior!.repeatIntent) : row.repeatIntent,
      loggedAt: Number(prior?.loggedAt) > 0 ? Number(prior?.loggedAt) : fallbackLoggedAt,
    };
  });

  const decisionsPath = path.join(REPO_ROOT, "users", user, "decisions-latest.json");
  backupFile(decisionsPath);

  const payload: DecisionSnapshotFile = {
    exportedAt: Date.now(),
    sourceDbPath: `users/${user}/playlists/full-music-library.csv`,
    count: nextDecisions.length,
    decisions: nextDecisions,
  };

  fs.writeFileSync(decisionsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    decisions: nextDecisions.length,
    fullLibrary: fullRows.length,
  };
}

function main() {
  if (USERS.length === 0) {
    throw new Error("No users specified. Set WAX_USERS.");
  }

  for (const user of USERS) {
    const result = syncUser(user);
    console.log(
      `[decisions:sync:full-library] user=${user} decisions=${result.decisions} full_library=${result.fullLibrary}`,
    );
  }
}

main();
