import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import type { ListenWithTrack, TrackWithStats } from "@shared/schema";
import { ACTIVITY_PRESETS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { ImportEmptyState } from "@/components/EmptyState";
import { AlbumArt } from "@/components/AlbumArt";
import {
  repeatIntentChipClass, repeatIntentLabel, relativeTime, absoluteTime, dayHeader, dayKey,
} from "@/lib/wax";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Headphones, EarOff, MoreHorizontal, Library, Trash2, Clock,
} from "lucide-react";

const PAGE_SIZE = 50;

function featureChips(t: TrackWithStats | undefined): string[] {
  if (!t) return [];
  const chips: string[] = [];
  if (t.bpm != null && Number.isFinite(t.bpm)) chips.push(`${Math.round(t.bpm)} BPM`);
  if (t.camelot) chips.push(String(t.camelot));
  if (t.energy != null && t.dance != null && t.valence != null) {
    const mood = t.energy + t.dance + t.valence;
    chips.push(`Mood ${mood.toFixed(2)}`);
  }
  if (t.albumYear != null && Number.isFinite(t.albumYear)) chips.push(String(t.albumYear));
  return chips;
}

const DATE_RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "all", label: "All time", days: 0 },
] as const;

export default function RecentsPage() {
  const { toast } = useToast();
  const [activities, setActivities] = useState<string[]>([]);
  const [range, setRange] = useState<string>("all");
  const [listenedOnly, setListenedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const statsQuery = useQuery<{ totals: { totalListens: number } }>({ queryKey: ["/api/stats"] });

  const from = useMemo(() => {
    const r = DATE_RANGES.find((x) => x.key === range);
    if (!r || r.days === 0) return undefined;
    return Date.now() - r.days * 24 * 60 * 60 * 1000;
  }, [range]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (activities.length) p.set("activity", activities.join(","));
    if (from) p.set("from", String(from));
    if (listenedOnly) p.set("listenedOnly", "1");
    p.set("limit", String(limit));
    return p.toString();
  }, [activities, from, listenedOnly, limit]);

  const listensQuery = useQuery<ListenWithTrack[]>({
    queryKey: ["/api/listens", "recents", params],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/listens?${params}`);
      return res.json();
    },
  });

  const recentTrackIdsParam = useMemo(() => {
    const ids = Array.from(new Set((listensQuery.data ?? []).map((l) => l.trackId).filter(Boolean)));
    return ids.join(",");
  }, [listensQuery.data]);

  const tracksQuery = useQuery<TrackWithStats[]>({
    queryKey: ["/api/tracks/by-ids", recentTrackIdsParam],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tracks/by-ids?ids=${encodeURIComponent(recentTrackIdsParam)}`);
      return res.json();
    },
    enabled: recentTrackIdsParam.length > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/listens/${id}`); },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listens"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      await queryClient.refetchQueries({ queryKey: ["/api/stats"], type: "all" });
      setConfirmDelete(null);
      toast({ title: "Entry deleted" });
    },
  });

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const listens = listensQuery.data ?? [];
  const trackById = useMemo(() => {
    const m = new Map<string, TrackWithStats>();
    for (const t of tracksQuery.data ?? []) m.set(t.id, t);
    return m;
  }, [tracksQuery.data]);

  // Group by day.
  const groups = useMemo(() => {
    const map: { key: string; header: string; items: ListenWithTrack[] }[] = [];
    let lastKey = "";
    for (const l of listens) {
      const k = dayKey(l.loggedAt);
      if (k !== lastKey) {
        map.push({ key: k, header: dayHeader(l.loggedAt), items: [] });
        lastKey = k;
      }
      map[map.length - 1].items.push(l);
    }
    return map;
  }, [listens]);

  if (statsQuery.data && statsQuery.data.totals.totalListens === 0 &&
      activities.length === 0 && range === "all" && !listenedOnly) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-16 text-center">
          <div className="text-primary"><Clock className="h-12 w-12" /></div>
          <h2 className="mt-4 font-display text-xl font-bold" data-testid="text-recents-empty">
            No listens logged yet
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Head to Shuffle and log your first listen — it'll show up here as a journal of what you played and when.
          </p>
          <Link href="/">
            <a><Button className="mt-6" size="lg" data-testid="button-go-shuffle">Go to Shuffle</Button></a>
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1 className="font-display text-xl font-bold">Recents</h1>
      <p className="text-sm text-muted-foreground">Your listening journal, newest first.</p>

      {/* Filter bar */}
      <div className="mt-5 space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Activity</span>
          {ACTIVITY_PRESETS.map((a) => (
            <button
              key={a}
              onClick={() => { toggle(activities, a, setActivities); setLimit(PAGE_SIZE); }}
              data-testid={`filter-activity-${a.replace(/\s+/g, "-")}`}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors hover-elevate ${
                activities.includes(a) ? "border-primary/50 bg-primary/15 text-primary" : "border-border bg-secondary/30 text-muted-foreground"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {DATE_RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => { setRange(r.key); setLimit(PAGE_SIZE); }}
                data-testid={`filter-range-${r.key}`}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover-elevate ${
                  range === r.key ? "bg-primary/15 text-primary" : "bg-secondary/40 text-muted-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Listened only
            <Switch
              checked={listenedOnly}
              onCheckedChange={(v) => { setListenedOnly(v); setLimit(PAGE_SIZE); }}
              data-testid="switch-listened-only"
            />
          </label>
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-6">
        {listensQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : listens.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground" data-testid="text-no-recents">
            No entries match these filters.
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.key}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground" data-testid={`day-header-${g.key}`}>
                  {g.header}
                </h2>
                <div className="space-y-2">
                  {g.items.map((l) => (
                    <div
                      key={l.id}
                      className="flex gap-3 rounded-xl border border-border bg-card p-3"
                      data-testid={`recent-entry-${l.id}`}
                    >
                      <AlbumArt url={l.albumArtUrl} name={l.name} size={48} className="!w-12 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{l.name || "Unknown track"}</div>
                            <div className="truncate text-xs text-muted-foreground">{l.artists || "Unknown artist"}</div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="More" data-testid={`menu-${l.id}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <Link href="/library">
                                <a><DropdownMenuItem data-testid={`menu-open-library-${l.id}`}><Library className="mr-2 h-4 w-4" /> Open in library</DropdownMenuItem></a>
                              </Link>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setConfirmDelete(l.id)}
                                data-testid={`menu-delete-${l.id}`}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Delete entry
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground/80">
                          {absoluteTime(l.loggedAt)} · {relativeTime(l.loggedAt)}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                            {l.listened ? <Headphones className="h-3 w-3" /> : <EarOff className="h-3 w-3" />}
                            {l.listened ? "Listened" : "Background"}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${repeatIntentChipClass(l.repeatIntent)}`}>
                            {repeatIntentLabel(l.repeatIntent)}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            l.keepInLibrary ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
                          }`}>
                            {l.keepInLibrary ? "Keep" : "Remove"}
                          </span>
                          {l.activity.map((a) => (
                            <span key={a} className="rounded-full bg-secondary/40 px-2 py-0.5 text-[10px] text-muted-foreground">{a}</span>
                          ))}
                        </div>
                        {featureChips(trackById.get(l.trackId)).length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1" data-testid={`recent-feature-chips-${l.id}`}>
                            {featureChips(trackById.get(l.trackId)).map((chip) => (
                              <span key={chip} className="rounded-full bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {chip}
                              </span>
                            ))}
                          </div>
                        )}
                        {l.notes && <p className="mt-1.5 text-xs text-muted-foreground">{l.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {listens.length >= limit && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => setLimit((l) => l + PAGE_SIZE)} data-testid="button-load-more">
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this log entry?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete !== null && deleteMutation.mutate(confirmDelete)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
