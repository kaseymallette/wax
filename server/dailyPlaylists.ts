const PLAYLIST_COUNT = 7;
const KMEANS_MAX_ITERS = 25;

type Vector2 = { bpm: number; mood: number };
export const DAILY_PLAYLIST_ORDERING_MODE = "nearest_neighbors" as const;
export type DailyPlaylistOrderingMode = typeof DAILY_PLAYLIST_ORDERING_MODE;

type CandidateTrack = {
  track: PlaylistSourceTrack;
  raw: Vector2;
  normalized: Vector2;
  moodValue: number;
};

type Cluster = {
  centroid: Vector2;
  members: CandidateTrack[];
};

export type DailyPlaylistTrack = {
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

export type DailyPlaylist = {
  index: number;
  trackCount: number;
  orderingMode: DailyPlaylistOrderingMode;
  tracks: DailyPlaylistTrack[];
};

export type DailyPlaylistsResult = {
  playlists: DailyPlaylist[];
  diagnostics: {
    currentlyListeningCount: number;
    excludedForReview: number;
    playlistMaxSize: number;
    usableTrackCount: number;
    excludedMissingFeatures: number;
    droppedForCapacity: number;
  };
};

export type DailyPlaylistOrderingMap = Partial<Record<number, DailyPlaylistOrderingMode>>;

export type PlaylistSourceTrack = {
  id: string;
  name: string;
  artists: string;
  album: string;
  dailyPlaylistStatus?: "include" | "review";
  albumArtUrl?: string | null;
  spotifyUrl?: string | null;
  bpm?: number | null;
  camelot?: string | null;
  energy?: number | null;
  valence?: number | null;
  dance?: number | null;
  albumYear?: number | null;
};

type BuildDailyPlaylistsOptions = {
  firstTrackByPlaylist?: Record<string | number, string>;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function distance(a: Vector2, b: Vector2): number {
  const db = a.bpm - b.bpm;
  const dm = a.mood - b.mood;
  return Math.hypot(db, dm);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  if (values.length <= 1) return 1;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return std > 0 ? std : 1;
}

function normalizeCandidates(candidates: Array<{ track: PlaylistSourceTrack; raw: Vector2; moodValue: number }>): CandidateTrack[] {
  const bpmValues = candidates.map((c) => c.raw.bpm);
  const moodValues = candidates.map((c) => c.raw.mood);
  const bpmMean = mean(bpmValues);
  const moodMean = mean(moodValues);
  const bpmStd = stdDev(bpmValues, bpmMean);
  const moodStd = stdDev(moodValues, moodMean);

  return candidates.map((c) => ({
    track: c.track,
    raw: c.raw,
    moodValue: c.moodValue,
    normalized: {
      bpm: (c.raw.bpm - bpmMean) / bpmStd,
      mood: (c.raw.mood - moodMean) / moodStd,
    },
  }));
}

function nearestCentroidIndex(point: Vector2, centroids: Vector2[]): number {
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centroids.length; i += 1) {
    const d = distance(point, centroids[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function initializeCentroids(points: CandidateTrack[], k: number): Vector2[] {
  if (points.length === 0) return [];
  const centroids: Vector2[] = [];
  const sorted = [...points].sort((a, b) => a.track.id.localeCompare(b.track.id));

  centroids.push(sorted[0].normalized);
  while (centroids.length < k) {
    let bestPoint: CandidateTrack | null = null;
    let bestDistance = Number.NEGATIVE_INFINITY;
    for (const point of sorted) {
      const nearest = centroids.reduce((best, c) => Math.min(best, distance(point.normalized, c)), Number.POSITIVE_INFINITY);
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestPoint = point;
      }
    }
    centroids.push((bestPoint ?? sorted[0]).normalized);
  }

  return centroids;
}

function runKMeans(points: CandidateTrack[], k: number): Cluster[] {
  if (points.length === 0) {
    return Array.from({ length: k }, () => ({ centroid: { bpm: 0, mood: 0 }, members: [] }));
  }

  let centroids = initializeCentroids(points, k);

  for (let iter = 0; iter < KMEANS_MAX_ITERS; iter += 1) {
    const buckets: CandidateTrack[][] = Array.from({ length: k }, () => []);
    for (const point of points) {
      const idx = nearestCentroidIndex(point.normalized, centroids);
      buckets[idx].push(point);
    }

    const nextCentroids = centroids.map((c, idx) => {
      if (buckets[idx].length === 0) return c;
      const bpmAvg = mean(buckets[idx].map((p) => p.normalized.bpm));
      const moodAvg = mean(buckets[idx].map((p) => p.normalized.mood));
      return { bpm: bpmAvg, mood: moodAvg };
    });

    let changed = false;
    for (let i = 0; i < k; i += 1) {
      if (distance(centroids[i], nextCentroids[i]) > 1e-6) {
        changed = true;
        break;
      }
    }
    centroids = nextCentroids;
    if (!changed) break;
  }

  const clusters: Cluster[] = centroids.map((centroid) => ({ centroid, members: [] }));
  for (const point of points) {
    const idx = nearestCentroidIndex(point.normalized, centroids);
    clusters[idx].members.push(point);
  }
  return clusters;
}

function rebalanceClusterSizes(clusters: Cluster[], totalTracks: number): void {
  if (clusters.length === 0 || totalTracks <= 0) return;

  const base = Math.floor(totalTracks / clusters.length);
  const remainder = totalTracks % clusters.length;

  const rankedBySize = clusters
    .map((cluster, idx) => ({ idx, size: cluster.members.length }))
    .sort((a, b) => {
      if (b.size !== a.size) return b.size - a.size;
      return a.idx - b.idx;
    });

  const targetSizes = new Array<number>(clusters.length).fill(base);
  for (let i = 0; i < remainder; i += 1) {
    targetSizes[rankedBySize[i].idx] += 1;
  }

  const pickBestDonor = (receiverIdx: number): { donorIdx: number; memberIdx: number } | null => {
    const receiver = clusters[receiverIdx];
    let best: { donorIdx: number; memberIdx: number; distance: number } | null = null;

    for (let donorIdx = 0; donorIdx < clusters.length; donorIdx += 1) {
      if (donorIdx === receiverIdx) continue;
      const donor = clusters[donorIdx];
      if (donor.members.length <= targetSizes[donorIdx]) continue;

      for (let memberIdx = 0; memberIdx < donor.members.length; memberIdx += 1) {
        const candidate = donor.members[memberIdx];
        const d = distance(candidate.normalized, receiver.centroid);
        if (!best || d < best.distance) {
          best = { donorIdx, memberIdx, distance: d };
        }
      }
    }

    if (!best) return null;
    return { donorIdx: best.donorIdx, memberIdx: best.memberIdx };
  };

  for (let receiverIdx = 0; receiverIdx < clusters.length; receiverIdx += 1) {
    while (clusters[receiverIdx].members.length < targetSizes[receiverIdx]) {
      const donorPick = pickBestDonor(receiverIdx);
      if (!donorPick) break;
      const moved = clusters[donorPick.donorIdx].members.splice(donorPick.memberIdx, 1)[0];
      clusters[receiverIdx].members.push(moved);
    }
  }
}

function orderClusterMembers(
  cluster: Cluster,
  playlistIndex: number,
  firstTrackByPlaylist?: Record<string | number, string>,
): CandidateTrack[] {
  if (cluster.members.length <= 1) return [...cluster.members];

  const remaining = [...cluster.members];
  const centroid: Vector2 = {
    bpm: mean(remaining.map((m) => m.normalized.bpm)),
    mood: mean(remaining.map((m) => m.normalized.mood)),
  };

  const requestedFirstTrackId = firstTrackByPlaylist?.[playlistIndex] ?? firstTrackByPlaylist?.[String(playlistIndex)];
  let startIdx = requestedFirstTrackId
    ? remaining.findIndex((member) => member.track.id === requestedFirstTrackId)
    : -1;
  if (startIdx < 0) {
    startIdx = 0;
    let bestStartDistance = distance(remaining[0].normalized, centroid);
    for (let i = 1; i < remaining.length; i += 1) {
      const d = distance(remaining[i].normalized, centroid);
      if (d < bestStartDistance) {
        startIdx = i;
        bestStartDistance = d;
        continue;
      }
      if (d === bestStartDistance && remaining[i].track.id.localeCompare(remaining[startIdx].track.id) < 0) {
        startIdx = i;
      }
    }
  }

  const ordered: CandidateTrack[] = [remaining.splice(startIdx, 1)[0]];
  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    let nextIdx = 0;
    let nextDist = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const d = distance(current.normalized, remaining[i].normalized);
      if (d < nextDist || (d === nextDist && remaining[i].track.id.localeCompare(remaining[nextIdx].track.id) < 0)) {
        nextDist = d;
        nextIdx = i;
      }
    }

    ordered.push(remaining.splice(nextIdx, 1)[0]);
  }

  return ordered;
}

export function buildDailyPlaylists(tracks: PlaylistSourceTrack[], options: BuildDailyPlaylistsOptions = {}): DailyPlaylistsResult {
  const eligibleTracks = tracks.filter((t) => t.dailyPlaylistStatus !== "review");
  const excludedForReview = tracks.length - eligibleTracks.length;

  const candidatesRaw: Array<{ track: PlaylistSourceTrack; raw: Vector2; moodValue: number }> = [];
  for (const t of eligibleTracks) {
    if (!isFiniteNumber(t.bpm) || !isFiniteNumber(t.energy) || !isFiniteNumber(t.dance) || !isFiniteNumber(t.valence)) {
      continue;
    }
    const mood = t.energy + t.dance + t.valence;
    candidatesRaw.push({
      track: t,
      raw: { bpm: t.bpm, mood },
      moodValue: mood,
    });
  }

  const excludedMissingFeatures = eligibleTracks.length - candidatesRaw.length;
  const normalized = normalizeCandidates(candidatesRaw);

  const k = Math.min(PLAYLIST_COUNT, Math.max(1, normalized.length || 1));
  const clusters = runKMeans(normalized, k);
  while (clusters.length < PLAYLIST_COUNT) {
    clusters.push({ centroid: { bpm: 0, mood: 0 }, members: [] });
  }

  rebalanceClusterSizes(clusters, normalized.length);

  const playlists: DailyPlaylist[] = clusters.slice(0, PLAYLIST_COUNT).map((cluster, i) => {
    const playlistIndex = i + 1;
    const orderingMode = DAILY_PLAYLIST_ORDERING_MODE;
    const ordered = orderClusterMembers(cluster, playlistIndex, options.firstTrackByPlaylist);
    const tracksOut: DailyPlaylistTrack[] = ordered.map((c) => ({
      id: c.track.id,
      name: c.track.name,
      artists: c.track.artists,
      album: c.track.album,
      dailyPlaylistStatus: c.track.dailyPlaylistStatus === "review" ? "review" : "include",
      albumArtUrl: c.track.albumArtUrl ?? null,
      spotifyUrl: c.track.spotifyUrl ?? null,
      bpm: c.track.bpm ?? 0,
      mood: c.moodValue,
      camelot: c.track.camelot ?? null,
      energy: c.track.energy ?? 0,
      valence: c.track.valence ?? 0,
      dance: c.track.dance ?? 0,
      albumYear: c.track.albumYear ?? null,
    }));

    return {
      index: playlistIndex,
      trackCount: tracksOut.length,
      orderingMode,
      tracks: tracksOut,
    };
  });

  return {
    playlists,
    diagnostics: {
      currentlyListeningCount: tracks.length,
      excludedForReview,
      playlistMaxSize: Math.ceil((normalized.length || 1) / PLAYLIST_COUNT),
      usableTrackCount: normalized.length,
      excludedMissingFeatures,
      droppedForCapacity: 0,
    },
  };
}
