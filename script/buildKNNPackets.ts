import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type RepeatIntent = "currently_listening" | "favorites_archive" | "save_for_later" | "skip" | "undecided";

type DecisionSnapshot = {
  trackId: string;
  repeatIntent: string;
  loggedAt: number;
};

type DecisionSnapshotFile = {
  decisions?: DecisionSnapshot[];
};

type Decision = {
  trackId: string;
  repeatIntent: RepeatIntent;
  loggedAt: number;
};

type Track = {
  trackId: string;
  name: string;
  artists: string;
  album: string;
  spotifyUrl: string;
  tier: RepeatIntent;
  loggedAt: number;
  bpm: number;
  valence: number;
  dance: number;
  energy: number;
  moodScore: number;
  camelot: string;
};

type PacketEntry = { track: Track; distance: number; keyStep: number };

type HarmonicLookup = Map<string, Map<string, number>>;

const HARMONIC_RULE_COLUMNS = [
  "Perfect Mix",
  "-1 Mix",
  "+1 Mix",
  "Energy Boost",
  "Scale Change",
  "Diagonal Mix",
  "Jaw's Mix",
  "Mood Shifter",
] as const;

const HARMONIC_RULE_GROUPS: Record<(typeof HARMONIC_RULE_COLUMNS)[number], number> = {
  "Perfect Mix": 1,
  "-1 Mix": 1,
  "+1 Mix": 1,
  "Energy Boost": 2,
  "Scale Change": 2,
  "Diagonal Mix": 3,
  "Jaw's Mix": 4,
  "Mood Shifter": 5,
};

const DEFAULT_KEY_STEP = 6;
const KEEP_TIERS = new Set<RepeatIntent>(["currently_listening", "favorites_archive", "save_for_later"]);
const PRIMARY_TIERS = new Set<RepeatIntent>(["currently_listening", "favorites_archive"]);
const TIER_PRIORITY: Record<RepeatIntent, number> = {
  currently_listening: 0,
  favorites_archive: 1,
  save_for_later: 2,
  skip: 3,
  undecided: 4,
};

const DEFAULT_NEIGHBORS = 3;
const DEFAULT_SAVE_FOR_LATER_DISTANCE_THRESHOLD = 1.0;
const DEFAULT_MAX_NEIGHBOR_DISTANCE = 2.0;

const REPO_ROOT = process.cwd();

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return undefined;
}

const WAX_USER = (argValue("--wax-user") ?? process.env.WAX_USER ?? "kasey").trim() || "kasey";
const DECISIONS_PATH = path.resolve(REPO_ROOT, "users", WAX_USER, "decisions-latest.json");
const DB_PATH = path.resolve(REPO_ROOT, "data.db");
const HARMONIC_RULES_PATH = path.resolve(REPO_ROOT, "data", "harmonic_mixing_rules.csv");
const OUTPUT_PATH = path.resolve(REPO_ROOT, "users", WAX_USER, "playlists", "knn", "knn-packets.csv");

function normalizeRepeatIntent(v: unknown): RepeatIntent {
  const s = String(v ?? "undecided").trim().toLowerCase();
  if (
    s === "currently_listening" ||
    s === "favorites_archive" ||
    s === "save_for_later" ||
    s === "skip" ||
    s === "undecided"
  ) {
    return s;
  }
  return "undecided";
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function readHarmonicLookup(csvPath: string): HarmonicLookup {
  const lookup: HarmonicLookup = new Map();
  if (!fs.existsSync(csvPath)) return lookup;

  const lines = fs
    .readFileSync(csvPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return lookup;

  const header = splitCsvLine(lines[0]);
  const idx = new Map<string, number>();
  for (let i = 0; i < header.length; i++) idx.set(header[i], i);
  const iStartingKey = idx.get("Starting Key");
  if (iStartingKey == null) return lookup;

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const seed = (cells[iStartingKey] ?? "").trim();
    if (!seed) continue;

    const stepMap = new Map<string, number>();
    for (const col of HARMONIC_RULE_COLUMNS) {
      const iCol = idx.get(col);
      if (iCol == null) continue;
      const target = (cells[iCol] ?? "").trim();
      if (target) stepMap.set(target, HARMONIC_RULE_GROUPS[col]);
    }
    lookup.set(seed, stepMap);
  }
  return lookup;
}

function loadDecisions(decisionsPath: string): Map<string, Decision> {
  if (!fs.existsSync(decisionsPath)) throw new Error(`Decisions file not found: ${decisionsPath}`);
  const raw = fs.readFileSync(decisionsPath, "utf8");
  const parsed = JSON.parse(raw) as DecisionSnapshotFile;
  const rows = Array.isArray(parsed.decisions) ? parsed.decisions : [];

  const latest = new Map<string, Decision>();
  for (const row of rows) {
    const trackId = String(row.trackId ?? "").trim();
    if (!trackId) continue;

    const tier = normalizeRepeatIntent(row.repeatIntent);
    if (!KEEP_TIERS.has(tier)) continue;

    const loggedAt = Number(row.loggedAt ?? 0) || 0;
    const existing = latest.get(trackId);
    if (!existing || loggedAt >= existing.loggedAt) {
      latest.set(trackId, { trackId, repeatIntent: tier, loggedAt });
    }
  }
  return latest;
}

function loadTracks(dbPath: string, decisions: Map<string, Decision>): Map<string, Track> {
  if (!fs.existsSync(dbPath)) throw new Error(`DB not found: ${dbPath}`);
  const trackIds = Array.from(decisions.keys());
  const out = new Map<string, Track>();
  if (trackIds.length === 0) return out;

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const chunkSize = 500;
    for (let i = 0; i < trackIds.length; i += chunkSize) {
      const chunk = trackIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      const sql = `
        SELECT
          t.id          AS track_id,
          t.name        AS name,
          t.artists     AS artists,
          t.album       AS album,
          t.spotify_url AS spotify_url,
          tf.bpm        AS bpm,
          tf.valence    AS valence,
          tf.dance      AS dance,
          tf.energy     AS energy,
          tf.camelot    AS camelot
        FROM tracks t
        LEFT JOIN track_features tf ON TRIM(tf.track_id) = TRIM(t.id)
        WHERE t.id IN (${placeholders})
      `;
      const rows = db.prepare(sql).all(...chunk) as Array<Record<string, unknown>>;

      for (const row of rows) {
        const trackId = String(row.track_id ?? "").trim();
        if (!trackId) continue;
        const decision = decisions.get(trackId);
        if (!decision) continue;

        const bpm = row.bpm == null ? null : Number(row.bpm);
        const valence = row.valence == null ? null : Number(row.valence);
        const dance = row.dance == null ? null : Number(row.dance);
        const energy = row.energy == null ? null : Number(row.energy);
        if (bpm == null || valence == null || dance == null || energy == null) continue;

        out.set(trackId, {
          trackId,
          name: String(row.name ?? ""),
          artists: String(row.artists ?? ""),
          album: String(row.album ?? ""),
          spotifyUrl: String(row.spotify_url ?? ""),
          tier: decision.repeatIntent,
          loggedAt: decision.loggedAt,
          bpm,
          valence,
          dance,
          energy,
          moodScore: valence + dance + energy,
          camelot: String(row.camelot ?? "").trim(),
        });
      }
    }
  } finally {
    db.close();
  }
  return out;
}

function zscoreRows(rows: Array<[number, number, number]>): Array<[number, number, number]> {
  if (rows.length === 0) return [];
  const means: [number, number, number] = [0, 0, 0];
  for (const row of rows) {
    means[0] += row[0];
    means[1] += row[1];
    means[2] += row[2];
  }
  means[0] /= rows.length;
  means[1] /= rows.length;
  means[2] /= rows.length;

  const vars: [number, number, number] = [0, 0, 0];
  for (const row of rows) {
    vars[0] += (row[0] - means[0]) ** 2;
    vars[1] += (row[1] - means[1]) ** 2;
    vars[2] += (row[2] - means[2]) ** 2;
  }
  vars[0] /= rows.length;
  vars[1] /= rows.length;
  vars[2] /= rows.length;

  const stds: [number, number, number] = [Math.sqrt(vars[0]), Math.sqrt(vars[1]), Math.sqrt(vars[2])];
  for (let i = 0; i < 3; i++) if (stds[i] < 1e-12) stds[i] = 1;

  return rows.map((row) => [
    (row[0] - means[0]) / stds[0],
    (row[1] - means[1]) / stds[1],
    (row[2] - means[2]) / stds[2],
  ]);
}

function euclidean(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function nearestNeighborsForSeed(seed: Track, candidates: Track[], harmonicLookup: HarmonicLookup): PacketEntry[] {
  if (candidates.length === 0) return [];

  const keySteps = harmonicLookup.get(seed.camelot) ?? new Map<string, number>();
  const seedKeyStep = keySteps.get(seed.camelot) ?? 1;

  const rows: Array<[number, number, number]> = [[seed.bpm, seed.moodScore, seedKeyStep]];
  const candidateKeySteps: number[] = [];
  for (const track of candidates) {
    const keyStep = keySteps.get(track.camelot) ?? DEFAULT_KEY_STEP;
    candidateKeySteps.push(keyStep);
    rows.push([track.bpm, track.moodScore, keyStep]);
  }

  const zRows = zscoreRows(rows);
  const zSeed = zRows[0];
  const zCandidates = zRows.slice(1);

  const scored: PacketEntry[] = [];
  for (let i = 0; i < candidates.length; i++) {
    scored.push({
      track: candidates[i],
      distance: euclidean(zSeed, zCandidates[i]),
      keyStep: candidateKeySteps[i],
    });
  }
  scored.sort((a, b) => a.distance - b.distance);
  return scored;
}

function buildPackets(tracksById: Map<string, Track>, harmonicLookup: HarmonicLookup): PacketEntry[][] {
  const packets: PacketEntry[][] = [];
  const unused = new Map<string, Track>(tracksById);

  while (unused.size > 0) {
    const allCandidates = Array.from(unused.values());
    const primarySeeds = allCandidates.filter((t) => PRIMARY_TIERS.has(t.tier));
    const seedCandidates = primarySeeds.length > 0
      ? primarySeeds
      : allCandidates.filter((t) => t.tier === "save_for_later");
    if (seedCandidates.length === 0) break;

    let bestPacket: PacketEntry[] = [];
    let bestScore = Number.POSITIVE_INFINITY;
    let bestTie: [number, number, string] | null = null;

    for (const seed of seedCandidates) {
      const pool = allCandidates.filter((t) => t.trackId !== seed.trackId);
      const ranked = nearestNeighborsForSeed(seed, pool, harmonicLookup);

      const picked: PacketEntry[] = [];
      for (const entry of ranked) {
        if (picked.length >= DEFAULT_NEIGHBORS) break;
        if (entry.distance > DEFAULT_MAX_NEIGHBOR_DISTANCE) break;

        if (entry.track.tier === "save_for_later") {
          if (seed.tier === "save_for_later" || entry.distance > DEFAULT_SAVE_FOR_LATER_DISTANCE_THRESHOLD) {
            picked.push(entry);
          }
          continue;
        }

        if (PRIMARY_TIERS.has(entry.track.tier)) picked.push(entry);
      }

      const score = picked.length > 0
        ? picked.reduce((sum, e) => sum + e.distance, 0) / picked.length
        : Number.POSITIVE_INFINITY;

      const tie: [number, number, string] = [
        seed.tier === "currently_listening" ? 0 : 1,
        -seed.loggedAt,
        seed.trackId,
      ];

      const betterTie =
        !bestTie || tie[0] < bestTie[0] ||
        (tie[0] === bestTie[0] && (tie[1] < bestTie[1] ||
          (tie[1] === bestTie[1] && tie[2] < bestTie[2])));

      const sameScore = score === bestScore || (
        Number.isFinite(score) &&
        Number.isFinite(bestScore) &&
        Math.abs(score - bestScore) < 1e-9
      );

      if (bestPacket.length === 0 || score < bestScore || (sameScore && betterTie)) {
        bestScore = score;
        bestTie = tie;
        bestPacket = [{ track: seed, distance: 0, keyStep: 1 }, ...picked];
      }
    }

    if (bestPacket.length === 0) break;
    packets.push(bestPacket);
    for (const entry of bestPacket) unused.delete(entry.track.trackId);
  }

  if (unused.size > 0) {
    const remaining = Array.from(unused.values()).sort((a, b) => {
      const tierCmp = TIER_PRIORITY[a.tier] - TIER_PRIORITY[b.tier];
      if (tierCmp !== 0) return tierCmp;
      if (a.loggedAt !== b.loggedAt) return b.loggedAt - a.loggedAt;
      return a.trackId.localeCompare(b.trackId);
    });
    for (const track of remaining) packets.push([{ track, distance: 0, keyStep: 1 }]);
  }

  return packets;
}

function escapeCsv(value: string | number): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes("\r") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writePacketsCsvList(outputPath: string, packets: PacketEntry[][]): void {
  const lines = [
    "packet_index,slot,seed_track_id,track_id,tier,name,artists,album,bpm,mood_score,key_step,distance,spotify_url",
  ];

  packets.forEach((packet, packetIndex) => {
    const seedTrackId = packet[0]?.track.trackId ?? "";
    packet.forEach((entry, slotIndex) => {
      lines.push([
        packetIndex + 1,
        slotIndex + 1,
        seedTrackId,
        entry.track.trackId,
        entry.track.tier,
        entry.track.name,
        entry.track.artists,
        entry.track.album,
        entry.track.bpm.toFixed(3),
        entry.track.moodScore.toFixed(3),
        entry.keyStep,
        entry.distance.toFixed(6),
        entry.track.spotifyUrl,
      ].map(escapeCsv).join(","));
    });
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n") + "\n", "utf8");
}

type TierVector = [number, number, number];

const KNN_PLAYLIST_ARCHETYPES: Array<{ key: string; vector: TierVector }> = [
  { key: "currently-listening-favorites", vector: [0.45, 0.55, 0.0] },
  { key: "favorites-save-for-later", vector: [0.05, 0.55, 0.4] },
  { key: "save-for-later-heavy", vector: [0.0, 0.2, 0.8] },
];

function packetTierVector(packet: PacketEntry[]): TierVector {
  const counts: TierVector = [0, 0, 0];
  for (const entry of packet) {
    if (entry.track.tier === "currently_listening") counts[0] += 1;
    else if (entry.track.tier === "favorites_archive") counts[1] += 1;
    else if (entry.track.tier === "save_for_later") counts[2] += 1;
  }
  const n = Math.max(1, counts[0] + counts[1] + counts[2]);
  return [counts[0] / n, counts[1] / n, counts[2] / n];
}

function vecDist(a: TierVector, b: TierVector): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function nearestArchetype(point: TierVector, archetypes: Array<{ key: string; vector: TierVector }>): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < archetypes.length; i++) {
    const d = vecDist(point, archetypes[i].vector);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function classifyTierBucket(v: TierVector): number {
  const hasCurrentlyListening = v[0] > 1e-9;
  const hasFavoritesArchive = v[1] > 1e-9;
  const hasSaveForLater = v[2] > 1e-9;

  if (!hasSaveForLater) return 0;
  if (hasCurrentlyListening || hasFavoritesArchive) return 1;
  return 2;
}

function canAssignToBucket(bucket: number, v: TierVector): boolean {
  const hasSaveForLater = v[2] > 1e-9;
  if (bucket === 0) return !hasSaveForLater;
  return true;
}

function rebalance(vectors: TierVector[], labels: number[], k: number): number[] {
  const n = vectors.length;
  if (n === 0) return labels;
  const minTarget = Math.floor(n / k);
  const maxTarget = Math.ceil(n / k);
  const out = labels.slice();

  for (let pass = 0; pass < n * 3; pass++) {
    const counts = new Array<number>(k).fill(0);
    out.forEach((l) => (counts[l] += 1));

    const over = counts.findIndex((c) => c > maxTarget);
    const under = counts.findIndex((c) => c < minTarget);
    if (over < 0 || under < 0) break;

    let bestIdx = -1;
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (let i = 0; i < vectors.length; i++) {
      if (out[i] !== over) continue;
      if (!canAssignToBucket(under, vectors[i])) continue;
      const penalty =
        vecDist(vectors[i], KNN_PLAYLIST_ARCHETYPES[under].vector) -
        vecDist(vectors[i], KNN_PLAYLIST_ARCHETYPES[over].vector);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    out[bestIdx] = under;
  }

  return out;
}

function writeSplitPlaylists(packets: PacketEntry[][]): { k: number; packetCounts: number[]; files: string[] } {
  const vectors = packets.map(packetTierVector);
  const k = Math.min(3, packets.length);
  let labels = vectors.map(classifyTierBucket);
  labels = labels.map((label, i) => (canAssignToBucket(label, vectors[i]) ? label : nearestArchetype(vectors[i], KNN_PLAYLIST_ARCHETYPES)));
  labels = rebalance(vectors, labels, k);

  const names = ["a", "b", "c"] as const;
  const labelOrder = [2, 1, 0] as const;
  const files: string[] = [];
  const countsByLabel = new Array<number>(k).fill(0);
  labels.forEach((l) => (countsByLabel[l] += 1));
  const packetCounts = labelOrder.slice(0, k).map((label) => countsByLabel[label]);

  for (let c = 0; c < k; c++) {
    const targetLabel = labelOrder[c];
    const outPath = path.resolve(path.dirname(OUTPUT_PATH), `knn-playlist-${names[c]}.csv`);
    const lines = [
      "packet_index,slot,seed_track_id,track_id,tier,name,artists,album,bpm,mood_score,key_step,distance,spotify_url",
    ];

    packets
      .map((packet, idx) => ({ packet, idx, label: labels[idx] }))
      .filter((x) => x.label === targetLabel)
      .sort((a, b) => a.idx - b.idx)
      .forEach(({ packet, idx }) => {
        const seedTrackId = packet[0]?.track.trackId ?? "";
        packet.forEach((entry, slotIndex) => {
          lines.push([
            idx + 1,
            slotIndex + 1,
            seedTrackId,
            entry.track.trackId,
            entry.track.tier,
            entry.track.name,
            entry.track.artists,
            entry.track.album,
            entry.track.bpm.toFixed(3),
            entry.track.moodScore.toFixed(3),
            entry.keyStep,
            entry.distance.toFixed(6),
            entry.track.spotifyUrl,
          ].map(escapeCsv).join(","));
        });
      });

    fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
    files.push(outPath);
  }

  return { k, packetCounts, files };
}

function main(): void {
  const decisions = loadDecisions(DECISIONS_PATH);
  const tracks = loadTracks(DB_PATH, decisions);
  const harmonicLookup = readHarmonicLookup(HARMONIC_RULES_PATH);
  const packets = buildPackets(tracks, harmonicLookup);

  writePacketsCsvList(OUTPUT_PATH, packets);

  const totalTracks = packets.reduce((n, p) => n + p.length, 0);
  const fullPackets = packets.filter((p) => p.length === 4).length;
  const partialPackets = packets.length - fullPackets;

  console.log(`Built packets for user: ${WAX_USER}`);
  console.log(`Decisions considered (currently_listening + favorites_archive + save_for_later): ${decisions.size}`);
  console.log(`Tracks with full features available: ${tracks.size}`);
  console.log("Seed mode: auto");
  console.log(`Save For Later fallback threshold: > ${DEFAULT_SAVE_FOR_LATER_DISTANCE_THRESHOLD.toFixed(3)}`);
  console.log(`Max NN distance before fallback sort: ${DEFAULT_MAX_NEIGHBOR_DISTANCE.toFixed(3)}`);
  console.log(`Packets: ${packets.length} (full: ${fullPackets}, partial: ${partialPackets})`);
  console.log(`Total tracks used: ${totalTracks}`);
  console.log(`Output: ${OUTPUT_PATH}`);

  const split = writeSplitPlaylists(packets);
  console.log(`Split playlists: ${split.k}`);
  console.log(`Split packet counts: ${split.packetCounts.join(", ")}`);
  split.files.forEach((f) => console.log(`Wrote: ${f}`));
}

main();
