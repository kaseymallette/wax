/**
 * spotifyAuth.ts — one-time Spotify authorization helper for WAX.
 *
 * Runs the Authorization Code flow: spins up a tiny local callback server,
 * opens your browser to the Spotify consent screen, captures the `code`,
 * exchanges it for a refresh token, and prints what to paste into .env.
 *
 * You only run this ONCE (or again if you revoke access / change scopes).
 *
 * Usage:
 *   npx tsx script/spotifyAuth.ts
 *
 * Requires in .env:
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 *   SPOTIFY_REDIRECT_URI   (default http://127.0.0.1:8888/callback)
 */

import http from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";
import "dotenv/config";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:8888/callback";

// Scopes needed to read & modify the account's private playlists.
const SCOPES = [
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  fail(
    "Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in .env. " +
      "See SETUP.md to register a Spotify app first.",
  );
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? `open "${url}"`
      : platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log(
        "\nCouldn't auto-open your browser. Open this URL manually:\n" + url + "\n",
      );
    }
  });
}

async function exchangeCodeForTokens(code: string): Promise<void> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    fail(`Token exchange failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  console.log("\n✅ Success! Add this to your .env file:\n");
  console.log("────────────────────────────────────────");
  console.log(`SPOTIFY_REFRESH_TOKEN=${json.refresh_token}`);
  console.log("────────────────────────────────────────");
  console.log(`\nGranted scopes: ${json.scope}`);
  console.log(
    "\nThe push agent uses the refresh token to mint fresh access tokens automatically.\n",
  );
}

function main(): void {
  const state = Math.random().toString(36).slice(2);
  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);

  const redirect = new URL(REDIRECT_URI);
  const port = Number(redirect.port || 8888);

  const server = http.createServer(async (req, res) => {
    if (!req.url) return;
    const reqUrl = new URL(req.url, REDIRECT_URI);
    if (reqUrl.pathname !== redirect.pathname) {
      res.writeHead(404).end();
      return;
    }

    const code = reqUrl.searchParams.get("code");
    const returnedState = reqUrl.searchParams.get("state");
    const error = reqUrl.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h2>Authorization failed: ${error}</h2>`);
      server.close();
      fail(`Authorization denied: ${error}`);
    }

    if (returnedState !== state) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h2>State mismatch — possible CSRF. Aborting.</h2>");
      server.close();
      fail("State mismatch between request and callback.");
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h2>No authorization code received.</h2>");
      server.close();
      fail("No code in callback.");
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h2>✅ WAX authorized. You can close this tab and return to the terminal.</h2>",
    );

    server.close();
    await exchangeCodeForTokens(code!);
    process.exit(0);
  });

  server.listen(port, () => {
    console.log(`\nWAX Spotify auth helper listening on ${REDIRECT_URI}`);
    console.log("Opening your browser to authorize…\n");
    openBrowser(authUrl.toString());
  });
}

main();
