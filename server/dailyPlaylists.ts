import type { TrackWithStats } from "@shared/schema";

const PLAYLIST_COUNT = 7;
const PLAYLIST_MAX_SIZE = 30;
const KMEANS_MAX_ITERS = 25;

type Vector2 = { bpm: number; mood: number };

type CandidateTrack = {
  track: TrackWithStats;
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

function playlistMaxSizeForCount(currentlyListeningCount: number): number {
  if (currentlyListeningCount <= 35) return 5;
  if (currentlyListeningCount <= 70) return 10;
  if (currentlyListeningCount <= 105) return 15;
  if (currentlyListeningCount <= 140) return 20;
  if (currentlyListeningCount <= 175) return 25;
  return PLAYLIST_MAX_SIZE;
}

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

function normalizeCandidates(candidates: Array<{ track: TrackWithStats; raw: Vector2; moodValue: number }>): CandidateTrack[] {
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

function enforcePlaylistCap(clusters: Cluster[], playlistMaxSize: number): { droppedForCapacity: number } {
  let droppedForCapacity = 0;

  const withOverflow = () => clusters.findIndex((c) => c.members.length > playlistMaxSize);

  let overflowIdx = withOverflow();
  while (overflowIdx !== -1) {
    const cluster = clusters[overflowIdx];
    const ranked = [...cluster.members].sort((a, b) => {
      const da = distance(a.normalized, cluster.centroid);
      const db = distance(b.normalized, cluster.centroid);
      if (db !== da) return db - da;
      return a.track.id.localeCompare(b.track.id);
    });

    const overflow = ranked.slice(playlistMaxSize);
    cluster.members = ranked.slice(0, playlistMaxSize);

    for (const candidate of overflow) {
      const targets = clusters
        .map((c, idx) => ({ idx, c }))
        .filter(({ idx, c }) => idx !== overflowIdx && c.members.length < playlistMaxSize)
        .sort((a, b) => {
          const da = distance(candidate.normalized, a.c.centroid);
          const db = distance(candidate.normalized, b.c.centroid);
          if (da !== db) return da - db;
          return a.c.members.length - b.c.members.length;
        });

      if (targets.length === 0) {
        droppedForCapacity += 1;
      } else {
        clusters[targets[0].idx].members.push(candidate);
      }
    }

    overflowIdx = withOverflow();
  }

  return { droppedForCapacity };
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

function orderClusterMembers(cluster: Cluster): CandidateTrack[] {
  if (cluster.members.length <= 2) return [...cluster.members];

  const remaining = [...cluster.members];
  remaining.sort((a, b) => {
    const da = distance(a.normalized, cluster.centroid);
    const db = distance(b.normalized, cluster.centroid);
    if (da !== db) return da - db;
    return a.track.id.localeCompare(b.track.id);
  });

  const ordered: CandidateTrack[] = [remaining.shift()!];
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

export function buildDailyPlaylists(tracks: TrackWithStats[]): DailyPlaylistsResult {
  const currentlyListening = tracks.filter((t) => t.repeatIntent === "currently_listening");
  const eligibleCurrentlyListening = currentlyListening.filter((t) => t.dailyPlaylistStatus !== "review");
  const excludedForReview = currentlyListening.length - eligibleCurrentlyListening.length;
  const playlistMaxSize = playlistMaxSizeForCount(currentlyListening.length);

  const candidatesRaw: Array<{ track: TrackWithStats; raw: Vector2; moodValue: number }> = [];
  for (const t of eligibleCurrentlyListening) {
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

  const excludedMissingFeatures = eligibleCurrentlyListening.length - candidatesRaw.length;
  const normalized = normalizeCandidates(candidatesRaw);

  const k = Math.min(PLAYLIST_COUNT, Math.max(1, normalized.length || 1));
  const clusters = runKMeans(normalized, k);
  while (clusters.length < PLAYLIST_COUNT) {
    clusters.push({ centroid: { bpm: 0, mood: 0 }, members: [] });
  }

  const { droppedForCapacity } = enforcePlaylistCap(clusters, playlistMaxSize);
  rebalanceClusterSizes(clusters, normalized.length - droppedForCapacity);

  const playlists: DailyPlaylist[] = clusters.slice(0, PLAYLIST_COUNT).map((cluster, i) => {
    const ordered = orderClusterMembers(cluster);
    const tracksOut: DailyPlaylistTrack[] = ordered.map((c) => ({
      id: c.track.id,
      name: c.track.name,
      artists: c.track.artists,
      album: c.track.album,
      dailyPlaylistStatus: c.track.dailyPlaylistStatus === "review" ? "review" : "include",
      albumArtUrl: c.track.albumArtUrl,
      spotifyUrl: c.track.spotifyUrl,
      bpm: c.track.bpm ?? 0,
      mood: c.moodValue,
      camelot: c.track.camelot,
      energy: c.track.energy ?? 0,
      valence: c.track.valence ?? 0,
      dance: c.track.dance ?? 0,
      albumYear: c.track.albumYear,
    }));

    return {
      index: i + 1,
      trackCount: tracksOut.length,
      tracks: tracksOut,
    };
  });

  return {
    playlists,
    diagnostics: {
      currentlyListeningCount: currentlyListening.length,
      excludedForReview,
      playlistMaxSize,
      usableTrackCount: normalized.length,
      excludedMissingFeatures,
      droppedForCapacity,
    },
  };
}
