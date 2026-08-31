import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Check, ChevronDown, ChevronUp, Circle, Lock, LockOpen, Music2, Square, X } from "lucide-react";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const DAILY_ORDERING_MODE = "nearest_neighbors" as const;
const AUTO_FIRST_TRACK = "__auto__";

type PlaylistTrack = {
  id: string;
  name: string;
  artists: string;
  album: string;
  dailyPlaylistStatus: "include" | "review";
  albumArtUrl: string | null;
  spotifyUrl: string | null;
  bpm: number;
  mood: number;
  camelot: string | null;
  energy: number;
  valence: number;
  dance: number;
  albumYear: number | null;
};

type WeekdayMapResp = {
  mapping: Record<string, string>;
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
    currentlyListeningCount: number;
    excludedForReview: number;
    playlistMaxSize: number;
    usableTrackCount: number;
    excludedMissingFeatures: number;
    droppedForCapacity: number;
  };
  isLocked: boolean;
  lockedAt: number | null;
};

type KeepTrack = {
  id: string;
  name: string;
  artists: string;
  album: string;
  addedAt: string | null;
  repeatIntent: string;
  dailyPlaylistStatus: "include" | "review";
  albumYear: number | null;
  bpm: number | null;
  energy: number | null;
  dance: number | null;
  valence: number | null;
};

const LOCAL_STORAGE_KEY = "wax-playlist-weekday-map";

function defaultDayMap(playlists: Playlist[]): Record<number, string> {
  const map: Record<number, string> = {};
  for (let i = 0; i < playlists.length; i += 1) {
    map[playlists[i].index] = WEEKDAYS[i] ?? "Monday";
  }
  return map;
}

export default function PlaylistsPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dayMap, setDayMap] = useState<Record<number, string>>({});
  const [dayMapInitialized, setDayMapInitialized] = useState(false);

  const repeatIntentMutation = useMutation({
    mutationFn: async ({
      trackId,
      repeatIntent,
    }: {
      trackId: string;
      repeatIntent: "currently_listening" | "favorites_archive" | "save_for_later" | "skip_for_now";
    }) => {
      const res = await apiRequest("PATCH", `/api/tracks/${trackId}/repeat-intent`, {
        repeatIntent,
      });
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists/daily"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracks"] });
      await queryClient.refetchQueries({ queryKey: ["/api/playlists/daily"], type: "active" });
    },
  });

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

  const query = useQuery<Resp>({
    queryKey: ["/api/playlists/daily"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/playlists/daily");
      return res.json();
    },
  });

  const keepTracksQuery = useQuery<KeepTrack[]>({
    queryKey: ["/api/tracks", "keep", "playlists"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/tracks?status=keep&sort=last");
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
  const playlists = query.data?.playlists ?? [];
  const diagnostics = query.data?.diagnostics;
  const isLocked = query.data?.isLocked ?? false;
  const lockedAt = query.data?.lockedAt ?? null;
  const keepTracks = keepTracksQuery.data ?? [];
  const firstTrackByPlaylist = orderingQuery.data?.firstTrackByPlaylist ?? {};
  const compareArtistAlbumSong = (a: KeepTrack, b: KeepTrack) => {
    return a.artists.localeCompare(b.artists) || a.album.localeCompare(b.album) || a.name.localeCompare(b.name);
  };
  const favoritesArchiveTracks = [...keepTracks.filter((t) => t.repeatIntent === "favorites_archive")].sort(compareArtistAlbumSong);
  const saveForLaterTracks = [...keepTracks.filter((t) => t.repeatIntent === "save_for_later")].sort((a, b) => {
    return compareArtistAlbumSong(a, b);
  });
  const currentlyListeningTracks = [...keepTracks.filter((t) => t.repeatIntent === "currently_listening")].sort((a, b) => {
    return compareArtistAlbumSong(a, b);
  });
  const skipForNowTracks = [...keepTracks.filter((t) => t.repeatIntent === "skip_for_now")].sort((a, b) => {
    return compareArtistAlbumSong(a, b);
  });
  const fullKeepsTracks = [...keepTracks.filter((t) => (
    t.repeatIntent === "currently_listening" ||
    t.repeatIntent === "favorites_archive" ||
    t.repeatIntent === "save_for_later" ||
    t.repeatIntent === "skip_for_now"
  ))].sort((a, b) => compareArtistAlbumSong(a, b));

  useEffect(() => {
    if (playlists.length === 0) return;

    const fallback = defaultDayMap(playlists);
    let cancelled = false;

    const load = async () => {
      const next: Record<number, string> = { ...fallback };

      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, string>;
          for (const p of playlists) {
            const assigned = parsed[String(p.index)];
            if (assigned && WEEKDAYS.includes(assigned as (typeof WEEKDAYS)[number])) {
              next[p.index] = assigned;
            }
          }
        }
      } catch {}

      try {
        const res = await apiRequest("GET", "/api/playlists/weekday-map");
        const payload = (await res.json()) as WeekdayMapResp;
        const serverMap = payload.mapping ?? {};
        for (const p of playlists) {
          const assigned = serverMap[String(p.index)];
          if (assigned && WEEKDAYS.includes(assigned as (typeof WEEKDAYS)[number])) {
            next[p.index] = assigned;
          }
        }
      } catch {}

      if (!cancelled) {
        setDayMap(next);
        setDayMapInitialized(true);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [playlists]);

  useEffect(() => {
    if (!dayMapInitialized || !Object.keys(dayMap).length) return;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dayMap));
    void apiRequest("PUT", "/api/playlists/weekday-map", {
      mapping: Object.fromEntries(Object.entries(dayMap).map(([k, v]) => [String(k), v])),
    }).catch(() => {});
  }, [dayMap, dayMapInitialized]);

  const updateDay = (playlistIndex: number, newDay: string) => {
    setDayMap((prev) => {
      const next = { ...prev };
      const currentDay = next[playlistIndex];
      if (currentDay === newDay) return prev;

      const conflict = Object.entries(next).find(
        ([idx, day]) => Number(idx) !== playlistIndex && day === newDay,
      );

      next[playlistIndex] = newDay;
      if (conflict && currentDay) {
        next[Number(conflict[0])] = currentDay;
      }
      return next;
    });
  };

  const keepLists: { key: string; title: string; tracks: KeepTrack[] }[] = [
    { key: "currently-listening", title: "Currently Listening", tracks: currentlyListeningTracks },
    { key: "favorites-archive", title: "Favorites Archive", tracks: favoritesArchiveTracks },
    { key: "save-for-later", title: "Save for Later", tracks: saveForLaterTracks },
    { key: "skip-for-now", title: "Skip for Now", tracks: skipForNowTracks },
    { key: "full-keeps", title: "Full Music Library", tracks: fullKeepsTracks },
  ];

  return (
    <Layout>
      <h1 className="font-display text-xl font-bold">Playlists</h1>
      <Tabs defaultValue="daily" className="mt-4">
        <TabsList>
          <TabsTrigger value="daily" data-testid="tab-playlists-daily">Daily Playlists</TabsTrigger>
          <TabsTrigger value="keeps" data-testid="tab-playlists-keeps">Keeps</TabsTrigger>
        </TabsList>

        <TabsContent value="daily">
          <p className="text-sm text-muted-foreground">
            7 daily playlists (Mon-Sun) are created from Currently Listening using BPM + mood clustering.
          </p>
          {query.isLoading ? (
            <div className="mt-6 space-y-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-xl" />
              ))}
            </div>
          ) : !diagnostics ? (
            <div className="mt-6 rounded-xl border border-border bg-card px-4 py-8 text-sm text-muted-foreground">
              Could not load playlists.
            </div>
          ) : (
            <>
              <div className="mt-4 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-3">
                    <span>Currently Listening: {diagnostics.currentlyListeningCount}</span>
                    <span>Usable for clustering: {diagnostics.usableTrackCount}</span>
                    <span>Missing features: {diagnostics.excludedMissingFeatures}</span>
                    {diagnostics.droppedForCapacity > 0 && <span>Dropped at cap: {diagnostics.droppedForCapacity}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      isLocked
                        ? "bg-blue-500/15 text-blue-400"
                        : "bg-secondary/60 text-muted-foreground"
                    }`}>
                      {isLocked ? "Locked" : "Live"}
                    </span>
                    {lockedAt ? (
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(lockedAt).toLocaleString()}
                      </span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => reclusterMutation.mutate()}
                      disabled={reclusterMutation.isPending}
                      data-testid="button-daily-recluster"
                    >
                      <Music2 className="mr-1 h-3.5 w-3.5" /> Recluster
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => lockMutation.mutate()}
                      disabled={lockMutation.isPending || isLocked}
                      data-testid="button-daily-lock"
                    >
                      <Lock className="mr-1 h-3.5 w-3.5" /> Lock Playlists
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => unlockMutation.mutate()}
                      disabled={unlockMutation.isPending || !isLocked}
                      data-testid="button-daily-unlock"
                    >
                      <LockOpen className="mr-1 h-3.5 w-3.5" /> Unlock
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Currently Listening
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Square className="h-3.5 w-3.5 text-blue-400" /> Favorites Archive
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Circle className="h-3.5 w-3.5 text-yellow-400" /> Save for Later
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <X className="h-3.5 w-3.5 text-destructive" /> Skip for Now
                  </span>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {playlists.map((playlist) => {
              const panelKey = `daily-${playlist.index}`;
              const isExpanded = expanded.has(panelKey);
              const preview = playlist.tracks.slice(0, 5);
              const visibleTracks = isExpanded ? playlist.tracks : preview;
              const tracksForFirstSongSelect = [...playlist.tracks].sort((a, b) => {
                return a.name.localeCompare(b.name) || a.artists.localeCompare(b.artists) || a.id.localeCompare(b.id);
              });
              const persistedFirstTrackId = firstTrackByPlaylist[String(playlist.index)];
              const persistedExists = persistedFirstTrackId
                ? playlist.tracks.some((track) => track.id === persistedFirstTrackId)
                : false;
              const selectedFirstTrackValue = persistedExists ? persistedFirstTrackId : AUTO_FIRST_TRACK;
              return (
                <div key={playlist.index} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-base font-semibold">Playlist {playlist.index}</h2>
                      <p className="text-xs text-muted-foreground">{playlist.trackCount} songs (max {diagnostics.playlistMaxSize})</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
                        Nearest Neighbors
                      </div>
                      <Select
                        value={selectedFirstTrackValue}
                        onValueChange={(value) =>
                          firstTrackMutation.mutate({
                            playlistIndex: playlist.index,
                            firstTrackId: value === AUTO_FIRST_TRACK ? null : value,
                          })
                        }
                        disabled={firstTrackMutation.isPending || isLocked}
                      >
                        <SelectTrigger className="w-64" data-testid={`select-playlist-first-track-${playlist.index}`}>
                          <SelectValue placeholder="First song" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AUTO_FIRST_TRACK}>Auto pick first song</SelectItem>
                          {tracksForFirstSongSelect.map((track) => (
                            <SelectItem key={track.id} value={track.id}>
                              {track.name} - {track.artists}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={dayMap[playlist.index] ?? "Monday"}
                        onValueChange={(day) => updateDay(playlist.index, day)}
                      >
                        <SelectTrigger className="w-44" data-testid={`select-playlist-day-${playlist.index}`}>
                          <SelectValue placeholder="Assign weekday" />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAYS.map((day) => (
                            <SelectItem key={day} value={day}>
                              {day}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {visibleTracks.length === 0 ? (
                    <div className="mt-4 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      <Music2 className="mx-auto h-4 w-4" />
                      <p className="mt-2">No songs in this playlist yet.</p>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-2">
                      {visibleTracks.map((t, idx) => (
                        <div
                          key={t.id}
                          className="rounded-lg border border-border/80 bg-secondary/20 px-3 py-2"
                          data-testid={`playlist-${playlist.index}-track-${t.id}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {idx + 1}. {t.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{t.artists}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="shrink-0 text-[10px] text-muted-foreground">
                                {Math.round(t.bpm)} BPM · Mood {t.mood.toFixed(2)}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    repeatIntentMutation.mutate({
                                      trackId: t.id,
                                      repeatIntent: "currently_listening",
                                    })
                                  }
                                  disabled={
                                    (repeatIntentMutation.isPending &&
                                      repeatIntentMutation.variables?.trackId === t.id)
                                  }
                                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs transition-colors hover-elevate ${
                                    "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                                  }`}
                                  title="Currently Listening"
                                  data-testid={`button-playlist-intent-currently-listening-${t.id}`}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    repeatIntentMutation.mutate({
                                      trackId: t.id,
                                      repeatIntent: "favorites_archive",
                                    })
                                  }
                                  disabled={
                                    (repeatIntentMutation.isPending &&
                                      repeatIntentMutation.variables?.trackId === t.id)
                                  }
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-blue-500/50 bg-blue-500/15 text-xs text-blue-400 transition-colors hover-elevate"
                                  title="Favorites Archive"
                                  data-testid={`button-playlist-intent-favorites-archive-${t.id}`}
                                >
                                  <Square className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    repeatIntentMutation.mutate({
                                      trackId: t.id,
                                      repeatIntent: "save_for_later",
                                    })
                                  }
                                  disabled={
                                    (repeatIntentMutation.isPending &&
                                      repeatIntentMutation.variables?.trackId === t.id)
                                  }
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-yellow-500/50 bg-yellow-500/15 text-xs text-yellow-400 transition-colors hover-elevate"
                                  title="Save for Later"
                                  data-testid={`button-playlist-intent-save-for-later-${t.id}`}
                                >
                                  <Circle className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    repeatIntentMutation.mutate({
                                      trackId: t.id,
                                      repeatIntent: "skip_for_now",
                                    })
                                  }
                                  disabled={
                                    (repeatIntentMutation.isPending &&
                                      repeatIntentMutation.variables?.trackId === t.id)
                                  }
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-destructive/50 bg-destructive/15 text-xs text-destructive transition-colors hover-elevate"
                                  title="Skip for Now"
                                  data-testid={`button-playlist-intent-skip-for-now-${t.id}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {playlist.tracks.length > 5 && (
                    <div className="mt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(panelKey)) next.delete(panelKey);
                            else next.add(panelKey);
                            return next;
                          });
                        }}
                        data-testid={`button-playlist-expand-${playlist.index}`}
                      >
                        {isExpanded ? (
                          <>
                            Show fewer <ChevronUp className="ml-1 h-4 w-4" />
                          </>
                        ) : (
                          <>
                            Show all songs <ChevronDown className="ml-1 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="keeps">
          <p className="text-sm text-muted-foreground">
            Keep-based playlists plus a Full Music Library view.
          </p>
          <div className="mt-6 space-y-4">
            {keepLists.map((list) => {
              const isExpanded = expanded.has(list.key);
              const preview = list.tracks.slice(0, 5);
              const visibleTracks = isExpanded ? list.tracks : preview;

              return (
                <div key={list.key} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-base font-semibold">{list.title}</h2>
                      <p className="text-xs text-muted-foreground">{list.tracks.length} songs</p>
                    </div>
                  </div>

                  {keepTracksQuery.isLoading ? (
                    <div className="mt-4 space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={`${list.key}-skeleton-${i}`} className="h-14 w-full rounded-lg" />
                      ))}
                    </div>
                  ) : visibleTracks.length === 0 ? (
                    <div className="mt-4 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      <Music2 className="mx-auto h-4 w-4" />
                      <p className="mt-2">No songs in this playlist yet.</p>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-2">
                      {visibleTracks.map((t, idx) => {
                        const mood =
                          t.energy != null && t.dance != null && t.valence != null
                            ? t.energy + t.dance + t.valence
                            : null;

                        return (
                          <div
                            key={t.id}
                            className="rounded-lg border border-border/80 bg-secondary/20 px-3 py-2"
                            data-testid={`${list.key}-track-${t.id}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {idx + 1}. {t.name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">{t.artists}</p>
                              </div>
                              <div className="shrink-0 text-[10px] text-muted-foreground">
                                {t.bpm != null && Number.isFinite(t.bpm) ? `${Math.round(t.bpm)} BPM` : "—"}
                                {mood != null ? ` · Mood ${mood.toFixed(2)}` : ""}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {list.tracks.length > 5 && (
                    <div className="mt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(list.key)) next.delete(list.key);
                            else next.add(list.key);
                            return next;
                          });
                        }}
                        data-testid={`button-${list.key}-expand`}
                      >
                        {isExpanded ? (
                          <>
                            Show fewer <ChevronUp className="ml-1 h-4 w-4" />
                          </>
                        ) : (
                          <>
                            Show all songs <ChevronDown className="ml-1 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
