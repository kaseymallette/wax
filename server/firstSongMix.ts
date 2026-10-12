import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { playlistDisplayId } from "./playlistNames";
import type { DailyPlaylistsResult, DailyPlaylistTrack } from "./dailyPlaylists";
import { DAYS, hash, writeJson } from "./profilePublish";
import type { SpotifyPublisher } from "./spotifyPublisher";

type Source = { profile: { id: string; name: string }; result: DailyPlaylistsResult };
export type FirstSongMix = {
  name: string; week: string; revision: string;
  tracks: (DailyPlaylistTrack & { profileId: string; profile: string; day: string })[];
};
export function buildFirstSongMix(username: string, week: string, sources: Source[]): FirstSongMix {
  if (!sources.length) throw new Error("Add a collection to build your first-song mix.");
  const tracks = sources.flatMap(({ profile, result }) => {
    return DAYS.map((day, index) => {
      const track = result.playlists.find(p => p.index === index + 1)?.tracks[0];
      if (!track) throw new Error(`${profile.name} is missing an opening song for ${day}.`);
      return { ...track, profileId: profile.id, profile: profile.name, day };
    });
  });
  const name = `Wax - ${playlistDisplayId(username)} First Songs`;
  return { name, week, revision: hash({ name, week, tracks }), tracks };
}
export function mixExportPath(userDir: string, mix: FirstSongMix) {
  return path.join(userDir, "exports", `first-songs-mix-${mix.week}-${mix.revision.slice(0, 12)}.csv`);
}
export function saveFirstSongMix(userDir: string, mix: FirstSongMix) {
  const file = mixExportPath(userDir, mix);
  const csv = Papa.unparse(mix.tracks.map((t, i) => ({ rank: i + 1, track_id: t.id, name: t.name, artists: t.artists, album: t.album, bpm: t.bpm, mood: t.mood, energy: t.energy, dance: t.dance, valence: t.valence, camelot: t.camelot, spotify_url: t.spotifyUrl, profile: t.profile, day: t.day })), { escapeFormulae: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, csv + "\n");
  fs.renameSync(`${file}.tmp`, file);
  return file;
}
type MixPublication = { revision: string; accountId: string; playlistId: string; complete: boolean };
const publicationPath = (userDir: string) => path.join(userDir, "state", "first-songs-mix-publish.json");
export function readMixPublication(userDir: string): MixPublication | null {
  const file = publicationPath(userDir);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}
export async function publishFirstSongMix(userDir: string, mix: FirstSongMix, expectedAccountId: string, spotify: SpotifyPublisher) {
  if (mix.tracks.length > 100) throw new Error("Spotify mix publishing supports up to 100 songs. You can still save the CSV.");
  const account = await spotify.account();
  if (account.id !== expectedAccountId) throw new Error("Spotify account changed. Check the account again before publishing.");
  const previous = readMixPublication(userDir);
  if (previous?.accountId === account.id && previous.revision === mix.revision && previous.complete) return previous;
  saveFirstSongMix(userDir, mix);
  const playlistId = previous?.accountId === account.id ? previous.playlistId : await spotify.findOrCreate(mix.name, `Wax v2 | ${path.basename(userDir)} | first songs`, account.id);
  const publication = { revision: mix.revision, accountId: account.id, playlistId, complete: false };
  writeJson(publicationPath(userDir), publication);
  await spotify.replace(playlistId, mix.tracks.map(t => t.id));
  writeJson(path.join(userDir, "snapshots", `first-songs-mix-${mix.week}-${mix.revision}.json`), { ...mix, accountId: account.id, playlistId, publishedAt: new Date().toISOString() });
  publication.complete = true;
  writeJson(publicationPath(userDir), publication);
  return publication;
}
