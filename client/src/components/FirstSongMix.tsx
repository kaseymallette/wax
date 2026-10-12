import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "./ui/button";
import type { FirstSongMix as Mix } from "../../../server/firstSongMix";

type Result = Mix & { csvSaved: boolean; running: boolean; error?: string; publication: { complete: boolean; playlistId: string } | null };
export function FirstSongMix() {
  const [account, setAccount] = useState<{ id: string; name: string } | null>(null);
  const query = useQuery<Result>({
    queryKey: ["/api/first-song-mix"], staleTime: 0, refetchOnWindowFocus: true,
    refetchInterval: q => q.state.data?.running ? 1500 : false,
    queryFn: async () => (await apiRequest("GET", "/api/first-song-mix")).json(),
  });
  const action = useMutation({
    mutationFn: async (kind: "export" | "publish" | "account") => {
      if (kind === "account") { setAccount(await (await apiRequest("GET", "/api/spotify/account")).json()); return; }
      await apiRequest("POST", `/api/first-song-mix/${kind}`, { revision: query.data?.revision, accountId: account?.id });
    },
    onSettled: () => { void query.refetch(); },
  });
  const mix = query.data;
  const busy = action.isPending || !!mix?.running || query.isFetching;
  const groups = mix ? Array.from(new Set(mix.tracks.map(t => t.profileId))).map(id => mix.tracks.filter(t => t.profileId === id)) : [];
  return <section className="my-8 rounded-2xl border border-primary/30 bg-card p-5 sm:p-7" aria-labelledby="first-song-mix-title">
    <p className="collection-eyebrow">ALL YOUR OPENING SONGS</p>
    <h2 id="first-song-mix-title" className="mt-3 font-display text-3xl font-bold">First songs. One mix.</h2>
    <p className="mt-3 text-sm text-muted-foreground">The first song from every day, across all your collections. Monday through Sunday for each profile, in your collection order.</p>
    {query.isLoading && <p role="status" className="mt-4">Gathering your opening songs…</p>}
    {mix && <>
      <p className="mt-4 font-medium">{mix.tracks.length} songs · {groups.length} collections · Week of {new Date(`${mix.week}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</p>
      <p className="mt-2 text-sm text-muted-foreground">Uses your current opening-song choices, including any you let Wax choose. Changing an opener updates this mix.</p>
      <details className="mt-5 rounded-xl border border-border p-4">
        <summary className="cursor-pointer font-medium">See the {mix.tracks.length}-song mix</summary>
        <div className="mt-4 grid gap-6 md:grid-cols-2">{groups.map(tracks => <div key={tracks[0].profileId}>
          <h3 className="font-display text-lg font-bold">{tracks[0].profile}</h3>
          <ol className="mt-2 divide-y divide-border">{tracks.map(t => <li key={t.day} className="flex gap-3 py-2 text-sm"><span className="w-10 shrink-0 text-muted-foreground">{t.day.slice(0, 3)}</span><div className="min-w-0"><a className="font-medium hover:text-primary" href={t.spotifyUrl ?? undefined} target="_blank" rel="noreferrer">{t.name}</a><p className="text-xs text-muted-foreground">{t.artists}</p></div></li>)}</ol>
        </div>)}</div>
      </details>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => action.mutate("export")}>{mix.csvSaved ? "Save mix CSV again" : "Save mix CSV"}</Button>
        {mix.csvSaved && <a className="text-sm text-primary underline" href={`/api/first-song-mix/export?revision=${mix.revision}`} download>Download mix CSV</a>}
        <Button variant="ghost" disabled={busy} onClick={() => query.refetch()}>Refresh mix</Button>
      </div>
      <div className="mt-5 border-t border-border pt-5">
        <h3 className="font-medium">{mix.name}</h3>
        <p className="mt-2 text-sm text-muted-foreground">Publish one private Spotify playlist. Publishing updated choices replaces the songs in that same mix.</p>
        {mix.publication?.complete ? <a className="mt-3 inline-block text-primary underline" href={`https://open.spotify.com/playlist/${mix.publication.playlistId}`} target="_blank" rel="noreferrer">Open mix on Spotify</a> : <>
          {!account ? <Button className="mt-4" variant="secondary" disabled={busy} onClick={() => action.mutate("account")}>Check Spotify account for mix</Button> : <><p className="mt-3 text-sm">Publishing to <strong>{account.name}</strong> ({account.id}).</p><Button className="mt-3" disabled={busy || mix.tracks.length > 100} onClick={() => action.mutate("publish")}>{mix.running ? "Publishing mix…" : mix.error ? "Retry publishing mix" : "Publish first-song mix"}</Button></>}
          {mix.tracks.length > 100 && <p className="mt-2 text-sm">Spotify publishing supports up to 100 songs; your full mix is available as a CSV.</p>}
        </>}
        {mix.running && <p role="status" className="mt-3 text-sm">Sending your opening songs to Spotify…</p>}
      </div>
    </>}
    {(query.error || action.error || mix?.error) && <div role="alert" className="mt-4 text-sm text-destructive">{query.error?.message || action.error?.message || mix?.error}<Button className="ml-3" variant="outline" disabled={busy} onClick={() => query.refetch()}>Refresh mix</Button></div>}
  </section>;
}
