import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import type { TrackWithStats } from "@shared/schema";
import { ACTIVITY_PRESETS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { ImportEmptyState } from "@/components/EmptyState";
import { AlbumArt } from "@/components/AlbumArt";
import { PlaybackSection } from "@/components/PlaybackSection";
import { LogForm, LogState, initialLogState, isLogValid } from "@/components/LogForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkipForward, Save, PartyPopper } from "lucide-react";

type StatsResp = { totals: { tracks: number } };

function shuffleList<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildKeepPriorityQueue(tracks: TrackWithStats[]): TrackWithStats[] {
  const undecided = shuffleList(tracks.filter((t) => t.repeatIntent === "undecided"));
  const currentlyListening = shuffleList(tracks.filter((t) => t.repeatIntent === "currently_listening"));
  const favoritesArchive = shuffleList(tracks.filter((t) => t.repeatIntent === "favorites_archive"));
  const saveForLater = shuffleList(tracks.filter((t) => t.repeatIntent === "save_for_later"));
  const ordered: TrackWithStats[] = [];

  while (currentlyListening.length > 0 || favoritesArchive.length > 0) {
    if (currentlyListening.length > 0) ordered.push(currentlyListening.shift()!);
    if (favoritesArchive.length > 0) ordered.push(favoritesArchive.shift()!);
  }

  ordered.push(...undecided, ...saveForLater);
  return ordered;
}

export default function Shuffle() {
  const { toast } = useToast();
  const [mode, setMode] = useState<"unlogged" | "all">("all");
  const [keepOnly, setKeepOnly] = useState(false);
  const [current, setCurrent] = useState<TrackWithStats | null>(null);
  const [nextTrack, setNextTrack] = useState<TrackWithStats | null>(null);
  const [keepQueue, setKeepQueue] = useState<TrackWithStats[]>([]);
  const [keepQueueCursor, setKeepQueueCursor] = useState(0);
  const [state, setState] = useState<LogState>(initialLogState());
  const [exhausted, setExhausted] = useState(false);
  const recentShownIdsRef = useRef<string[]>([]);

  const statsQuery = useQuery<StatsResp>({ queryKey: ["/api/stats"] });
  const libraryEmpty = statsQuery.data ? statsQuery.data.totals.tracks === 0 : undefined;

  const rememberShown = useCallback((id: string) => {
    const normalized = String(id).trim();
    if (!normalized) return;
    const next = [normalized, ...recentShownIdsRef.current.filter((v) => v !== normalized)];
    recentShownIdsRef.current = next.slice(0, 8);
  }, []);

  const buildExcludes = useCallback((extra: string[] = []) => {
    return Array.from(new Set([...recentShownIdsRef.current, ...extra.map((v) => String(v).trim()).filter(Boolean)]));
  }, []);

  const fetchRandomTrack = useCallback(async (m: "unlogged" | "all", kOnly: boolean, excludeIds: string[] = []): Promise<TrackWithStats> => {
    const excludeTrackIds = excludeIds.length ? `&excludeTrackIds=${encodeURIComponent(excludeIds.join(","))}` : "";
    const res = await apiRequest("GET", `/api/tracks/random?status=${m}&keepOnly=${kOnly}&includeFeatures=0${excludeTrackIds}`);
    return res.json();
  }, []);

  const prefetchNext = useCallback(async (m: "unlogged" | "all", kOnly: boolean, avoidId?: string) => {
    try {
      const first = await fetchRandomTrack(m, kOnly, avoidId ? [avoidId] : []);
      if (!avoidId || first.id !== avoidId) {
        setNextTrack(first);
        return;
      }
      const second = await fetchRandomTrack(m, kOnly, [avoidId, first.id]);
      if (second.id !== avoidId) {
        setNextTrack(second);
        return;
      }
      setNextTrack(null);
    } catch {
      setNextTrack(null);
    }
  }, [fetchRandomTrack]);

  const fetchRandom = useCallback(async (m: "unlogged" | "all", kOnly: boolean) => {
    try {
      const t = await fetchRandomTrack(m, kOnly, buildExcludes());
      setCurrent(t);
      rememberShown(t.id);
      setState(initialLogState());
      setExhausted(false);
      await prefetchNext(m, kOnly, t.id);
    } catch {
      setCurrent(null);
      setNextTrack(null);
      setExhausted(true);
    }
  }, [buildExcludes, fetchRandomTrack, prefetchNext, rememberShown]);

  const loadKeepQueue = useCallback(async (avoidId?: string) => {
    try {
      const res = await apiRequest("GET", "/api/tracks?status=keep&sort=name&q=&includeFeatures=0");
      const tracks: TrackWithStats[] = await res.json();
      const queue = buildKeepPriorityQueue(tracks);
      setKeepQueue(queue);

      if (!queue.length) {
        setCurrent(null);
        setNextTrack(null);
        setExhausted(true);
        return;
      }

      let startIndex = queue.findIndex((t) => t.id !== avoidId);
      if (startIndex < 0) startIndex = 0;

      const first = queue[startIndex];
      setCurrent(first);
      rememberShown(first.id);
      setState(initialLogState());
      setExhausted(false);

      if (queue.length === 1) {
        setKeepQueueCursor(startIndex);
        setNextTrack(null);
        return;
      }

      let nextIndex = (startIndex + 1) % queue.length;
      if (queue[nextIndex].id === first.id) {
        nextIndex = (nextIndex + 1) % queue.length;
      }

      setKeepQueueCursor(nextIndex);
      setNextTrack(queue[nextIndex].id === first.id ? null : queue[nextIndex]);
    } catch {
      setCurrent(null);
      setNextTrack(null);
      setExhausted(true);
    }
  }, [rememberShown]);

  const advanceKeepQueue = useCallback(async () => {
    if (!keepQueue.length) {
      await loadKeepQueue(current?.id);
      return;
    }

    if (keepQueue.length === 1) {
      setNextTrack(null);
      return;
    }

    const len = keepQueue.length;
    let scan = keepQueueCursor;
    let chosen: TrackWithStats | null = null;

    for (let i = 0; i < len; i += 1) {
      const candidate = keepQueue[scan % len];
      scan = (scan + 1) % len;
      if (!current || candidate.id !== current.id) {
        chosen = candidate;
        break;
      }
    }

    if (!chosen) {
      await loadKeepQueue(current?.id);
      return;
    }

    setCurrent(chosen);
    rememberShown(chosen.id);
    setState(initialLogState());
    setExhausted(false);

    let preview: TrackWithStats | null = null;
    let previewScan = scan;
    for (let i = 0; i < len; i += 1) {
      const candidate = keepQueue[previewScan % len];
      previewScan = (previewScan + 1) % len;
      if (candidate.id !== chosen.id) {
        preview = candidate;
        break;
      }
    }

    setKeepQueueCursor(scan);
    setNextTrack(preview);
  }, [current, keepQueue, keepQueueCursor, loadKeepQueue, rememberShown]);

  const advanceToNext = useCallback(async (m: "unlogged" | "all", kOnly: boolean) => {
    if (!nextTrack) {
      await fetchRandom(m, kOnly);
      return;
    }
    const next = nextTrack;
    if (current && next.id === current.id) {
      try {
        const replacement = await fetchRandomTrack(m, kOnly, buildExcludes([current.id]));
        setCurrent(replacement);
        rememberShown(replacement.id);
        setState(initialLogState());
        setExhausted(false);
        setNextTrack(null);
        await prefetchNext(m, kOnly, replacement.id);
      } catch {
        setNextTrack(null);
      }
      return;
    }
    setCurrent(next);
    rememberShown(next.id);
    setState(initialLogState());
    setExhausted(false);
    setNextTrack(null);
    await prefetchNext(m, kOnly, next.id);
  }, [buildExcludes, current, fetchRandom, fetchRandomTrack, nextTrack, prefetchNext, rememberShown]);

  useEffect(() => {
    if (libraryEmpty === false && !current && !exhausted) {
      if (keepOnly) {
        loadKeepQueue();
      } else {
        fetchRandom(mode, keepOnly);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryEmpty, keepOnly]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!current) return;
      if (state.keepInLibrary === null) return;
      const wantAgain =
        state.repeatIntent === "currently_listening" ||
        state.repeatIntent === "favorites_archive" ||
        state.repeatIntent === "save_for_later";
      const wouldAgain =
        state.repeatIntent === "currently_listening" ||
        state.repeatIntent === "favorites_archive";
      const res = await apiRequest("POST", "/api/listens", {
        trackId: current.id,
        listened: true,
        wantAgain,
        wouldAgain,
        keepInLibrary: state.keepInLibrary,
        repeatIntent: state.keepInLibrary ? state.repeatIntent : undefined,
        activity: state.activity,
        notes: state.notes,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listens"] });
      const count = data?.track?.listenCount ?? 1;
      toast({ title: "Logged.", description: `${count} ${count === 1 ? "listen" : "listens"} so far.` });
      if (keepOnly) {
        loadKeepQueue(current?.id);
      } else {
        advanceToNext(mode, keepOnly);
      }
    },
    onError: (e: any) =>
      toast({ title: "Could not log", description: e?.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!current) return;
    if (!isLogValid(state)) {
      toast({
        title: "Fill the required fields",
        description: "Pick keep/remove. If Keep is selected, choose Currently Listening, Favorites Archive, Save for Later, or Skip for Now.",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate();
  };

  const handleSkip = () => {
    if (keepOnly) {
      advanceKeepQueue();
      return;
    }
    advanceToNext(mode, keepOnly);
  };

  const shuffleAll = () => {
    setMode("all");
    setKeepOnly(false);
    setKeepQueue([]);
    setKeepQueueCursor(0);
    recentShownIdsRef.current = [];
    fetchRandom("all", false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!current) return;
      const k = e.key.toLowerCase();
      if (k === "w") setState((s) => ({ ...s, repeatIntent: "currently_listening" }));
      else if (k === "y") setState((s) => ({ ...s, repeatIntent: "favorites_archive" }));
      else if (k === "m") setState((s) => ({ ...s, repeatIntent: "save_for_later" }));
      else if (k === "n") setState((s) => ({ ...s, repeatIntent: "skip" }));
      else if (k === "k") setState((s) => ({ ...s, keepInLibrary: true }));
      else if (k === "r") setState((s) => ({ ...s, keepInLibrary: false, repeatIntent: null }));
      else if (["1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(k)) {
        const tagName = ACTIVITY_PRESETS[Number(k) - 1];
        if (tagName) {
          setState((s) => ({
            ...s,
            activity: s.activity.includes(tagName)
              ? s.activity.filter((x) => x !== tagName)
              : [...s.activity, tagName],
          }));
        }
      } else if (e.key === "Enter") { e.preventDefault(); handleSave(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); handleSkip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, state]);

  if (statsQuery.isLoading) {
    return (
      <Layout>
        <div className="mx-auto w-full max-w-[520px]">
          <Skeleton className="aspect-square w-full rounded-lg" />
          <Skeleton className="mt-4 h-7 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      </Layout>
    );
  }

  if (libraryEmpty) {
    return (
      <Layout>
        <ImportEmptyState headline="Your library is empty" />
      </Layout>
    );
  }

  if (exhausted) {
    return (
      <Layout>
        <div className="mx-auto flex max-w-[520px] flex-col items-center rounded-2xl border border-border bg-card px-6 py-16 text-center">
          <div className="text-primary"><PartyPopper className="h-12 w-12" /></div>
          <h2 className="mt-4 font-display text-xl font-bold" data-testid="text-celebration">
            You've logged everything new.
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Every unlogged track has a listen. Want to shuffle the full library,
            including songs you've already logged?
          </p>
          <Button className="mt-6" size="lg" onClick={shuffleAll} data-testid="button-shuffle-all">
            Shuffle the full library
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-3 flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              setKeepOnly((v) => !v);
              setKeepQueue([]);
              setKeepQueueCursor(0);
              recentShownIdsRef.current = [];
              setCurrent(null);
              setNextTrack(null);
              setExhausted(false);
            }}
            data-testid="toggle-keep-only"
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover-elevate ${
              keepOnly
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border bg-secondary/30 text-muted-foreground"
            }`}
          >
            Keep only: {keepOnly ? "On" : "Off"}
          </button>
        </div>
        <AnimatePresence mode="wait">
          {current && (
            <div className="flex items-center gap-3">
              <motion.div
                key={current.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 rounded-2xl border border-border bg-card p-5 shadow-xl shadow-black/20 sm:p-7"
              >
              <div className="flex justify-center">
                <AlbumArt url={current.albumArtUrl} name={current.name} size={280} />
              </div>

              <div className="mt-5 text-center">
                <h1 className="font-display text-xl font-bold leading-tight" data-testid="text-track-name">
                  {current.name || "Unknown track"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground" data-testid="text-track-artists">
                  {current.artists || "Unknown artist"}
                </p>
                {current.album && (
                  <p className="mt-0.5 text-xs text-muted-foreground/70" data-testid="text-track-album">
                    {current.album}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  {current.listenCount > 0 && (
                    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground" data-testid="text-listen-count">
                      {current.listenCount} {current.listenCount === 1 ? "listen" : "listens"}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <PlaybackSection trackId={current.id} previewUrl={current.previewUrl} />
              </div>

              {nextTrack && (
                <div className="mt-4 rounded-lg border border-border bg-secondary/20 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Up next</div>
                  <div className="mt-1 text-sm font-medium text-foreground" data-testid="text-next-track-name">{nextTrack.name || "Unknown track"}</div>
                  <div className="text-xs text-muted-foreground" data-testid="text-next-track-artists">{nextTrack.artists || "Unknown artist"}</div>
                </div>
              )}

              <div className="mt-6">
                <LogForm state={state} setState={setState} />
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3">
                <Button variant="ghost" onClick={handleSkip} data-testid="button-skip">
                  <SkipForward className="mr-2 h-4 w-4" /> Skip
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending || !isLogValid(state)}
                  data-testid="button-log-next"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saveMutation.isPending ? "Logging…" : "Log & next"}
                </Button>
              </div>

                <p className="mt-4 text-center text-xs text-muted-foreground/70" data-testid="text-shortcuts">
                  Shortcuts: W currently listening · Y favorites archive · M save for later · N skip for now · K keep · R remove · 1–9 activity · Enter log · → skip
                </p>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </Layout>
  );
}
