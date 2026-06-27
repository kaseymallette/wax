#!/usr/bin/env python3
import argparse
import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, Tuple, Any, Set, List, Iterable


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
        description="Delete tracks from data/music-library/spotify_music_library.db when decisions keepInLibrary=0.",
    )
    parser.add_argument(
        "--owner-user",
        default="",
        help="Owner user whose remove decisions drive deletion (defaults to WAX_USER or decisions path parent folder).",
    )
    parser.add_argument(
        "--decisions",
        default=str(repo_root / "users" / "kasey" / "decisions-latest.json"),
        help="Path to decisions-latest.json",
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
        "--apply",
        action="store_true",
        help="Actually delete rows. If omitted, runs in dry-run mode.",
    )
    parser.add_argument(
        "--backup",
        action="store_true",
        help="Create a timestamped .bak copy next to the DB before deleting (only with --apply).",
    )
    return parser.parse_args()


def derive_owner_user(owner_arg: str, decisions_path: Path) -> str:
    if owner_arg.strip():
        return owner_arg.strip()

    env_user = str(__import__("os").environ.get("WAX_USER", "")).strip()
    if env_user:
        return env_user

    # users/<name>/decisions-latest.json -> <name>
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

    remove_ids = owner_remove_ids - protected_ids
    protected_from_delete = owner_remove_ids & protected_ids

    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        cur.execute('SELECT "Track_ID" FROM tracks')
        rows = cur.fetchall()

        raw_track_ids: List[str] = [str(r[0] or "").strip() for r in rows]
        matched_raw_ids: List[str] = [raw for raw in raw_track_ids if normalize_track_id(raw) in remove_ids]

        print(f"Owner user:     {owner_user}")
        print(f"Decisions file: {decisions_path}")
        print(f"Users root:     {users_root}")
        print(f"Music DB:       {db_path}")
        print(f"Other users scanned:           {scanned_users}")
        print(f"Owner remove IDs (latest):     {len(owner_remove_ids)}")
        print(f"Protected by other-user keep:  {len(protected_from_delete)}")
        print(f"Final remove IDs after safety: {len(remove_ids)}")
        print(f"Rows in tracks table:      {len(raw_track_ids)}")
        print(f"Rows matched for delete:   {len(matched_raw_ids)}")

        if protected_from_delete:
            preview_protected = sorted(list(protected_from_delete))[:10]
            print("Protected Track_ID values (kept by other users):")
            for t in preview_protected:
                print(f"  - {t}")
            if len(protected_from_delete) > len(preview_protected):
                print(f"  ... +{len(protected_from_delete) - len(preview_protected)} more")

        if matched_raw_ids:
            preview = matched_raw_ids[:10]
            print("Example Track_ID values to delete:")
            for t in preview:
                print(f"  - {t}")
            if len(matched_raw_ids) > len(preview):
                print(f"  ... +{len(matched_raw_ids) - len(preview)} more")

        if not args.apply:
            print("\nDry-run complete. Re-run with --apply to delete.")
            return

        if args.backup:
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup_dir = repo_root / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup_path = backup_dir / f"{db_path.name}.{ts}.bak"
            shutil.copy2(db_path, backup_path)
            print(f"Backup created: {backup_path}")

        cur.executemany('DELETE FROM tracks WHERE "Track_ID" = ?', [(t,) for t in matched_raw_ids])
        con.commit()
        print(f"\nDeleted {len(matched_raw_ids)} row(s) from tracks.")
    finally:
        con.close()


if __name__ == "__main__":
    main()
