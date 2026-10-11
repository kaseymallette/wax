import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { apiRequest } from "@/lib/queryClient";
import type { PublishJob } from "../../../server/profilePublish";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export type PublishStatus = { running: boolean; job: PublishJob | null; error?: string };
export function PublishCollection({ id, revision, reviewed, status, busy, refresh, csvSaved, targetWeek }: { targetWeek: string; csvSaved: boolean; id: string; revision: string; reviewed: number[]; status: PublishStatus; busy: boolean; refresh: () => void }) {
  const [account, setAccount] = useState<{ id: string; name: string } | null>(null);
  const action = useMutation({
    mutationFn: async (kind: "export" | "account" | "publish" | "approve-week") => {
      if (kind === "account") { const result = await (await apiRequest("GET", "/api/spotify/account")).json(); setAccount(result); return; }
      await apiRequest(kind === "approve-week" ? "PUT" : "POST", `/api/playlists/${kind}?profile=${encodeURIComponent(id)}`, { revision, accountId: account?.id });
    },
    onSuccess: () => refresh(),
  });
  const pending = busy || action.isPending || status.running;
  const complete = status.job?.snapshotDone;
  return <section className="my-8 rounded-2xl border border-border bg-card p-5 sm:p-7">
    <p className="collection-eyebrow">MAKE IT A WEEK</p>
    <p className="mt-2 text-sm font-medium">For the week of {new Date(`${targetWeek}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-display text-2xl font-bold">{complete ? "Your week is on Spotify." : csvSaved ? "Your playlists are saved." : "Save your playlists."}</h3><p className="mt-2 text-sm text-muted-foreground">{csvSaved ? "All seven CSVs include your current song order." : "Your opening-song choices are saved automatically. Save CSV copies of all seven playlists here."}</p></div><Button disabled={pending} variant="outline" onClick={() => action.mutate("export")}>{csvSaved ? "Save CSVs again" : "Save playlist CSVs"}</Button></div>
    {csvSaved && <div role="status" className="mt-4"><p className="text-sm">Download your saved playlists:</p><div className="mt-2 flex flex-wrap gap-3">{DAYS.map((day, i) => <a className="text-sm text-primary underline" key={day} href={`/api/playlists/export/${i + 1}?profile=${encodeURIComponent(id)}&revision=${revision}`} download>{day}</a>)}</div></div>}
    <div className="mt-5 border-t border-border pt-5">
      <h4 className="font-medium">Send to Spotify</h4>
      <p className="mb-4 mt-2 text-sm text-muted-foreground">{complete ? "All seven playlists are published." : reviewed.length === 7 ? "This week is approved for Spotify. Ready to publish." : "Happy with the song order? Approve this week, then publish to Spotify."}</p>
      {!complete && <div className="mb-4"><Button disabled={pending || reviewed.length === 7} onClick={() => action.mutate("approve-week")}>{reviewed.length === 7 ? "✓ Week approved" : "Approve this week"}</Button><p className="mt-2 text-xs text-muted-foreground">Approves all seven playlists in this collection. If you change the songs or their order, approve the week again.</p></div>}
      {!account ? <Button variant="secondary" disabled={pending} onClick={() => action.mutate("account")}>Check Spotify account</Button> : <><p className="text-sm">Publishing to <strong>{account.name}</strong> ({account.id}). Creates seven private playlists; publishing again replaces their songs with this approved order.</p><Button className="mt-4" disabled={pending || reviewed.length !== 7 || !!complete} onClick={() => action.mutate("publish")}>{complete ? "Published" : status.running ? "Publishing…" : status.job || status.error ? "Retry publish" : "Publish collection"}</Button></>}
      {status.running && <p role="status" className="mt-3 text-sm">{status.job?.csvDone ? "CSVs saved." : "Preparing your files…"} {status.job?.spotifyDone.length ?? 0} of 7 playlists sent to Spotify.</p>}
      {complete && <div className="mt-3"><p className="text-sm">Weekly snapshot saved for {status.job?.week}.</p><div className="mt-2 flex flex-wrap gap-3">{DAYS.map((day, i) => <a key={day} className="text-sm text-primary underline" target="_blank" rel="noreferrer" href={`https://open.spotify.com/playlist/${status.job?.spotifyIds[String(i + 1)]}`}>{day}</a>)}</div></div>}
      {(action.error || status.error || status.job?.error) && <p role="alert" className="mt-3 text-sm text-destructive">{action.error?.message || status.error || status.job?.error}</p>}
    </div>
  </section>;
}
