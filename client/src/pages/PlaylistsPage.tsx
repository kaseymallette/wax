import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { apiRequest } from "@/lib/queryClient";
import { ChevronDown, ChevronUp, Music2 } from "lucide-react";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

type PlaylistTrack = {
  id: string;
  name: string;
  artists: string;
  album: string;
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
  tracks: PlaylistTrack[];
};

type Resp = {
  playlists: Playlist[];
  diagnostics: {
    currentlyListeningCount: number;
    playlistMaxSize: number;
    usableTrackCount: number;
    excludedMissingFeatures: number;
    droppedForCapacity: number;
  };
};

type KeepTrack = {
  id: string;
  name: string;
  artists: string;
  album: string;
  addedAt: string | null;
  repeatIntent: string;
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

  const playlists = query.data?.playlists ?? [];
  const diagnostics = query.data?.diagnostics;
  const keepTracks = keepTracksQuery.data ?? [];
  const favoritesArchiveTracks = [...keepTracks.filter((t) => t.repeatIntent === "favorites_archive")].sort((a, b) => {
    return a.artists.localeCompare(b.artists) || a.album.localeCompare(b.album) || a.name.localeCompare(b.name);
  });
  const compareAddedAtDesc = (a: KeepTrack, b: KeepTrack) => {
    const aAdded = a.addedAt ? Date.parse(a.addedAt) : Number.NaN;
    const bAdded = b.addedAt ? Date.parse(b.addedAt) : Number.NaN;
    const aHas = Number.isFinite(aAdded);
    const bHas = Number.isFinite(bAdded);
    if (aHas && bHas && aAdded !== bAdded) return bAdded - aAdded;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return a.name.localeCompare(b.name);
  };
  const saveForLaterTracks = [...keepTracks.filter((t) => t.repeatIntent === "save_for_later")].sort((a, b) => {
    return a.artists.localeCompare(b.artists) || a.album.localeCompare(b.album) || a.name.localeCompare(b.name);
  });
  const currentlyListeningTracks = [...keepTracks.filter((t) => t.repeatIntent === "currently_listening")].sort((a, b) => {
    return a.artists.localeCompare(b.artists) || a.album.localeCompare(b.album) || a.name.localeCompare(b.name);
  });

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

  return (
    <Layout>
      <h1 className="font-display text-xl font-bold">Playlists</h1>
      <p className="text-sm text-muted-foreground">
        7 daily playlists (Mon-Sun) are created from Currently Listening using BPM + mood clustering.
      </p>
      <p className="text-sm text-muted-foreground">
        3 additional playlists are created: Currently Listening, Save for Later, and Favorites Archive.
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
            <div className="flex flex-wrap gap-3">
              <span>Currently Listening: {diagnostics.currentlyListeningCount}</span>
              <span>Usable for clustering: {diagnostics.usableTrackCount}</span>
              <span>Missing features: {diagnostics.excludedMissingFeatures}</span>
              {diagnostics.droppedForCapacity > 0 && <span>Dropped at cap: {diagnostics.droppedForCapacity}</span>}
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {playlists.map((playlist) => {
              const panelKey = `daily-${playlist.index}`;
              const isExpanded = expanded.has(panelKey);
              const preview = playlist.tracks.slice(0, 5);
              const visibleTracks = isExpanded ? playlist.tracks : preview;
              return (
                <div key={playlist.index} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-base font-semibold">Playlist {playlist.index}</h2>
                      <p className="text-xs text-muted-foreground">{playlist.trackCount} songs (max {diagnostics.playlistMaxSize})</p>
                    </div>
                    <div className="flex items-center gap-2">
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
                            <div className="shrink-0 text-[10px] text-muted-foreground">
                              {Math.round(t.bpm)} BPM · Mood {t.mood.toFixed(2)}
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

            {[
              { key: "currently-listening", title: "Currently Listening", tracks: currentlyListeningTracks },
              { key: "save-for-later", title: "Save for Later", tracks: saveForLaterTracks },
              { key: "favorites-archive", title: "Favorites Archive", tracks: favoritesArchiveTracks },
            ].map((list) => {
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
        </>
      )}
    </Layout>
  );
}
