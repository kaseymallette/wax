import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { readProfileTracks, type PreflightReport, type ProfileReport } from "./profileConfig";
import { buildDailyPlaylists, remapOpeningSongs } from "./dailyPlaylists";
import { hash, weekStart, writeJson, type PublishInput } from "./profilePublish";
type SavedState = { dayAssignment?: string; fingerprint: string; firstTrackByPlaylist: Record<string, string>; reviewed?: Record<string, string> };
export function loadProfileWorkflow(report: PreflightReport, profile: ProfileReport) {
  const tracks = readProfileTracks(profile.path);
  const fingerprint = createHash("sha256").update(JSON.stringify(tracks)).digest("hex");
  const statePath = path.join(path.dirname(report.configPath), "state", `${profile.id}.json`);
  let state: SavedState = { dayAssignment: "angular-equal-count-0-upper-left-clockwise-v1", fingerprint, firstTrackByPlaylist: {} };
  if (fs.existsSync(statePath)) {
    const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (saved.fingerprint === fingerprint) state = { dayAssignment: saved.dayAssignment, fingerprint, firstTrackByPlaylist: z.record(z.string()).parse(saved.firstTrackByPlaylist), reviewed: z.record(z.string()).parse(saved.reviewed ?? {}) };
  }
  if (state.dayAssignment !== "angular-equal-count-0-upper-left-clockwise-v1") {
    const backup = `${statePath}.before-angular-upper-left.json`;
    if (!fs.existsSync(backup)) fs.copyFileSync(statePath, backup);
    state.firstTrackByPlaylist = remapOpeningSongs(buildDailyPlaylists(tracks), state.firstTrackByPlaylist);
    state.reviewed = {};
    state.dayAssignment = "angular-equal-count-0-upper-left-clockwise-v1";
    writeJson(statePath, state);
  }
  const result = buildDailyPlaylists(tracks, state);
  const revision = hash(result.playlists);
  const input: PublishInput = { profileId: profile.id, userDir: path.dirname(report.configPath), result, revision, week: weekStart() };
  return { profile, tracks, state, statePath, result, revision, input };
}
