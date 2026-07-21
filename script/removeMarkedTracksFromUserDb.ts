import Database from "better-sqlite3";
import path from "node:path";

const WAX_USER = String(process.env.WAX_USER || "kasey").trim() || "kasey";
const DB_PATH = path.resolve(
  process.cwd(),
  process.env.WAX_DB_PATH || path.join("users", WAX_USER, "music_library.db"),
);

function main() {
  const db = new Database(DB_PATH);

  try {
    const toRemove = db
      .prepare(
        `
          SELECT id, name, artists
          FROM tracks
          WHERE COALESCE(TRIM(repeat_intent), 'undecided') = 'removed'
          ORDER BY imported_at DESC, id ASC
        `,
      )
      .all() as Array<{ id: string; name: string; artists: string }>;

    if (toRemove.length === 0) {
      console.log(`[user:remove] user=${WAX_USER}`);
      console.log(`[user:remove] db=${DB_PATH}`);
      console.log("[user:remove] no tracks marked 'removed'; nothing deleted");
      return;
    }

    const beforeTrackCount = Number((db.prepare("SELECT COUNT(*) AS c FROM tracks").get() as { c: number }).c || 0);
    const beforeListenCount = Number((db.prepare("SELECT COUNT(*) AS c FROM listens").get() as { c: number }).c || 0);

    const removeStmt = db.prepare("DELETE FROM tracks WHERE COALESCE(TRIM(repeat_intent), 'undecided') = 'removed'");
    const tx = db.transaction(() => removeStmt.run());
    const result = tx();

    const afterTrackCount = Number((db.prepare("SELECT COUNT(*) AS c FROM tracks").get() as { c: number }).c || 0);
    const afterListenCount = Number((db.prepare("SELECT COUNT(*) AS c FROM listens").get() as { c: number }).c || 0);

    console.log(`[user:remove] user=${WAX_USER}`);
    console.log(`[user:remove] db=${DB_PATH}`);
    console.log(`[user:remove] deleted_tracks=${result.changes}`);
    console.log(`[user:remove] tracks_before=${beforeTrackCount} tracks_after=${afterTrackCount}`);
    console.log(`[user:remove] listens_before=${beforeListenCount} listens_after=${afterListenCount}`);
    console.log(`[user:remove] first_removed=${toRemove[0].id} | ${toRemove[0].artists} | ${toRemove[0].name}`);
  } finally {
    db.close();
  }
}

main();
