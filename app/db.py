"""SQLite: источники цен, история цен и сохранённые сборки."""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("VERSTAK_DATA", ROOT / "data"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id TEXT NOT NULL,
    store TEXT NOT NULL,
    url TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('web', 'manual', 'csv')),
    status TEXT NOT NULL DEFAULT 'new',
    last_checked TEXT,
    last_error TEXT,
    blocked_until TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS sources_unique ON sources (part_id, store, COALESCE(url, ''));
CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    price INTEGER NOT NULL,
    in_stock INTEGER NOT NULL DEFAULT 1,
    fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prices_source ON prices (source_id, fetched_at);
CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    sel TEXT NOT NULL,
    color TEXT NOT NULL,
    rgb TEXT NOT NULL,
    total INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
"""


def db_path() -> Path:
    return Path(os.environ.get("VERSTAK_DB", DATA_DIR / "verstak.db"))


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


@contextmanager
def connect():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
