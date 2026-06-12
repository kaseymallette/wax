import { useEffect, useState, useCallback } from "react";
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
import { eraChipClass, eraLabel } from "@/lib/wax";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkipForward, Save, PartyPopper } from "lucide-react";

type StatsResp = { totals: { tracks: number } };

export default function Shuffle() {
  const { toast } = useToast();
  const [mode, setMode] = useState<"unlogged" | "all">("all");
  const [keepOnly, setKeepOnly] = useState(false);
  const [current, setCurrent] = useState<TrackWithStats | null>(null);
  const [state, setState] = useState<LogState>(initialLogState(null));
  const [exhausted, setExhausted] = useState(false);

  const statsQuery = useQuery<StatsResp>({ queryKey: ["/api/stats"] });
  const libraryEmpty = statsQuery.data ? statsQuery.data.totals.tracks === 0 : undefined;

  const fetchRandom = useCallback(async (m: "unlogged" | "all", kOnly: boolean) => {
    try {
      const res = await apiRequest("GET", `/api/tracks/random?status=${m}&keepOnly=${kOnly}`);
      const t: TrackWithStats = await res.json();
      setCurrent(t);
      setState(initialLogState(t.era ?? null));
      setExhausted(false);
    } catch {
      setCurrent(null);
      setExhausted(true);
    }
  }, []);

  useEffect(() => {
    if (libraryEmpty === false && !current && !exhausted) {
      fetchRandom(mode, keepOnly);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryEmpty, keepOnly]);

  const needEra = !!current && !current.era;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!current) return;
      const res = await apiRequest("POST", "/api/listens", {
        trackId: current.id,
        listened: state.listened,
        wantAgain: state.wantAgain,
        wouldAgain: state.wouldAgain,
        keepInLibrary: state.keepInLibrary,
        activity: state.activity,
        notes: state.notes,
        era: state.era ?? undefined,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listens"] });
      const count = data?.track?.listenCount ?? 1;
      toast({ title: "Logged.", description: `${count} ${count === 1 ? "listen" : "listens"} so far.` });
      fetchRandom(mode, keepOnly);
    },
    onError: (e: any) =>
      toast({ title: "Could not log", description: e?.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!current) return;
    if (!isLogValid(state)) {
      toast({
        title: "Fill the required fields",
        description: "Pick listened state and all three listen-again choices.",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate();
  };

  const handleSkip = () => fetchRandom(mode, keepOnly);

  const shuffleAll = () => {
    setMode("all");
    fetchRandom("all", keepOnly);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!current) return;
      const k = e.key.toLowerCase();
      if (k === "l") setState((s) => ({ ...s, listened: true }));
      else if (k === "b") setState((s) => ({ ...s, listened: false }));
      else if (k === "w") setState((s) => ({ ...s, wantAgain: true }));
      else if (k === "o") setState((s) => ({ ...s, wantAgain: false }));
      else if (k === "a") setState((s) => ({ ...s, wouldAgain: true }));
      else if (k === "n") setState((s) => ({ ...s, wouldAgain: false }));
      else if (k === "k") setState((s) => ({ ...s, keepInLibrary: true }));
      else if (k === "r") setState((s) => ({ ...s, keepInLibrary: false }));
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
  }, [current, state, needEra]);

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
              setCurrent(null);
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
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-2xl border border-border bg-card p-5 shadow-xl shadow-black/20 sm:p-7"
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
                  {current.era && (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${eraChipClass(current.era)}`} data-testid="badge-era">
                      {eraLabel(current.era)}
                    </span>
                  )}
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

              <div className="mt-6">
                <LogForm state={state} setState={setState} showEra={needEra} />
              </div>

              <div className="mt-7 grid grid-cols-[auto_1fr] gap-3">
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
                Shortcuts: L listened · B background · W want again · O don't want · A would again · N wouldn't · K keep · R remove · 1–9 activity · Enter log · → skip
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Layout>
  );
}
