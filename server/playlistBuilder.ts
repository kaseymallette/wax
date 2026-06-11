import fs from "node:fs";
import path from "node:path";
import type { TrackFeaturePoint } from "./storage";

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

type HarmonicRuleRow = {
  startingKey: string;
  targets: Partial<Record<(typeof HARMONIC_RULE_COLUMNS)[number], string>>;
};

let cachedRules: HarmonicRuleRow[] | null = null;
let cachedRulesPath: string | null = null;

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
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }

    field += c;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function readHarmonicRules(rulesPath: string): HarmonicRuleRow[] {
  if (cachedRules && cachedRulesPath === rulesPath) return cachedRules;

  const raw = fs.readFileSync(rulesPath, "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(raw);
  if (rows.length < 2) {
    throw new Error("harmonic_mixing_rules.csv is empty or invalid");
  }

  const header = rows[0].map((h) => h.trim());
  const idxStarting = header.findIndex((h) => h.toLowerCase() === "starting key");
  if (idxStarting === -1) {
    throw new Error("harmonic_mixing_rules.csv is missing 'Starting Key' column");
  }

  const idxByColumn = new Map<(typeof HARMONIC_RULE_COLUMNS)[number], number>();
  for (const col of HARMONIC_RULE_COLUMNS) {
    const idx = header.findIndex((h) => h.toLowerCase() === col.toLowerCase());
    if (idx !== -1) idxByColumn.set(col, idx);
  }

  const parsed: HarmonicRuleRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const startingKey = (r[idxStarting] ?? "").trim();
    if (!startingKey) continue;

    const targets: HarmonicRuleRow["targets"] = {};
    for (const col of HARMONIC_RULE_COLUMNS) {
      const idx = idxByColumn.get(col);
      if (idx == null) continue;
      const value = (r[idx] ?? "").trim();
      if (value) targets[col] = value;
    }

    parsed.push({ startingKey, targets });
  }

  cachedRules = parsed;
  cachedRulesPath = rulesPath;
  return parsed;
}

function buildKeyStepLookup(seedCamelot: string | null, harmonicRules: HarmonicRuleRow[]): Record<string, number> {
  if (!seedCamelot || !seedCamelot.trim()) return {};
  const seed = seedCamelot.trim();
  const row = harmonicRules.find((r) => r.startingKey === seed);
  if (!row) return {};

  const lookup: Record<string, number> = {};
  for (const col of HARMONIC_RULE_COLUMNS) {
    const target = row.targets[col];
    if (!target) continue;
    lookup[target] = HARMONIC_RULE_GROUPS[col];
  }
  return lookup;
}

function zScoreScale(data: number[][]): { scaled: number[][]; means: number[]; stds: number[] } {
  const cols = data[0]?.length ?? 0;
  const means = Array.from({ length: cols }, (_, c) => {
    const sum = data.reduce((acc, row) => acc + row[c], 0);
    return sum / data.length;
  });

  const stds = Array.from({ length: cols }, (_, c) => {
    const variance =
      data.reduce((acc, row) => {
        const d = row[c] - means[c];
        return acc + d * d;
      }, 0) / data.length;
    const stdev = Math.sqrt(variance);
    return stdev > 0 ? stdev : 1;
  });

  const scaled = data.map((row) => row.map((v, c) => (v - means[c]) / stds[c]));
  return { scaled, means, stds };
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export type PlaylistCandidate = {
  trackId: string;
  name: string;
  artists: string;
  album: string;
  bpm: number;
  camelot: string | null;
  energy: number;
  dance: number;
  valence: number;
  moodScore: number;
  keyStep: number;
  distance: number;
  source: string | null;
};

export function generatePlaylistCandidates(input: {
  seedTrackId: string;
  topN: number;
  maxDistance: number;
  keepPoints: TrackFeaturePoint[];
  rulesPath?: string;
}): { seed: PlaylistCandidate; candidates: PlaylistCandidate[]; poolSize: number } {
  const rulesPath = input.rulesPath ?? path.resolve(process.cwd(), "data", "harmonic_mixing_rules.csv");
  const harmonicRules = readHarmonicRules(rulesPath);

  const seedPoint = input.keepPoints.find((p) => p.trackId === input.seedTrackId);
  if (!seedPoint) {
    throw new Error("Seed track must be in keep tracks with imported features");
  }

  const keyStepLookup = buildKeyStepLookup(seedPoint.camelot, harmonicRules);
  const defaultKeyStep = Object.keys(HARMONIC_RULE_GROUPS).length + 1;

  const toMood = (p: TrackFeaturePoint) => p.valence + p.dance + p.energy;
  const toKeyStep = (camelot: string | null) => keyStepLookup[String(camelot ?? "")] ?? defaultKeyStep;

  const matrix = input.keepPoints.map((p) => [p.bpm, toMood(p), toKeyStep(p.camelot)]);
  const { scaled } = zScoreScale(matrix);

  const seedIndex = input.keepPoints.findIndex((p) => p.trackId === seedPoint.trackId);
  const seedScaled = scaled[seedIndex];

  const mapped: PlaylistCandidate[] = input.keepPoints.map((p, idx) => ({
    trackId: p.trackId,
    name: p.name,
    artists: p.artists,
    album: p.album,
    bpm: p.bpm,
    camelot: p.camelot,
    energy: p.energy,
    dance: p.dance,
    valence: p.valence,
    moodScore: toMood(p),
    keyStep: toKeyStep(p.camelot),
    distance: euclideanDistance(seedScaled, scaled[idx]),
    source: p.source,
  }));

  const seed = {
    ...mapped[seedIndex],
    keyStep: keyStepLookup[String(seedPoint.camelot ?? "")] ?? 1,
    distance: 0,
  };

  const candidates = mapped
    .filter((p) => p.trackId !== seed.trackId)
    .filter((p) => p.distance <= input.maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, input.topN);

  return {
    seed,
    candidates,
    poolSize: input.keepPoints.length,
  };
}
