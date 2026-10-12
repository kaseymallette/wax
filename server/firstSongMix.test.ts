import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Papa from "papaparse";
import { buildDailyPlaylists } from "./dailyPlaylists";
import { buildFirstSongMix, saveFirstSongMix, mixExportPath, publishFirstSongMix, readMixPublication } from "./firstSongMix";
import type { SpotifyPublisher } from "./spotifyPublisher";

function sources() {
  return ["Alt Rock", "Classic Rock", "Country Blues", "Electropop", "Indie Folk", "Pop & Hip-Hop"].map((name, p) => ({
    profile: { id: `profile-${p}`, name },
    result: buildDailyPlaylists(Array.from({ length: 70 }, (_, i) => ({ id: `${p}${String(i).padStart(21, "0")}`, name: `Song, "${i}"`, artists: "Artist", album: "Album", bpm: 90 + i, energy: 50, dance: 60, valence: 40 }))),
  }));
}
test("mix keeps profile order, orders each profile Monday–Sunday, and preserves choices", () => {
  const input = sources();
  input[0].result.playlists[0].tracks.reverse();
  input[0].result.playlists.reverse(); // Day ordering must use indices, not array position.
  const before = JSON.stringify(input);
  const mix = buildFirstSongMix("kasey", "2026-10-12", input);
  assert.equal(mix.tracks.length, 42);
  assert.deepEqual(mix.tracks.map(t => t.id), input.flatMap(s => [...s.result.playlists].sort((a, b) => a.index - b.index).map(p => p.tracks[0].id)));
  assert.equal(mix.tracks[0].day, "Monday");
  assert.equal(mix.tracks[6].day, "Sunday");
  assert.equal(mix.tracks[7].profile, "Classic Rock");
  assert.equal(JSON.stringify(input), before);
  assert.equal(buildFirstSongMix("kasey", "2026-10-12", input).revision, mix.revision);
  input[1].result.playlists[0].tracks.reverse();
  assert.notEqual(buildFirstSongMix("kasey", "2026-10-12", input).revision, mix.revision);
  assert.notEqual(buildFirstSongMix("kasey", "2026-10-19", input).revision, mix.revision);
  input[2].result.playlists.pop();
  assert.throws(() => buildFirstSongMix("kasey", "2026-10-12", input), /missing an opening song/);
});
test("CSV roundtrip preserves 42 ordered songs and previous exports", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wax-mix-"));
  try {
    const input = sources();
    const mix = buildFirstSongMix("kasey", "2026-10-12", input);
    const file = saveFirstSongMix(dir, mix);
    const before = fs.readFileSync(file, "utf8");
    const parsed = Papa.parse<Record<string, string>>(before, { header: true, skipEmptyLines: true });
    assert.equal(parsed.errors.length, 0);
    assert.deepEqual(parsed.data.map(r => r.track_id), mix.tracks.map(t => t.id));
    assert.equal(parsed.data[0].name, mix.tracks[0].name);
    assert.equal(parsed.data[41].rank, "42");
    input[0].result.playlists[0].tracks.reverse();
    const changed = buildFirstSongMix("kasey", "2026-10-12", input);
    assert.notEqual(saveFirstSongMix(dir, changed), file);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.ok(fs.existsSync(mixExportPath(dir, changed)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("mix publish checks account, resumes failure, and updates the same playlist", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wax-mix-"));
  let creates = 0, replaces = 0, fail = true;
  const input = sources();
  let mix = buildFirstSongMix("kasey", "2026-10-12", input);
  const spotify: SpotifyPublisher = {
    account: async () => ({ id: "account" }),
    findOrCreate: async name => { assert.equal(name, "Wax - Kasey First Songs"); creates++; return "playlist"; },
    replace: async (id, tracks) => { assert.equal(id, "playlist"); assert.deepEqual(tracks, mix.tracks.map(t => t.id)); replaces++; if (fail) throw new Error("offline"); },
  };
  try {
    await assert.rejects(publishFirstSongMix(dir, mix, "wrong", spotify), /account changed/);
    assert.equal(creates, 0);
    await assert.rejects(publishFirstSongMix(dir, mix, "account", spotify), /offline/);
    assert.equal(readMixPublication(dir)?.complete, false);
    fail = false;
    await publishFirstSongMix(dir, mix, "account", spotify);
    await publishFirstSongMix(dir, mix, "account", spotify);
    assert.equal(creates, 1);
    assert.equal(replaces, 2);
    input[0].result.playlists[0].tracks.reverse();
    mix = buildFirstSongMix("kasey", "2026-10-12", input);
    await publishFirstSongMix(dir, mix, "account", spotify);
    assert.equal(creates, 1);
    assert.equal(replaces, 3);
    assert.equal(readMixPublication(dir)?.revision, mix.revision);
    assert.equal(readMixPublication(dir)?.complete, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
