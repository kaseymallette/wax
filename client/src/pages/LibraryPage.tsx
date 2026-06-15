import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { TrackWithStats, ListenWithTrack } from "@shared/schema";
import { REPEAT_INTENT_OPTIONS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { ImportEmptyState } from "@/components/EmptyState";
import { AlbumArt } from "@/components/AlbumArt";
import { PlaybackSection } from "@/components/PlaybackSection";
import { LogForm, LogState, initialLogState, isLogValid } from "@/components/LogForm";
import { repeatIntentChipClass, repeatIntentLabel, relativeTime, absoluteTime } from "@/lib/wax";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search, Save, ThumbsUp, ThumbsDown, Headphones, EarOff, Trash2,
} from "lucide-react";

type StatusFilter = "all" | "logged" | "unlogged" | "keep" | "remove";
type SortKey = "added" | "listens" | "last" | "name";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "logged", label: "Logged" },
  { key: "unlogged", label: "Unlogged" },
  { key: "keep", label: "Keep" },
  { key: "remove", label: "Remove" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "added", label: "Recently added" },
  { key: "listens", label: "Most listens" },
  { key: "last", label: "Last listened" },
  { key: "name", label: "Name" },
];

export default function LibraryPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<TrackWithStats | null>(null);

  const statsQuery = useQuery<{ totals: { tracks: number } }>({ queryKey: ["/api/stats"] });
  const tracksQuery = useQuery<TrackWithStats[]>({
    queryKey: ["/api/tracks", status, sort, q],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/tracks?status=${status}&sort=${sort}&q=${encodeURIComponent(q)}&includeFeatures=0`,
      );
      return res.json();
    },
  });

  if (statsQuery.data && statsQuery.data.totals.tracks === 0) {
    return (
      <Layout>
        <ImportEmptyState headline="No songs in your library yet" />
      </Layout>
    );
  }

  const tracks = tracksQuery.data ?? [];

  return (
    <Layout>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold">Library</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-library-count">
            {tracksQuery.isLoading ? "Loading…" : `${tracks.length} songs`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, artist, album"
            className="pl-9"
            data-testid="input-search"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              data-testid={`filter-${f.key}`}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover-elevate ${
                status === f.key ? "bg-primary/15 text-primary" : "bg-secondary/40 text-muted-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full sm:w-48" data-testid="select-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.key} value={s.key} data-testid={`sort-${s.key}`}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {tracksQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : tracks.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground" data-testid="text-no-results">
            No songs match your filters.
          </div>
        ) : (
          <div className="max-h-[64vh] overflow-y-auto">
            {tracks.map((t) => (
              <button
                key={t.id}
                onClick={() => setEditing(t)}
                data-testid={`row-track-${t.id}`}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover-elevate last:border-0 sm:grid-cols-[2.4fr_1fr_auto_auto]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <AlbumArt url={t.albumArtUrl} name={t.name} size={40} className="!w-10 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" data-testid={`text-name-${t.id}`}>
                      {t.name || "Unknown track"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.artists || "Unknown artist"}
                    </div>
                  </div>
                </div>
                <div className="hidden sm:block">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${repeatIntentChipClass(t.repeatIntent)}`}>
                    {repeatIntentLabel(t.repeatIntent)}
                  </span>
                </div>
                <div className="text-right text-xs text-muted-foreground sm:text-left">
                  <div className="font-medium text-foreground" data-testid={`count-${t.id}`}>
                    {t.listenCount} {t.listenCount === 1 ? "listen" : "listens"}
                  </div>
                  <div className="text-[11px]">{t.lastListenedAt ? relativeTime(t.lastListenedAt) : "—"}</div>
                </div>
                <div className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                  <ThumbsUp className="h-3 w-3 text-primary" /> {t.wouldAgainCount}
                  <ThumbsDown className="ml-1 h-3 w-3 text-destructive" /> {t.wouldNotAgainCount}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <TrackDialog editing={editing} onClose={() => setEditing(null)} />
    </Layout>
  );
}

function TrackDialog({ editing, onClose }: { editing: TrackWithStats | null; onClose: () => void }) {
  const { toast } = useToast();
  const [state, setState] = useState<LogState>(initialLogState());
  const [editingRepeatIntent, setEditingRepeatIntent] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // Reset form when a new track opens.
  const trackId = editing?.id ?? null;
  const [lastId, setLastId] = useState<string | null>(null);
  if (trackId !== lastId) {
    setLastId(trackId);
    setState(initialLogState());
    setEditingRepeatIntent(false);
  }

  const historyQuery = useQuery<ListenWithTrack[]>({
    queryKey: ["/api/listens", trackId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/listens?trackId=${trackId}&limit=200`);
      return res.json();
    },
    enabled: !!trackId,
  });

  const repeatIntentMutation = useMutation({
    mutationFn: async (repeatIntent: TrackWithStats["repeatIntent"]) => {
      const res = await apiRequest("PATCH", `/api/tracks/${trackId}/repeat-intent`, { repeatIntent });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setEditingRepeatIntent(false);
      toast({ title: "Listen-again tag updated" });
    },
    onError: (e: any) => toast({ title: "Could not update tag", description: e?.message, variant: "destructive" }),
  });

  const logMutation = useMutation({
    mutationFn: async () => {
      if (state.keepInLibrary === null || state.listened === null) return;
      const wantAgain = state.repeatIntent === "on_repeat" || state.repeatIntent === "yes" || state.repeatIntent === "maybe";
      const wouldAgain = state.repeatIntent === "on_repeat" || state.repeatIntent === "yes";
      const res = await apiRequest("POST", "/api/listens", {
        trackId,
        listened: state.listened,
        wantAgain,
        wouldAgain,
        keepInLibrary: state.keepInLibrary,
        repeatIntent: state.keepInLibrary ? state.repeatIntent : undefined,
        activity: state.activity,
        notes: state.notes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listens"] });
      setState(initialLogState());
      toast({ title: "Logged.", description: editing?.name });
    },
    onError: (e: any) => toast({ title: "Could not log", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/listens/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listens"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setConfirmDelete(null);
      toast({ title: "Entry deleted" });
    },
  });

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        {editing && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">{editing.name || "Unknown track"}</DialogTitle>
              <p className="text-sm text-muted-foreground">{editing.artists || "Unknown artist"}</p>
            </DialogHeader>

            <div className="space-y-5">
              <PlaybackSection trackId={editing.id} previewUrl={editing.previewUrl} />

              {/* Repeat intent edit row */}
              <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
                <span className="text-xs text-muted-foreground">Listen again</span>
                {!editingRepeatIntent ? (
                  <>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${repeatIntentChipClass(editing.repeatIntent)}`} data-testid="text-current-repeat-intent">
                      {repeatIntentLabel(editing.repeatIntent)}
                    </span>
                    <button
                      className="ml-auto text-xs font-medium text-primary hover:underline"
                      onClick={() => setEditingRepeatIntent(true)}
                      data-testid="link-edit-repeat-intent"
                    >
                      Edit tag
                    </button>
                  </>
                ) : (
                  <div className="flex w-full flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {REPEAT_INTENT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => repeatIntentMutation.mutate(opt.value)}
                          disabled={repeatIntentMutation.isPending}
                          data-testid={`edit-repeat-intent-${opt.value}`}
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover-elevate ${
                            editing.repeatIntent === opt.value
                              ? repeatIntentChipClass(opt.value) + " border-current"
                              : "border-border bg-secondary/40 text-muted-foreground"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Log form */}
              <div>
                <h3 className="mb-3 font-display text-sm font-semibold">Log a listen</h3>
                <LogForm state={state} setState={setState} />
              </div>

              <Button
                className="w-full"
                onClick={() => {
                  if (!isLogValid(state)) {
                    toast({ title: "Fill the required fields", variant: "destructive" });
                    return;
                  }
                  logMutation.mutate();
                }}
                disabled={logMutation.isPending || !isLogValid(state)}
                data-testid="button-log-listen"
              >
                <Save className="mr-2 h-4 w-4" />
                {logMutation.isPending ? "Logging…" : "Log a listen"}
              </Button>

              {/* History */}
              <div>
                <h3 className="mb-2 font-display text-sm font-semibold">
                  Listen history
                  {historyQuery.data ? ` (${historyQuery.data.length})` : ""}
                </h3>
                {historyQuery.isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : (historyQuery.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-history">
                    No listens logged yet.
                  </p>
                ) : (
                  <div className="space-y-2" data-testid="container-history">
                    {historyQuery.data!.map((l) => (
                      <div
                        key={l.id}
                        className="rounded-lg border border-border bg-secondary/20 p-3"
                        data-testid={`history-${l.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{absoluteTime(l.loggedAt)}</span>
                          <div className="flex items-center gap-1.5">
                            {l.listened ? (
                              <Headphones className="h-3.5 w-3.5 text-primary" aria-label="Listened" />
                            ) : (
                              <EarOff className="h-3.5 w-3.5 text-muted-foreground" aria-label="Background" />
                            )}
                            {l.keepInLibrary ? (
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${repeatIntentChipClass(l.repeatIntent)}`}>
                                {repeatIntentLabel(l.repeatIntent)}
                              </span>
                            ) : null}
                            {l.keepInLibrary ? (
                              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">Keep</span>
                            ) : (
                              <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">Remove</span>
                            )}
                            <button
                              onClick={() => setConfirmDelete(l.id)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label="Delete entry"
                              data-testid={`button-delete-history-${l.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        {l.activity.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {l.activity.map((a) => (
                              <span key={a} className="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {a}
                              </span>
                            ))}
                          </div>
                        )}
                        {l.notes && (
                          <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{l.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose} data-testid="button-close-dialog">Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

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
    </Dialog>
  );
}
