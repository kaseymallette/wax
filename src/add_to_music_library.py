#!/usr/bin/env python3
import argparse
import csv
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


def normalize_track_id(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        return ""
    if "spotify.com/track/" in s:
        s = s.split("spotify.com/track/", 1)[1].split("?", 1)[0].split("/", 1)[0]
    if s.startswith("spotify:track:"):
        s = s.split("spotify:track:", 1)[1]
    return s.strip()


def qi(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Add new songs from CSV into data/music-library/spotify_music_library.db tracks table.",
    )
    parser.add_argument("--csv", required=True, help="Path to source CSV file.")
    parser.add_argument(
        "--db",
        default=str(repo_root / "data" / "music-library" / "spotify_music_library.db"),
        help="Path to spotify_music_library.db",
    )
    parser.add_argument("--table", default="tracks", help="Target table name (default: tracks)")
    parser.add_argument(
        "--id-column",
        default="Track_ID",
        help="DB ID column used to detect duplicates and insert IDs (default: Track_ID)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually insert rows. If omitted, runs in dry-run mode.",
    )
    parser.add_argument(
        "--backup",
        action="store_true",
        help="Create a timestamped backup in backups/ before insert (only with --apply).",
    )
    parser.add_argument(
        "--preview-limit",
        type=int,
        default=10,
        help="How many candidate rows to preview in output.",
    )
    return parser.parse_args()


def find_header_case_insensitive(headers: List[str], wanted: str) -> Optional[str]:
    wanted_norm = wanted.strip().lower()
    for h in headers:
        if h.strip().lower() == wanted_norm:
            return h
    return None


def find_csv_id_header(headers: List[str], preferred: str) -> Optional[str]:
    candidates = [
        preferred,
        "Track_ID",
        "track_id",
        "Track Id",
        "Spotify Track Id",
        "Track URI",
        "id",
    ]
    for c in candidates:
        found = find_header_case_insensitive(headers, c)
        if found:
            return found
    return None


def load_db_columns(cur: sqlite3.Cursor, table: str) -> List[str]:
    rows = cur.execute(f"PRAGMA table_info({qi(table)})").fetchall()
    return [str(r[1]) for r in rows]


def load_existing_ids(cur: sqlite3.Cursor, table: str, id_column: str) -> Set[str]:
    rows = cur.execute(f"SELECT {qi(id_column)} FROM {qi(table)} WHERE {qi(id_column)} IS NOT NULL").fetchall()
    return {normalize_track_id(r[0]) for r in rows if normalize_track_id(r[0])}


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]

    csv_path = Path(args.csv).expanduser().resolve()
    db_path = Path(args.db).expanduser().resolve()

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")
    if not db_path.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")

    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()

        db_columns = load_db_columns(cur, args.table)
        if not db_columns:
            raise ValueError(f"Table not found or has no columns: {args.table}")

        id_column = find_header_case_insensitive(db_columns, args.id_column)
        if not id_column:
            raise ValueError(f"ID column '{args.id_column}' not found in table {args.table}")

        existing_ids = load_existing_ids(cur, args.table, id_column)

        with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                raise ValueError("CSV has no header row")
            headers = [str(h).strip() for h in reader.fieldnames if h is not None]
            csv_id_header = find_csv_id_header(headers, id_column)
            if not csv_id_header:
                raise ValueError(
                    "Could not find track ID column in CSV. Tried: "
                    "Track_ID, track_id, Track Id, Spotify Track Id, Track URI, id"
                )

            db_column_map: Dict[str, str] = {}
            for col in db_columns:
                h = find_header_case_insensitive(headers, col)
                if h:
                    db_column_map[col] = h

            if id_column not in db_column_map:
                db_column_map[id_column] = csv_id_header

            insert_columns = [c for c in db_columns if c in db_column_map]

            if id_column not in insert_columns:
                raise ValueError(f"ID column {id_column} is required in insert column mapping")

            rows_to_insert: List[Tuple[Any, ...]] = []
            preview_rows: List[Tuple[str, str, str]] = []
            seen_csv_ids: Set[str] = set()

            skipped_missing_id = 0
            skipped_existing = 0
            skipped_dup_in_csv = 0

            name_col = find_header_case_insensitive(headers, "Song") or find_header_case_insensitive(headers, "name")
            artist_col = find_header_case_insensitive(headers, "Artist") or find_header_case_insensitive(headers, "artists")

            for row in reader:
                raw_id = row.get(csv_id_header)
                norm_id = normalize_track_id(raw_id)
                if not norm_id:
                    skipped_missing_id += 1
                    continue
                if norm_id in seen_csv_ids:
                    skipped_dup_in_csv += 1
                    continue
                seen_csv_ids.add(norm_id)
                if norm_id in existing_ids:
                    skipped_existing += 1
                    continue

                values: List[Any] = []
                for col in insert_columns:
                    source_header = db_column_map[col]
                    if col == id_column:
                        v: Any = norm_id
                    else:
                        v = row.get(source_header)
                        if isinstance(v, str):
                            v = v.strip()
                        if v == "":
                            v = None
                    values.append(v)

                rows_to_insert.append(tuple(values))
                if len(preview_rows) < max(0, args.preview_limit):
                    preview_rows.append(
                        (
                            norm_id,
                            str(row.get(name_col) or "").strip() if name_col else "",
                            str(row.get(artist_col) or "").strip() if artist_col else "",
                        )
                    )

        print(f"CSV:      {csv_path}")
        print(f"DB:       {db_path}")
        print(f"Table:    {args.table}")
        print(f"ID col:   {id_column}")
        print(f"Rows existing in DB:      {len(existing_ids)}")
        print(f"Rows to insert (new):     {len(rows_to_insert)}")
        print(f"Skipped missing ID:       {skipped_missing_id}")
        print(f"Skipped existing in DB:   {skipped_existing}")
        print(f"Skipped duplicate in CSV: {skipped_dup_in_csv}")

        if preview_rows:
            print("Preview new rows:")
            for tid, name, artists in preview_rows:
                if name or artists:
                    print(f"  - {tid} | {artists} | {name}")
                else:
                    print(f"  - {tid}")

        if not args.apply:
            print("\nDry-run complete. Re-run with --apply to insert.")
            return

        if not rows_to_insert:
            print("\nNothing to insert.")
            return

        if args.backup:
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup_dir = repo_root / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup_path = backup_dir / f"{db_path.name}.{ts}.bak"
            shutil.copy2(db_path, backup_path)
            print(f"Backup created: {backup_path}")

        placeholders = ",".join(["?"] * len(insert_columns))
        insert_sql = f"INSERT INTO {qi(args.table)} ({','.join(qi(c) for c in insert_columns)}) VALUES ({placeholders})"

        with con:
            cur.executemany(insert_sql, rows_to_insert)

        print(f"\nInserted {len(rows_to_insert)} row(s) into {args.table}.")
    finally:
        con.close()


if __name__ == "__main__":
    main()
