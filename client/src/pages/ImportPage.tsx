import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { UploadCloud, Database, FileDown, Trash2, CheckCircle2, Loader2 } from "lucide-react";

type TableInfo = { name: string; columns: string[]; rowCount: number };

const FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "id", label: "Track ID", required: true },
  { key: "name", label: "Track name" },
  { key: "artists", label: "Artist(s)" },
  { key: "album", label: "Album" },
  { key: "albumArtUrl", label: "Album art URL" },
  { key: "durationMs", label: "Duration (ms)" },
  { key: "previewUrl", label: "Preview URL" },
  { key: "addedAt", label: "Added at" },
  { key: "spotifyUrl", label: "Spotify URL" },
];

const GUESS: Record<string, RegExp[]> = {
  id: [/track[_ ]?id/i, /^id$/i, /spotify[_ ]?id/i, /uri/i, /track[_ ]?uri/i],
  name: [/^song$/i, /track[_ ]?name/i, /^name$/i, /title/i, /song[_ ]name/i],
  artists: [/artist/i],
  album: [/album[_ ]?name/i, /^album$/i],
  albumArtUrl: [/album[_ ]?image/i, /art[_ ]?url/i, /image[_ ]?url/i, /cover/i, /artwork/i],
  durationMs: [/duration/i, /length[_ ]?ms/i],
  previewUrl: [/preview/i],
  addedAt: [/added[_ ]?at/i, /date[_ ]?added/i, /added/i],
  spotifyUrl: [/spotify[_ ]?url/i, /track[_ ]?url/i, /external[_ ]?url/i],
};

function autoMap(columns: string[]): Record<string, string | null> {
  const m: Record<string, string | null> = {};
  for (const f of FIELDS) {
    let found: string | null = null;
    for (const re of GUESS[f.key] || []) {
      const hit = columns.find((c) => re.test(c));
      if (hit) { found = hit; break; }
    }
    m[f.key] = found;
  }
  return m;
}

const NONE = "__none__";

export default function ImportPage() {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const statsQuery = useQuery<{ total: number }>({ queryKey: ["/api/stats"] });

  const currentTable = tables.find((t) => t.name === selectedTable);

  const reset = () => {
    setToken(null); setTables([]); setSelectedTable(""); setMapping({});
    setResult(null); setProgress(null);
  };

  const handleFile = async (file: File) => {
    const isCsv = /\.csv$/i.test(file.name);
    const isDb = /\.(db|sqlite|sqlite3)$/i.test(file.name);
    if (!isCsv && !isDb) {
      toast({
        title: "Unsupported file",
        description: "Please upload a .db, .sqlite, or .csv file.",
        variant: "destructive",
      });
      return;
    }
    reset();
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // Route through the same proxy prefix the rest of the app uses so multipart uploads
      // hit the backend after deployment (raw paths 404 on the static host).
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const endpoint = isCsv ? "/api/upload/csv" : "/api/upload";
      const res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }

      if (isCsv) {
        // CSV path: server already parsed + imported in one shot. No mapper needed.
        const data: {
          imported: number; newTracks: number; updated: number; skipped: number; rowsInFile: number;
        } = await res.json();
        setResult({ imported: data.imported, skipped: data.skipped });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
        const desc =
          data.newTracks > 0 && data.updated > 0
            ? `${data.newTracks.toLocaleString()} new, ${data.updated.toLocaleString()} already in your library.`
            : data.newTracks > 0
              ? `${data.newTracks.toLocaleString()} new tracks added.`
              : `All ${data.updated.toLocaleString()} tracks already in your library — ratings preserved.`;
        toast({ title: "CSV imported", description: desc });
        return;
      }

      // SQLite path: continue with column mapper.
      const data: { token: string; tables: TableInfo[] } = await res.json();
      setToken(data.token);
      setTables(data.tables);
      // Prefer the canonical tracks table; otherwise fall back to the largest table.
      const tracksTable = data.tables.find((t) => t.name.toLowerCase() === "tracks");
      const best = tracksTable ?? [...data.tables].sort((a, b) => b.rowCount - a.rowCount)[0];
      if (best) {
        setSelectedTable(best.name);
        setMapping(autoMap(best.columns));
      }
      toast({ title: "Database read", description: `${data.tables.length} table(s) found.` });
    } catch (e: any) {
      toast({ title: "Could not read file", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const onTableChange = (name: string) => {
    setSelectedTable(name);
    const t = tables.find((x) => x.name === name);
    if (t) setMapping(autoMap(t.columns));
    setResult(null);
  };

  const runImport = async () => {
    if (!token || !selectedTable) return;
    if (!mapping.id) {
      toast({ title: "Track ID is required", description: "Map a column to Track ID.", variant: "destructive" });
      return;
    }
    setImporting(true);
    setResult(null);
    let offset = 0;
    let total = currentTable?.rowCount || 0;
    let imported = 0;
    let skipped = 0;
    setProgress({ done: 0, total });
    try {
      const cleanMap: Record<string, string | null> = {};
      for (const f of FIELDS) {
        const v = mapping[f.key];
        cleanMap[f.key] = v && v !== NONE ? v : null;
      }
      // ensure id present
      cleanMap.id = mapping.id;

      let done = false;
      while (!done) {
        const res = await apiRequest("POST", "/api/import", {
          token,
          table: selectedTable,
          mapping: cleanMap,
          offset,
          limit: 500,
        });
        const data = await res.json();
        total = data.total;
        offset = data.processed;
        imported += data.imported;
        skipped += data.skipped;
        done = data.done;
        setProgress({ done: data.processed, total });
      }
      setResult({ imported, skipped });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      toast({ title: "Import complete", description: `${imported} songs imported.` });
      setToken(null); // file auto-deleted server-side
    } catch (e: any) {
      toast({ title: "Import failed", description: e?.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const clearLibrary = async () => {
    await apiRequest("DELETE", "/api/library", { confirm: true });
    queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
    toast({ title: "Library cleared" });
  };

  const exportCsv = () => {
    window.open("/api/export", "_blank");
  };

  const libTotal = statsQuery.data?.total ?? 0;
  const pct = progress && progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0;

  return (
    <Layout>
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-xl font-bold">Import your library</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Upload a SQLite library (<span className="text-foreground">.db</span> /{" "}
          <span className="text-foreground">.sqlite</span>) or an Exportify{" "}
          <span className="text-foreground">.csv</span>. Uploads merge by Spotify Track ID —
          new songs are added, duplicates are skipped, and your existing ratings stay attached.
          Your original file is never modified.
        </p>

        {/* Dropzone */}
        {!token && !importing && !result && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => fileInput.current?.click()}
            data-testid="dropzone"
            className={`mt-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-border bg-card hover-elevate"
            }`}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".db,.sqlite,.sqlite3,.csv"
              className="hidden"
              data-testid="input-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {uploading ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="mt-4 text-sm text-muted-foreground">Reading file…</p>
              </>
            ) : (
              <>
                <UploadCloud className="h-10 w-10 text-primary" />
                <p className="mt-4 font-display text-base font-semibold">
                  Drop a .db, .sqlite, or .csv file here
                </p>
                <p className="mt-1 text-sm text-muted-foreground">or click to choose a file (up to 80MB)</p>
              </>
            )}
          </div>
        )}

        {/* Column mapper */}
        {token && !result && (
          <div className="mt-6 space-y-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Database className="h-4 w-4 text-primary" />
              Map your columns
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Which table holds your tracks?</label>
              <Select value={selectedTable} onValueChange={onTableChange}>
                <SelectTrigger data-testid="select-table">
                  <SelectValue placeholder="Choose a table" />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name} ({t.rowCount.toLocaleString()} rows)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {currentTable && (
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {f.label}
                      {f.required && <span className="ml-0.5 text-destructive">*</span>}
                    </label>
                    <Select
                      value={mapping[f.key] ?? NONE}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === NONE ? null : v }))}
                    >
                      <SelectTrigger
                        data-testid={`select-map-${f.key}`}
                        className={f.required && !mapping[f.key] ? "border-destructive" : ""}
                      >
                        <SelectValue placeholder="— not mapped —" />
                      </SelectTrigger>
                      <SelectContent>
                        {!f.required && <SelectItem value={NONE}>— not mapped —</SelectItem>}
                        {currentTable.columns.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              Track ID is required. Missing names show as "Unknown track"; the Spotify player and link
              are built from the Track ID even if your database has no URL column.
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" onClick={reset} data-testid="button-cancel-import">Cancel</Button>
              <Button
                onClick={runImport}
                disabled={!mapping.id || importing}
                className="flex-1"
                data-testid="button-run-import"
              >
                Import {currentTable ? currentTable.rowCount.toLocaleString() : ""} songs
              </Button>
            </div>
          </div>
        )}

        {/* Progress */}
        {importing && (
          <div className="mt-6 rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Importing…</span>
              <span data-testid="text-import-progress">
                {progress ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}` : ""}
              </span>
            </div>
            <Progress value={pct} className="mt-3" data-testid="progress-import" />
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-primary" />
            <h2 className="mt-4 font-display text-lg font-bold" data-testid="text-import-result">
              Imported {result.imported.toLocaleString()} songs
            </h2>
            {result.skipped > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                {result.skipped.toLocaleString()} rows skipped (missing track ID).
              </p>
            )}
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" onClick={reset} data-testid="button-import-another">Import another</Button>
              <Button onClick={() => (window.location.hash = "#/shuffle")} data-testid="button-go-shuffle">Start shuffling</Button>
            </div>
          </div>
        )}

        {/* Library management */}
        <div className="mt-10 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold">Your library</h2>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="text-library-total">
            {libTotal.toLocaleString()} songs currently imported.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={libTotal === 0} data-testid="button-export">
              <FileDown className="mr-2 h-4 w-4" /> Export ratings as CSV
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" disabled={libTotal === 0} data-testid="button-clear-library" className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Clear library
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear your entire library?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes all imported songs and every rating you've made. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-clear-cancel">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={clearLibrary} data-testid="button-clear-confirm">
                    Yes, clear everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </Layout>
  );
}
