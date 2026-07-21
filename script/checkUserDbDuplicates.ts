import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type TrackRow = {
  id: string;
  name: string;
  artists: string;
  album: string;
  repeat_intent: string;
};

const WAX_USER = String(process.env.WAX_USER || "kasey").trim() || "kasey";
const DB_PATH = path.resolve(
  process.cwd(),
  process.env.WAX_DB_PATH || path.join("users", WAX_USER, "music_library.db"),
);
const CSV_OUT = path.resolve(
  process.cwd(),
  process.env.WAX_DUPES_OUT || path.join("users", WAX_USER, "duplicate-tracks.csv"),
);

function normalize(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeCsv(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`SELECT id, name, artists, album, repeat_intent FROM tracks`).all() as TrackRow[];

    const groups = new Map<string, TrackRow[]>();
    for (const row of rows) {
      const key = `${normalize(row.artists)}||${normalize(row.name)}`;
      if (!key || key === "||") continue;
      const bucket = groups.get(key) || [];
      bucket.push(row);
      groups.set(key, bucket);
    }

    const dupGroups = [...groups.entries()]
      .filter(([, bucket]) => bucket.length > 1)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

    console.log(`[user:dupes] user=${WAX_USER}`);
    console.log(`[user:dupes] db=${DB_PATH}`);
    console.log(`[user:dupes] duplicate_groups=${dupGroups.length}`);

    if (dupGroups.length === 0) {
      console.log("[user:dupes] no duplicate artist+song groups found");
      return;
    }

    const lines: string[] = [];
    lines.push(
      [
        "group_key",
        "group_count",
        "track_id",
        "artists",
        "name",
        "album",
        "repeat_intent",
      ].join(","),
    );

    for (const [key, bucket] of dupGroups) {
      const sorted = [...bucket].sort((a, b) => a.artists.localeCompare(b.artists) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      for (const row of sorted) {
        lines.push(
          [
            escapeCsv(key),
            String(bucket.length),
            escapeCsv(row.id),
            escapeCsv(row.artists),
            escapeCsv(row.name),
            escapeCsv(row.album),
            escapeCsv(row.repeat_intent),
          ].join(","),
        );
      }
    }

    fs.mkdirSync(path.dirname(CSV_OUT), { recursive: true });
    fs.writeFileSync(CSV_OUT, `${lines.join("\n")}\n`, "utf8");

    console.log(`[user:dupes] wrote=${CSV_OUT}`);
    const top = dupGroups.slice(0, 5);
    for (const [key, bucket] of top) {
      console.log(`[user:dupes] top group count=${bucket.length} key=${key}`);
    }
  } finally {
    db.close();
  }
}

main();
