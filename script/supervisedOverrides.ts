import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { hash } from "../server/profilePublish";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const acceptedSchema = z.object({
  username: slug, profileId: slug, weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day: z.number().int().min(1).max(7), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  trackIds: z.array(z.string().regex(/^[A-Za-z0-9]{22}$/)).min(1).max(100),
  revision: z.string().regex(/^[a-f0-9]{64}$/), acceptedAt: z.string().datetime(),
});
export type AcceptedPlaylist = z.infer<typeof acceptedSchema>;
export const overrideFile = (userDir: string) => path.join(userDir, "supervised", "accepted.json");
export const targetKey = (o: Pick<AcceptedPlaylist, "profileId" | "weekStart" | "day">) => `${o.profileId}/${o.weekStart}/${o.day}`;
export function acceptedRevision(o: Omit<AcceptedPlaylist, "revision" | "acceptedAt">) {
  return hash({ username: o.username, profileId: o.profileId, weekStart: o.weekStart, day: o.day, sourceRevision: o.sourceRevision, trackIds: o.trackIds });
}
export function readOverrides(userDir: string): AcceptedPlaylist[] {
  const file = overrideFile(userDir);
  if (!fs.existsSync(file)) return [];
  const { playlists } = z.object({ schemaVersion: z.literal(1), playlists: z.array(acceptedSchema) }).parse(JSON.parse(fs.readFileSync(file, "utf8")));
  const keys = new Set<string>();
  for (const o of playlists) {
    if (o.username !== path.basename(userDir) || keys.has(targetKey(o)) || new Set(o.trackIds).size !== o.trackIds.length || acceptedRevision(o) !== o.revision) {
      throw new Error(`Invalid or duplicate accepted playlist in ${file}: ${targetKey(o)}`);
    }
    keys.add(targetKey(o));
  }
  return playlists;
}
export function orderedTracks<T extends { id: string }>(tracks: T[], ids: string[]): T[] {
  const byId = new Map(tracks.map(t => [t.id, t]));
  return ids.map(id => {
    const track = byId.get(id);
    if (!track) throw new Error(`Track ${id} is absent from the original source playlist.`);
    return track;
  });
}
export function applyOverrides<T extends { profileId: string; weekStart: string; revision: string; playlists: { index: number; trackCount: number; tracks: { id: string }[] }[] }>(snapshot: T, overrides: AcceptedPlaylist[]): T {
  const result = structuredClone(snapshot);
  for (const o of overrides.filter(o => o.profileId === snapshot.profileId && o.weekStart === snapshot.weekStart)) {
    if (o.sourceRevision !== snapshot.revision) throw new Error(`Accepted playlist ${targetKey(o)} conflicts with the selected snapshot revision. Reconcile and accept the playlist from the replacement export first.`);
    const playlist = result.playlists.find(p => p.index === o.day);
    if (!playlist) throw new Error(`Missing day ${o.day} in source snapshot.`);
    playlist.tracks = orderedTracks(playlist.tracks, o.trackIds);
    playlist.trackCount = playlist.tracks.length;
  }
  return result;
}
