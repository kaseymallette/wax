import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { loadPreflight } from "./profileConfig";
import { loadProfileWorkflow } from "./profileWorkflow";
import { weekStart } from "./profilePublish";
import { createSpotifyPublisher } from "./spotifyPublisher";
import { buildFirstSongMix, mixExportPath, saveFirstSongMix, readMixPublication, publishFirstSongMix } from "./firstSongMix";

export function registerFirstSongMixRoutes(app: Express) {
  const running = new Set<string>();
  const errors = new Map<string, string>();
  app.use("/api/first-song-mix", (req, res, next) => {
    try {
      const report = loadPreflight();
      if (!report.valid) return res.status(422).json({ error: "Fix your collection sources before building the mix." });
      const userDir = path.dirname(report.configPath);
      const mix = buildFirstSongMix(report.username, weekStart(), report.profiles.map(p => loadProfileWorkflow(report, p)));
      if (req.method !== "GET" && running.has(userDir)) return res.status(409).json({ error: "Your mix is publishing. Wait before trying again." });
      res.locals.mix = { userDir, mix };
      next();
    } catch (error) { res.status(422).json({ error: (error as Error).message }); }
  });
  app.get("/api/first-song-mix", (_req, res) => {
    const { userDir, mix } = res.locals.mix;
    const publication = readMixPublication(userDir);
    res.json({ ...mix, csvSaved: fs.existsSync(mixExportPath(userDir, mix)), running: running.has(userDir), error: errors.get(userDir), publication: publication?.revision === mix.revision ? publication : null });
  });
  app.post("/api/first-song-mix/export", (req, res) => {
    const { userDir, mix } = res.locals.mix;
    if (req.body?.revision !== mix.revision) return res.status(409).json({ error: "Your opening songs changed. Refresh the mix before saving." });
    saveFirstSongMix(userDir, mix);
    res.json({ saved: true });
  });
  app.get("/api/first-song-mix/export", (req, res) => {
    const { userDir, mix } = res.locals.mix;
    if (req.query.revision !== mix.revision) return res.status(409).json({ error: "Your opening songs changed. Save the updated mix first." });
    const file = mixExportPath(userDir, mix);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Save the mix before downloading it." });
    res.download(file);
  });
  app.post("/api/first-song-mix/publish", (req, res) => {
    const { userDir, mix } = res.locals.mix;
    if (req.body?.revision !== mix.revision) return res.status(409).json({ error: "Your opening songs changed. Refresh and check the mix before publishing." });
    if (typeof req.body.accountId !== "string" || !req.body.accountId) return res.status(400).json({ error: "Check your Spotify account first." });
    running.add(userDir); errors.delete(userDir);
    void publishFirstSongMix(userDir, mix, req.body.accountId, createSpotifyPublisher())
      .catch(error => errors.set(userDir, error.message))
      .finally(() => running.delete(userDir));
    res.status(202).json({ started: true });
  });
}
