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

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseIsoMaybe(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function keepInLibraryFromIntent(intent: string): 0 | 1 {
  const normalized = String(intent || "undecided").trim().toLowerCase();
  if (normalized === "removed") return 0;
  return 1;
}

function normalizeIntent(intent: string): string {
  const s = String(intent || "undecided").trim().toLowerCase();
  if (
    s === "currently_listening" ||
    s === "favorites_archive" ||
    s === "save_for_later" ||
    s === "skip_for_now" ||
    s === "off_rotation" ||
    s === "removed" ||
    s === "undecided"
  ) return s;
  if (s === "skip") return "skip_for_now";
  return "undecided";
}

function main() {
  const user = String(process.argv[2] || process.env.WAX_USER || "kasey").trim() || "kasey";
  const userDir = path.resolve(process.cwd(), "users", user);
  const playlistsDir = path.join(userDir, "playlists");
  const outPath = path.join(userDir, "decisions-latest.json");

  if (!fs.existsSync(playlistsDir)) {
    throw new Error(`Playlists directory not found: ${playlistsDir}`);
  }

  const csvFiles = fs
    .readdirSync(playlistsDir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => path.join(playlistsDir, f))
    .sort();

  if (!csvFiles.length) {
    throw new Error(`No playlist CSV files found under ${playlistsDir}`);
  }

  if (fs.existsSync(outPath)) {
    const backupPath = `${outPath}.bak.${Date.now()}`;
    fs.copyFileSync(outPath, backupPath);
    console.log(`backup: ${backupPath}`);
  }

  const now = Date.now();
  const byTrack = new Map<string, DecisionSnapshot>();

  for (const filePath of csvFiles) {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= 1) continue;

    const header = splitCsvLine(lines[0]).map((h) => h.trim());
    const idxTrack = header.indexOf("track_id");
    if (idxTrack < 0) continue;
    const idxName = header.indexOf("name");
    const idxArtists = header.indexOf("artists");
    const idxIntent = header.indexOf("repeat_intent");
    const idxLastListened = header.indexOf("last_listened_at");

    for (let i = 1; i < lines.length; i += 1) {
      const cells = splitCsvLine(lines[i]);
      const trackId = String(cells[idxTrack] ?? "").trim();
      if (!trackId) continue;

      const repeatIntent = normalizeIntent(String(cells[idxIntent] ?? "undecided"));
      const loggedAt = parseIsoMaybe(String(cells[idxLastListened] ?? "")) ?? now;
      const decision: DecisionSnapshot = {
        trackId,
        name: idxName >= 0 ? String(cells[idxName] ?? "").trim() : "",
        artists: idxArtists >= 0 ? String(cells[idxArtists] ?? "").trim() : "",
        keepInLibrary: keepInLibraryFromIntent(repeatIntent),
        repeatIntent,
        loggedAt,
      };

      const prev = byTrack.get(trackId);
      if (!prev || decision.loggedAt >= prev.loggedAt) {
        byTrack.set(trackId, decision);
      }
    }
  }

  const decisions = Array.from(byTrack.values()).sort((a, b) => {
    if (b.loggedAt !== a.loggedAt) return b.loggedAt - a.loggedAt;
    return a.trackId.localeCompare(b.trackId);
  });

  const payload: DecisionSnapshotFile = {
    exportedAt: now,
    sourceDbPath: path.join(userDir, "music_library.db"),
    count: decisions.length,
    decisions,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`rebuilt ${outPath} with ${decisions.length} decisions from ${csvFiles.length} playlist CSVs`);
}

main();
