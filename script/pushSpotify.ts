/**
 * pushSpotify.ts — WAX Phase 2: push mood-band CSVs to Spotify playlists.
 *
 * Reads the three mood-band CSVs produced by buildMoodPlaylists.ts for the
 * current WAX_USER, then for each band finds-or-creates a private playlist
 * named "WAX – {User} {Band} Mood" and FULL-REPLACES its contents with the
 * tracks in CSV (algorithm) order.
 *
 * Full replace is used deliberately: the algorithm re-ranks tracks every run,
 * so order changes — replacing guarantees the Spotify playlist matches the CSV
 * exactly, rather than fighting Spotify-side ordering.
 *
 * Usage:
 *   WAX_USER=kasey npx tsx script/pushSpotify.ts
 *   WAX_USER=kasey npx tsx script/pushSpotify.ts --dry-run
 *
 * Requires in .env:
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 *   SPOTIFY_REFRESH_TOKEN   (from `npx tsx script/spotifyAuth.ts`)
 *
 * Optional .env:
 *   WAX_PLAYLISTS_DIR       (default: users/<WAX_USER>/playlists)
 *   WAX_PLAYLIST_PUBLIC     ("true" to make playlists public; default private)
 */

import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

// ───────────────────────── config ─────────────────────────

const WAX_USER = process.env.WAX_USER ?? "kasey";
const DRY_RUN = process.argv.includes("--dry-run");

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN ?? "";

const PLAYLIST_PUBLIC = (process.env.WAX_PLAYLIST_PUBLIC ?? "false") === "true";

const PLAYLISTS_DIR =
  process.env.WAX_PLAYLISTS_DIR ??
  path.join("users", WAX_USER, "playlists");

// Band file name -> human label used in the playlist title.
const BANDS: { file: string; label: string }[] = [
  { file: "low.csv", label: "Low" },
  { file: "medium.csv", label: "Medium" },
  { file: "high.csv", label: "High" },
];

const LOG_PATH = path.join(PLAYLISTS_DIR, "push.log");
const API = "https://api.spotify.com/v1";

// ───────────────────────── logging ─────────────────────────

const logLines: string[] = [];
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  logLines.push(line);
}
function flushLog(): void {
  try {
    fs.mkdirSync(PLAYLISTS_DIR, { recursive: true });
    fs.writeFileSync(LOG_PATH, logLines.join("\n") + "\n", "utf8");
  } catch {
    /* best-effort */
  }
}

async function appendPlaylistTracks(
  playlistId: string,
  uris: string[],
): Promise<void> {
  const chunkSize = 100;
  for (let i = 0; i < uris.length; i += chunkSize) {
    const chunk = uris.slice(i, i + chunkSize);
    await api(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: chunk }),
    });
  }
}
function fail(msg: string): never {
  log(`❌ ${msg}`);
  flushLog();
  process.exit(1);
}

// ───────────────────────── CSV parsing ─────────────────────────

interface CsvRow {
  rank: number;
  trackId: string;
  name: string;
  artists: string;
}

/**
 * Minimal RFC-4180-aware CSV line splitter (handles quoted fields/commas).
 * WAX CSVs are simple, but artist/album names can contain commas.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseBandCsv(filePath: string): CsvRow[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (col: string) => header.indexOf(col);
  const iRank = idx("rank");
  const iTrackId = idx("track_id");
  const iName = idx("name");
  const iArtists = idx("artists");

  if (iTrackId === -1) {
    fail(`CSV ${filePath} is missing required column "track_id".`);
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const trackId = (cells[iTrackId] ?? "").trim();
    if (!trackId) continue;
    rows.push({
      rank: iRank >= 0 ? Number(cells[iRank]) : i,
      trackId,
      name: iName >= 0 ? (cells[iName] ?? "").trim() : "",
      artists: iArtists >= 0 ? (cells[iArtists] ?? "").trim() : "",
    });
  }
  return rows;
}

/** Spotify track IDs are 22-char base62. Validate before building URIs. */
const ID_RE = /^[A-Za-z0-9]{22}$/;

// ───────────────────────── Spotify API client ─────────────────────────

let accessToken = "";

async function refreshAccessToken(): Promise<void> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
    }),
  });
  if (!res.ok) {
    fail(
      `Failed to refresh access token (${res.status}): ${await res.text()}. ` +
        "Re-run script/spotifyAuth.ts to get a fresh SPOTIFY_REFRESH_TOKEN.",
    );
  }
  const json = (await res.json()) as { access_token: string };
  accessToken = json.access_token;
}

/**
 * Authenticated fetch with automatic retry on 401 (token expired) and
 * 429 (rate limit, honoring Retry-After).
 */
async function api<T = unknown>(
  endpoint: string,
  init: RequestInit = {},
  retries = 3,
): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `${API}${endpoint}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && retries > 0) {
    await refreshAccessToken();
    return api<T>(endpoint, init, retries - 1);
  }
  if (res.status === 429 && retries > 0) {
    const wait = Number(res.headers.get("Retry-After") ?? "1") + 1;
    log(`⏳ Rate limited; waiting ${wait}s…`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return api<T>(endpoint, init, retries - 1);
  }
  if (!res.ok) {
    const body = await res.text();
    const authHeader = res.headers.get("www-authenticate");
    const requestId = res.headers.get("x-spotify-request-id");
    const diagnostics = [
      authHeader ? `www-authenticate=${authHeader}` : null,
      requestId ? `x-spotify-request-id=${requestId}` : null,
    ].filter(Boolean).join("; ");

    throw new Error(
      `Spotify API ${res.status} on ${url}: ${body}${diagnostics ? ` [${diagnostics}]` : ""}`,
    );
  }
  // Some endpoints (e.g. PUT items) return empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ───────────────────────── playlist ops ─────────────────────────

interface SpotifyUser {
  id: string;
  display_name: string | null;
}
interface SpotifyPlaylist {
  id: string;
  name: string;
  tracks?: { total?: number };
}

async function getCurrentUser(): Promise<SpotifyUser> {
  return api<SpotifyUser>("/me");
}

/** Page through the user's playlists to find one by exact name. */
async function findPlaylistByName(
  name: string,
): Promise<SpotifyPlaylist | null> {
  let url: string | null = "/me/playlists?limit=50";
  while (url) {
    const page: {
      items: SpotifyPlaylist[];
      next: string | null;
    } = await api(url);
    const hit = page.items.find((p) => p.name === name);
    if (hit) return hit;
    url = page.next;
  }
  return null;
}

async function createPlaylist(name: string): Promise<SpotifyPlaylist> {
  return api<SpotifyPlaylist>(`/me/playlists`, {
    method: "POST",
    body: JSON.stringify({
      name,
      public: PLAYLIST_PUBLIC,
      description: `Auto-generated by WAX • ${new Date().toISOString().slice(0, 10)} • full-replace on each run`,
    }),
  });
}

/**
 * Replace the entire contents of a playlist with the given URIs, in order.
 * Spotify caps each request at 100 URIs:
 *   - First chunk uses PUT (replaces everything, including clearing extras).
 *   - Remaining chunks use POST (append) to preserve order.
 * A PUT with an empty array clears the playlist when there are zero tracks.
 */
async function replacePlaylistTracks(
  playlistId: string,
  uris: string[],
): Promise<void> {
  const chunkSize = 100;

  if (uris.length === 0) {
    await api(`/playlists/${playlistId}/tracks`, {
      method: "PUT",
      body: JSON.stringify({ uris: [] }),
    });
    return;
  }

  const first = uris.slice(0, chunkSize);
  await api(`/playlists/${playlistId}/tracks`, {
    method: "PUT",
    body: JSON.stringify({ uris: first }),
  });

  for (let i = chunkSize; i < uris.length; i += chunkSize) {
    const chunk = uris.slice(i, i + chunkSize);
    await api(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: chunk }),
    });
  }
}

// ───────────────────────── main ─────────────────────────

async function pushBand(band: { file: string; label: string }): Promise<void> {
  const csvPath = path.join(PLAYLISTS_DIR, band.file);
  if (!fs.existsSync(csvPath)) {
    log(`⚠️  ${band.label}: CSV not found at ${csvPath} — skipping.`);
    return;
  }

  const rows = parseBandCsv(csvPath);
  const valid: CsvRow[] = [];
  for (const r of rows) {
    if (ID_RE.test(r.trackId)) {
      valid.push(r);
    } else {
      log(
        `   ⚠️  Skipping invalid track_id "${r.trackId}" (${r.artists} – ${r.name})`,
      );
    }
  }

  const uris = valid.map((r) => `spotify:track:${r.trackId}`);
  const userLabel = WAX_USER.charAt(0).toUpperCase() + WAX_USER.slice(1);
  const playlistName = `WAX – ${userLabel} ${band.label} Mood`;

  log(`\n▶ ${band.label}: ${uris.length} tracks → "${playlistName}"`);

  if (DRY_RUN) {
    log(`   (dry-run) would replace contents with ${uris.length} tracks.`);
    valid.slice(0, 3).forEach((r, i) =>
      log(`     ${i + 1}. ${r.artists} – ${r.name}`),
    );
    if (valid.length > 3) log(`     … +${valid.length - 3} more`);
    return;
  }

  let playlist = await findPlaylistByName(playlistName);
  let createdNow = false;
  if (!playlist) {
    log(`   Creating new playlist…`);
    playlist = await createPlaylist(playlistName);
    createdNow = true;
  } else {
    const existingCount = playlist.tracks?.total ?? 0;
    log(`   Found existing playlist (${existingCount} tracks) — replacing.`);
  }

  if (createdNow) {
    await appendPlaylistTracks(playlist.id, uris);
  } else {
    await replacePlaylistTracks(playlist.id, uris);
  }
  log(`   ✅ Pushed ${uris.length} tracks.`);
  log(`   🔗 https://open.spotify.com/playlist/${playlist.id}`);
}

async function main(): Promise<void> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    fail(
      "Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN in .env. " +
        "Run script/spotifyAuth.ts first (see SETUP.md).",
    );
  }

  log(`WAX Spotify push — user="${WAX_USER}" dir="${PLAYLISTS_DIR}"${DRY_RUN ? " [DRY RUN]" : ""}`);

  await refreshAccessToken();
  const me = await getCurrentUser();
  log(`Authenticated as: ${me.display_name ?? me.id} (${me.id})`);

  for (const band of BANDS) {
    try {
      await pushBand(band);
    } catch (err) {
      log(`   ❌ ${band.label} failed: ${(err as Error).message}`);
    }
  }

  log("\nDone.");
  flushLog();
}

main().catch((err) => fail((err as Error).message));
