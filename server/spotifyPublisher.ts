export type SpotifyAccount = { id: string; display_name?: string };
export type SpotifyPlaylist = { id: string; name: string; description: string; owner: { id: string } };
export interface SpotifyPublisher {
  account(): Promise<SpotifyAccount>;
  findOrCreate(name: string, marker: string, accountId: string): Promise<string>;
  replace(id: string, trackIds: string[]): Promise<void>;
}

// The create request is deliberately not retried on ambiguous failures. On the
// next publish attempt we rediscover the playlist before attempting creation.
export function createSpotifyPublisher(fetcher: typeof fetch = fetch, sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))): SpotifyPublisher {
  let token = "";
  async function refresh() {
    const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret, SPOTIFY_REFRESH_TOKEN: refreshToken } = process.env;
    if (!id || !secret || !refreshToken) throw new Error("Spotify is not connected. Add Spotify credentials to .env and run npm run spotify:auth, then restart Wax.");
    const response = await fetcher("https://accounts.spotify.com/api/token", { method: "POST", signal: AbortSignal.timeout(20000), headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }) });
    if (!response.ok) throw new Error(`Spotify sign-in needs attention (${response.status}). Run npm run spotify:auth again.`);
    token = (await response.json()).access_token;
    if (!token) throw new Error("Spotify did not return an access token.");
  }
  async function request(endpoint: string, method = "GET", body?: unknown): Promise<any> {
    if (!token) await refresh();
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetcher(`https://api.spotify.com/v1${endpoint}`, { method, signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch {
        if (method !== "POST" && attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
        throw new Error("Spotify could not be reached. Retry publishing to resume saved progress.");
      }
      if (response.status === 401 && attempt < 2) { await refresh(); continue; }
      if (response.status === 429 && attempt < 2) {
        const wait = Number(response.headers.get("Retry-After") ?? "1");
        if (!Number.isFinite(wait) || wait > 30) throw new Error("Spotify is busy. Wait a little, then retry publishing.");
        await sleep(Math.max(1, wait) * 1000); continue;
      }
      if (response.status >= 500 && method !== "POST" && attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
      if (!response.ok) throw new Error(`Spotify request failed (${response.status}). ${response.status === 403 ? "Check your Spotify app access and playlist permissions." : "Retry publishing to resume saved progress."}`);
      return response.status === 204 ? undefined : response.json();
    }
    throw new Error("Spotify retries exhausted. Retry publishing later.");
  }
  return {
    account: () => request("/me"),
    async findOrCreate(name, marker, accountId) {
      const owned: SpotifyPlaylist[] = [];
      for (let offset = 0; ; offset += 50) {
        const page = await request(`/me/playlists?limit=50&offset=${offset}`);
        owned.push(...page.items.filter((p: SpotifyPlaylist | null): p is SpotifyPlaylist => !!p && p.owner?.id === accountId));
        if (!page.next) break;
      }
      // Search every page before falling back to a marker: older duplicates may
      // carry the marker while the user's original playlist has the right name.
      const named = owned.filter(p => p.name === name);
      if (named.length > 1) throw new Error(`More than one playlist is named "${name}". Give the intended playlist a unique name before publishing.`);
      if (named.length === 1) return named[0].id;
      const marked = owned.filter(p => p.description === marker);
      if (marked.length > 1) throw new Error(`More than one playlist matches "${name}". Resolve the duplicate playlists before publishing.`);
      if (marked.length === 1) return marked[0].id;
      const playlist = await request("/me/playlists", "POST", { name, description: marker, public: false });
      return playlist.id;
    },
    async replace(id, trackIds) {
      if (trackIds.length > 100) throw new Error("Daily playlists cannot exceed 100 songs.");
      await request(`/playlists/${encodeURIComponent(id)}/items`, "PUT", { uris: trackIds.map(id => `spotify:track:${id}`) });
    },
  };
}
