import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PublishCollection, type PublishStatus } from "@/components/PublishCollection";
import { FirstSongMix } from "@/components/FirstSongMix";
import { PlaylistMap } from "@/components/PlaylistMap";
import { Disc3, Play, ExternalLink, Search } from "lucide-react";
import type { PreflightReport } from "../../../server/profileConfig";
import type { DailyPlaylistsResult } from "../../../server/dailyPlaylists";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type Result = DailyPlaylistsResult & { firstTrackByPlaylist: Record<string, string>; revision: string; targetWeek: string; csvSaved: boolean; reviewed: number[]; publish: PublishStatus };
export default function PlaylistsPage({ stage = "organize" }: { stage?: "visualize" | "organize" | "publish" }) {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/:stage/:id");
  const profiles = useQuery<PreflightReport>({ queryKey: ["/api/profiles/preflight"] });
  const selected = params?.id;
  const profile = profiles.data?.profiles.find(p => p.id === selected) ?? profiles.data?.profiles[0];
  return <Layout>
    <p className="collection-eyebrow"><Disc3 size={15} /> YOUR WEEK ON WAX</p>
    <h1 className="mt-5 font-display text-4xl font-bold tracking-tight">{stage === "visualize" ? "See your week take shape." : stage === "publish" ? "Take your week with you." : "Seven days. Your soundtrack."}</h1>
    <p className="mt-3 text-muted-foreground">{stage === "visualize" ? "Explore how your songs come together, then head to Organize to find their flow." : stage === "publish" ? "Save your finished playlists or send them to Spotify, one collection at a time." : "Pick a day, take a listen, and make the opening yours. Your choices save automatically."}</p>
    <div className="my-8 flex flex-wrap gap-2" aria-label="Genre collections">
      {profiles.data?.profiles.map(p => <Button key={p.id} variant={profile?.id === p.id ? "default" : "outline"} aria-pressed={profile?.id === p.id} onClick={() => navigate(`/${stage}/${p.id}`)}>{p.name}</Button>)}
    </div>
    {profiles.error && <p role="alert">Could not load your collections. Refresh to try again.</p>}
    {profile && <Collection key={profile.id} id={profile.id} name={profile.name} stage={stage} />}
    {stage === "publish" && <FirstSongMix />}
  </Layout>;
}
function Collection({ id, name, stage }: { id: string; name: string; stage: "visualize" | "organize" | "publish" }) {
  const [, navigate] = useLocation();
  const [day, setDay] = useState(0);
  const [search, setSearch] = useState("");
  const [foundTrack, setFoundTrack] = useState<string | null>(null);
  useEffect(() => {
    if (!foundTrack || stage !== "organize") return;
    const row = document.getElementById(`song-${foundTrack}`);
    row?.scrollIntoView({ block: "center", behavior: "auto" });
    row?.focus({ preventScroll: true });
  }, [foundTrack, day, stage]);
  const [preview, setPreview] = useState<string | null>(null);
  const endpoint = `/api/playlists/daily?profile=${encodeURIComponent(id)}`;
  const query = useQuery<Result>({ queryKey: [endpoint], refetchInterval: q => q.state.data?.publish.running ? 1500 : false, queryFn: async () => (await apiRequest("GET", endpoint)).json() });
  const ordering = useMutation({
    mutationFn: async (firstTrackId: string | null): Promise<Result> => (await apiRequest("PUT", `/api/playlists/daily-ordering?profile=${encodeURIComponent(id)}`, { playlistIndex: day + 1, firstTrackId })).json(),
    onSuccess: data => queryClient.setQueryData([endpoint], data),
  });
  const busy = ordering.isPending || !!query.data?.publish.running;
  const playlist = query.data?.playlists[day];
  const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const terms = normalizeSearch(search).trim().split(/\s+/).filter(Boolean);
  const matches = terms.length ? (query.data?.playlists ?? []).flatMap(p => p.tracks.flatMap((track, index) => {
    const text = normalizeSearch(`${track.name} ${track.artists}`);
    return terms.every(term => text.includes(term)) ? [{ track, dayIndex: p.index - 1, position: index + 1 }] : [];
  })) : [];

  if (query.isLoading) return <p role="status" className="py-12">Finding the flow for {name}…</p>;
  if (query.error) return <div role="alert"><p>{query.error.message}</p><Button className="mt-4" onClick={() => query.refetch()}>Try again</Button></div>;
  if (stage === "publish") return <>
    <Button variant="ghost" onClick={() => navigate(`/organize/${id}`)}>← Back to organizing {name}</Button>
    <h2 className="mt-6 font-display text-2xl font-bold">{name}</h2>
    {query.data && <PublishCollection targetWeek={query.data.targetWeek} csvSaved={query.data.csvSaved} id={id} revision={query.data.revision} reviewed={query.data.reviewed} status={query.data.publish} busy={busy} refresh={() => { void query.refetch(); }} />}
  </>;
  if (stage === "visualize") return <>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" onClick={() => navigate("/")}>← Collections</Button>
      <Button onClick={() => navigate(`/organize/${id}`)}>Continue to organize →</Button>
    </div>
    <p className="mb-4 text-sm text-muted-foreground">{query.data?.diagnostics.usableTrackCount} songs · 7 daily mixes. Hover over or select a dot to explore a song.</p>
    {query.data && <PlaylistMap playlists={query.data.playlists} name={name} disabled={false} onSelect={dayIndex => setDay(dayIndex)} />}
    <div className="mt-6 flex justify-end"><Button onClick={() => navigate(`/organize/${id}`)}>Organize {name} →</Button></div>
  </>;
  return <>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" onClick={() => navigate(`/visualize/${id}`)}>← Visualize</Button><Button disabled={busy} onClick={() => navigate(`/publish/${id}`)}>Continue to save & publish →</Button></div>
    <div className="mb-6 flex items-baseline justify-between gap-4"><h2 className="font-display text-2xl font-bold">{name}</h2><p className="text-sm text-muted-foreground">{query.data?.diagnostics.usableTrackCount} songs · 7 daily mixes</p></div>
    <div className="mb-6">
      <label htmlFor="song-search" className="mb-2 block text-sm font-medium">Find a song in {name}</label>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4">
        <Search size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <input id="song-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by song or artist…" aria-describedby="song-search-status" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        {search && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFoundTrack(null); document.getElementById("song-search")?.focus(); }}>Clear</Button>}
      </div>
      <p id="song-search-status" role="status" className="mt-2 text-xs text-muted-foreground">{terms.length ? matches.length ? `${matches.length} ${matches.length === 1 ? "song found" : "songs found"} across this collection. Select a song to jump to its day.` : "No matching songs in this collection. Try another song or artist." : "Search all seven days in this collection."}</p>
      {matches.length > 0 && <ul aria-label="Song search results" className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-border bg-card divide-y divide-border">
        {matches.map(({ track, dayIndex, position }) => <li key={track.id}><button disabled={busy} onClick={() => { setDay(dayIndex); setPreview(null); setFoundTrack(track.id); }} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-primary/10 focus-visible:outline focus-visible:outline-primary">
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{track.name}</span><span className="block truncate text-xs text-muted-foreground">{track.artists}</span></span>
          <span className="shrink-0 text-right"><span className="block text-sm font-medium text-primary">{DAYS[dayIndex]}</span><span className="block text-xs text-muted-foreground">Song {position}</span></span>
        </button></li>)}
      </ul>}
    </div>
    <p className="mb-4 text-sm text-muted-foreground">Monday starts in green in the upper-left quadrant. Tuesday through Sunday follow clockwise around the playlist map.</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Daily playlists">
      {query.data?.playlists.map((p, i) => <button key={p.index} disabled={busy} aria-pressed={day === i} onClick={() => { setDay(i); setPreview(null); setFoundTrack(null); }} className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${day === i ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}><span className="block text-xs uppercase tracking-widest text-muted-foreground">{DAYS[i].slice(0, 3)}</span><span className="mt-2 block font-display text-2xl font-bold">{p.trackCount}<span className="ml-1 text-xs font-normal text-muted-foreground">songs</span></span><span className="mt-2 block text-xs text-muted-foreground">{Math.round(p.averageBpm)} avg BPM</span></button>)}
    </div>
    {playlist && <section className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="collection-eyebrow">DAILY MIX / 0{day + 1}</p><h3 className="mt-2 font-display text-3xl font-bold">{DAYS[day]}</h3></div><div className="w-full sm:max-w-sm"><label htmlFor="first-song" className="mb-2 block text-sm font-medium">Set the opening song</label><select id="first-song" className="w-full rounded-lg border border-border bg-background p-3 text-sm" disabled={busy} value={query.data?.firstTrackByPlaylist[String(day + 1)] ?? ""} onChange={event => ordering.mutate(event.target.value || null)}><option value="">Let Wax choose</option>{playlist.tracks.map(t => <option key={t.id} value={t.id}>{t.name} — {t.artists}</option>)}</select><p className="mt-2 text-xs text-muted-foreground" role="status">{ordering.isPending ? "Finding the new flow…" : "The rest of the mix flows from your first song."}</p></div></div>
      {ordering.error && <p role="alert" className="mt-4 text-destructive">Couldn’t save your opening song. {ordering.error.message}</p>}
      {preview && <iframe className="mt-5 w-full rounded-xl" title="Spotify song preview" src={`https://open.spotify.com/embed/track/${preview}`} height="152" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />}
      <ol className="mt-6 divide-y divide-border">{playlist.tracks.map((t, i) => <li key={t.id} id={`song-${t.id}`} tabIndex={-1} className={`flex items-center gap-3 py-3 scroll-mt-24 focus:outline-none ${foundTrack === t.id ? "rounded-lg bg-primary/10 ring-1 ring-primary px-2" : ""}`}><span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span><button aria-label={`Preview ${t.name}`} onClick={() => setPreview(t.id)} className="rounded-full border border-border p-2 hover:bg-primary/15 focus-visible:outline focus-visible:outline-primary"><Play size={14} /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{t.name}</p><p className="truncate text-xs text-muted-foreground">{t.artists}</p></div><span className="hidden text-xs text-muted-foreground sm:block">{t.bpm} BPM</span><a href={t.spotifyUrl ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open ${t.name} in Spotify`} className="p-2 text-muted-foreground hover:text-primary"><ExternalLink size={14} /></a></li>)}</ol>
    </section>}
  </>;
}
