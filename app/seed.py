"""Цены из файла data/prices.csv: так цены попадают на статический сайт, где нет ни сервера, ни базы.

Колонки: part_id;price;store;url;in_stock;updated;name (нужны part_id и price, остальное по желанию).
Разделитель ; , или табуляция. Кодировка UTF-8 или Windows-1251 (так сохраняет Excel).
updated (обязательна): когда смотрел цену. 2026-10-19, 19.10.2026 или 2026-10-19T12:00:00Z. Без даты строка пропускается,
потому что сайт показывает посетителям, насколько цена свежая.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import catalog
from .prices import MANUAL_MAX_AGE, plausible, to_rub

FIELDS = ["part_id", "price", "store", "url", "in_stock", "updated", "name"]


def decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1251")


def _parse_date(s: str) -> datetime | None:
    s = (s or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d.%m.%Y", "%d.%m.%Y %H:%M"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def parse_seed(text: str, *, now: datetime | None = None,
               max_age: timedelta = MANUAL_MAX_AGE) -> tuple[dict[str, dict], list[str]]:
    """Возвращает ({part_id: {price, store, updated, url}}, замечания). Для каждой детали берётся минимальная
    цена среди строк, где товар в наличии, цена правдоподобна и не старше max_age."""
    now = now or datetime.now(timezone.utc)
    text = text.lstrip("﻿")
    if not text.strip():
        return {}, []
    delim = max(";\t,", key=text.splitlines()[0].count)
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    reader.fieldnames = [(f or "").strip().lower() for f in (reader.fieldnames or [])]
    if not {"part_id", "price"} <= set(reader.fieldnames):
        raise ValueError("В первой строке нужны колонки part_id и price")
    best: dict[str, dict] = {}
    problems: list[str] = []
    for n, row in enumerate(reader, start=2):
        raw_price = (row.get("price") or "").strip()
        if not raw_price:
            continue  # строка из шаблона, цену ещё не вписали
        pid = (row.get("part_id") or "").strip()
        if not catalog.get_part(pid):
            problems.append(f"строка {n}: нет детали с id «{pid}»")
            continue
        value = to_rub(raw_price)
        if not value:
            problems.append(f"строка {n} ({pid}): цена «{raw_price}» не распознана")
            continue
        if not plausible(pid, value):
            ref = catalog.get_part(pid)[1]["ref_price"]
            problems.append(f"строка {n} ({pid}): цена {value} ₽ слишком далека от ориентира {ref} ₽, пропущена")
            continue
        if (row.get("in_stock") or "1").strip().lower() in ("0", "false", "нет", "no"):
            continue
        stamp = (row.get("updated") or "").strip()
        updated = _parse_date(stamp)
        if updated is None:
            problems.append(f"строка {n} ({pid}): " + (f"дата «{stamp}» не распознана" if stamp else "не указана дата в колонке updated")
                            + ", строка пропущена")
            continue
        if now - updated > max_age:
            problems.append(f"строка {n} ({pid}): цена от {updated:%d.%m.%Y} старше {max_age.days} дней, пропущена")
            continue
        url = (row.get("url") or "").strip()
        if url and not re.match(r"^https?://", url, re.I):
            url = ""
        store = (row.get("store") or "").strip() or "Магазин"
        cur = best.get(pid)
        if cur is None or value < cur["price"]:
            best[pid] = {"price": value, "store": store, "updated": updated.strftime("%Y-%m-%dT%H:%M:%SZ"),
                         "url": url or None}
    return best, problems


def load_seed(path: Path, now: datetime | None = None) -> tuple[dict[str, dict], list[str]]:
    """Читает файл цен. Нет файла, значит цен нет (сайт покажет ориентировочные)."""
    path = Path(path)
    if not path.exists():
        return {}, []
    return parse_seed(decode(path.read_bytes()), now=now)


def template_rows(today: datetime | None = None) -> list[list[str]]:
    """Шаблон со всеми деталями. Дата уже проставлена сегодняшняя: цены впиши в тот же день или поправь её."""
    stamp = (today or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    rows = [FIELDS]
    from . import catalog_data as D
    for cat, _ in D.CATEGORIES:
        for p in D.PARTS[cat]:
            if p["id"] != "none":
                rows.append([p["id"], "", "Магазин", "", "1", stamp, p["name"].replace(";", ",")])
    return rows


def write_csv(path: Path, rows: list[list[str]]) -> None:
    buf = io.StringIO()
    csv.writer(buf, delimiter=";", lineterminator="\n").writerows(rows)
    Path(path).write_text(buf.getvalue(), encoding="utf-8-sig")  # BOM, чтобы Excel не ломал кириллицу
