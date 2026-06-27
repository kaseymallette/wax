/**
 * Mood Playlist Builder (v1)
 *
 * Reads per-user decisions from `users/<WAX_USER>/decisions-latest.json`,
 * joins each trackId against the shared `data.db` `track_features` table for
 * mood (= energy + dance + valence), then:
 *
 *   1. Filters to keeps with repeat_intent in { on_repeat, yes, maybe }
 *   2. Partitions into Low / Medium / High using TERCILES of the user's
 *      mood distribution (recomputed each run)
 *   3. Sorts within each band by a weighted score:
 *        tier_weight * (1 + 0.5 * recency_boost + listen_count_boost) * jitter
 *   4. Writes three CSVs to `users/<WAX_USER>/playlists/`
 *   5. Logs any decision-referenced tracks not found in data.db to
 *      `users/<WAX_USER>/missing-tracks.log`
 *
 * Usage:
 *   WAX_USER=kasey      npx tsx script/buildMoodPlaylists.ts
 *   WAX_USER=kaseysdad  npx tsx script/buildMoodPlaylists.ts
 *   WAX_USER=kaseysmom  npx tsx script/buildMoodPlaylists.ts
 *
 * Environment:
 *   WAX_USER            user folder name under users/    (default: "default")
 *   WAX_DB_PATH         path to master data.db           (default: ./data.db)
 *   WAX_DECISIONS_PATH  override decisions JSON path     (default: users/<WAX_USER>/decisions-latest.json)
 *   WAX_PLAYLISTS_DIR   override playlists output dir    (default: users/<WAX_USER>/playlists)
 *   WAX_MISSING_LOG     override missing-tracks log path (default: users/<WAX_USER>/missing-tracks.log)
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// ---------- Types ---------------------------------------------------------

type RepeatIntent = "on_repeat" | "yes" | "maybe" | "nah" | "undecided";

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

type TrackFeatureRow = {
  id: string;
  name: string;
  artists: string;
  album: string;
  spotify_url: string | null;
  bpm: number | null;
  camelot: string | null;
  energy: number | null;
  dance: number | null;
  valence: number | null;
  listen_count: number;
  latest_logged_at: number | null;
};

type Candidate = {
  trackId: string;
  name: string;
  artists: string;
  album: string;
  spotifyUrl: string | null;
  tier: RepeatIntent;
  decisionLoggedAt: number;
  bpm: number | null;
  camelot: string | null;
  energy: number;
  dance: number;
  valence: number;
  mood: number;
  listenCount: number;
  daysSinceLatestListen: number;
  tierWeight: number;
  recencyBoost: number;
  listenCountBoost: number;
  jitter: number;
  sortScore: number;
};

type Band = "low" | "medium" | "high";

// ---------- Config --------------------------------------------------------

const KEEP_TIERS = new Set<RepeatIntent>(["on_repeat", "yes", "maybe"]);

const TIER_WEIGHTS: Record<RepeatIntent, number> = {
  on_repeat: 3.0,
  yes: 1.5,
  maybe: 0.6,
  // present so the type is total — these tiers are filtered out before scoring
  nah: 0,
  undecided: 0,
};

const RECENCY_HALF_LIFE_DAYS = 30;
const RECENCY_WEIGHT = 0.5;
const LISTEN_COUNT_WEIGHT = 0.2;
const JITTER_MIN = 0.95;
const JITTER_MAX = 1.05;

const WAX_USER = (process.env.WAX_USER || "default").trim() || "default";
const REPO_ROOT = process.cwd();
const DB_PATH = path.resolve(REPO_ROOT, process.env.WAX_DB_PATH || "data.db");
const DECISIONS_PATH = path.resolve(
  REPO_ROOT,
  process.env.WAX_DECISIONS_PATH || path.join("users", WAX_USER, "decisions-latest.json"),
);
const PLAYLISTS_DIR = path.resolve(
  REPO_ROOT,
  process.env.WAX_PLAYLISTS_DIR || path.join("users", WAX_USER, "playlists", "mood"),
);
const MISSING_LOG_PATH = path.resolve(
  REPO_ROOT,
  process.env.WAX_MISSING_LOG || path.join("users", WAX_USER, "missing-tracks.log"),
);

// ---------- Helpers -------------------------------------------------------

function normalizeRepeatIntent(v: unknown): RepeatIntent {
  const s = String(v ?? "undecided").trim().toLowerCase();
  if (s === "undecided" || s === "on_repeat" || s === "yes" || s === "maybe" || s === "nah") {
    return s as RepeatIntent;
  }
  return "undecided";
}

/**
 * Cut points for N equal groups: percentile positions k/N for k = 1..N-1.
 * Uses linear interpolation between adjacent sorted values (numpy default).
 *
 * For terciles (N=3): returns [p33.3, p66.6].
 */
function quantiles(sortedAsc: number[], probs: number[]): number[] {
  if (sortedAsc.length === 0) return probs.map(() => NaN);
  if (sortedAsc.length === 1) return probs.map(() => sortedAsc[0]);
  const n = sortedAsc.length;
  return probs.map((p) => {
    const pos = p * (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sortedAsc[lo];
    const frac = pos - lo;
    return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
  });
}

function assignBand(mood: number, cuts: [number, number]): Band {
  // Use < for lower bound, so ties on a boundary fall into the higher band.
  // This keeps clumps of identical mood values together rather than splitting them arbitrarily.
  if (mood < cuts[0]) return "low";
  if (mood < cuts[1]) return "medium";
  return "high";
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return Number(n).toFixed(digits);
}

function ensureDirOf(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// ---------- Main pipeline -------------------------------------------------

function loadDecisions(): DecisionSnapshot[] {
  if (!fs.existsSync(DECISIONS_PATH)) {
    console.error(`No decisions snapshot at ${DECISIONS_PATH}`);
    console.error(`Run: WAX_USER=${WAX_USER} npx tsx script/decisions.ts export`);
    process.exit(1);
  }
  const raw = fs.readFileSync(DECISIONS_PATH, "utf8");
  const parsed = JSON.parse(raw) as DecisionSnapshotFile;
  const decisions = Array.isArray(parsed?.decisions) ? parsed.decisions : [];
  return decisions;
}

function loadFeaturesByTrackId(db: Database.Database, trackIds: string[]): Map<string, TrackFeatureRow> {
  const map = new Map<string, TrackFeatureRow>();
  if (trackIds.length === 0) return map;

  // SQLite has a parameter limit (default 999). Chunk just in case.
  const CHUNK = 500;
  const stmtSql = (placeholders: string) => `
    SELECT
      t.id              AS id,
      t.name            AS name,
      t.artists         AS artists,
      t.album           AS album,
      t.spotify_url     AS spotify_url,
      tf.bpm            AS bpm,
      tf.camelot        AS camelot,
      tf.energy         AS energy,
      tf.dance          AS dance,
      tf.valence        AS valence,
      (SELECT COUNT(*) FROM listens l WHERE l.track_id = t.id)            AS listen_count,
      (SELECT MAX(l.logged_at) FROM listens l WHERE l.track_id = t.id)    AS latest_logged_at
    FROM tracks t
    LEFT JOIN track_features tf ON TRIM(tf.track_id) = TRIM(t.id)
    WHERE t.id IN (${placeholders})
  `;

  for (let i = 0; i < trackIds.length; i += CHUNK) {
    const chunk = trackIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db.prepare(stmtSql(placeholders)).all(...chunk) as TrackFeatureRow[];
    for (const r of rows) {
      map.set(r.id, r);
    }
  }
  return map;
}

function buildCandidates(
  decisions: DecisionSnapshot[],
  featureMap: Map<string, TrackFeatureRow>,
  nowMs: number,
): { candidates: Candidate[]; missing: DecisionSnapshot[]; skippedNoFeatures: DecisionSnapshot[] } {
  const candidates: Candidate[] = [];
  const missing: DecisionSnapshot[] = [];
  const skippedNoFeatures: DecisionSnapshot[] = [];

  for (const d of decisions) {
    const tier = normalizeRepeatIntent(d.repeatIntent);
    if (!KEEP_TIERS.has(tier)) continue; // skip nah / undecided

    const row = featureMap.get(d.trackId);
    if (!row) {
      missing.push(d);
      continue;
    }
    if (row.energy == null || row.dance == null || row.valence == null) {
      skippedNoFeatures.push(d);
      continue;
    }

    const energy = Number(row.energy);
    const dance = Number(row.dance);
    const valence = Number(row.valence);
    const mood = energy + dance + valence;

    const latestListen = row.latest_logged_at ?? d.loggedAt;
    const days = Math.max(0, (nowMs - latestListen) / 86_400_000);
    const recencyBoost = 1 / (1 + days / RECENCY_HALF_LIFE_DAYS);
    const listenCountBoost = Math.log(1 + Math.max(0, row.listen_count)) * LISTEN_COUNT_WEIGHT;
    const tierWeight = TIER_WEIGHTS[tier];
    const jitter = JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN);
    const sortScore = tierWeight * (1 + RECENCY_WEIGHT * recencyBoost + listenCountBoost) * jitter;

    candidates.push({
      trackId: d.trackId,
      name: row.name ?? d.name ?? "",
      artists: row.artists ?? d.artists ?? "",
      album: row.album ?? "",
      spotifyUrl: row.spotify_url ?? null,
      tier,
      decisionLoggedAt: d.loggedAt,
      bpm: row.bpm == null ? null : Number(row.bpm),
      camelot: row.camelot ?? null,
      energy,
      dance,
      valence,
      mood,
      listenCount: Number(row.listen_count ?? 0),
      daysSinceLatestListen: days,
      tierWeight,
      recencyBoost,
      listenCountBoost,
      jitter,
      sortScore,
    });
  }

  return { candidates, missing, skippedNoFeatures };
}

function partitionByTercile(candidates: Candidate[]): { bands: Record<Band, Candidate[]>; cuts: [number, number] } {
  const sortedMoods = candidates.map((c) => c.mood).sort((a, b) => a - b);
  const [c1, c2] = quantiles(sortedMoods, [1 / 3, 2 / 3]);
  const cuts: [number, number] = [c1, c2];

  const bands: Record<Band, Candidate[]> = { low: [], medium: [], high: [] };
  for (const c of candidates) {
    bands[assignBand(c.mood, cuts)].push(c);
  }

  // Sort each band descending by sort score
  for (const b of Object.keys(bands) as Band[]) {
    bands[b].sort((a, b2) => b2.sortScore - a.sortScore);
  }

  return { bands, cuts };
}

function writePlaylistCsv(band: Band, rows: Candidate[]) {
  const filePath = path.join(PLAYLISTS_DIR, `${band}.csv`);
  ensureDirOf(filePath);

  const header = [
    "rank",
    "track_id",
    "name",
    "artists",
    "album",
    "tier",
    "mood",
    "energy",
    "dance",
    "valence",
    "bpm",
    "camelot",
    "listen_count",
    "days_since_latest_listen",
    "tier_weight",
    "recency_boost",
    "listen_count_boost",
    "jitter",
    "sort_score",
    "spotify_url",
  ];

  const lines: string[] = [header.join(",")];
  rows.forEach((r, i) => {
    lines.push(
      [
        i + 1,
        escapeCsv(r.trackId),
        escapeCsv(r.name),
        escapeCsv(r.artists),
        escapeCsv(r.album),
        escapeCsv(r.tier),
        fmtNum(r.mood, 2),
        fmtNum(r.energy, 2),
        fmtNum(r.dance, 2),
        fmtNum(r.valence, 2),
        fmtNum(r.bpm, 2),
        escapeCsv(r.camelot),
        r.listenCount,
        fmtNum(r.daysSinceLatestListen, 2),
        fmtNum(r.tierWeight, 3),
        fmtNum(r.recencyBoost, 4),
        fmtNum(r.listenCountBoost, 4),
        fmtNum(r.jitter, 4),
        fmtNum(r.sortScore, 4),
        escapeCsv(r.spotifyUrl),
      ].join(","),
    );
  });

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

function writeMissingLog(missing: DecisionSnapshot[], skippedNoFeatures: DecisionSnapshot[]) {
  if (missing.length === 0 && skippedNoFeatures.length === 0) {
    // If a previous run wrote one, clear it so it doesn't go stale.
    if (fs.existsSync(MISSING_LOG_PATH)) fs.unlinkSync(MISSING_LOG_PATH);
    return null;
  }
  ensureDirOf(MISSING_LOG_PATH);

  const ts = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# buildMoodPlaylists missing-tracks report`);
  lines.push(`# user: ${WAX_USER}`);
  lines.push(`# generated: ${ts}`);
  lines.push(`# db: ${DB_PATH}`);
  lines.push(`# decisions: ${DECISIONS_PATH}`);
  lines.push("");
  lines.push(`## Tracks referenced by decisions but NOT FOUND in data.db (${missing.length})`);
  lines.push("# Action: import these tracks into your master library so future runs include them.");
  lines.push("# Columns: trackId | repeatIntent | name | artists");
  for (const m of missing) {
    lines.push(`${m.trackId} | ${m.repeatIntent} | ${m.name} | ${m.artists}`);
  }
  lines.push("");
  lines.push(`## Tracks found but MISSING AUDIO FEATURES in track_features (${skippedNoFeatures.length})`);
  lines.push("# Action: re-import features (energy/dance/valence) for these tracks.");
  lines.push("# Columns: trackId | repeatIntent | name | artists");
  for (const s of skippedNoFeatures) {
    lines.push(`${s.trackId} | ${s.repeatIntent} | ${s.name} | ${s.artists}`);
  }

  fs.writeFileSync(MISSING_LOG_PATH, `${lines.join("\n")}\n`, "utf8");
  return MISSING_LOG_PATH;
}

// ---------- Run -----------------------------------------------------------

function main() {
  console.log(`[buildMoodPlaylists] user=${WAX_USER}`);
  console.log(`[buildMoodPlaylists] db=${DB_PATH}`);
  console.log(`[buildMoodPlaylists] decisions=${DECISIONS_PATH}`);
  console.log(`[buildMoodPlaylists] out=${PLAYLISTS_DIR}`);

  const decisions = loadDecisions();
  console.log(`[buildMoodPlaylists] loaded ${decisions.length} decisions`);

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  let candidates: Candidate[] = [];
  let missing: DecisionSnapshot[] = [];
  let skippedNoFeatures: DecisionSnapshot[] = [];
  let cuts: [number, number] = [NaN, NaN];
  let bands: Record<Band, Candidate[]> = { low: [], medium: [], high: [] };

  try {
    const trackIds = decisions.map((d) => d.trackId);
    const featureMap = loadFeaturesByTrackId(db, trackIds);

    const built = buildCandidates(decisions, featureMap, Date.now());
    candidates = built.candidates;
    missing = built.missing;
    skippedNoFeatures = built.skippedNoFeatures;

    if (candidates.length === 0) {
      console.warn("[buildMoodPlaylists] No candidates after filtering. Writing empty CSVs.");
    } else {
      const partitioned = partitionByTercile(candidates);
      bands = partitioned.bands;
      cuts = partitioned.cuts;
    }
  } finally {
    db.close();
  }

  // Always write all three CSVs (even if empty) for a consistent output contract
  const lowPath = writePlaylistCsv("low", bands.low);
  const medPath = writePlaylistCsv("medium", bands.medium);
  const highPath = writePlaylistCsv("high", bands.high);
  const missingPath = writeMissingLog(missing, skippedNoFeatures);

  // Summary
  const tierCounts = (rows: Candidate[]) =>
    rows.reduce<Record<string, number>>(
      (acc, r) => ((acc[r.tier] = (acc[r.tier] ?? 0) + 1), acc),
      {},
    );

  const fmtCuts = Number.isFinite(cuts[0]) && Number.isFinite(cuts[1])
    ? `[${cuts[0].toFixed(2)}, ${cuts[1].toFixed(2)}]`
    : "[n/a]";

  console.log("");
  console.log(`[buildMoodPlaylists] tercile cuts (mood): ${fmtCuts}`);
  console.log(`[buildMoodPlaylists] candidates kept: ${candidates.length}`);
  console.log(`[buildMoodPlaylists] low    : ${bands.low.length} ${JSON.stringify(tierCounts(bands.low))}`);
  console.log(`[buildMoodPlaylists] medium : ${bands.medium.length} ${JSON.stringify(tierCounts(bands.medium))}`);
  console.log(`[buildMoodPlaylists] high   : ${bands.high.length} ${JSON.stringify(tierCounts(bands.high))}`);
  console.log("");
  console.log(`[buildMoodPlaylists] wrote ${lowPath}`);
  console.log(`[buildMoodPlaylists] wrote ${medPath}`);
  console.log(`[buildMoodPlaylists] wrote ${highPath}`);
  if (missing.length > 0 || skippedNoFeatures.length > 0) {
    console.log(
      `[buildMoodPlaylists] warnings: ${missing.length} missing track(s), ${skippedNoFeatures.length} missing features -> ${missingPath}`,
    );
  } else {
    console.log(`[buildMoodPlaylists] no missing tracks or features`);
  }
}

main();
