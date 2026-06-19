import fs from "node:fs";
import path from "node:path";

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function main() {
  const user = (process.env.WAX_USER || "default").trim() || "default";
  const root = process.cwd();

  const userDir = path.join(root, "users", user);
  const decisionsPath = path.join(userDir, "decisions-latest.json");
  const playlistsDir = path.join(userDir, "playlists");
  const missingLogPath = path.join(userDir, "missing-tracks.log");

  if (!fs.existsSync(decisionsPath)) {
    console.error(`[snapshot:user] Missing decisions file: ${decisionsPath}`);
    console.error(`[snapshot:user] Run decisions export first: WAX_USER=${user} npm run decisions:export`);
    process.exit(1);
  }

  const stamp = getTimestamp();
  const outDir = path.join(root, "backups", "user-snapshots", user, stamp);
  fs.mkdirSync(outDir, { recursive: true });

  const outDecisions = path.join(outDir, "decisions-latest.json");
  fs.cpSync(decisionsPath, outDecisions);

  if (fs.existsSync(playlistsDir)) {
    fs.cpSync(playlistsDir, path.join(outDir, "playlists"), { recursive: true });
  }

  if (fs.existsSync(missingLogPath)) {
    fs.cpSync(missingLogPath, path.join(outDir, "missing-tracks.log"));
  }

  const metadata = {
    user,
    createdAt: new Date().toISOString(),
    decisionsFile: fs.existsSync(outDecisions),
    playlistsDir: fs.existsSync(path.join(outDir, "playlists")),
    missingLog: fs.existsSync(path.join(outDir, "missing-tracks.log")),
  };
  fs.writeFileSync(path.join(outDir, "meta.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  console.log(`[snapshot:user] user=${user}`);
  console.log(`[snapshot:user] wrote ${outDir}`);
}

main();
