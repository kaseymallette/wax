#!/usr/bin/env python3
import argparse
import csv
import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable, List, Set, Tuple


def normalize_track_id(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        return ""
    if "spotify.com/track/" in s:
        s = s.split("spotify.com/track/", 1)[1].split("?", 1)[0].split("/", 1)[0]
    if s.startswith("spotify:track:"):
        s = s.split("spotify:track:", 1)[1]
    return s.strip()


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Build a review CSV for owner-user remove decisions before deleting from music-library DB.",
    )
    parser.add_argument(
        "--owner-user",
        default="",
        help="Owner user whose remove decisions drive candidates (defaults to WAX_USER or decisions path parent folder).",
    )
    parser.add_argument(
        "--decisions",
        default=str(repo_root / "users" / "kasey" / "decisions-latest.json"),
        help="Path to owner decisions-latest.json",
    )
    parser.add_argument(
        "--users-root",
        default=str(repo_root / "users"),
        help="Root users directory for cross-user keep checks.",
    )
    parser.add_argument(
        "--db",
        default=str(repo_root / "data" / "music-library" / "spotify_music_library.db"),
        help="Path to spotify_music_library.db",
    )
    parser.add_argument(
        "--out",
        default="",
        help="Output CSV path (defaults to outputs/<owner-user>-removal-review.csv)",
    )
    return parser.parse_args()


def derive_owner_user(owner_arg: str, decisions_path: Path) -> str:
    if owner_arg.strip():
        return owner_arg.strip()

    env_user = str(__import__("os").environ.get("WAX_USER", "")).strip()
    if env_user:
        return env_user

    parent = decisions_path.parent.name.strip()
    return parent or "default"


def load_latest_keep_map(decisions_path: Path) -> Dict[str, Tuple[int, int]]:
    payload = json.loads(decisions_path.read_text(encoding="utf-8"))
    rows = payload.get("decisions") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ValueError(f"Invalid decisions payload: expected decisions[] in {decisions_path}")

    latest: Dict[str, Tuple[int, int]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        tid = normalize_track_id(row.get("trackId"))
        if not tid:
            continue
        logged_at = int(row.get("loggedAt") or 0)
        keep_val = 0 if int(row.get("keepInLibrary") or 0) == 0 else 1
        prev = latest.get(tid)
        if prev is None or logged_at >= prev[0]:
            latest[tid] = (logged_at, keep_val)
    return latest


def find_other_user_decision_files(users_root: Path, owner_user: str) -> Iterable[Path]:
    if not users_root.exists() or not users_root.is_dir():
        return []

    out: List[Path] = []
    for child in sorted(users_root.iterdir()):
        if not child.is_dir():
            continue
        if child.name == owner_user:
            continue
        p = child / "decisions-latest.json"
        if p.exists() and p.is_file():
            out.append(p)
    return out


def load_track_rows(db_path: Path) -> Dict[str, Dict[str, str]]:
    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        rows = cur.execute(
            'SELECT "Track_ID", "Song", "Artist", "Album", "Added At", "Album Date", "playlist_name" FROM tracks'
        ).fetchall()
        out: Dict[str, Dict[str, str]] = {}
        for r in rows:
            raw_id = str(r[0] or "").strip()
            norm_id = normalize_track_id(raw_id)
            if not norm_id:
                continue
            out[norm_id] = {
                "track_id": raw_id,
                "song": str(r[1] or "").strip(),
                "artist": str(r[2] or "").strip(),
                "album": str(r[3] or "").strip(),
                "added_at": str(r[4] or "").strip(),
                "album_date": str(r[5] or "").strip(),
                "playlist_name": str(r[6] or "").strip(),
            }
        return out
    finally:
        con.close()


def yes_no(value: bool) -> str:
    return "yes" if value else "no"


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    decisions_path = Path(args.decisions).expanduser().resolve()
    db_path = Path(args.db).expanduser().resolve()
    users_root = Path(args.users_root).expanduser().resolve()

    if not decisions_path.exists():
        raise FileNotFoundError(f"Decisions file not found: {decisions_path}")
    if not db_path.exists():
        raise FileNotFoundError(f"Music-library DB not found: {db_path}")

    owner_user = derive_owner_user(args.owner_user, decisions_path)
    out_path = Path(args.out).expanduser().resolve() if args.out else repo_root / "outputs" / f"{owner_user}-removal-review.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    owner_latest = load_latest_keep_map(decisions_path)
    owner_remove_ids: Set[str] = {
        track_id for track_id, (_logged_at, keep_val) in owner_latest.items() if keep_val == 0
    }

    other_files = list(find_other_user_decision_files(users_root, owner_user))
    protected_ids: Set[str] = set()
    scanned_users = 0
    for f in other_files:
        latest = load_latest_keep_map(f)
        scanned_users += 1
        for track_id, (_logged_at, keep_val) in latest.items():
            if keep_val == 1:
                protected_ids.add(track_id)

    db_rows = load_track_rows(db_path)

    rows_out: List[Dict[str, str]] = []
    for track_id in sorted(owner_remove_ids):
        kept_by_other = track_id in protected_ids
        eligible = not kept_by_other
        db_row = db_rows.get(track_id)

        rows_out.append(
            {
                "track_id": (db_row or {}).get("track_id", track_id),
                "song": (db_row or {}).get("song", ""),
                "artist": (db_row or {}).get("artist", ""),
                "album": (db_row or {}).get("album", ""),
                "added_at": (db_row or {}).get("added_at", ""),
                "album_date": (db_row or {}).get("album_date", ""),
                "playlist_name": (db_row or {}).get("playlist_name", ""),
                "owner_latest_keep_in_library": "0",
                "kept_by_other_user": yes_no(kept_by_other),
                "eligible_for_delete": yes_no(eligible),
                "in_music_library_db": yes_no(db_row is not None),
                "your_decision": "",
                "notes": "",
            }
        )

    rows_out.sort(
        key=lambda r: (
            0 if r["eligible_for_delete"] == "yes" else 1,
            (r["artist"] or "").lower(),
            (r["song"] or "").lower(),
            (r["track_id"] or "").lower(),
        )
    )

    fieldnames = [
        "track_id",
        "song",
        "artist",
        "album",
        "added_at",
        "album_date",
        "playlist_name",
        "owner_latest_keep_in_library",
        "kept_by_other_user",
        "eligible_for_delete",
        "in_music_library_db",
        "your_decision",
        "notes",
    ]

    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows_out)

    eligible_count = sum(1 for r in rows_out if r["eligible_for_delete"] == "yes")
    protected_count = sum(1 for r in rows_out if r["kept_by_other_user"] == "yes")
    in_db_count = sum(1 for r in rows_out if r["in_music_library_db"] == "yes")

    print(f"Owner user: {owner_user}")
    print(f"Decisions file: {decisions_path}")
    print(f"Users root: {users_root}")
    print(f"Music DB: {db_path}")
    print(f"Other users scanned: {scanned_users}")
    print(f"Owner latest remove IDs: {len(owner_remove_ids)}")
    print(f"Protected by other-user keep: {protected_count}")
    print(f"Eligible for delete review: {eligible_count}")
    print(f"Present in DB: {in_db_count}")
    print(f"Wrote review CSV: {out_path}")
    print("\nNext: fill your_decision with yes/no, then run apply_music_library_removal_review.py")


if __name__ == "__main__":
    main()
