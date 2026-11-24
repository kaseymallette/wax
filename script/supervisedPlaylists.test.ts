import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Papa from "papaparse";
import { buildDailyPlaylists } from "../server/dailyPlaylists";
import { DAYS, exportFiles, hash, writeJson } from "../server/profilePublish";
import { prepareWeeklyRelease, writeWeeklyRelease } from "./buildWaxWeeklyData";
import { acceptSupervised, prepareSupervised, readOrderedCsv } from "./supervisedPlaylists";
import { overrideFile, readOverrides } from "./supervisedOverrides";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wax-supervised-"));
  const userDir = path.join(root, "users/kasey");
  const profileId = "kasey-alt-rock", week = "2026-11-02";
  writeJson(path.join(root, "wax_weekly/release.json"), { username: "kasey", profileIds: [profileId] });
  writeJson(path.join(userDir, "config.json"), { username: "kasey", profiles: [{ id: profileId, name: "Alt Rock", enabled: true, masterCsvPath: "unused.csv" }] });
  const result = buildDailyPlaylists(Array.from({ length: 70 }, (_, i) => ({ id: String(i).padStart(22, "0"), spotifyUrl: `https://open.spotify.com/track/${String(i).padStart(22, "0")}`, name: `Song ${i}`, artists: "Artist", album: "-Album", bpm: 100 + i, energy: 50, dance: 60, valence: 40 })));
  const snapshot = { schemaVersion: 2, profileId, weekStart: week, revision: hash(result.playlists), publishedAt: "2026-11-02T00:00:00.000Z", spotifyAccountId: "account", spotifyIds: Object.fromEntries(DAYS.map((_, i) => [i + 1, String(i + 1).repeat(22)])), ...result };
  const sourceFile = path.join(userDir, `snapshots/${profileId}-${week}.json`);
  writeJson(sourceFile, snapshot);
  const exported = exportFiles({ profileId, userDir, revision: snapshot.revision, result, week });
  const csv = path.join(exported.directory, "alt-rock-monday.csv");
  const input = path.join(userDir, "supervised", path.basename(exported.directory), "alt-rock-monday.csv");
  fs.mkdirSync(path.dirname(input), { recursive: true });
  const tracks = snapshot.playlists.find(p => p.index === 1)!.tracks;
  const upload = (ids: string[]) => fs.writeFileSync(input, Papa.unparse(ids.map((id, i) => ({ "#": i + 1, "Spotify Track Id": id, Song: "Ignore uploaded metadata", BPM: 999 }))));
  const mix = { playlistId: "a".repeat(22), accountId: "account", publishedAt: snapshot.publishedAt, tracks: DAYS.map((day, i) => ({ id: snapshot.playlists.find(p => p.index === i + 1)!.tracks[0].id, profileId, day })) };
  writeJson(path.join(userDir, "snapshots/first-songs-mix-test.json"), mix);
  writeWeeklyRelease(prepareWeeklyRelease(root));
  const siteFile = path.join(root, "wax_weekly/data.js");
  const site = () => JSON.parse(fs.readFileSync(siteFile, "utf8").replace(/^window.WAX_DATA = /, "").trim().replace(/;$/, ""));
  return { root, userDir, snapshot, sourceFile, csv, input, tracks, upload, siteFile, site };
}

test("prepare, review, accept and rebuild are isolated; omitted songs can be restored", () => {
  const f = fixture();
  try {
    const source = fs.readFileSync(f.sourceFile, "utf8");
    const original = f.site();
    const chosen = f.tracks.slice(2).reverse().map(t => t.id);
    f.upload(chosen);
    const initialExport = fs.readFileSync(f.csv, "utf8");
    prepareSupervised(f.root, f.input, true);
    assert.equal(fs.readFileSync(f.csv, "utf8"), initialExport);
    prepareSupervised(f.root, f.input);
    assert.deepEqual(readOrderedCsv(f.csv).ids, chosen);
    assert.equal(readOrderedCsv(f.csv).rows[0].row.name, f.tracks.at(-1)!.name);
    assert.deepEqual(f.site(), original);
    assert.deepEqual(prepareWeeklyRelease(f.root).data, original);
    // Accept uses the reviewed export, even after the upload changes.
    f.upload(f.tracks.map(t => t.id));
    acceptSupervised(f.root, f.csv, true);
    assert.equal(fs.existsSync(overrideFile(f.userDir)), false);
    acceptSupervised(f.root, f.csv);
    const acceptedSite = f.site();
    assert.deepEqual(acceptedSite.stations[0].days[0].tracks.map((t: { u: string }) => t.u.split('/').at(-1)), chosen);
    assert.deepEqual(acceptedSite.stations[0].days.slice(1), original.stations[0].days.slice(1));
    assert.equal(acceptedSite.stations[0].days[0].playlist_url, original.stations[0].days[0].playlist_url);
    assert.equal(acceptedSite.first_songs, undefined);
    const accepted = fs.readFileSync(overrideFile(f.userDir), "utf8");
    acceptSupervised(f.root, f.csv);
    assert.equal(fs.readFileSync(overrideFile(f.userDir), "utf8"), accepted);
    prepareSupervised(f.root, f.input); // restores all original songs, draft only
    assert.deepEqual(readOrderedCsv(f.csv).ids, f.tracks.map(t => t.id));
    assert.deepEqual(f.site(), acceptedSite);
    writeWeeklyRelease(prepareWeeklyRelease(f.root));
    assert.deepEqual(f.site(), acceptedSite);
    acceptSupervised(f.root, f.csv);
    assert.deepEqual(f.site().first_songs, original.first_songs);
    assert.equal(fs.readFileSync(f.sourceFile, "utf8"), source);
    assert.equal(readOverrides(f.userDir).length, 1);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("invalid inputs and mismatched targets fail before changing files", () => {
  const f = fixture();
  try {
    const original = fs.readFileSync(f.csv, "utf8");
    for (const rows of [
      [{ "#": 1, "Spotify Track Id": f.tracks[0].id }, { "#": 2, "Spotify Track Id": f.tracks[0].id }],
      [{ "#": 2, "Spotify Track Id": f.tracks[0].id }],
      [{ "#": 1, rank: 2, "Spotify Track Id": f.tracks[0].id }],
      [{ "#": 1, "Spotify Track Id": "z".repeat(22) }],
    ]) {
      fs.writeFileSync(f.input, Papa.unparse(rows));
      assert.throws(() => prepareSupervised(f.root, f.input));
      assert.equal(fs.readFileSync(f.csv, "utf8"), original);
    }
    f.upload(f.tracks.map(t => t.id));
    prepareSupervised(f.root, f.input);
    const before = fs.readFileSync(f.siteFile, "utf8");
    const changed = f.site(); changed.week_start = "2026-11-09";
    fs.writeFileSync(f.siteFile, `window.WAX_DATA = ${JSON.stringify(changed)};\n`);
    assert.throws(() => acceptSupervised(f.root, f.csv), /week\/profile/);
    assert.equal(fs.existsSync(overrideFile(f.userDir)), false);
    fs.writeFileSync(f.siteFile, before);
    const newer = structuredClone(f.snapshot);
    newer.playlists[0].tracks.reverse(); newer.revision = hash(newer.playlists);
    newer.publishedAt = "2026-11-03T00:00:00.000Z";
    writeJson(f.sourceFile, newer);
    assert.throws(() => acceptSupervised(f.root, f.csv), /source revision/);
    assert.equal(fs.readFileSync(f.siteFile, "utf8"), before);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("accepted orders reject replacement revisions and never leak into a new week", () => {
  const f = fixture();
  try {
    f.upload(f.tracks.slice(1).reverse().map(t => t.id));
    prepareSupervised(f.root, f.input); acceptSupervised(f.root, f.csv);
    const newer = structuredClone(f.snapshot);
    newer.playlists[0].tracks.reverse(); newer.revision = hash(newer.playlists);
    newer.publishedAt = "2026-11-03T00:00:00.000Z";
    writeJson(f.sourceFile, newer);
    assert.throws(() => prepareWeeklyRelease(f.root), /conflicts/);
    newer.weekStart = "2026-11-09";
    writeJson(f.sourceFile, newer);
    const release = prepareWeeklyRelease(f.root);
    assert.deepEqual(release.data.stations[0].days[0].tracks.map(t => t.u.split('/').at(-1)), newer.playlists[0].tracks.map(t => t.id));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("CSV ordering supports physical rows and rank, rejecting malformed and empty CSVs", () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.input, Papa.unparse(f.tracks.slice(0, 2).map(t => ({ track_id: t.id }))));
    assert.deepEqual(readOrderedCsv(f.input).ids, f.tracks.slice(0, 2).map(t => t.id));
    fs.writeFileSync(f.input, Papa.unparse([{ rank: 2, track_id: f.tracks[0].id }, { rank: 1, track_id: f.tracks[1].id }]));
    assert.deepEqual(readOrderedCsv(f.input).ids, [f.tracks[1].id, f.tracks[0].id]);
    for (const text of ['track_id\n', 'track_id\n"unterminated', 'track_id,track_id\na,b']) {
      fs.writeFileSync(f.input, text); assert.throws(() => readOrderedCsv(f.input));
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
