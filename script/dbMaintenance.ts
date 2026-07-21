import fs from "node:fs";
import path from "node:path";

function usage(): never {
  console.error("Usage: tsx script/dbMaintenance.ts <backup|restore|clean>");
  process.exit(1);
}

function timestamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

const mode = (process.argv[2] || "").trim().toLowerCase();
if (mode !== "backup" && mode !== "restore" && mode !== "clean") usage();

const repoRoot = process.cwd();
const WAX_USER = String(process.env.WAX_USER || "kasey").trim() || "kasey";
const dbPath = path.resolve(repoRoot, process.env.WAX_DB_PATH || path.join("users", WAX_USER, "music_library.db"));
const backupsDir = path.resolve(repoRoot, process.env.WAX_BACKUPS_DIR || "backups");
const dbBase = path.basename(dbPath);

function walPath(base: string): string {
  return `${base}-wal`;
}

function shmPath(base: string): string {
  return `${base}-shm`;
}

function backupDb(): void {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB not found: ${dbPath}`);
  }
  fs.mkdirSync(backupsDir, { recursive: true });
  const out = path.join(backupsDir, `${dbBase}.${timestamp()}.bak`);
  fs.copyFileSync(dbPath, out);
  console.log(`Backup created: ${out}`);
}

function restoreDb(): void {
  if (!fs.existsSync(backupsDir) || !fs.statSync(backupsDir).isDirectory()) {
    throw new Error(`No backup directory found: ${backupsDir}`);
  }

  const candidates = fs
    .readdirSync(backupsDir)
    .filter((name) => name.startsWith(`${dbBase}.`) && name.endsWith(".bak"))
    .map((name) => ({
      name,
      fullPath: path.join(backupsDir, name),
      mtimeMs: fs.statSync(path.join(backupsDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (candidates.length === 0) {
    throw new Error(`No backup found in ${backupsDir} for ${dbBase}`);
  }

  const latest = candidates[0].fullPath;
  fs.copyFileSync(latest, dbPath);

  const wal = walPath(dbPath);
  const shm = shmPath(dbPath);
  if (fs.existsSync(wal)) fs.rmSync(wal, { force: true });
  if (fs.existsSync(shm)) fs.rmSync(shm, { force: true });

  console.log(`Restored ${latest} -> ${dbPath}`);
}

function cleanDb(): void {
  const targets = [dbPath, walPath(dbPath), shmPath(dbPath)];
  let removed = 0;
  for (const target of targets) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      console.log(`Removed: ${target}`);
      removed += 1;
    }
  }
  if (removed === 0) {
    console.log(`No DB files found to remove at ${dbPath} (+ -wal/-shm)`);
  }
}

if (mode === "backup") backupDb();
else if (mode === "restore") restoreDb();
else cleanDb();
