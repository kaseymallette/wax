import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const configSchema = z.object({
  username: slug,
  profiles: z.array(z.object({
    id: slug,
    name: z.string().trim().min(1),
    masterCsvPath: z.string().trim().min(1).refine(value => !value.includes("\0")),
    stationId: slug.optional(),
    enabled: z.boolean().default(true),
  })).min(1),
}).superRefine((config, ctx) => {
  const ids = new Set<string>();
  for (const profile of config.profiles) {
    if (ids.has(profile.id)) ctx.addIssue({ code: "custom", message: `Duplicate profile ID: ${profile.id}` });
    ids.add(profile.id);
  }
  if (!config.profiles.some(p => p.enabled)) ctx.addIssue({ code: "custom", message: "Enable at least one profile." });
});

export type ProfileReport = {
  id: string; name: string; path: string; trackCount: number | null;
  valid: boolean; errors: string[];
};
export type PreflightReport = {
  username: string; configPath: string; valid: boolean; errors: string[];
  requiredRange: { min: number; max: number }; profiles: ProfileReport[];
};

export function validateCsv(source: string): { trackCount: number; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(source, {
    header: true, skipEmptyLines: "greedy", transformHeader: h => h.trim(),
  });
  const errors = parsed.errors.map(e => `CSV row ${e.row === undefined ? "unknown" : e.row + 2}: ${e.message}`);
  const required = ["Song", "Artist", "Spotify Track Id", "BPM", "Energy", "Dance", "Valence"];
  for (const field of required) {
    if (!parsed.meta.fields?.includes(field)) errors.push(`Missing required column: ${field}`);
  }
  const trackCount = parsed.data.length;
  if (trackCount < 70 || trackCount > 700) errors.push(`Found ${trackCount} tracks; required range is 70–700.`);
  if (required.every(field => parsed.meta.fields?.includes(field))) {
    const ids = new Set<string>();
    parsed.data.forEach((row, index) => {
      const rowErrors: string[] = [];
      for (const field of ["Song", "Artist"]) if (!row[field]?.trim()) rowErrors.push(`${field} is required`);
      const id = row["Spotify Track Id"]?.trim();
      if (!/^[A-Za-z0-9]{22}$/.test(id ?? "")) rowErrors.push("invalid Spotify Track Id");
      else if (ids.has(id)) rowErrors.push(`duplicate Spotify Track Id ${id}`);
      ids.add(id);
      for (const field of ["BPM", "Energy", "Dance", "Valence"]) {
        const value = Number(row[field]);
        if (!row[field]?.trim() || !Number.isFinite(value) || (field === "BPM" ? value <= 0 : value < 0 || value > 100)) {
          rowErrors.push(`${field} must be ${field === "BPM" ? "a positive number" : "between 0 and 100"}`);
        }
      }
      if (rowErrors.length) errors.push(`CSV row ${index + 2}: ${rowErrors.join("; ")}`);
    });
  }
  return { trackCount, errors };
}

export function loadPreflight(username = process.env.WAX_USER || "kaseysmom", root = process.cwd()): PreflightReport {
  const report: PreflightReport = { username, configPath: "", valid: false, errors: [], requiredRange: { min: 70, max: 700 }, profiles: [] };
  if (!slug.safeParse(username).success) { report.errors.push("WAX_USER must be a lowercase username with optional hyphens."); return report; }
  report.configPath = path.resolve(root, "users", username, "config.json");
  try {
    const config = configSchema.parse(JSON.parse(fs.readFileSync(report.configPath, "utf8")));
    if (config.username !== username) throw new Error(`Config username must match WAX_USER (${username}).`);
    for (const profile of config.profiles.filter(p => p.enabled)) {
      const csvPath = path.resolve(path.dirname(report.configPath), profile.masterCsvPath);
      const entry: ProfileReport = { id: profile.id, name: profile.name, path: csvPath, trackCount: null, valid: false, errors: [] };
      try {
        const result = validateCsv(fs.readFileSync(csvPath, "utf8"));
        entry.trackCount = result.trackCount;
        entry.errors = result.errors;
        entry.valid = !result.errors.length;
      } catch (error) { entry.errors.push(`Cannot read CSV: ${(error as Error).message}`); }
      report.profiles.push(entry);
    }
    report.valid = report.profiles.every(p => p.valid);
  } catch (error) { report.errors.push((error as Error).message); }
  return report;
}

export function readProfileTracks(csvPath: string) {
  const source = fs.readFileSync(csvPath, "utf8");
  const validation = validateCsv(source);
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));
  return Papa.parse<Record<string, string>>(source, { header: true, skipEmptyLines: "greedy", transformHeader: h => h.trim() }).data.map(row => ({
    id: row["Spotify Track Id"].trim(), name: row.Song.trim(), artists: row.Artist.trim(),
    album: row.Album ?? "", spotifyUrl: `https://open.spotify.com/track/${row["Spotify Track Id"].trim()}`,
    bpm: Number(row.BPM), energy: Number(row.Energy), dance: Number(row.Dance), valence: Number(row.Valence),
    camelot: row.Camelot || null,
    albumYear: /^\d{4}/.test(row["Album Date"] ?? "") ? Number(row["Album Date"].slice(0, 4)) : null,
  }));
}
