import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { TrackWithStats } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { ImportEmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, UploadCloud } from "lucide-react";

type StatsResp = { totals: { tracks: number } };

type FeatureImportResp = {
  ok: boolean;
  importedRows: number;
  skipped: number;
  imported: number;
  matchedByTrackId: number;
  matchedByArtistSong: number;
  unmatched: number;
};

type PlaylistCandidate = {
  trackId: string;
  name: string;
  artists: string;
  album: string;
  bpm: number;
  camelot: string | null;
  energy: number;
  dance: number;
  valence: number;
  moodScore: number;
  keyStep: number;
  distance: number;
  source: string | null;
};

type PlaylistResult = {
  seed: PlaylistCandidate;
  candidates: PlaylistCandidate[];
  poolSize: number;
};

export default function PlaylistBuilderPage() {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [importingFromDb, setImportingFromDb] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<FeatureImportResp | null>(null);
  const [seedTrackId, setSeedTrackId] = useState<string>("");
  const [topN, setTopN] = useState<number>(50);
  const [maxDistance, setMaxDistance] = useState<number>(3);

  const statsQuery = useQuery<StatsResp>({ queryKey: ["/api/stats"] });

  const keepTracksQuery = useQuery<TrackWithStats[]>({
    queryKey: ["/api/tracks", "keep", "name", ""],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/tracks?status=keep&sort=name&q=");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (): Promise<PlaylistResult> => {
      const res = await apiRequest("POST", "/api/playlist-builder/generate", {
        seedTrackId,
        topN,
        maxDistance,
      });
      return res.json();
    },
    onError: (e: any) => {
      let description = e?.message || "Unknown error";
      try {
        const raw = description.includes(":") ? description.split(":").slice(1).join(":").trim() : description;
        const parsed = JSON.parse(raw);
        if (parsed?.diagnostics) {
          const d = parsed.diagnostics;
          description = `${parsed.error} (keep=${d.keepTrackCount}, seedInKeep=${d.seedInKeep}, seedHasFeatures=${d.seedHasFeatures})`;
        } else if (parsed?.error) {
          description = parsed.error;
        }
      } catch {
      }
      toast({ title: "Could not generate", description, variant: "destructive" });
    },
  });

  const tracks = keepTracksQuery.data ?? [];

  const selectedSeed = useMemo(
    () => tracks.find((t) => t.id === seedTrackId) ?? null,
    [tracks, seedTrackId],
  );

  const handleFeatureFile = async (file: File) => {
    if (!/\.csv$/i.test(file.name)) {
      toast({ title: "Unsupported file", description: "Upload a CSV file.", variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const res = await fetch(`${API_BASE}/api/playlist-builder/import-features`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Feature import failed");
      }

      const data: FeatureImportResp = await res.json();
      setUploadSummary(data);
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      toast({
        title: "Features imported",
        description: `${data.imported.toLocaleString()} matched tracks updated.`,
      });
    } catch (e: any) {
      toast({ title: "Could not import features", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const importFromSourceDb = async () => {
    setImportingFromDb(true);
    setUploadSummary(null);
    try {
      const res = await apiRequest("POST", "/api/playlist-builder/import-features-from-db");
      const raw = await res.text();
      let data: FeatureImportResp;
      try {
        data = JSON.parse(raw) as FeatureImportResp;
      } catch {
        throw new Error(
          "Import endpoint returned a non-JSON response. If you just changed backend routes, restart the server and try again.",
        );
      }
      setUploadSummary(data);
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      toast({
        title: "Features imported from DB",
        description: `${data.imported.toLocaleString()} matched tracks updated.`,
      });
    } catch (e: any) {
      toast({
        title: "Could not import from source DB",
        description: e?.message,
        variant: "destructive",
      });
    } finally {
      setImportingFromDb(false);
    }
  };

  const runGenerate = () => {
    if (!seedTrackId) {
      toast({ title: "Choose a seed track", variant: "destructive" });
      return;
    }
    generateMutation.mutate();
  };

  if (statsQuery.data && statsQuery.data.totals.tracks === 0) {
    return (
      <Layout>
        <ImportEmptyState headline="Import your library first" />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="font-display text-xl font-bold">Playlist Builder</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Import feature CSVs, choose a keep-track seed, and generate nearest-neighbor candidates using your harmonic rules.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold">1) Import feature CSV</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use files like <span className="text-foreground">Vinyl.csv</span> and <span className="text-foreground">new_new_red_car.csv</span>.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFeatureFile(f);
                e.currentTarget.value = "";
              }}
              data-testid="input-feature-csv"
            />
            <Button
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              disabled={uploading || importingFromDb}
              data-testid="button-upload-feature-csv"
            >
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload feature CSV"}
            </Button>
            <Button
              variant="outline"
              onClick={importFromSourceDb}
              disabled={uploading || importingFromDb}
              data-testid="button-import-features-source-db"
            >
              {importingFromDb ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {importingFromDb ? "Importing from DB…" : "Import from spotify_music_library.db"}
            </Button>
          </div>

          {uploadSummary && (
            <div className="mt-4 rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground" data-testid="text-feature-import-summary">
              Imported rows: {uploadSummary.importedRows.toLocaleString()} · Matched by ID: {uploadSummary.matchedByTrackId.toLocaleString()} · Matched by Artist/Song: {uploadSummary.matchedByArtistSong.toLocaleString()} · Unmatched: {uploadSummary.unmatched.toLocaleString()} · Skipped: {uploadSummary.skipped.toLocaleString()}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold">2) Generate keep-only candidates</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Seed track (Keep tab)</label>
              <Select value={seedTrackId} onValueChange={setSeedTrackId}>
                <SelectTrigger data-testid="select-playlist-seed">
                  <SelectValue placeholder={keepTracksQuery.isLoading ? "Loading keep tracks…" : "Choose a seed track"} />
                </SelectTrigger>
                <SelectContent>
                  {tracks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} — {t.artists}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Top N</label>
              <Input
                type="number"
                min={1}
                max={200}
                value={topN}
                onChange={(e) => setTopN(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                data-testid="input-playlist-topn"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Max distance</label>
              <Input
                type="number"
                min={0}
                max={20}
                step="0.1"
                value={maxDistance}
                onChange={(e) => setMaxDistance(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
                data-testid="input-playlist-maxdistance"
              />
            </div>
          </div>

          {selectedSeed && (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="text-seed-selected">
              Seed: <span className="text-foreground">{selectedSeed.name}</span> — {selectedSeed.artists}
            </p>
          )}

          <div className="mt-4">
            <Button onClick={runGenerate} disabled={!seedTrackId || generateMutation.isPending} data-testid="button-generate-playlist">
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Generate candidates
                </>
              )}
            </Button>
          </div>
        </div>

        {generateMutation.data && (
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold">Results</h2>
              <p className="text-xs text-muted-foreground" data-testid="text-playlist-pool-size">
                Keep pool: {generateMutation.data.poolSize.toLocaleString()} · Returned: {generateMutation.data.candidates.length.toLocaleString()}
              </p>
            </div>

            <div className="mb-4 rounded-xl border border-border bg-secondary/20 p-3" data-testid="playlist-seed-features">
              <div className="font-medium">Seed: {generateMutation.data.seed.name}</div>
              <div className="text-xs text-muted-foreground">{generateMutation.data.seed.artists}</div>
              <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div>BPM: <span className="text-foreground">{Math.round(generateMutation.data.seed.bpm)}</span></div>
                <div>Camelot: <span className="text-foreground">{generateMutation.data.seed.camelot ?? "—"}</span></div>
                <div>Distance: <span className="text-foreground">{generateMutation.data.seed.distance.toFixed(4)}</span></div>
                <div>Energy: <span className="text-foreground">{generateMutation.data.seed.energy.toFixed(3)}</span></div>
                <div>Dance: <span className="text-foreground">{generateMutation.data.seed.dance.toFixed(3)}</span></div>
                <div>Valence: <span className="text-foreground">{generateMutation.data.seed.valence.toFixed(3)}</span></div>
                <div>Mood: <span className="text-foreground">{generateMutation.data.seed.moodScore.toFixed(3)}</span></div>
                <div>Step: <span className="text-foreground">{generateMutation.data.seed.keyStep}</span></div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Track</th>
                      <th className="px-3 py-2">Distance</th>
                      <th className="px-3 py-2">BPM</th>
                      <th className="px-3 py-2">Mood</th>
                      <th className="px-3 py-2">Key</th>
                      <th className="px-3 py-2">Step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generateMutation.data.candidates.map((c) => (
                      <tr key={c.trackId} className="border-t border-border" data-testid={`playlist-row-${c.trackId}`}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">{c.artists}</div>
                        </td>
                        <td className="px-3 py-2">{c.distance.toFixed(4)}</td>
                        <td className="px-3 py-2">{Math.round(c.bpm)}</td>
                        <td className="px-3 py-2">{c.moodScore.toFixed(1)}</td>
                        <td className="px-3 py-2">{c.camelot ?? "—"}</td>
                        <td className="px-3 py-2">{c.keyStep}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
