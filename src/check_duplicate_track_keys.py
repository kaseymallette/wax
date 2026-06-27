#!/usr/bin/env python3
import argparse
import csv
import re
import sqlite3
from collections import defaultdict
from pathlib import Path


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Find duplicate track keys in a SQLite tracks table (COUNT(track_key) > 1).",
    )
    parser.add_argument(
        "--db",
        default=str(repo_root / "data" / "music-library" / "spotify_music_library.db"),
        help="Path to SQLite DB.",
    )
    parser.add_argument(
        "--table",
        default="tracks",
        help="Table name to inspect.",
    )
    parser.add_argument(
        "--column",
        default="Track_Key",
        help="Column name to count duplicates for.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Max duplicate keys to print.",
    )
    parser.add_argument(
        "--show-rows",
        action="store_true",
        help="Also print all rows for each duplicate key (track id/title/artist).",
    )
    parser.add_argument(
        "--ignore-remaster",
        action="store_true",
        help="Normalize values by stripping common remaster/remastered text before duplicate checks.",
    )
    parser.add_argument(
        "--ignore-year-version",
        action="store_true",
        help="Normalize values by stripping common year/version suffixes (e.g., '2019 Digital Master').",
    )
    parser.add_argument(
        "--csv-out",
        default="",
        help="Optional path to write duplicate results as CSV.",
    )
    return parser.parse_args()


def qi(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def normalize_remaster(value: str) -> str:
    s = value.strip().lower()
    s = re.sub(r"\s*\((?:[^)]*\bremaster(?:ed)?\b[^)]*)\)", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*-\s*\bremaster(?:ed)?\b.*$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\bremaster(?:ed)?\b", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip(" -_")
    return s


def normalize_year_version(value: str) -> str:
    s = value
    s = re.sub(
        r"\s*[-–—]\s*\d{4}\s+(?:digital\s+master|master|remaster(?:ed)?|mix|version|edit|mono|stereo).*$",
        "",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"\s*\((?:\d{4}\s+)?(?:digital\s+master|master|remaster(?:ed)?|mix|version|edit|mono|stereo)[^)]*\)",
        "",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(r"\s+", " ", s).strip(" -_")
    return s


def normalize_key(value: str, ignore_remaster: bool, ignore_year_version: bool) -> str:
    out = value
    if ignore_year_version:
        out = normalize_year_version(out)
    if ignore_remaster:
        out = normalize_remaster(out)
    return out


def main() -> None:
    args = parse_args()
    db_path = Path(args.db).expanduser().resolve()
    if not db_path.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")

    table = qi(args.table)
    column = qi(args.column)

    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()

        rows = cur.execute(
            f"""
            SELECT "Track_ID", "Song", "Artist", {column}
            FROM {table}
            WHERE {column} IS NOT NULL AND TRIM({column}) <> ''
            """
        ).fetchall()

        groups = defaultdict(list)
        for track_id, song, artist, key in rows:
            key_str = str(key)
            grouped_key = normalize_key(key_str, args.ignore_remaster, args.ignore_year_version)
            groups[grouped_key].append((track_id, song, artist, key_str))

        dup_groups = [(k, v) for k, v in groups.items() if len(v) > 1]
        dup_groups.sort(key=lambda x: (-len(x[1]), x[0]))
        total_dup_keys = len(dup_groups)
        dups = dup_groups[: args.limit]

        print(f"DB: {db_path}")
        print(f"Table: {args.table}")
        print(f"Column: {args.column}")
        print(f"Ignore remaster text: {'yes' if args.ignore_remaster else 'no'}")
        print(f"Ignore year/version suffixes: {'yes' if args.ignore_year_version else 'no'}")
        print(f"Duplicate keys found: {total_dup_keys}")

        if not dups:
            print("No duplicate track keys found.")
            return

        print("\nTop duplicate keys:")
        for key, group_rows in dups:
            print(f"- {key}  (count={len(group_rows)})")

        if args.csv_out:
            csv_path = Path(args.csv_out).expanduser().resolve()
            csv_path.parent.mkdir(parents=True, exist_ok=True)
            with csv_path.open("w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(
                    [
                        "group_key",
                        "group_count",
                        "track_id",
                        "artist",
                        "song",
                        "raw_key",
                        "normalized_by_ignore_remaster",
                        "normalized_by_ignore_year_version",
                    ]
                )
                for key, group_rows in dup_groups:
                    sorted_rows = sorted(group_rows, key=lambda r: (str(r[2]), str(r[1])))
                    for track_id, song, artist, raw_key in sorted_rows:
                        writer.writerow(
                            [
                                key,
                                len(group_rows),
                                track_id,
                                artist,
                                song,
                                raw_key,
                                int(args.ignore_remaster),
                                int(args.ignore_year_version),
                            ]
                        )
            print(f"CSV written: {csv_path}")

        if args.show_rows:
            print("\nRows per duplicate key:")
            for key, group_rows in dups:
                print(f"\n{key} (count={len(group_rows)})")
                sorted_rows = sorted(group_rows, key=lambda r: (str(r[2]), str(r[1])))
                for track_id, song, artist, raw_key in sorted_rows:
                    print(f"  - {track_id} | {artist} | {song} | raw_key={raw_key}")
    finally:
        con.close()


if __name__ == "__main__":
    main()
