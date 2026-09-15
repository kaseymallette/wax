import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Lock, LockOpen, RefreshCcw } from "lucide-react";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const DAILY_ORDERING_MODE = "nearest_neighbors" as const;
const AUTO_FIRST_TRACK = "__auto__";

type PlaylistTrack = {
  id: string;
  name: string;
  artists: string;
  album: string;
  spotifyUrl: string | null;
  bpm: number;
  mood: number;
};

type Playlist = {
  index: number;
  trackCount: number;
  orderingMode: typeof DAILY_ORDERING_MODE;
  tracks: PlaylistTrack[];
};

type DailyOrderingResp = {
  mode: typeof DAILY_ORDERING_MODE;
  firstTrackByPlaylist: Record<string, string>;
};

type Resp = {
  playlists: Playlist[];
  diagnostics: {
    usableTrackCount: number;
    excludedMissingFeatures: number;
  };
  isLocked: boolean;
  lockedAt: number | null;
};

type WeekdayMapResp = {
  mapping: Record<string, string>;
};

type RuntimeResp = {
  mode: string;
  stateDir: string;
};

export default function PlaylistsPage() {
  const [dayMap, setDayMap] = useState<Record<number, string>>({});
  const [dayMapInitialized, setDayMapInitialized] = useState(false);

  const query = useQuery<Resp>({
    queryKey: ["/api/playlists/daily"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/playlists/daily");
      return res.json();
    },
  });
  const orderingQuery = useQuery<DailyOrderingResp>({
    queryKey: ["/api/playlists/daily-ordering"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/playlists/daily-ordering");
      return res.json();
    },
  });
  const runtimeQuery = useQuery<RuntimeResp>({
    queryKey: ["/api/runtime"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/runtime");
      return res.json();
    },
  });

  const playlists = query.data?.playlists ?? [];
  const diagnostics = query.data?.diagnostics;
  const isLocked = query.data?.isLocked ?? false;
  const lockedAt = query.data?.lockedAt ?? null;
  const firstTrackByPlaylist = orderingQuery.data?.firstTrackByPlaylist ?? {};

  const reclusterMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/playlists/daily-recluster");
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists/daily"] });
      queryClient.invalidateQueries({ queryKey: ["/api/playlists/daily-ordering"] });
      await queryClient.refetchQueries({ queryKey: ["/api/playlists/daily"], type: "active" });
    },
  });
  const lockMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/playlists/daily-lock");
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists/daily"] });
      await queryClient.refetchQueries({ queryKey: ["/api/playlists/daily"], type: "active" });
    },
  });
  const unlockMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/playlists/daily-lock");
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists/daily"] });
      await queryClient.refetchQueries({ queryKey: ["/api/playlists/daily"], type: "active" });
    },
  });
  const firstTrackMutation = useMutation({
    mutationFn: async ({
      playlistIndex,
      firstTrackId,
    }: {
      playlistIndex: number;
      firstTrackId: string | null;
    }) => {
      const res = await apiRequest("PUT", "/api/playlists/daily-ordering", {
        playlistIndex,
        firstTrackId,
      });
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists/daily"] });
      await queryClient.refetchQueries({ queryKey: ["/api/playlists/daily"], type: "active" });
    },
  });

  useEffect(() => {
    if (playlists.length === 0) return;
    let cancelled = false;
    const fallback: Record<number, string> = {};
    for (let i = 0; i < playlists.length; i += 1) {
      fallback[playlists[i].index] = WEEKDAYS[i] ?? "Monday";
    }

    const load = async () => {
      let next = { ...fallback };
      try {
        const res = await apiRequest("GET", "/api/playlists/weekday-map");
        const payload = (await res.json()) as WeekdayMapResp;
        for (const p of playlists) {
          const day = payload.mapping[String(p.index)];
          if (day && WEEKDAYS.includes(day as (typeof WEEKDAYS)[number])) next[p.index] = day;
        }
      } catch {
        // keep defaults
      }
      if (!cancelled) {
        setDayMap(next);
        setDayMapInitialized(true);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [playlists]);

  const dayMapMutation = useMutation({
    mutationFn: async (next: Record<number, string>) => {
      const mapping: Record<string, string> = {};
      for (const [idx, day] of Object.entries(next)) mapping[String(idx)] = day;
      const res = await apiRequest("PUT", "/api/playlists/weekday-map", { mapping });
      return res.json();
    },
  });

  if (query.isLoading) {
    return (
      <Layout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <h1 className="font-display text-2xl font-bold">Playlists</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            V2 Phase 1: V1 surfaces removed. Profile-config and CSV validation are next.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => lockMutation.mutate()}
              disabled={lockMutation.isPending || isLocked}
            >
              <Lock className="mr-2 h-4 w-4" />
              Lock
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => unlockMutation.mutate()}
              disabled={unlockMutation.isPending || !isLocked}
            >
              <LockOpen className="mr-2 h-4 w-4" />
              Unlock
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => reclusterMutation.mutate()}
              disabled={reclusterMutation.isPending}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Recluster
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {isLocked && lockedAt
              ? `Locked at ${new Date(lockedAt).toLocaleString()}`
              : "Currently unlocked"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Runtime: {runtimeQuery.data?.mode ?? "unknown"} · State dir: {runtimeQuery.data?.stateDir ?? "unknown"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tracks in current run: {diagnostics?.usableTrackCount ?? 0} · Missing features: {diagnostics?.excludedMissingFeatures ?? 0}
          </p>
        </div>

        {playlists.map((playlist) => {
          const currentFirst = firstTrackByPlaylist[String(playlist.index)] ?? AUTO_FIRST_TRACK;
          return (
            <section key={playlist.index} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold">
                  Playlist {playlist.index} · {dayMap[playlist.index] ?? WEEKDAYS[playlist.index - 1]} · {playlist.trackCount} tracks
                </h2>
                <div className="min-w-[260px]">
                  <Select
                    value={currentFirst}
                    onValueChange={(value) =>
                      firstTrackMutation.mutate({
                        playlistIndex: playlist.index,
                        firstTrackId: value === AUTO_FIRST_TRACK ? null : value,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose first song" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_FIRST_TRACK}>Auto (center-nearest)</SelectItem>
                      {playlist.tracks.map((track) => (
                        <SelectItem key={track.id} value={track.id}>
                          {track.name} — {track.artists}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ol className="mt-3 space-y-2">
                {playlist.tracks.map((track, i) => (
                  <li key={track.id} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="font-medium">{i + 1}. {track.name}</div>
                    <div className="text-muted-foreground">{track.artists} · {track.album}</div>
                  </li>
                ))}
                {playlist.tracks.length === 0 && (
                  <li className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                    No tracks yet. Phase 2 wires validated CSV profiles into this view.
                  </li>
                )}
              </ol>
            </section>
          );
        })}

        {dayMapInitialized && playlists.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-display text-lg font-semibold">Weekday mapping</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {playlists.map((playlist) => (
                <div key={`weekday-${playlist.index}`} className="flex items-center gap-2">
                  <span className="w-24 text-sm text-muted-foreground">Playlist {playlist.index}</span>
                  <Select
                    value={dayMap[playlist.index] ?? WEEKDAYS[playlist.index - 1]}
                    onValueChange={(day) => {
                      const next = { ...dayMap, [playlist.index]: day };
                      setDayMap(next);
                      dayMapMutation.mutate(next);
                    }}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((day) => (
                        <SelectItem key={`${playlist.index}-${day}`} value={day}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
