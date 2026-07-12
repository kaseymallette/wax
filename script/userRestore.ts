import fs from "node:fs";
import path from "node:path";

function latestSnapshotDir(baseDir: string): string | null {
  if (!fs.existsSync(baseDir)) return null;
  const dirs = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (dirs.length === 0) return null;
  return dirs[dirs.length - 1];
}

function main() {
  const user = (process.env.WAX_USER || "default").trim() || "default";
  const root = process.cwd();

  const snapshotsBase = path.join(root, "backups", "user-snapshots", user);
  const snapshotArg = process.argv[2]?.trim();
  const selected = snapshotArg || latestSnapshotDir(snapshotsBase);

  if (!selected) {
    console.error(`[restore:user] No snapshots found for user '${user}' in ${snapshotsBase}`);
    process.exit(1);
  }

  const snapshotDir = path.join(snapshotsBase, selected);
  if (!fs.existsSync(snapshotDir)) {
    console.error(`[restore:user] Snapshot does not exist: ${snapshotDir}`);
    process.exit(1);
  }

  const userDir = path.join(root, "users", user);
  const targetDecisions = path.join(userDir, "decisions-latest.json");
  const targetPlaylists = path.join(userDir, "playlists");
  const targetMissingFeaturesLog = path.join(userDir, "missing-features.log");
  const targetMissingTracksLogLegacy = path.join(userDir, "missing-tracks.log");

  const srcDecisions = path.join(snapshotDir, "decisions-latest.json");
  const srcPlaylists = path.join(snapshotDir, "playlists");
  const srcMissingFeaturesLog = path.join(snapshotDir, "missing-features.log");
  const srcMissingTracksLogLegacy = path.join(snapshotDir, "missing-tracks.log");

  if (!fs.existsSync(srcDecisions)) {
    console.error(`[restore:user] Snapshot is missing decisions file: ${srcDecisions}`);
    process.exit(1);
  }

  fs.mkdirSync(userDir, { recursive: true });
  fs.cpSync(srcDecisions, targetDecisions);

  if (fs.existsSync(srcPlaylists)) {
    fs.rmSync(targetPlaylists, { recursive: true, force: true });
    fs.cpSync(srcPlaylists, targetPlaylists, { recursive: true });
  }

  if (fs.existsSync(srcMissingFeaturesLog)) {
    fs.cpSync(srcMissingFeaturesLog, targetMissingFeaturesLog);
  } else if (fs.existsSync(targetMissingFeaturesLog)) {
    fs.rmSync(targetMissingFeaturesLog, { force: true });
  }

  if (fs.existsSync(srcMissingTracksLogLegacy)) {
    fs.cpSync(srcMissingTracksLogLegacy, targetMissingTracksLogLegacy);
  } else if (fs.existsSync(targetMissingTracksLogLegacy)) {
    fs.rmSync(targetMissingTracksLogLegacy, { force: true });
  }

  console.log(`[restore:user] user=${user}`);
  console.log(`[restore:user] restored snapshot=${selected}`);
  console.log(`[restore:user] source=${snapshotDir}`);
}

main();
