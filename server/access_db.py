"""SQLite-backed access code management."""

import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "access_codes.db"


def _conn():
    return sqlite3.connect(DB_PATH, check_same_thread=False)


def init_db():
    with _conn() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS access_codes (
                code        TEXT PRIMARY KEY,
                max_uses    INTEGER NOT NULL DEFAULT 0,
                used_count  INTEGER NOT NULL DEFAULT 0,
                active      INTEGER NOT NULL DEFAULT 1,
                created_at  REAL NOT NULL
            )
        """)


def validate_code(code: str) -> tuple[bool, str]:
    """Check code exists, is active, and under limit. Increments used_count atomically.
    Returns (valid, reason) where reason is 'ok', 'not_found', 'inactive', or 'exhausted'.
    """
    with _conn() as db:
        cur = db.execute(
            """
            UPDATE access_codes
               SET used_count = used_count + 1
             WHERE code = ?
               AND active = 1
               AND (max_uses = 0 OR used_count < max_uses)
            """,
            (code,),
        )
        if cur.rowcount == 1:
            return True, "ok"
        # Determine why it failed
        row = db.execute(
            "SELECT active, max_uses, used_count FROM access_codes WHERE code = ?",
            (code,),
        ).fetchone()
        if not row:
            return False, "not_found"
        active, max_uses, used_count = row
        if not active:
            return False, "inactive"
        if max_uses > 0 and used_count >= max_uses:
            return False, "exhausted"
        return False, "not_found"


def list_codes() -> list[dict]:
    with _conn() as db:
        rows = db.execute(
            "SELECT code, max_uses, used_count, active, created_at FROM access_codes ORDER BY created_at DESC"
        ).fetchall()
    return [
        {
            "code": r[0],
            "max_uses": r[1],
            "used_count": r[2],
            "active": bool(r[3]),
            "created_at": r[4],
        }
        for r in rows
    ]


def create_code(code: str, max_uses: int = 0) -> bool:
    try:
        with _conn() as db:
            db.execute(
                "INSERT INTO access_codes (code, max_uses, created_at) VALUES (?, ?, ?)",
                (code, max_uses, time.time()),
            )
        return True
    except sqlite3.IntegrityError:
        return False


def delete_code(code: str):
    with _conn() as db:
        db.execute("DELETE FROM access_codes WHERE code = ?", (code,))


def update_code(code: str, *, max_uses: int | None = None, active: bool | None = None):
    parts, params = [], []
    if max_uses is not None:
        parts.append("max_uses = ?")
        params.append(max_uses)
    if active is not None:
        parts.append("active = ?")
        params.append(int(active))
    if not parts:
        return
    params.append(code)
    with _conn() as db:
        db.execute(f"UPDATE access_codes SET {', '.join(parts)} WHERE code = ?", params)


def reset_usage(code: str):
    with _conn() as db:
        db.execute("UPDATE access_codes SET used_count = 0 WHERE code = ?", (code,))
