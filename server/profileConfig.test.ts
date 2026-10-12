import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createServer } from "node:http";
import { configSchema, loadPreflight, validateCsv } from "./profileConfig";
import { registerRoutes } from "./routes";

function csv(count: number) {
  return "Song,Artist,Spotify Track Id,BPM,Energy,Dance,Valence\n" + Array.from({length: count}, (_, i) => `Song,Artist,${String(i).padStart(22, "0")},100,50,50,50`).join("\n");
}
const profile = { id: "mom-rock", name: "Rock", masterCsvPath: "rock.csv" };
test("config rejects missing fields, duplicate IDs, empty paths and no enabled profiles", () => {
  for (const value of [{}, {username:"mom", profiles:[profile, profile]}, {username:"mom", profiles:[{...profile, masterCsvPath:""}]}, {username:"mom", profiles:[{...profile, enabled:false}]}]) {
    assert.equal(configSchema.safeParse(value).success, false);
  }
});
test("CSV count boundaries and quoting", () => {
  for (const count of [69,70,700,701]) {
    const result = validateCsv(csv(count));
    assert.equal(result.trackCount, count);
    assert.equal(result.errors.length === 0, count >= 70 && count <= 700);
  }
  const quoted = csv(70).replace("Song,Artist,000", '"Song, with comma\nand newline",Artist,000');
  assert.equal(validateCsv(quoted + "\n\n").trackCount, 70);
  assert.deepEqual(validateCsv(quoted).errors, []);
});
test("CSV rejects malformed rows, missing features, duplicate IDs and missing headers", () => {
  assert.ok(validateCsv(csv(70).replace(",100,50,50,50", ",,50,50,50")).errors.length);
  assert.ok(validateCsv(csv(70).replace("BPM", "Tempo")).errors.length);
  assert.ok(validateCsv(csv(70) + "\nSong,Artist,0000000000000000000000,100,50,50,50").errors.length);
  assert.ok(validateCsv(csv(70) + '\n"unterminated').errors.length);
});
test("one invalid profile blocks every playlist route and recovers after correction", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wax-preflight-"));
  const previousCwd = process.cwd();
  const previousUser = process.env.WAX_USER;
  const dir = path.join(root, "users", "mom");
  fs.mkdirSync(dir, {recursive:true});
  fs.writeFileSync(path.join(dir,"config.json"), JSON.stringify({username:"mom", profiles:[profile, {...profile, id:"mom-pop", masterCsvPath:"pop.csv"}]}));
  fs.writeFileSync(path.join(dir,"rock.csv"), csv(70));
  fs.writeFileSync(path.join(dir,"pop.csv"), csv(69));
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  try {
    process.chdir(root); process.env.WAX_USER = "mom";
    assert.equal(loadPreflight().profiles[1].trackCount, 69);
    await registerRoutes(server, app);
    await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
    const address = server.address() as {port:number};
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(base + "/api/profiles/preflight")).status,200);
    assert.equal((await fetch(base + "/api/playlists/daily")).status,422);
    assert.equal((await fetch(base + "/api/first-song-mix")).status,422);
    assert.equal((await fetch(base + "/api/playlists/daily-lock",{method:"POST"})).status,422);
    fs.writeFileSync(path.join(dir,"pop.csv"),csv(70));
    assert.equal((await fetch(base + "/api/playlists/daily")).status,200);
    const original = await (await fetch(base + "/api/playlists/daily?profile=mom-rock")).json();
    const initialMix = await (await fetch(base + "/api/first-song-mix")).json();
    assert.equal(initialMix.tracks.length,14);
    assert.equal(initialMix.tracks[0].profileId,"mom-rock");
    assert.equal(initialMix.tracks[7].profileId,"mom-pop");
    const post = async (route: string, body: unknown, method = "POST") => fetch(base + route + "?profile=mom-rock", {method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
    assert.equal((await post("/api/first-song-mix/export",{revision:"stale"})).status,409);
    assert.equal((await post("/api/first-song-mix/publish",{revision:initialMix.revision})).status,400);
    assert.equal((await post("/api/first-song-mix/export",{revision:initialMix.revision})).status,200);
    assert.equal((await fetch(base + `/api/first-song-mix/export?revision=${initialMix.revision}`)).status,200);
    assert.equal((await (await fetch(base + "/api/first-song-mix")).json()).csvSaved,true);
    assert.equal((await post("/api/playlists/publish",{revision:original.revision,accountId:"account"})).status,409);
    assert.equal((await post("/api/playlists/export",{revision:"stale"})).status,409);
    assert.equal((await post("/api/playlists/export",{revision:original.revision})).status,200);
    const reviewed=await post("/api/playlists/review",{revision:original.revision,day:1,reviewed:true},"PUT");
    assert.deepEqual((await reviewed.json()).reviewed,[1]);
    assert.equal((await post("/api/playlists/approve-week",{revision:"stale"},"PUT")).status,409);
    const week = await post("/api/playlists/approve-week",{revision:original.revision},"PUT");
    assert.deepEqual((await week.json()).reviewed,[1,2,3,4,5,6,7]);
    const firstTrackId = original.playlists[0].tracks.at(-1).id;
    const changed = await fetch(base + "/api/playlists/daily-ordering?profile=mom-rock", {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({playlistIndex:1,firstTrackId})});
    assert.equal(changed.status,200);
    assert.equal((await changed.json()).playlists[0].tracks[0].id,firstTrackId);
    const reloaded = await (await fetch(base + "/api/playlists/daily?profile=mom-rock")).json();
    assert.equal(reloaded.firstTrackByPlaylist[1],firstTrackId);
    const updatedMix = await (await fetch(base + "/api/first-song-mix")).json();
    assert.equal(updatedMix.tracks[0].id,firstTrackId);
    assert.notEqual(updatedMix.revision,initialMix.revision);
    assert.equal(updatedMix.csvSaved,false);
    assert.equal((await post("/api/first-song-mix/publish",{revision:initialMix.revision,accountId:"account"})).status,409);
    assert.equal((await fetch(base + `/api/first-song-mix/export?revision=${initialMix.revision}`)).status,409);
    assert.deepEqual(reloaded.reviewed,[2,3,4,5,6,7]);
    const other = await (await fetch(base + "/api/playlists/daily?profile=mom-pop")).json();
    assert.deepEqual(other.firstTrackByPlaylist,{});
    assert.equal((await fetch(base + "/api/playlists/daily?profile=unknown")).status,404);
    const invalid = await fetch(base + "/api/playlists/daily-ordering?profile=mom-rock", {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({playlistIndex:1,firstTrackId:"not-a-member"})});
    assert.equal(invalid.status,400);
    fs.writeFileSync(path.join(dir,"rock.csv"),csv(71));
    assert.deepEqual((await (await fetch(base + "/api/playlists/daily?profile=mom-rock")).json()).firstTrackByPlaylist,{});
    fs.unlinkSync(path.join(dir,"pop.csv"));
    assert.equal(loadPreflight().valid,false);
    assert.equal(loadPreflight("../mom").valid,false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    process.chdir(previousCwd);
    if (previousUser === undefined) delete process.env.WAX_USER; else process.env.WAX_USER = previousUser;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
