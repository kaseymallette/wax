import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import { playlistDisplayId } from "./playlistNames";
import type { DailyPlaylistsResult } from "./dailyPlaylists";
import type { SpotifyPublisher } from "./spotifyPublisher";
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const hash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}
export function weekStart(now = new Date()) {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  date.setUTCDate(date.getUTCDate() + 7 - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
export type PublishJob = { revision: string; week: string; accountId: string; csvDone: boolean; spotifyIds: Record<string, string>; spotifyDone: number[]; snapshotDone: boolean; error?: string };
export type PublishInput = { profileId: string; userDir: string; revision: string; result: DailyPlaylistsResult; week?: string };
export function jobPath(input: PublishInput) { return path.join(input.userDir, "state", `${input.profileId}-publish.json`); }
export function readJob(input: PublishInput): PublishJob | null {
  const file = jobPath(input);
  if (!fs.existsSync(file)) return null;
  const job = JSON.parse(fs.readFileSync(file, "utf8")) as PublishJob;
  return job.revision === input.revision && job.week === (input.week ?? weekStart()) ? job : null;
}
export function exportProfileName(input: PublishInput): string {
  const prefix = `${path.basename(input.userDir)}-`;
  return input.profileId.startsWith(prefix) ? input.profileId.slice(prefix.length) : input.profileId;
}
export function hasSavedExport(input: PublishInput): boolean {
  const root = path.join(input.userDir, "exports");
  if (!fs.existsSync(root)) return false;
  return fs.readdirSync(root).some(name => {
    if (![exportProfileName(input), input.profileId].some(prefix => name.startsWith(`${prefix}-${input.week ?? weekStart()}-`))) return false;
    try {
      const directory = path.join(root, name);
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
      return manifest.profileId === input.profileId && manifest.revision === input.revision && manifest.files?.length === 7 &&
        manifest.files.every((file: { filename: string }) => fs.existsSync(path.join(directory, file.filename)));
    } catch { return false; }
  });
}

export function exportFiles(input: PublishInput) {
  const directory = path.join(input.userDir, "exports", `${exportProfileName(input)}-${input.week ?? weekStart()}-${input.revision.slice(0, 12)}`);
  fs.mkdirSync(directory, { recursive: true });
  const files = input.result.playlists.map(playlist => {
    const filename = `${exportProfileName(input)}-${DAYS[playlist.index - 1].toLowerCase()}.csv`;
    const csv = Papa.unparse(playlist.tracks.map((t, i) => ({ rank: i + 1, track_id: t.id, name: t.name, artists: t.artists, album: t.album, bpm: t.bpm, mood: t.mood, energy: t.energy, dance: t.dance, valence: t.valence, camelot: t.camelot, spotify_url: t.spotifyUrl })), { escapeFormulae: true });
    fs.writeFileSync(path.join(directory, filename), csv + "\n");
    return { day: playlist.index, filename };
  });
  writeJson(path.join(directory, "manifest.json"), { profileId: input.profileId, weekStart: input.week ?? weekStart(), revision: input.revision, files });
  return { directory, files };
}
export async function publishProfile(input: PublishInput, expectedAccountId: string, spotify: SpotifyPublisher, snapshotWriter = writeJson) {
  input = { ...input, week: input.week ?? weekStart() };
  const account = await spotify.account();
  if (account.id !== expectedAccountId) throw new Error("Spotify account changed. Check the account again before publishing.");
  let job = readJob(input);
  if (job && job.accountId !== account.id) throw new Error("This publish belongs to a different Spotify account. Reconnect that account to resume.");
  job ??= { revision: input.revision, week: input.week!, accountId: account.id, csvDone: false, spotifyIds: {}, spotifyDone: [], snapshotDone: false };
  const save = () => writeJson(jobPath(input), job);
  try {
    delete job.error;
    save();
    if (!job.csvDone) { exportFiles(input); job.csvDone = true; save(); }
    for (const playlist of input.result.playlists) {
      const key = String(playlist.index);
      if (job.spotifyDone.includes(playlist.index)) continue;
      if (!job.spotifyIds[key]) {
        job.spotifyIds[key] = await spotify.findOrCreate(`Wax - ${playlistDisplayId(input.profileId)} ${DAYS[playlist.index - 1]}`, `Wax v2 | ${input.profileId} | day ${playlist.index}`, account.id);
        save();
      }
      await spotify.replace(job.spotifyIds[key], playlist.tracks.map(t => t.id));
      job.spotifyDone.push(playlist.index); save();
    }
    if (!job.snapshotDone) {
      const file = path.join(input.userDir, "snapshots", `${input.profileId}-${job.week}-${input.revision}.json`);
      snapshotWriter(file, { schemaVersion: 2, profileId: input.profileId, weekStart: job.week, revision: input.revision, publishedAt: new Date().toISOString(), spotifyAccountId: account.id, spotifyIds: job.spotifyIds, ...input.result });
      job.snapshotDone = true; save();
    }
  } catch (error) { job.error = (error as Error).message; save(); throw error; }
  return job;
}
