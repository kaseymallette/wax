import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Papa from "papaparse";
import { z } from "zod";
import { configSchema } from "../server/profileConfig";
import { DAYS } from "../server/profilePublish";
import { matchingFirstSongs, validateSnapshot } from "./buildWaxWeeklyData";
import { acceptedRevision, orderedTracks, overrideFile, readOverrides, targetKey } from "./supervisedOverrides";

const manifestSchema = z.object({
  profileId: z.string(), weekStart: z.string(), revision: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(z.object({ day: z.number().int().min(1).max(7), filename: z.string() })),
});
type Track = ReturnType<typeof validateSnapshot>["playlists"][number]["tracks"][number];
const json = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

export function readOrderedCsv(file: string) {
  const parsed = Papa.parse<Record<string, string>>(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), { header: true, delimiter: ",", skipEmptyLines: "greedy" });
  if (parsed.errors.length) throw new Error(`Invalid CSV ${file}: ${parsed.errors.map(e => e.message).join("; ")}`);
  const fields = parsed.meta.fields ?? [];
  if (Object.keys(parsed.meta.renamedHeaders ?? {}).length || new Set(fields).size !== fields.length) throw new Error(`Duplicate CSV headers in ${file}`);
  const idFields = ["track_id", "Spotify Track Id"].filter(f => fields.includes(f));
  const ranks = ["rank", "#"].filter(f => fields.includes(f));
  if (!idFields.length || !parsed.data.length || parsed.data.length > 100) throw new Error("CSV must contain 1–100 songs and a track_id or Spotify Track Id column.");
  const rows = parsed.data.map((row, i) => {
    const id = row[idFields[0]].trim();
    if (!/^[A-Za-z0-9]{22}$/.test(id) || idFields.some(f => row[f].trim() !== id)) throw new Error(`Invalid or conflicting Spotify Track ID at CSV row ${i + 2}.`);
    const rank = ranks.length ? Number(row[ranks[0]]) : i + 1;
    if (!Number.isInteger(rank) || rank < 1 || ranks.some(f => !/^\d+$/.test(row[f]) || Number(row[f]) !== rank)) throw new Error(`Invalid or conflicting rank for ${id}.`);
    return { row, id, rank };
  }).sort((a, b) => a.rank - b.rank);
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("Duplicate Spotify Track IDs in CSV.");
  if (rows.some((r, i) => r.rank !== i + 1)) throw new Error("Ranks must be unique and contiguous, starting at 1.");
  return { fields, rows, ids: rows.map(r => r.id) };
}

function resolveTarget(root: string, file: string, mode: "prepare" | "accept") {
  const absolute = path.resolve(root, file);
  const parts = path.relative(path.join(root, "users"), absolute).split(path.sep);
  if (parts.length !== 4 || parts.some(p => !p || p === "..") || parts[1] !== (mode === "prepare" ? "supervised" : "exports") || !parts[3].endsWith(".csv")) {
    throw new Error(`Expected users/<username>/${mode === "prepare" ? "supervised" : "exports"}/<export-folder>/<playlist>.csv`);
  }
  const [username, , folder, filename] = parts;
  const userDir = path.join(root, "users", username);
  const exportDir = path.join(userDir, "exports", folder);
  const manifest = manifestSchema.parse(json(path.join(exportDir, "manifest.json")));
  if (new Set(manifest.files.map(f => f.filename)).size !== manifest.files.length || new Set(manifest.files.map(f => f.day)).size !== manifest.files.length) throw new Error("Ambiguous export manifest.");
  const entry = manifest.files.find(f => f.filename === filename);
  if (!entry) throw new Error(`Playlist ${filename} is not listed in the export manifest.`);
  const config = configSchema.parse(json(path.join(userDir, "config.json")));
  const profile = config.profiles.find(p => p.id === manifest.profileId && p.enabled);
  if (config.username !== username || !profile) throw new Error("Export profile is missing or disabled in the user configuration.");
  const snapshotDir = path.join(userDir, "snapshots");
  const candidates = fs.readdirSync(snapshotDir).filter(f => f.startsWith(`${manifest.profileId}-`) && f.endsWith(".json"))
    .map(f => validateSnapshot(path.join(snapshotDir, f))).filter(s => s.profileId === manifest.profileId && s.weekStart === manifest.weekStart)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const snapshot = candidates[0];
  if (!snapshot || snapshot.revision !== manifest.revision) throw new Error("Export source revision does not match the latest published snapshot for this profile/week. Use the current export.");
  if (candidates[1]?.publishedAt === snapshot.publishedAt && candidates[1].revision !== snapshot.revision) throw new Error("Ambiguous source snapshots.");
  const tracks = snapshot.playlists.find(p => p.index === entry.day)!.tracks;
  return { absolute, username, userDir, exportPath: path.join(exportDir, filename), manifest, day: entry.day, snapshot, tracks, stationId: profile.stationId ?? profile.id };
}

function exportRow(t: Track): Record<string, string> {
  return Object.fromEntries(Object.entries({ track_id: t.id, name: t.name, artists: t.artists, album: t.album, bpm: t.bpm, mood: t.mood, energy: t.energy, dance: t.dance, valence: t.valence, camelot: t.camelot ?? "", spotify_url: `https://open.spotify.com/track/${t.id}` }).map(([k, v]) => [k, typeof v === "string" && /^[=+\-@\t\r].*$/.test(v) ? `'${v}` : String(v)]));
}
function siteTrack(t: Track, i: number) {
  return { n: i + 1, t: t.name, a: t.artists, al: t.album, bpm: t.bpm, e: t.energy, d: t.dance, v: t.valence, m: t.mood, k: t.camelot, u: `https://open.spotify.com/track/${t.id}` };
}

// Stage every file before replacing any, and restore prior bytes on a write failure.
function writeFiles(files: [string, string][]) {
  const before = files.map(([file]) => fs.existsSync(file) ? fs.readFileSync(file) : null);
  const staged = files.map(([file]) => `${file}.${process.pid}.tmp`);
  let replaced = 0;
  try {
    files.forEach(([file, content], i) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(staged[i], content, { flag: "wx" }); });
    files.forEach(([file], i) => { fs.renameSync(staged[i], file); replaced++; });
  } catch (error) {
    for (let i = 0; i < replaced; i++) {
      if (before[i] === null) fs.unlinkSync(files[i][0]);
      else fs.writeFileSync(files[i][0], before[i]!);
    }
    throw error;
  } finally { for (const file of staged) if (fs.existsSync(file)) fs.unlinkSync(file); }
}

export function prepareSupervised(root: string, file: string, check = false) {
  const target = resolveTarget(root, file, "prepare");
  const input = readOrderedCsv(target.absolute);
  const tracks = orderedTracks(target.tracks, input.ids);
  const current = readOrderedCsv(target.exportPath);
  if (!current.fields.includes("rank") || !current.fields.includes("track_id")) throw new Error("Review export must have rank and track_id columns.");
  const rows = tracks.map((t, i) => {
    const row = current.rows.find(r => r.id === t.id)?.row ?? exportRow(t);
    if (current.fields.some(f => f !== "rank" && row[f] === undefined)) throw new Error(`Cannot restore missing export metadata for ${t.id}.`);
    return { ...row, rank: String(i + 1) };
  });
  if (!check) writeFiles([[target.exportPath, Papa.unparse({ fields: current.fields, data: rows }, { newline: "\n" }) + "\n"]]);
  return { exportPath: target.exportPath, tracks, removed: target.tracks.filter(t => !input.ids.includes(t.id)) };
}

export function acceptSupervised(root: string, file: string, check = false) {
  const target = resolveTarget(root, file, "accept");
  const reviewed = readOrderedCsv(target.exportPath);
  const tracks = orderedTracks(target.tracks, reviewed.ids);
  // The review changes membership/order only; retain the original source metadata.
  for (const { row, id } of reviewed.rows) {
    const expected = exportRow(target.tracks.find(t => t.id === id)!);
    for (const [key, value] of Object.entries(expected)) if (row[key] !== value) throw new Error(`Review metadata differs from the source for ${id}, column ${key}. Only membership and order can be changed.`);
  }
  const release = z.object({ username: z.string(), profileIds: z.array(z.string()) }).parse(json(path.join(root, "wax_weekly/release.json")));
  if (release.username !== target.username || !release.profileIds.includes(target.manifest.profileId)) throw new Error("This playlist is not configured for Wax Weekly.");
  const siteFile = path.join(root, "wax_weekly/data.js");
  const text = fs.readFileSync(siteFile, "utf8").trim();
  if (!text.startsWith("window.WAX_DATA = ")) throw new Error("Unexpected website data format.");
  const data = JSON.parse(text.slice("window.WAX_DATA = ".length).replace(/;$/, ""));
  const stations = data.stations.filter((s: { id: string }) => s.id === target.stationId);
  if (data.week_start !== target.manifest.weekStart || stations.length !== 1 || stations[0].week_start !== target.manifest.weekStart) throw new Error("Website week/profile does not match this export. Build the matching week first.");
  const days = stations[0].days.filter((d: { day: string }) => d.day === DAYS[target.day - 1]);
  if (days.length !== 1 || days[0].playlist_url !== `https://open.spotify.com/playlist/${target.snapshot.spotifyIds[String(target.day)]}`) throw new Error("Website playlist does not match the source Spotify playlist.");
  const overrides = readOverrides(target.userDir);
  const fields = { username: target.username, profileId: target.manifest.profileId, weekStart: target.manifest.weekStart, day: target.day, sourceRevision: target.manifest.revision, trackIds: reviewed.ids };
  const revision = acceptedRevision(fields);
  const previous = overrides.find(o => targetKey(o) === targetKey(fields));
  const acceptedAt = previous?.revision === revision ? previous.acceptedAt : new Date().toISOString();
  const accepted = { ...fields, revision, acceptedAt };
  const next = overrides.filter(o => targetKey(o) !== targetKey(accepted)).concat(accepted).sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
  days[0].tracks = tracks.map(siteTrack);
  const config = configSchema.parse(json(path.join(target.userDir, "config.json")));
  const openers = release.profileIds.flatMap(profileId => {
    const profile = config.profiles.find(p => p.id === profileId);
    const station = data.stations.find((s: { id: string }) => s.id === (profile?.stationId ?? profileId));
    return DAYS.map(day => {
      const url = station?.days.find((d: { day: string }) => d.day === day)?.tracks[0]?.u;
      if (typeof url !== "string" || !/^https:\/\/open.spotify.com\/track\/[A-Za-z0-9]{22}$/.test(url)) throw new Error(`Missing website opener for ${profileId}/${day}.`);
      return { id: url.split("/").at(-1)!, profileId, day };
    });
  });
  data.first_songs = matchingFirstSongs(path.join(target.userDir, "snapshots"), target.snapshot.spotifyAccountId, openers);
  data.last_updated = Math.max(data.last_updated ?? 0, Date.parse(acceptedAt));
  if (!check) writeFiles([
    [overrideFile(target.userDir), JSON.stringify({ schemaVersion: 1, playlists: next }, null, 2) + "\n"],
    [siteFile, `window.WAX_DATA = ${JSON.stringify(data)};\n`],
  ]);
  return { exportPath: target.exportPath, tracks, removed: target.tracks.filter(t => !reviewed.ids.includes(t.id)) };
}

export function main(args = process.argv.slice(2)) {
  const [action, file, ...flags] = args;
  if (!["prepare", "accept"].includes(action) || !file || flags.some(f => f !== "--check")) throw new Error("Usage: npm run supervised:prepare -- <supervised.csv> [--check]\n   or: npm run supervised:accept -- <review-export.csv> [--check]");
  const check = flags.includes("--check");
  const result = (action === "prepare" ? prepareSupervised : acceptSupervised)(process.cwd(), file, check);
  console.log(`${check ? "Validated" : action === "prepare" ? "Prepared review export" : "Accepted for Wax Weekly"}: ${result.exportPath}`);
  result.tracks.forEach((t, i) => console.log(`${i + 1}. ${t.name} — ${t.artists}`));
  console.log(`${result.tracks.length} songs; ${result.removed.length} omitted from the original playlist.`);
  result.removed.forEach(t => console.log(`  Removed: ${t.name} — ${t.artists}`));
  console.log(check ? "No files changed." : action === "prepare" ? "Review the export, then run supervised:accept when ready. Website unchanged." : "Website data and accepted order saved locally. Nothing was published to Spotify, pushed, or deployed.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(`Supervised playlist update failed: ${(error as Error).message}`); process.exitCode = 1; }
}
