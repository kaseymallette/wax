import { useQuery } from "@tanstack/react-query";
import type { ListenWithTrack } from "@shared/schema";
import { Layout } from "@/components/Layout";
import { ImportEmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { eraLabel, relativeTime } from "@/lib/wax";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import { Disc3, Headphones, ListMusic, CalendarDays, ThumbsUp, ThumbsDown } from "lucide-react";

type Stats = {
  totals: { tracks: number; totalListens: number; actualListens: number; uniqueTracksLogged: number };
  listensByDay: { date: string; count: number }[];
  topTracks: { trackId: string; name: string; artists: string; count: number }[];
  activityBreakdown: { activity: string; count: number }[];
  wouldAgainRatio: { yes: number; no: number };
  eraDistribution: { era: string; count: number }[];
  recent: ListenWithTrack[];
};

const CHART_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))",
];

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

export default function StatsPage() {
  const { data, isLoading } = useQuery<Stats>({ queryKey: ["/api/stats"] });

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

  const eraData = data.eraDistribution.map((e) => ({ name: eraLabel(e.era === "unset" ? null : e.era), value: e.count }));

  const total = data.wouldAgainRatio.yes + data.wouldAgainRatio.no;
  const yesPct = total ? Math.round((data.wouldAgainRatio.yes / total) * 100) : 0;
  const noPct = total ? 100 - yesPct : 0;

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

        {/* Activity breakdown */}
        <div className="rounded-xl border border-border bg-card p-5" data-testid="chart-activity">
          <h2 className="font-display text-base font-semibold">Activity breakdown</h2>
          {data.activityBreakdown.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No activities logged yet.</p>
          ) : (
            <div className="mt-4" style={{ height: Math.max(180, data.activityBreakdown.length * 28) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.activityBreakdown} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="activity" width={92} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <RTooltip {...chartTooltip()} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                  <Bar dataKey="count" fill="hsl(var(--chart-3))" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Era distribution */}
        <div className="rounded-xl border border-border bg-card p-5" data-testid="chart-era">
          <h2 className="font-display text-base font-semibold">Era distribution</h2>
          <div className="mt-4 flex items-center gap-4">
            <div className="h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={eraData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {eraData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <RTooltip {...chartTooltip()} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5">
              {eraData.map((e, i) => (
                <div key={e.name} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="flex-1 text-muted-foreground">{e.name}</span>
                  <span className="tabular-nums font-medium">{e.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Would listen again */}
        <div className="rounded-xl border border-border bg-card p-5" data-testid="chart-would-again">
          <h2 className="font-display text-base font-semibold">Would listen again</h2>
          {total === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No listens logged yet.</p>
          ) : (
            <div className="mt-6 space-y-4">
              <div className="flex items-end justify-around">
                <div className="text-center">
                  <ThumbsUp className="mx-auto h-6 w-6 text-primary" />
                  <div className="mt-2 font-display text-3xl font-extrabold tabular-nums">{yesPct}%</div>
                  <div className="text-xs text-muted-foreground">Yes ({data.wouldAgainRatio.yes})</div>
                </div>
                <div className="text-center">
                  <ThumbsDown className="mx-auto h-6 w-6 text-destructive" />
                  <div className="mt-2 font-display text-3xl font-extrabold tabular-nums">{noPct}%</div>
                  <div className="text-xs text-muted-foreground">No ({data.wouldAgainRatio.no})</div>
                </div>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-secondary/50">
                <div className="h-full bg-primary" style={{ width: `${yesPct}%` }} />
                <div className="h-full bg-destructive" style={{ width: `${noPct}%` }} />
              </div>
            </div>
          )}
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
