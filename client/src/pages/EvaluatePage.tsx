import { useMemo, useRef, useState } from "react";
import { REPEAT_INTENT_OPTIONS } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { repeatIntentChipClass, repeatIntentLabel } from "@/lib/wax";
import { CheckCircle2, Loader2, UploadCloud } from "lucide-react";

type EvaluateSourceRow = {
  trackId: string | null;
  name: string;
  artists: string;
  album: string;
};

type EvaluateMatchTrack = {
  id: string;
  name: string;
  artists: string;
  album: string;
  repeatIntent: string;
};

type EvaluateApiRow = {
  rowIndex: number;
  source: EvaluateSourceRow;
  matchType: "track_id" | "artist_song" | "unmatched";
  track: EvaluateMatchTrack | null;
};

type EvaluatePayload = {
  rows: EvaluateApiRow[];
  totals: {
    total: number;
    matched: number;
    matchedByTrackId: number;
    matchedByArtistSong: number;
    unmatched: number;
  };
};

type RowDecision = {
  decision: "keep" | "remove" | null;
  repeatIntent: string;
};

const KEEP_OPTIONS = REPEAT_INTENT_OPTIONS.filter(
  (opt) => opt.value !== "undecided" && opt.value !== "removed" && opt.value !== "off_rotation",
);

function defaultKeepIntent(trackRepeatIntent: string | undefined): string {
  const normalized = String(trackRepeatIntent ?? "").trim();
  if (KEEP_OPTIONS.some((opt) => opt.value === normalized)) return normalized;
  return "currently_listening";
}

export default function EvaluatePage() {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [payload, setPayload] = useState<EvaluatePayload | null>(null);
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});

  const evaluatedRows = payload?.rows ?? [];

  const reviewedCount = useMemo(
    () => Object.values(decisions).filter((d) => d.decision !== null).length,
    [decisions],
  );

  const decisionRows = useMemo(() => {
    return evaluatedRows
      .map((row) => ({ row, state: decisions[row.rowIndex] }))
      .filter((entry) => entry.row.track && entry.state?.decision !== null)
      .map((entry) => ({
        trackId: entry.row.track!.id,
        keepInLibrary: entry.state!.decision === "keep",
        repeatIntent: entry.state!.decision === "keep" ? entry.state!.repeatIntent : "removed",
      }));
  }, [evaluatedRows, decisions]);

  const setRowDecision = (rowIndex: number, next: Partial<RowDecision>) => {
    setDecisions((prev) => {
      const current = prev[rowIndex] ?? { decision: null, repeatIntent: "currently_listening" };
      return {
        ...prev,
        [rowIndex]: {
          ...current,
          ...next,
        },
      };
    });
  };

  const applyMass = (decision: "keep" | "remove") => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const row of evaluatedRows) {
        if (!row.track) continue;
        const current = prev[row.rowIndex] ?? {
          decision: null,
          repeatIntent: defaultKeepIntent(row.track.repeatIntent),
        };
        next[row.rowIndex] = {
          decision,
          repeatIntent: current.repeatIntent,
        };
      }
      return next;
    });
  };

  const handleFile = async (file: File) => {
    if (!/\.csv$/i.test(file.name)) {
      toast({
        title: "CSV required",
        description: "Please upload a .csv file for Evaluate.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const res = await fetch(`${API_BASE}/api/evaluate/csv`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Evaluate upload failed");
      }

      const data = (await res.json()) as EvaluatePayload;
      setPayload(data);
      const seed: Record<number, RowDecision> = {};
      for (const row of data.rows) {
        if (!row.track) continue;
        seed[row.rowIndex] = {
          decision: null,
          repeatIntent: defaultKeepIntent(row.track.repeatIntent),
        };
      }
      setDecisions(seed);
      toast({ title: "Playlist loaded", description: `${data.totals.total} songs ready to review.` });
    } catch (e: any) {
      toast({ title: "Could not parse CSV", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const applyDecisions = async () => {
    if (!decisionRows.length) {
      toast({ title: "Nothing to apply", description: "Choose keep/remove on at least one matched row." });
      return;
    }

    setApplying(true);
    try {
      const res = await apiRequest("POST", "/api/evaluate/apply", { decisions: decisionRows });
      const data = (await res.json()) as { applied: number; failed: number };

      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listens"] });

      toast({
        title: "Evaluate applied",
        description:
          data.failed > 0
            ? `${data.applied} applied, ${data.failed} failed.`
            : `${data.applied} decisions applied.`,
      });
    } catch (e: any) {
      toast({ title: "Could not apply decisions", description: e?.message, variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Layout>
      <h1 className="font-display text-xl font-bold">Evaluate</h1>
      <p className="text-sm text-muted-foreground">
        Upload a playlist CSV, match tracks to your library, and apply keep/remove decisions in one pass.
      </p>

      <div className="mt-5 rounded-xl border border-border bg-card p-4">
        <input
          ref={fileInput}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading || applying}
          data-testid="button-evaluate-upload"
        >
          {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
          Upload playlist CSV
        </Button>

        {payload && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-secondary/40 px-2 py-1">Total: {payload.totals.total}</span>
            <span className="rounded-full bg-secondary/40 px-2 py-1">Matched: {payload.totals.matched}</span>
            <span className="rounded-full bg-secondary/40 px-2 py-1">Unmatched: {payload.totals.unmatched}</span>
            <span className="rounded-full bg-secondary/40 px-2 py-1">Reviewed: {reviewedCount}</span>
          </div>
        )}

        {payload && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => applyMass("keep")} data-testid="button-evaluate-mass-keep">
              Mark all matched as Keep
            </Button>
            <Button type="button" variant="secondary" onClick={() => applyMass("remove")} data-testid="button-evaluate-mass-remove">
              Mark all matched as Remove
            </Button>
            <Button type="button" onClick={applyDecisions} disabled={applying || decisionRows.length === 0} data-testid="button-evaluate-apply">
              {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Apply reviewed decisions ({decisionRows.length})
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {evaluatedRows.map((row) => {
          const state = decisions[row.rowIndex];
          const isMatched = Boolean(row.track);
          return (
            <div key={row.rowIndex} className="rounded-xl border border-border bg-card p-4" data-testid={`evaluate-row-${row.rowIndex}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{row.source.name || row.track?.name || "Unknown track"}</p>
                  <p className="text-xs text-muted-foreground">{row.source.artists || row.track?.artists || "Unknown artist"}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {row.matchType === "track_id" ? "Matched by Track ID" : row.matchType === "artist_song" ? "Matched by Artist + Song" : "Unmatched"}
                </span>
              </div>

              {row.track ? (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-secondary/50 px-2 py-1">Album: {row.track.album || "Unknown album"}</span>
                    <span className={`rounded-full px-2 py-1 ${repeatIntentChipClass(row.track.repeatIntent)}`}>
                      Current tag: {repeatIntentLabel(row.track.repeatIntent)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={state?.decision === "keep" ? "default" : "secondary"}
                      onClick={() => setRowDecision(row.rowIndex, { decision: "keep" })}
                      data-testid={`button-evaluate-keep-${row.rowIndex}`}
                    >
                      Keep
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={state?.decision === "remove" ? "destructive" : "secondary"}
                      onClick={() => setRowDecision(row.rowIndex, { decision: "remove" })}
                      data-testid={`button-evaluate-remove-${row.rowIndex}`}
                    >
                      Remove
                    </Button>

                    {state?.decision === "keep" && (
                      <select
                        value={state.repeatIntent}
                        onChange={(e) => setRowDecision(row.rowIndex, { repeatIntent: e.target.value })}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                        data-testid={`select-evaluate-intent-${row.rowIndex}`}
                      >
                        {KEEP_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">No library match found for this row.</p>
              )}
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
