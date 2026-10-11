import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyPlaylists } from "./dailyPlaylists";
import { loadPreflight, readProfileTracks } from "./profileConfig";
function tracks(n: number) { return Array.from({length:n},(_,i) => ({ id:String(i), name:`Song ${i}`, artists:"Artist", album:"", bpm:60+i%140, energy:i%101, dance:(i*3)%101, valence:(i*7)%101 })); }
test("every song appears exactly once with balanced sizes at boundaries and uneven totals", () => {
  for (const n of [70,193,245,700]) {
    const source = tracks(n);
    const result = buildDailyPlaylists(source);
    const sizes = result.playlists.map(p => p.trackCount);
    assert.equal(result.playlists.length,7);
    assert.equal(Math.max(...sizes)-Math.min(...sizes) <= 1,true);
    assert.deepEqual(result.playlists.flatMap(p => p.tracks.map(t => t.id)).sort(), source.map(t => t.id).sort());
    assert.deepEqual(buildDailyPlaylists(source),result);
  }
});
test("identical points still balance and first-song changes preserve membership", () => {
  const source = tracks(70).map(t => ({...t,bpm:100,energy:50,dance:50,valence:50}));
  const original = buildDailyPlaylists(source);
  const chosen = original.playlists[0].tracks.at(-1)!.id;
  const updated = buildDailyPlaylists(source,{firstTrackByPlaylist:{1:chosen}});
  assert.equal(updated.playlists[0].tracks[0].id,chosen);
  assert.deepEqual(updated.playlists[0].tracks.map(t=>t.id).sort(),original.playlists[0].tracks.map(t=>t.id).sort());
  assert.deepEqual(updated.playlists.slice(1),original.playlists.slice(1));
});
test("each step follows the nearest remaining song in normalized BPM/Mood space", () => {
  const source = tracks(193);
  const bpmMean=source.reduce((s,t)=>s+t.bpm,0)/source.length;
  const moods=source.map(t=>t.energy+t.dance+t.valence);
  const moodMean=moods.reduce((a,b)=>a+b,0)/source.length;
  const bpmStd=Math.sqrt(source.reduce((s,t)=>s+(t.bpm-bpmMean)**2,0)/source.length);
  const moodStd=Math.sqrt(moods.reduce((s,m)=>s+(m-moodMean)**2,0)/source.length);
  for(const p of buildDailyPlaylists(source).playlists) {
    const center={bpm:p.tracks.reduce((s,t)=>s+t.bpm,0)/p.trackCount,mood:p.tracks.reduce((s,t)=>s+t.mood,0)/p.trackCount};
    const dist=(a:{bpm:number;mood:number},b:{bpm:number;mood:number})=>Math.hypot((a.bpm-b.bpm)/bpmStd,(a.mood-b.mood)/moodStd);
    assert.ok(p.tracks.every(t=>dist(center,p.tracks[0])<=dist(center,t)+1e-10));
    for(let i=0;i<p.trackCount-1;i++) assert.ok(p.tracks.slice(i+1).every(t=>dist(p.tracks[i],p.tracks[i+1])<=dist(p.tracks[i],t)+1e-10));
  }
});
test("mom's three CSVs generate all 700 songs", () => {
  const report=loadPreflight("kaseysmom");
  assert.equal(report.valid,true);
  assert.deepEqual(report.profiles.map(p=>buildDailyPlaylists(readProfileTracks(p.path)).playlists.map(d=>d.trackCount)), [Array(7).fill(35),Array(7).fill(35),Array(7).fill(30)]);
});

test("weekday ranks follow mean BPM and saved opening songs follow their clusters", async () => {
  const { remapOpeningSongs } = await import("./dailyPlaylists");
  const result = buildDailyPlaylists(tracks(193));
  const ranked = [...result.playlists].sort((a,b)=>b.averageBpm-a.averageBpm);
  assert.deepEqual(result.playlists.map(p=>p.bpmRank),[1,3,6,4,2,5,7]);
  for (const p of result.playlists) {
    assert.equal(p.averageBpm,p.tracks.reduce((sum,t)=>sum+t.bpm,0)/p.trackCount);
    assert.equal(p.averageBpm,ranked[p.bpmRank-1].averageBpm);
  }
  const saved = Object.fromEntries(result.playlists.map((p,i)=>[String(7-i),p.tracks.at(-1)!.id]));
  const migrated=remapOpeningSongs(result,saved);
  const rebuilt=buildDailyPlaylists(tracks(193),{firstTrackByPlaylist:migrated});
  for(const p of rebuilt.playlists) assert.equal(p.tracks[0].id,result.playlists[p.index-1].tracks.at(-1)!.id);
});
