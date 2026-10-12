import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Papa from "papaparse";
import { buildDailyPlaylists } from "./dailyPlaylists";
import { publishProfile, readJob, hasSavedExport, exportFiles, hash, writeJson, type PublishInput } from "./profilePublish";
import { createSpotifyPublisher, type SpotifyPublisher } from "./spotifyPublisher";
function fixture(): PublishInput {
  const result=buildDailyPlaylists(Array.from({length:70},(_,i)=>({id:String(i).padStart(22,"0"),name:`Song, ${i}`,artists:"Artist",album:"Album",bpm:100+i,energy:50,dance:60,valence:40})));
  return {profileId:"mom-rock", userDir:fs.mkdtempSync(path.join(os.tmpdir(),"wax-publish-")),revision:hash(result.playlists),result};
}
test("export keeps every playlist's precise order and CSV quoting",()=>{
  const input=fixture();
  try {
    assert.equal(hasSavedExport(input),false);
    const out=exportFiles(input);
    assert.equal(hasSavedExport(input),true);
    assert.equal(hasSavedExport({...input, revision:"changed"}),false);
    assert.equal(out.files.length,7);
    for(const file of out.files) {
      const rows=Papa.parse<{track_id:string;name:string}>(fs.readFileSync(path.join(out.directory,file.filename),"utf8"),{header:true,skipEmptyLines:true}).data;
      assert.deepEqual(rows.map(r=>r.track_id),input.result.playlists[file.day-1].tracks.map(t=>t.id));
      assert.equal(rows[0].name,input.result.playlists[file.day-1].tracks[0].name);
    }
  } finally {fs.rmSync(input.userDir,{recursive:true,force:true});}
});
test("partial Spotify failure resumes completed days; snapshot failure retries only snapshot",async()=>{
  const input=fixture(); let calls=0,fail=true,creates=0;
  const spotify:SpotifyPublisher={account:async()=>({id:"account"}),findOrCreate:async()=>String(++creates),replace:async()=>{calls++;if(calls===3&&fail)throw new Error("offline");}};
  try {
    await assert.rejects(publishProfile(input,"wrong",spotify),/account changed/);
    assert.equal(creates,0);
    await assert.rejects(publishProfile(input,"account",spotify),/offline/);
    assert.deepEqual(readJob(input)?.spotifyDone,[1,2]);
    fail=false;
    await assert.rejects(publishProfile(input,"account",spotify,()=>{throw new Error("disk failure");}),/disk failure/);
    assert.equal(readJob(input)?.spotifyDone.length,7);
    assert.equal(creates,7);
    assert.equal(calls,8);
    await publishProfile(input,"account",spotify,writeJson);
    assert.equal(readJob(input)?.snapshotDone,true);
    assert.equal(calls,8);
    await publishProfile(input,"account",spotify);
    assert.equal(calls,8);
    const snapshot=JSON.parse(fs.readFileSync(path.join(input.userDir,"snapshots",fs.readdirSync(path.join(input.userDir,"snapshots"))[0]),"utf8"));
    assert.deepEqual(snapshot.playlists,input.result.playlists);
  }finally{fs.rmSync(input.userDir,{recursive:true,force:true});}
});
test("Spotify retries 401, 429, transient PUT failures, but not ambiguous creates",async()=>{
  const old={...process.env};
  process.env.SPOTIFY_CLIENT_ID="test";process.env.SPOTIFY_CLIENT_SECRET="test";process.env.SPOTIFY_REFRESH_TOKEN="test";
  let puts=0,gets=0,tokens=0,posts=0;const waits:number[]=[];
  const fetcher:typeof fetch=async(url,init)=>{
    if(String(url).includes("api/token")){tokens++;return Response.json({access_token:"test"});}
    if(String(url).endsWith("/me")){gets++;return gets===1?new Response(null,{status:401}):Response.json({id:"account"});}
    if(init?.method==="PUT") {puts++;if(puts===1)return new Response(null,{status:429,headers:{"Retry-After":"1"}});if(puts===2)return new Response(null,{status:503});return Response.json({snapshot_id:"done"});}
    if(init?.method==="POST"){posts++;throw new Error("ambiguous network error");}
    return Response.json({items:[],next:null});
  };
  try {
    const spotify=createSpotifyPublisher(fetcher,async ms=>{waits.push(ms);});
    assert.equal((await spotify.account()).id,"account");assert.equal(tokens,2);
    await spotify.replace("playlist",["track"]);assert.equal(puts,3);assert.equal(waits[0],1000);
    await assert.rejects(spotify.findOrCreate("name","marker","account"));assert.equal(posts,1);
  }finally{for(const key of ["SPOTIFY_CLIENT_ID","SPOTIFY_CLIENT_SECRET","SPOTIFY_REFRESH_TOKEN"])if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
});

test("exports target next Monday, including Sunday evening and year rollover", async () => {
  const { weekStart } = await import("./profilePublish");
  assert.equal(weekStart(new Date(2026, 9, 10, 15)), "2026-10-12");
  assert.equal(weekStart(new Date(2026, 9, 11, 23, 59)), "2026-10-12");
  assert.equal(weekStart(new Date(2026, 9, 12, 0)), "2026-10-19");
  assert.equal(weekStart(new Date(2026, 11, 31)), "2027-01-04");
  const input = fixture();
  try {
    exportFiles({...input, week:"2026-10-05"});
    assert.equal(hasSavedExport({...input, week:"2026-10-12"}),false);
    const output=exportFiles({...input, week:"2026-10-12"});
    assert.ok(output.directory.includes("2026-10-12"));
    assert.equal(hasSavedExport({...input, week:"2026-10-12"}),true);
  } finally { fs.rmSync(input.userDir,{recursive:true,force:true}); }
});

test("Spotify prefers the original exact-name playlist over a marked duplicate on an earlier page", async () => {
  const keys = ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"] as const;
  const previous = keys.map(key => process.env[key]);
  keys.forEach(key => process.env[key] = "test");
  let creates = 0;
  const name = "Wax - Kasey-alt-rock Monday";
  const marker = "Wax v2 | kasey-alt-rock | day 1";
  let duplicate = false;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).includes("api/token")) return Response.json({access_token:"test"});
    if (init?.method === "POST") { creates++; throw new Error("Should not create"); }
    if (String(url).includes("offset=0")) return Response.json({items:[{id:"new-lowercase",name:"Wax - kasey-alt-rock Monday",description:marker,owner:{id:"account"}}, {id:"someone-else",name,description:"",owner:{id:"other"}}],next:"next"});
    const original = {id:"original",name,description:"My playlist",owner:{id:"account"}};
    return Response.json({items:duplicate ? [original,{...original,id:"ambiguous"}] : [original],next:null});
  };
  try {
    const spotify = createSpotifyPublisher(fetcher);
    assert.equal(await spotify.findOrCreate(name,marker,"account"),"original");
    assert.equal(creates,0);
    duplicate = true;
    await assert.rejects(spotify.findOrCreate(name,marker,"account"), /More than one playlist/);
    assert.equal(creates,0);
  } finally {
    keys.forEach((key,i) => { if(previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});
