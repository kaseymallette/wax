import type { Express } from "express";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadPreflight } from "./profileConfig";
import { hash, weekStart, writeJson, hasSavedExport, exportFiles, readJob, publishProfile } from "./profilePublish";
import { createSpotifyPublisher } from "./spotifyPublisher";
import { buildDailyPlaylists } from "./dailyPlaylists";

import { loadProfileWorkflow } from "./profileWorkflow";
import { registerFirstSongMixRoutes } from "./firstSongMixRoutes";
const running = new Set<string>();
const failures = new Map<string, string>();
export async function registerRoutes(server: Server, app: Express): Promise<Server> {
  registerFirstSongMixRoutes(app);
  app.get("/api/profiles/preflight", (_req, res) => res.json(loadPreflight()));
  app.get("/api/spotify/account", async (_req, res) => {
    try { const account = await createSpotifyPublisher().account(); res.json({ id: account.id, name: account.display_name || account.id }); }
    catch (error) { res.status(422).json({ error: (error as Error).message }); }
  });
  app.get("/api/runtime", (_req, res) => res.json({ mode: "v2-playlists" }));
  app.use("/api/playlists", (req, res, next) => {
    const report = loadPreflight();
    if (!report.valid) return res.status(422).json({ error: "Please fix the collection sources before building playlists.", report });
    const profile = req.query.profile === undefined ? report.profiles[0] : report.profiles.find(p => p.id === req.query.profile);
    if (!profile) return res.status(404).json({ error: "Collection not found." });
    try {
      const workflow = loadProfileWorkflow(report, profile);
      const { statePath } = workflow;
      if (req.method !== "GET" && running.has(statePath)) return res.status(409).json({ error: "Publishing is in progress. Wait before making changes." });
      res.locals.workflow = workflow;
      next();
    } catch (error) { res.status(422).json({ error: (error as Error).message }); }
  });
  const respond = (res: any) => {
    const { profile, tracks, state, statePath, input } = res.locals.workflow;
    const result = buildDailyPlaylists(tracks, state);
    const revision = hash(result.playlists);
    const currentInput = { ...input, result, revision, week: weekStart() };
    return res.json({ ...result, revision, targetWeek: input.week, csvSaved: hasSavedExport(currentInput), profile, firstTrackByPlaylist: state.firstTrackByPlaylist,
      reviewed: result.playlists.filter(p => state.reviewed?.[String(p.index)] === hash(p)).map(p => p.index),
      publish: { running: running.has(statePath), job: readJob(currentInput), error: failures.get(statePath) },
    });
  };
  app.get("/api/playlists/daily", (_req, res) => respond(res));
  app.put("/api/playlists/daily-ordering", (req, res) => {
    const parsed = z.object({ playlistIndex: z.number().int().min(1).max(7), firstTrackId: z.string().min(1).nullable() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose a song from this playlist." });
    const { tracks, state, statePath } = res.locals.workflow;
    const { playlistIndex, firstTrackId } = parsed.data;
    const playlist = buildDailyPlaylists(tracks).playlists[playlistIndex - 1];
    if (firstTrackId && !playlist.tracks.some(t => t.id === firstTrackId)) return res.status(400).json({ error: "That song is not in this daily playlist." });
    if (firstTrackId) state.firstTrackByPlaylist[String(playlistIndex)] = firstTrackId;
    else delete state.firstTrackByPlaylist[String(playlistIndex)];
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n");
    fs.renameSync(temporary, statePath);
    return respond(res);
  });
  app.put("/api/playlists/approve-week", (req, res) => {
    const { state, statePath, result, revision } = res.locals.workflow;
    if (req.body?.revision !== revision) return res.status(409).json({ error: "This week changed. Refresh before approving it." });
    state.reviewed = Object.fromEntries(result.playlists.map((playlist: { index: number }) => [String(playlist.index), hash(playlist)]));
    writeJson(statePath, state);
    return respond(res);
  });
  app.put("/api/playlists/review", (req, res) => {
    const { state, statePath, result, revision } = res.locals.workflow;
    const parsed = z.object({ revision: z.string(), day: z.number().int().min(1).max(7), reviewed: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose a day to review." });
    if (parsed.data.revision !== revision) return res.status(409).json({ error: "This mix changed. Refresh and review the latest version." });
    state.reviewed ??= {};
    if (parsed.data.reviewed) state.reviewed[String(parsed.data.day)] = hash(result.playlists[parsed.data.day - 1]);
    else delete state.reviewed[String(parsed.data.day)];
    writeJson(statePath, state);
    return respond(res);
  });
  app.post("/api/playlists/export", (req, res) => {
    const { input, revision } = res.locals.workflow;
    if (req.body?.revision !== revision) return res.status(409).json({ error: "This mix changed. Refresh before saving." });
    res.json(exportFiles(input));
  });
  app.get("/api/playlists/export/:day", (req, res) => {
    const { input, revision } = res.locals.workflow;
    if (req.query.revision !== revision) return res.status(409).json({ error: "This mix changed. Save the latest CSVs again." });
    const day = Number(req.params.day);
    if (!Number.isInteger(day) || day < 1 || day > 7) return res.sendStatus(404);
    const exported = exportFiles(input);
    res.download(path.join(exported.directory, exported.files[day - 1].filename));
  });
  app.post("/api/playlists/publish", (req, res) => {
    const { input, revision, state, statePath, result } = res.locals.workflow;
    if (req.body?.revision !== revision) return res.status(409).json({ error: "This mix changed. Refresh before publishing." });
    if (!result.playlists.every((p: { index: number }) => state.reviewed?.[String(p.index)] === hash(p))) return res.status(409).json({ error: "Approve this week before publishing." });
    if (typeof req.body.accountId !== "string" || !req.body.accountId) return res.status(400).json({ error: "Check the Spotify account before publishing." });
    running.add(statePath); failures.delete(statePath);
    void publishProfile(input, req.body.accountId, createSpotifyPublisher())
      .catch(error => { failures.set(statePath, error.message); })
      .finally(() => running.delete(statePath));
    return res.status(202).json({ started: true });
  });
  return server;
}
