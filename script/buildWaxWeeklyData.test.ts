import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDailyPlaylists } from "../server/dailyPlaylists";
import { hash, writeJson } from "../server/profilePublish";
import { prepareWeeklyRelease, writeWeeklyRelease } from "./buildWaxWeeklyData";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wax-weekly-"));
  const ids = ["kasey-alt-rock", "kasey-electropop"];
  writeJson(path.join(root, "wax_weekly/release.json"), { username: "kasey", profileIds: ids });
  writeJson(path.join(root, "users/kasey/config.json"), { username: "kasey", profiles: ids.map(id => ({id, name:id, masterCsvPath:"unused.csv", enabled:true})) });
  const result = buildDailyPlaylists(Array.from({length:70}, (_, i) => ({id:String(i).padStart(22,"0"), name:`Song ${i}`, artists:"Artist", album:"Album", bpm:100+i, energy:50, dance:60, valence:40})));
  const snapshot = (id: string, week = "2026-10-12", time = "2026-10-11T23:00:00.000Z") => ({ schemaVersion:2, profileId:id, weekStart:week, publishedAt:time, revision:hash(result.playlists), spotifyAccountId:"account", spotifyIds:Object.fromEntries(result.playlists.map(p => [p.index,String(p.index).repeat(22)])), ...structuredClone(result) });
  const save = (s: ReturnType<typeof snapshot>, suffix = "") => writeJson(path.join(root, "users/kasey/snapshots", `${s.profileId}-${s.weekStart}${suffix}.json`),s);
  ids.forEach(id => save(snapshot(id)));
  return { root, ids, snapshot, save };
}
test("v2 release preserves published song order and Spotify IDs, and includes Electropop", () => {
  const f = fixture();
  try {
    const s = f.snapshot(f.ids[1]);
    s.playlists[0].tracks.reverse();
    s.revision = hash(s.playlists);
    f.save(s);
    const release = prepareWeeklyRelease(f.root);
    assert.deepEqual(release.data.stations.map(s => s.id),f.ids);
    assert.deepEqual(release.data.stations[1].days[0].tracks.map(t => t.t), s.playlists[0].tracks.map(t => t.name));
    assert.equal(release.data.stations[1].days[6].playlist_url, `https://open.spotify.com/playlist/${s.spotifyIds[7]}`);
    assert.equal(release.data.stations[1].days[0].tracks[0].n,1);
    writeWeeklyRelease(release);
    const first = fs.readFileSync(path.join(f.root,"wax_weekly/data.js"),"utf8");
    writeWeeklyRelease(prepareWeeklyRelease(f.root));
    assert.equal(fs.readFileSync(path.join(f.root,"wax_weekly/data.js"),"utf8"),first);
    assert.ok(!first.includes("spotifyAccountId"));
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
test("incomplete newest week fails without changing files; explicit complete week works", () => {
  const f=fixture();
  try {
    writeWeeklyRelease(prepareWeeklyRelease(f.root));
    const before=fs.readFileSync(path.join(f.root,"wax_weekly/data.js"),"utf8");
    f.save(f.snapshot(f.ids[0],"2026-10-19"));
    assert.throws(()=>prepareWeeklyRelease(f.root),/Missing published snapshot/);
    assert.equal(fs.readFileSync(path.join(f.root,"wax_weekly/data.js"),"utf8"),before);
    assert.equal(prepareWeeklyRelease(f.root,"2026-10-12").data.week_start,"2026-10-12");
    assert.throws(()=>prepareWeeklyRelease(f.root,"2026-10-13"),/Monday/);
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
test("latest published revision wins; corrupt snapshots and missing links fail", () => {
  const f=fixture();
  try {
    const newer=f.snapshot(f.ids[0],"2026-10-12","2026-10-12T00:00:00.000Z");
    newer.playlists[0].tracks.reverse();
    newer.revision=hash(newer.playlists);
    f.save(newer,"-new");
    assert.equal(prepareWeeklyRelease(f.root).data.stations[0].days[0].tracks[0].t,newer.playlists[0].tracks[0].name);
    newer.playlists[0].tracks[0].name="tampered";
    f.save(newer,"-new");
    assert.throws(()=>prepareWeeklyRelease(f.root),/revision does not match/);
    newer.revision=hash(newer.playlists);
    delete newer.spotifyIds[7];
    f.save(newer,"-new");
    assert.throws(()=>prepareWeeklyRelease(f.root),/Incomplete daily playlists or Spotify links/);
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});

test("jukebox links only a published mix with matching ordered openers and account", () => {
  const f=fixture();
  try {
    assert.equal(prepareWeeklyRelease(f.root).data.first_songs,undefined);
    const tracks=f.ids.flatMap(id=>f.snapshot(id).playlists.map((p,i)=>({id:p.tracks[0].id,profileId:id,day:["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][i]})));
    const file=path.join(f.root,"users/kasey/snapshots/first-songs-mix-2026-10-19-test.json");
    const mix={playlistId:"a".repeat(22),accountId:"account",publishedAt:"2026-10-12T01:00:00.000Z",tracks};
    writeJson(file,mix);
    assert.equal(prepareWeeklyRelease(f.root).data.first_songs?.playlist_url,`https://open.spotify.com/playlist/${mix.playlistId}`);
    writeJson(file,{...mix,tracks:[...tracks].reverse()});
    assert.equal(prepareWeeklyRelease(f.root).data.first_songs,undefined);
    writeJson(file,{...mix,accountId:"someone-else"});
    assert.equal(prepareWeeklyRelease(f.root).data.first_songs,undefined);
    writeJson(file,mix);
    writeJson(path.join(f.root,"users/kasey/snapshots/first-songs-mix-newer.json"),{...mix,publishedAt:"2026-10-13T01:00:00.000Z",tracks:[...tracks].reverse()});
    assert.equal(prepareWeeklyRelease(f.root).data.first_songs,undefined);
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
