import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { configSchema } from "../server/profileConfig";
import { DAYS, hash } from "../server/profilePublish";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const spotifyId = z.string().regex(/^[A-Za-z0-9]{22}$/);
const monday = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}, "Week must be a valid Monday (YYYY-MM-DD).");
const releaseConfigSchema = z.object({ username: slug, profileIds: z.array(slug).min(1) }).refine(c => new Set(c.profileIds).size === c.profileIds.length, "Release profile IDs must be unique.");
const trackSchema = z.object({
  id: spotifyId, name: z.string().min(1), artists: z.string().min(1), album: z.string(),
  bpm: z.number().positive(), energy: z.number().min(0).max(100), dance: z.number().min(0).max(100), valence: z.number().min(0).max(100),
  mood: z.number().min(0).max(300), camelot: z.string().nullable(), albumArtUrl: z.string().nullable().optional(),
}).passthrough();
const snapshotSchema = z.object({
  schemaVersion: z.literal(2), profileId: slug, weekStart: monday,
  revision: z.string().regex(/^[a-f0-9]{64}$/), publishedAt: z.string().datetime(),
  spotifyAccountId: z.string().min(1), spotifyIds: z.record(spotifyId),
  playlists: z.array(z.object({ index: z.number().int().min(1).max(7), trackCount: z.number().int(), tracks: z.array(trackSchema).min(1).max(100) }).passthrough()).length(7),
}).passthrough();

function readJson(file: string) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Cannot read ${file}: ${(error as Error).message}`); }
}
function validateSnapshot(file: string) {
  const raw = readJson(file);
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid snapshot ${file}: ${parsed.error.message}`);
  const s = parsed.data;
  const tracks = s.playlists.flatMap(p => p.tracks);
  if (new Set(s.playlists.map(p => p.index)).size !== 7 || s.playlists.some(p => p.trackCount !== p.tracks.length || !s.spotifyIds[String(p.index)])) throw new Error(`Incomplete daily playlists or Spotify links in ${file}`);
  if (tracks.length < 70 || tracks.length > 700 || new Set(tracks.map(t => t.id)).size !== tracks.length) throw new Error(`Invalid track count or duplicate tracks in ${file}`);
  if (hash(raw.playlists) !== s.revision) throw new Error(`Snapshot revision does not match its songs: ${file}`);
  return s;
}

export function prepareWeeklyRelease(root: string, requestedWeek?: string) {
  if (requestedWeek) monday.parse(requestedWeek);
  const siteDir = path.join(root, "wax_weekly");
  const release = releaseConfigSchema.parse(readJson(path.join(siteDir, "release.json")));
  const userDir = path.join(root, "users", release.username);
  const config = configSchema.parse(readJson(path.join(userDir, "config.json")));
  if (config.username !== release.username) throw new Error("Website release user does not match the user config.");
  const profiles = release.profileIds.map(id => {
    const profile = config.profiles.find(p => p.id === id && p.enabled);
    if (!profile) throw new Error(`Website profile ${id} is missing or disabled in the user config.`);
    return profile;
  });
  const stationIds = profiles.map(p => p.stationId ?? p.id);
  if (new Set(stationIds).size !== stationIds.length) throw new Error("Website station IDs must be unique.");
  const snapshotDir = path.join(userDir, "snapshots");
  if (!fs.existsSync(snapshotDir)) throw new Error(`No published snapshots for ${release.username}. Publish the website's collections in Wax first.`);
  const snapshots = fs.readdirSync(snapshotDir).filter(file => release.profileIds.some(id => file.startsWith(`${id}-`)) && file.endsWith(".json"))
    .map(file => validateSnapshot(path.join(snapshotDir, file))).filter(s => release.profileIds.includes(s.profileId));
  const week = requestedWeek ?? snapshots.map(s => s.weekStart).sort().at(-1);
  if (!week) throw new Error("No published weekly snapshots found. Publish the website's collections in Wax first.");
  const selected = profiles.map(profile => {
    const candidates = snapshots.filter(s => s.profileId === profile.id && s.weekStart === week).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    if (!candidates.length) throw new Error(`Missing published snapshot for ${profile.name}, week of ${week}. Publish that collection first, or choose a complete week with --week YYYY-MM-DD. Website files were not changed.`);
    if (candidates[1]?.publishedAt === candidates[0].publishedAt && candidates[1].revision !== candidates[0].revision) throw new Error(`Ambiguous snapshots for ${profile.name}, week of ${week}.`);
    return candidates[0];
  });
  if (new Set(selected.map(s => s.spotifyAccountId)).size !== 1) throw new Error("The selected week's collections were published to different Spotify accounts.");
  const stations = selected.map((s, i) => ({
    id: stationIds[i], name: profiles[i].name, week_start: week,
    days: DAYS.map((day, index) => {
      const playlist = s.playlists.find(p => p.index === index + 1)!;
      return { day, playlist_url: `https://open.spotify.com/playlist/${s.spotifyIds[String(index + 1)]}`,
        tracks: playlist.tracks.map((t, n) => ({ n: n + 1, t: t.name, a: t.artists, al: t.album, bpm: t.bpm, e: t.energy, d: t.dance, v: t.valence, m: t.mood, k: t.camelot, u: `https://open.spotify.com/track/${t.id}` })) };
    }),
  }));
  const artFile = path.join(siteDir, "art.js");
  let cachedArt: Record<string, string> = {};
  if (fs.existsSync(artFile)) {
    const text = fs.readFileSync(artFile, "utf8").trim();
    const prefix = "window.WAX_ART = ";
    if (!text.startsWith(prefix)) throw new Error("Unexpected artwork cache format.");
    cachedArt = z.record(z.string()).parse(JSON.parse(text.slice(prefix.length).replace(/;\s*$/, "")));
  }
  const art: Record<string, string> = {};
  for (const s of selected) for (const p of s.playlists) for (const t of p.tracks) {
    const url = t.albumArtUrl || cachedArt[t.id];
    if (url && /^https:\/\//.test(url)) art[t.id] = url;
  }
  // A mix published after midnight can target the following week while still
  // containing these exact openers. Match the songs and origins, not the date.
  const openers = selected.flatMap(s => DAYS.map((day, i) => ({ id: s.playlists.find(p => p.index === i + 1)!.tracks[0].id, profileId: s.profileId, day })));
  const mixSchema = z.object({ playlistId: spotifyId, accountId: z.string(), publishedAt: z.string().datetime(), tracks: z.array(z.object({ id: spotifyId, profileId: slug, day: z.string() })) });
  const mixes = fs.readdirSync(snapshotDir).filter(file => file.startsWith("first-songs-mix-") && file.endsWith(".json"))
    .map(file => mixSchema.parse(readJson(path.join(snapshotDir, file))))
    .filter(mix => mix.accountId === selected[0].spotifyAccountId)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const firstSongs = mixes[0] && JSON.stringify(mixes[0].tracks) === JSON.stringify(openers) ? { playlist_url: `https://open.spotify.com/playlist/${mixes[0].playlistId}` } : undefined;
  return { siteDir, username: release.username, data: { week_start: week, last_updated: Math.max(...selected.map(s => Date.parse(s.publishedAt))), stations, first_songs: firstSongs }, art };
}

export function writeWeeklyRelease(release: ReturnType<typeof prepareWeeklyRelease>) {
  for (const [filename, globalName, data] of [["art.js", "WAX_ART", release.art], ["data.js", "WAX_DATA", release.data]] as const) {
    const file = path.join(release.siteDir, filename);
    fs.writeFileSync(`${file}.tmp`, `window.${globalName} = ${JSON.stringify(data)};\n`);
    fs.renameSync(`${file}.tmp`, file);
  }
}

export function main(args = process.argv.slice(2)) {
  let week: string | undefined;
  let check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--week" && args[i + 1]) week = args[++i];
    else if (args[i] === "--check") check = true;
    else throw new Error("Usage: npm run weekly:release -- [--week YYYY-MM-DD] [--check]");
  }
  const release = prepareWeeklyRelease(process.cwd(), week);
  if (!check) writeWeeklyRelease(release);
  console.log(`${check ? "Validated" : "Prepared"} Wax Weekly for ${release.data.week_start} (${release.username}).`);
  for (const station of release.data.stations) console.log(`  ${station.name}: ${station.days.reduce((n, d) => n + d.tracks.length, 0)} songs, 7 Spotify playlists`);
  console.log(check ? "No files changed." : "Updated wax_weekly/data.js and art.js. Review and commit the website files, then deploy through your usual hosting workflow. Nothing was pushed or deployed.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(`Wax Weekly release failed: ${(error as Error).message}`); process.exitCode = 1; }
}
