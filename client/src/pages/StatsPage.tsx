import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ListenWithTrack, TrackWithStats } from "@shared/schema";
import { Layout } from "@/components/Layout";
import { ImportEmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/wax";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts";
import { Disc3, Headphones, ListMusic, CalendarDays, ThumbsUp, ThumbsDown } from "lucide-react";

type Stats = {
  totals: { tracks: number; totalListens: number; actualListens: number; uniqueTracksLogged: number };
  listensByDay: { date: string; count: number }[];
  topTracks: { trackId: string; name: string; artists: string; count: number }[];
  keepRemoveRatio: { keep: number; remove: number };
  featureSummaryKeepRemove: {
    keep: {
      trackCount: number;
      bpm: number | null;
      bpmMode: number | null;
      bpmRange: { min: number | null; max: number | null };
      energy: number | null;
      energyMode: number | null;
      energyRange: { min: number | null; max: number | null };
      dance: number | null;
      danceMode: number | null;
      danceRange: { min: number | null; max: number | null };
      valence: number | null;
      valenceMode: number | null;
      valenceRange: { min: number | null; max: number | null };
      moodScore: number | null;
      moodMode: number | null;
      moodRange: { min: number | null; max: number | null };
      topKey: string | null;
      topDecade: string | null;
    };
    remove: {
      trackCount: number;
      bpm: number | null;
      bpmMode: number | null;
      bpmRange: { min: number | null; max: number | null };
      energy: number | null;
      energyMode: number | null;
      energyRange: { min: number | null; max: number | null };
      dance: number | null;
      danceMode: number | null;
      danceRange: { min: number | null; max: number | null };
      valence: number | null;
      valenceMode: number | null;
      valenceRange: { min: number | null; max: number | null };
      moodScore: number | null;
      moodMode: number | null;
      moodRange: { min: number | null; max: number | null };
      topKey: string | null;
      topDecade: string | null;
    };
  };
  decadeDistribution: { decade: string; count: number }[];
  recent: ListenWithTrack[];
};

const KEEP_INTENT_TABS = [
  { value: "on_repeat", label: "On repeat" },
  { value: "yes", label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "nah", label: "Nah, I'm good" },
] as const;

function keepIntentTabClass(value: (typeof KEEP_INTENT_TABS)[number]["value"], active: boolean): string {
  if (!active) return "bg-secondary/40 text-muted-foreground";
  if (value === "on_repeat") return "bg-blue-500/15 text-blue-400";
  if (value === "yes") return "bg-emerald-500/15 text-emerald-400";
  if (value === "maybe") return "bg-amber-500/15 text-amber-400";
  if (value === "nah") return "bg-destructive/15 text-destructive";
  return "bg-primary/15 text-primary";
}

function keepIntentAccentTextClass(value: (typeof KEEP_INTENT_TABS)[number]["value"]): string {
  if (value === "on_repeat") return "text-blue-400";
  if (value === "yes") return "text-emerald-400";
  if (value === "maybe") return "text-amber-400";
  if (value === "nah") return "text-destructive";
  return "text-primary";
}

function keepIntentPanelClass(value: (typeof KEEP_INTENT_TABS)[number]["value"]): string {
  if (value === "on_repeat") return "border-blue-500/30 bg-blue-500/10";
  if (value === "yes") return "border-emerald-500/30 bg-emerald-500/10";
  if (value === "maybe") return "border-amber-500/30 bg-amber-500/10";
  if (value === "nah") return "border-destructive/30 bg-destructive/10";
  return "border-border bg-secondary/20";
}

function summarizeKeepIntentFeatures(tracks: TrackWithStats[]) {
  const toAvg = (values: number[]) => {
    if (!values.length) return null;
    return Number((values.reduce((s, n) => s + n, 0) / values.length).toFixed(3));
  };
  const topEntries = (counts: Map<string, number>, limit: number): string[] => {
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([key]) => key);
  };
  const median = (values: number[]): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
  };
  const quantile = (values: number[], q: number): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return Number((sorted[base] + rest * (sorted[base + 1] - sorted[base])).toFixed(1));
    }
    return Number(sorted[base].toFixed(1));
  };

  const bpm: number[] = [];
  const energy: number[] = [];
  const dance: number[] = [];
  const valence: number[] = [];
  const mood: number[] = [];
  const keyCounts = new Map<string, number>();
  const albumYears: number[] = [];

  for (const t of tracks) {
    if (t.bpm != null && Number.isFinite(t.bpm)) bpm.push(t.bpm);
    if (t.energy != null && Number.isFinite(t.energy)) energy.push(t.energy);
    if (t.dance != null && Number.isFinite(t.dance)) dance.push(t.dance);
    if (t.valence != null && Number.isFinite(t.valence)) valence.push(t.valence);
    if (
      t.energy != null && Number.isFinite(t.energy) &&
      t.dance != null && Number.isFinite(t.dance) &&
      t.valence != null && Number.isFinite(t.valence)
    ) {
      mood.push(t.energy + t.dance + t.valence);
    }
    if (t.camelot) keyCounts.set(t.camelot, (keyCounts.get(t.camelot) ?? 0) + 1);
    if (t.albumYear != null && Number.isFinite(t.albumYear) && t.albumYear >= 1900 && t.albumYear <= 2099) {
      albumYears.push(Math.round(t.albumYear));
    }
  }

  return {
    bpm: toAvg(bpm),
    energy: toAvg(energy),
    dance: toAvg(dance),
    valence: toAvg(valence),
    moodScore: toAvg(mood),
    topKeys: topEntries(keyCounts, 3),
    albumYearMedian: median(albumYears),
    albumYearIqr: {
      q1: quantile(albumYears, 0.25),
      q3: quantile(albumYears, 0.75),
    },
  };
}

function chartTooltip() {
  return {
    contentStyle: {
      background: "hsl(var(--popover))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 8,
      fontSize: 12,
      color: "hsl(var(--popover-foreground))",
    },
    labelStyle: { color: "hsl(var(--popover-foreground))" },
    itemStyle: { color: "hsl(var(--popover-foreground))" },
  };
}

function formatMetric(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function formatRange(range: { min: number | null; max: number | null }, digits = 2): string {
  if (range.min == null || range.max == null) return "—";
  return `${range.min.toFixed(digits)} → ${range.max.toFixed(digits)}`;
}

function formatYear(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function formatYearIqr(iqr: { q1: number | null; q3: number | null }): string {
  if (iqr.q1 == null || iqr.q3 == null) return "—";
  return `${formatYear(iqr.q1)} → ${formatYear(iqr.q3)}`;
}

export default function StatsPage() {
  const { data, isLoading } = useQuery<Stats>({ queryKey: ["/api/stats"] });
  const [keepIntentTab, setKeepIntentTab] = useState<(typeof KEEP_INTENT_TABS)[number]["value"]>("on_repeat");
  const keepTracksQuery = useQuery<TrackWithStats[]>({
    queryKey: ["/api/tracks", "keep", "name", ""],
    queryFn: async () => {
      const res = await fetch("/api/tracks?status=keep&sort=name&q=", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load keep tracks");
      return res.json();
    },
  });
  const removeTracksQuery = useQuery<TrackWithStats[]>({
    queryKey: ["/api/tracks", "remove", "name", ""],
    queryFn: async () => {
      const res = await fetch("/api/tracks?status=remove&sort=name&q=", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load remove tracks");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Layout>
        <Skeleton className="h-8 w-40" />
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      </Layout>
    );
  }

  if (data && data.totals.tracks === 0) {
    return <Layout><ImportEmptyState headline="No stats yet" /></Layout>;
  }
  if (!data) return <Layout><div /></Layout>;

  const last7 = data.listensByDay.slice(-7).reduce((s, d) => s + d.count, 0);

  const kpis = [
    { label: "Total tracks", value: data.totals.tracks, Icon: Disc3 },
    { label: "Total listens", value: data.totals.totalListens, Icon: Headphones },
    { label: "Unique tracks logged", value: data.totals.uniqueTracksLogged, Icon: ListMusic },
    { label: "Logs in last 7 days", value: last7, Icon: CalendarDays },
  ];

  const dayData = data.listensByDay.map((d) => ({
    ...d,
    label: new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));

  const total = data.keepRemoveRatio.keep + data.keepRemoveRatio.remove;
  const keepPct = total ? Math.round((data.keepRemoveRatio.keep / total) * 100) : 0;
  const removePct = total ? 100 - keepPct : 0;
  const keepTracks = keepTracksQuery.data ?? [];
  const keepTracksForIntent = useMemo(
    () => keepTracks.filter((t) => t.repeatIntent === keepIntentTab),
    [keepTracks, keepIntentTab],
  );
  const keepIntentSummary = useMemo(
    () => summarizeKeepIntentFeatures(keepTracksForIntent),
    [keepTracksForIntent],
  );
  const removeTracks = removeTracksQuery.data ?? [];
  const removeSummary = useMemo(
    () => summarizeKeepIntentFeatures(removeTracks),
    [removeTracks],
  );

  return (
    <Layout>
      <h1 className="font-display text-xl font-bold">Stats</h1>
      <p className="text-sm text-muted-foreground">
        {data.totals.tracks.toLocaleString()} tracks · {data.totals.totalListens.toLocaleString()} listens logged
      </p>

      {/* KPI tiles */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4" data-testid={`kpi-${k.label.replace(/\s+/g, "-").toLowerCase()}`}>
            <k.Icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-display text-2xl font-extrabold tabular-nums">{k.value.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Listens per day */}
        <div className="rounded-xl border border-border bg-card p-5" data-testid="chart-listens-day">
          <h2 className="font-display text-base font-semibold">Listens per day, last 30 days</h2>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dayData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={4} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <RTooltip {...chartTooltip()} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Keep vs remove (latest per unique track) */}
        <div className="rounded-xl border border-border bg-card p-5" data-testid="chart-keep-remove">
          <h2 className="font-display text-base font-semibold">Keep vs remove</h2>
          {total === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No listens logged yet.</p>
          ) : (
            <div className="mt-6 space-y-4">
              <div className="flex items-end justify-around">
                <div className="text-center">
                  <ThumbsUp className="mx-auto h-6 w-6 text-primary" />
                  <div className="mt-2 font-display text-3xl font-extrabold tabular-nums">{keepPct}%</div>
                  <div className="text-xs text-muted-foreground">Keep ({data.keepRemoveRatio.keep})</div>
                </div>
                <div className="text-center">
                  <ThumbsDown className="mx-auto h-6 w-6 text-destructive" />
                  <div className="mt-2 font-display text-3xl font-extrabold tabular-nums">{removePct}%</div>
                  <div className="text-xs text-muted-foreground">Remove ({data.keepRemoveRatio.remove})</div>
                </div>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-secondary/50">
                <div className="h-full bg-primary" style={{ width: `${keepPct}%` }} />
                <div className="h-full bg-destructive" style={{ width: `${removePct}%` }} />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Based on each track's latest keep/remove decision.
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5" data-testid="card-feature-summary-keep">
          <h2 className="font-display text-base font-semibold">Keep feature summary</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Averages from imported feature data on latest keep decisions. Tracks missing features are excluded from averages.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {KEEP_INTENT_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setKeepIntentTab(tab.value)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover-elevate ${keepIntentTabClass(
                  tab.value,
                  keepIntentTab === tab.value,
                )}`}
                data-testid={`keep-summary-tab-${tab.value}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className={`mt-3 rounded-lg border p-3 ${keepIntentPanelClass(keepIntentTab)}`}>
            <div className={`text-sm font-semibold ${keepIntentAccentTextClass(keepIntentTab)}`}>
              {KEEP_INTENT_TABS.find((t) => t.value === keepIntentTab)?.label} ({keepTracksForIntent.length})
            </div>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between gap-3"><span>Top 3 keys</span><span className="font-medium text-foreground">{keepIntentSummary.topKeys.length ? keepIntentSummary.topKeys.join(" · ") : "—"}</span></div>
              <div className="flex justify-between gap-3"><span>Median album year</span><span className="font-medium text-foreground">{formatYear(keepIntentSummary.albumYearMedian)}</span></div>
              <div className="flex justify-between gap-3"><span>Album year IQR</span><span className="font-medium text-foreground">{formatYearIqr(keepIntentSummary.albumYearIqr)}</span></div>
              <div className="flex justify-between gap-3"><span>BPM avg</span><span className="font-medium text-foreground">{formatMetric(keepIntentSummary.bpm, 1)}</span></div>
              <div className="flex justify-between gap-3"><span>Energy avg</span><span className="font-medium text-foreground">{formatMetric(keepIntentSummary.energy, 3)}</span></div>
              <div className="flex justify-between gap-3"><span>Dance avg</span><span className="font-medium text-foreground">{formatMetric(keepIntentSummary.dance, 3)}</span></div>
              <div className="flex justify-between gap-3"><span>Valence avg</span><span className="font-medium text-foreground">{formatMetric(keepIntentSummary.valence, 3)}</span></div>
              <div className="flex justify-between gap-3"><span>Mood avg</span><span className="font-medium text-foreground">{formatMetric(keepIntentSummary.moodScore, 3)}</span></div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5" data-testid="card-feature-summary-remove">
          <h2 className="font-display text-base font-semibold">Remove feature summary</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Averages from imported feature data on latest remove decisions. Tracks missing features are excluded from averages.
          </p>
          <div className="mt-3 rounded-lg border border-border bg-secondary/20 p-3">
            <div className="text-sm font-semibold text-destructive">Remove ({removeTracks.length})</div>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between gap-3"><span>Top 3 keys</span><span className="font-medium text-foreground">{removeSummary.topKeys.length ? removeSummary.topKeys.join(" · ") : "—"}</span></div>
              <div className="flex justify-between gap-3"><span>Median album year</span><span className="font-medium text-foreground">{formatYear(removeSummary.albumYearMedian)}</span></div>
              <div className="flex justify-between gap-3"><span>Album year IQR</span><span className="font-medium text-foreground">{formatYearIqr(removeSummary.albumYearIqr)}</span></div>
              <div className="flex justify-between gap-3"><span>BPM avg</span><span className="font-medium text-foreground">{formatMetric(data.featureSummaryKeepRemove.remove.bpm, 1)}</span></div>
              <div className="flex justify-between gap-3"><span>Energy avg</span><span className="font-medium text-foreground">{formatMetric(data.featureSummaryKeepRemove.remove.energy, 3)}</span></div>
              <div className="flex justify-between gap-3"><span>Dance avg</span><span className="font-medium text-foreground">{formatMetric(data.featureSummaryKeepRemove.remove.dance, 3)}</span></div>
              <div className="flex justify-between gap-3"><span>Valence avg</span><span className="font-medium text-foreground">{formatMetric(data.featureSummaryKeepRemove.remove.valence, 3)}</span></div>
              <div className="flex justify-between gap-3"><span>Mood avg</span><span className="font-medium text-foreground">{formatMetric(data.featureSummaryKeepRemove.remove.moodScore, 3)}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Top tracks */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-semibold">Top 10 most-listened tracks</h2>
        {data.topTracks.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing logged yet.</p>
        ) : (
          <div className="mt-4 divide-y divide-border">
            {data.topTracks.map((t, i) => (
              <div key={t.trackId} className="flex items-center gap-3 py-2.5" data-testid={`top-track-${t.trackId}`}>
                <span className="w-5 shrink-0 text-center text-xs font-bold text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.artists}</div>
                </div>
                <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary tabular-nums">
                  {t.count} {t.count === 1 ? "listen" : "listens"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent logs */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-semibold">Recent logs</h2>
        {data.recent.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing logged yet.</p>
        ) : (
          <div className="mt-4 divide-y divide-border">
            {data.recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2.5" data-testid={`recent-log-${r.id}`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.name || "Unknown track"}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.artists || "Unknown artist"}</div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(r.loggedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
