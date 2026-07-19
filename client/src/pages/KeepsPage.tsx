import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { ListenWithTrack, TrackWithStats } from "@shared/schema";
import { CURRENTLY_LISTENING_CAPACITY, REPEAT_INTENT_OPTIONS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { AlbumArt } from "@/components/AlbumArt";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  absoluteTime,
  dayHeader,
  dayKey,
  relativeTime,
  repeatIntentChipClass,
  repeatIntentLabel,
} from "@/lib/wax";
import { Clock, EarOff, Headphones, Library, MoreHorizontal, Trash2 } from "lucide-react";

const KEEP_DECISION_OPTIONS = REPEAT_INTENT_OPTIONS.filter(
  (opt) => opt.value !== "undecided" && opt.value !== "removed" && opt.value !== "off_rotation",
);
const KEEP_DECISION_ORDER = [
  "currently_listening",
  "favorites_archive",
  "save_for_later",
  "skip_for_now",
] as const;
const KEEP_DECISION_RANK = new Map(KEEP_DECISION_ORDER.map((value, index) => [value, index]));
const ORDERED_KEEP_DECISION_OPTIONS = [...KEEP_DECISION_OPTIONS].sort((a, b) => {
  const aRank = KEEP_DECISION_RANK.get(a.value) ?? Number.MAX_SAFE_INTEGER;
  const bRank = KEEP_DECISION_RANK.get(b.value) ?? Number.MAX_SAFE_INTEGER;
  return aRank - bRank;
});
const TAG_FILTERS = [
  { value: "all", label: "All keeps" },
  ...ORDERED_KEEP_DECISION_OPTIONS,
] as const;

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

function keepCountBadgeClass(tag: (typeof TAG_FILTERS)[number]["value"]): string {
  if (tag === "all") return "border-yellow-500/40 bg-yellow-500/15 text-yellow-400";
  if (tag === "currently_listening") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-400";
  if (tag === "favorites_archive") return "border-blue-500/40 bg-blue-500/15 text-blue-400";
  if (tag === "save_for_later") return "border-yellow-500/40 bg-yellow-500/15 text-yellow-400";
  if (tag === "skip_for_now") return "border-destructive/40 bg-destructive/15 text-destructive";
  return "border-primary/40 bg-primary/15 text-primary";
}

function keepIntentChipClass(intent: string): string {
  if (intent === "skip_for_now") return "bg-destructive/15 text-destructive";
  return repeatIntentChipClass(intent);
}

export default function KeepsPage() {
  const { toast } = useToast();
  const [tag, setTag] = useState<(typeof TAG_FILTERS)[number]["value"]>("all");
  const [lookup, setLookup] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "name">("newest");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("keepOnly", "1");
    p.set("limit", "500");
    return p.toString();
  }, []);

  const keepsQuery = useQuery<ListenWithTrack[]>({
    queryKey: ["/api/listens", "keeps", params],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/listens?${params}`);
      return res.json();
    },
  });

  const keepTracksQuery = useQuery<TrackWithStats[]>({
    queryKey: ["/api/tracks", "keep", "keeps-page"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/tracks?status=keep&sort=last&q=");
      return res.json();
    },
  });

  const updateRepeatIntentMutation = useMutation({
    mutationFn: async ({ trackId, repeatIntent }: { trackId: string; repeatIntent: string }) => {
      const res = await apiRequest("PATCH", `/api/tracks/${trackId}/repeat-intent`, { repeatIntent });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listens"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Listen-again tag updated" });
    },
    onError: (e: any) => {
      toast({ title: "Could not update tag", description: e?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/listens/${id}`);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listens"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setConfirmDelete(null);
      toast({ title: "Entry deleted" });
    },
  });

  const keeps = keepsQuery.data ?? [];
  const keepTrackById = useMemo(() => {
    const m = new Map<string, TrackWithStats>();
    for (const t of keepTracksQuery.data ?? []) m.set(t.id, t);
    return m;
  }, [keepTracksQuery.data]);
  const currentlyListeningCount = useMemo(
    () => (keepTracksQuery.data ?? []).filter((t) => t.repeatIntent === "currently_listening").length,
    [keepTracksQuery.data],
  );
  const isCurrentlyListeningFull = currentlyListeningCount >= CURRENTLY_LISTENING_CAPACITY;
  const keepTrackIds = useMemo(() => new Set((keepTracksQuery.data ?? []).map((t) => t.id)), [keepTracksQuery.data]);
  const latestKeeps = useMemo(() => {
    const byTrack = new Map<string, ListenWithTrack>();
    for (const l of keeps) {
      if (!keepTrackIds.has(l.trackId)) continue;
      if (!byTrack.has(l.trackId)) byTrack.set(l.trackId, l);
    }
    return Array.from(byTrack.values());
  }, [keeps, keepTrackIds]);
  const visibleKeeps = useMemo(() => {
    const q = lookup.trim().toLowerCase();
    let out = latestKeeps;

    if (tag !== "all") {
      out = out.filter((l) => {
        const track = keepTrackById.get(l.trackId);
        if (!track) return false;
        return track.repeatIntent === tag;
      });
    }

    if (q) {
      out = out.filter((l) => {
        const hay = `${l.name} ${l.artists} ${l.album}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const sorted = [...out];
    if (sortBy === "name") {
      sorted.sort((a, b) => {
        const byName = (a.name || "").localeCompare(b.name || "");
        if (byName !== 0) return byName;
        const byArtist = (a.artists || "").localeCompare(b.artists || "");
        if (byArtist !== 0) return byArtist;
        return b.loggedAt - a.loggedAt;
      });
    } else {
      sorted.sort((a, b) => {
        if (b.loggedAt !== a.loggedAt) return b.loggedAt - a.loggedAt;
        return b.id - a.id;
      });
    }

    return sorted;
  }, [latestKeeps, lookup, sortBy, tag, keepTrackById]);

  const groups = useMemo(() => {
    const map: { key: string; header: string; items: ListenWithTrack[] }[] = [];
    let lastKey = "";
    for (const l of visibleKeeps) {
      const k = dayKey(l.loggedAt);
      if (k !== lastKey) {
        map.push({ key: k, header: dayHeader(l.loggedAt), items: [] });
        lastKey = k;
      }
      map[map.length - 1].items.push(l);
    }
    return map;
  }, [visibleKeeps]);

  return (
    <Layout>
      <h1 className="font-display text-xl font-bold">Keeps</h1>
      <p className="text-sm text-muted-foreground">
        Your songs, logged and organized by what you want to hear next. Move any song between tags to update your
        playlists.
      </p>
      <div className="mt-3 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="font-semibold text-foreground">
                Currently Listening ({currentlyListeningCount}/{CURRENTLY_LISTENING_CAPACITY})
              </p>
              <p>Grouped into 7 daily playlists (Mon-Sun), up to 30 songs each.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">Favorites Archive</p>
              <p>Your all-time favorites not currently in rotation. Exported as one playlist.</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="font-semibold text-foreground">Save for Later</p>
              <p>Songs you want to listen to but don't have the time. Generated as one playlist.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">Skip for Now</p>
              <p>Liked songs off the rotation. Generated as one playlist.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-1.5 pt-5">
          {TAG_FILTERS.map((f) => (
            <div key={f.value} className="relative">
              {tag === f.value && (
                <span
                  className={`pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 rounded-md border px-2 py-[1px] text-[10px] font-semibold leading-none shadow-sm ${keepCountBadgeClass(
                    f.value,
                  )}`}
                  data-testid={`text-keep-count-${f.value}`}
                >
                  {visibleKeeps.length}
                </span>
              )}
              <button
                onClick={() => {
                  setTag(f.value);
                }}
                data-testid={`filter-keep-tag-${f.value}`}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover-elevate ${
                  tag === f.value
                    ? f.value === "all"
                      ? "bg-primary/15 text-primary"
                      : `${keepIntentChipClass(f.value)} ring-1 ring-current`
                    : "bg-secondary/40 text-muted-foreground"
                }`}
              >
                {f.label}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            placeholder="Look up keeps by song, artist, or album"
            data-testid="input-keeps-lookup"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground sm:max-w-md"
          />
          <div className="flex items-center gap-2">
            <label htmlFor="keeps-sort" className="text-xs text-muted-foreground">
              Sort
            </label>
            <select
              id="keeps-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "newest" | "name")}
              data-testid="select-keeps-sort"
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="newest">Newest</option>
              <option value="name">Name (A-Z)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6">
        {keepsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : visibleKeeps.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-4 py-12 text-center">
            <Clock className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground" data-testid="text-no-keeps">
              No keep entries match this filter yet.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.key}>
                <h2
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  data-testid={`keeps-day-header-${g.key}`}
                >
                  {g.header}
                </h2>
                <div className="space-y-2">
                  {g.items.map((l) => (
                    <div
                      key={l.id}
                      className="flex gap-3 rounded-xl border border-border bg-card p-3"
                      data-testid={`keep-entry-${l.id}`}
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
                              <button
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                                aria-label="More"
                                data-testid={`menu-keep-${l.id}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <Link href="/library">
                                <a>
                                  <DropdownMenuItem data-testid={`menu-keep-open-library-${l.id}`}>
                                    <Library className="mr-2 h-4 w-4" /> Open in library
                                  </DropdownMenuItem>
                                </a>
                              </Link>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setConfirmDelete(l.id)}
                                data-testid={`menu-keep-delete-${l.id}`}
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
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${keepIntentChipClass(l.repeatIntent)}`}
                          >
                            {repeatIntentLabel(l.repeatIntent)}
                          </span>
                          {l.activity.map((a) => (
                            <span key={a} className="rounded-full bg-secondary/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                              {a}
                            </span>
                          ))}
                        </div>
                        {featureChips(keepTrackById.get(l.trackId)).length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1" data-testid={`keep-feature-chips-${l.id}`}>
                            {featureChips(keepTrackById.get(l.trackId)).map((chip) => (
                              <span key={chip} className="rounded-full bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {chip}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`edit-keep-tag-${l.id}`}>
                          {ORDERED_KEEP_DECISION_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => updateRepeatIntentMutation.mutate({ trackId: l.trackId, repeatIntent: opt.value })}
                              disabled={
                                updateRepeatIntentMutation.isPending ||
                                l.repeatIntent === opt.value ||
                                (opt.value === "currently_listening" && isCurrentlyListeningFull && l.repeatIntent !== "currently_listening")
                              }
                              data-testid={`button-keep-tag-${l.id}-${opt.value}`}
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover-elevate ${
                                l.repeatIntent === opt.value
                                  ? `${keepIntentChipClass(opt.value)} border-current`
                                  : "border-border bg-secondary/40 text-muted-foreground"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        {l.notes && <p className="mt-1.5 text-xs text-muted-foreground">{l.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

          </div>
        )}
      </div>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this keep entry?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-keep-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete !== null && deleteMutation.mutate(confirmDelete)}
              data-testid="button-confirm-keep-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
