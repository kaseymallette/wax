import { angularPartition } from "./angularPartition";

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
  averageBpm: number;
  bpmRank: number;
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
  grouping?: "angular" | "kmeans";
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

// Capacity constraints are enforced at every assignment step, not after clustering.
function runKMeans(points: CandidateTrack[], k: number): Cluster[] {
  let centroids = initializeCentroids(points, k);
  const capacities = Array.from({ length: k }, (_, i) => Math.floor(points.length / k) + (i < points.length % k ? 1 : 0));
  let clusters: Cluster[] = [];
  let previous = "";
  for (let iteration = 0; iteration < KMEANS_MAX_ITERS; iteration++) {
    clusters = centroids.map(centroid => ({ centroid, members: [] }));
    const remaining = [...points].sort((a, b) => a.track.id.localeCompare(b.track.id));
    while (remaining.length) {
      // Assign the most constrained song first, preserving scarce nearby slots.
      let chosen = 0, destination = 0, greatestRegret = -Infinity;
      remaining.forEach((point, index) => {
        const choices = centroids.map((c, i) => ({ i, cost: distance(point.normalized, c) ** 2 }))
          .filter(c => clusters[c.i].members.length < capacities[c.i])
          .sort((a, b) => a.cost - b.cost || a.i - b.i);
        const regret = choices.length > 1 ? choices[1].cost - choices[0].cost : Infinity;
        if (regret > greatestRegret) { greatestRegret = regret; chosen = index; destination = choices[0].i; }
      });
      clusters[destination].members.push(remaining.splice(chosen, 1)[0]);
    }
    centroids = clusters.map(c => ({ bpm: mean(c.members.map(p => p.normalized.bpm)), mood: mean(c.members.map(p => p.normalized.mood)) }));
    const signature = JSON.stringify(clusters.map(c => c.members.map(p => p.track.id).sort()));
    if (signature === previous) break;
    previous = signature;
  }
  return clusters;
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
  if (tracks.length < 70 || tracks.length > 700) throw new Error("A profile must contain 70–700 tracks.");
  if (new Set(tracks.map(t => t.id)).size !== tracks.length) throw new Error("Track IDs must be unique.");
  const eligibleTracks = tracks;
  const excludedForReview = 0;

  const candidatesRaw: Array<{ track: PlaylistSourceTrack; raw: Vector2; moodValue: number }> = [];
  for (const t of eligibleTracks) {
    if (!isFiniteNumber(t.bpm) || !isFiniteNumber(t.energy) || !isFiniteNumber(t.dance) || !isFiniteNumber(t.valence)) {
      throw new Error(`Missing audio features for ${t.id}`);
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
  // Group in BPM–valence space; sequencing still uses normalized BPM–Mood.
  let clusters: Cluster[];
  let mondaySector = 0;
  if (options.grouping === "kmeans") {
    clusters = runKMeans(normalized, k);
  } else {
    const partition = angularPartition(candidatesRaw.map(c => ({
      id: c.track.id, bpm: c.raw.bpm, valence: c.track.valence!,
    })), { k, mode: "equal-count", rotation: 0 });
    // Anchor Monday to the upper-left direction (135°) in every profile.
    const mondayAngle = 3 * Math.PI / 4;
    mondaySector = partition.boundaries.reduce((sector, boundary, index) =>
      boundary <= mondayAngle ? index : sector, 0);
    const sectorById = new Map(partition.points.map(p => [p.id, p.sector]));
    clusters = Array.from({ length: k }, () => ({ centroid: { bpm: 0, mood: 0 }, members: [] }));
    for (const candidate of normalized) {
      clusters[sectorById.get(candidate.track.id)!].members.push(candidate);
    }
  }
  while (clusters.length < PLAYLIST_COUNT) {
    clusters.push({ centroid: { bpm: 0, mood: 0 }, members: [] });
  }



  // Rank by actual mean tempo; cluster index breaks equal-BPM ties deterministically.
  const ranked = clusters.map((cluster, index) => ({ cluster, index, averageBpm: mean(cluster.members.map(m => m.raw.bpm)) }))
    .sort((a, b) => b.averageBpm - a.averageBpm || a.index - b.index);
  const ranksByDay = [1, 3, 6, 4, 2, 5, 7];
  // Start in the upper left, then walk clockwise.
  // Angular sector indices increase counterclockwise.
  const groupsByDay = options.grouping === "kmeans"
    ? ranksByDay.map(rank => ranked[rank - 1])
    : Array.from({ length: PLAYLIST_COUNT }, (_, day) =>
      ranked.find(group => group.index === (mondaySector - day + PLAYLIST_COUNT) % PLAYLIST_COUNT)!);
  const playlists: DailyPlaylist[] = groupsByDay.map((group, i) => {
    const { cluster, averageBpm } = group;
    const rank = ranked.indexOf(group) + 1;
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
      averageBpm,
      bpmRank: rank,
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

// Legacy state used cluster indices as days. Match openers by membership instead.
export function remapOpeningSongs(result: DailyPlaylistsResult, saved: Record<string, string>): Record<string, string> {
  const chosen = new Set(Object.values(saved));
  return Object.fromEntries(result.playlists.flatMap(playlist => {
    const opener = playlist.tracks.find(track => chosen.has(track.id));
    return opener ? [[String(playlist.index), opener.id]] : [];
  }));
}
