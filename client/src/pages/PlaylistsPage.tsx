import { useEffect, useMemo, useState } from "react";
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

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

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

type Playlist = {
  index: number;
  trackCount: number;
  tracks: PlaylistTrack[];
};

type Resp = {
  playlists: Playlist[];
  diagnostics: {
    currentlyListeningCount: number;
    usableTrackCount: number;
    excludedMissingFeatures: number;
    droppedForCapacity: number;
  };
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
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dayMap, setDayMap] = useState<Record<number, string>>({});

  const query = useQuery<Resp>({
    queryKey: ["/api/playlists/daily"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/playlists/daily");
      return res.json();
    },
  });

  const playlists = query.data?.playlists ?? [];
  const diagnostics = query.data?.diagnostics;

  useEffect(() => {
    if (playlists.length === 0) return;

    const fallback = defaultDayMap(playlists);
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) {
        setDayMap(fallback);
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, string>;
      const next: Record<number, string> = { ...fallback };
      for (const p of playlists) {
        const assigned = parsed[String(p.index)];
        if (assigned && WEEKDAYS.includes(assigned as (typeof WEEKDAYS)[number])) {
          next[p.index] = assigned;
        }
      }
      setDayMap(next);
    } catch {
      setDayMap(fallback);
    }
  }, [playlists]);

  useEffect(() => {
    if (!Object.keys(dayMap).length) return;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dayMap));
  }, [dayMap]);

  const assignedDays = useMemo(() => new Set(Object.values(dayMap)), [dayMap]);

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
        Currently Listening is split into 5 weekday playlists using BPM + mood clustering.
      </p>

      {query.isLoading ? (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
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
              const isExpanded = expanded.has(playlist.index);
              const preview = playlist.tracks.slice(0, 5);
              const visibleTracks = isExpanded ? playlist.tracks : preview;
              return (
                <div key={playlist.index} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-base font-semibold">Playlist {playlist.index}</h2>
                      <p className="text-xs text-muted-foreground">{playlist.trackCount} songs (max 25)</p>
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
                            <SelectItem
                              key={day}
                              value={day}
                              disabled={assignedDays.has(day) && dayMap[playlist.index] !== day}
                            >
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
                            if (next.has(playlist.index)) next.delete(playlist.index);
                            else next.add(playlist.index);
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
    </Layout>
  );
}
