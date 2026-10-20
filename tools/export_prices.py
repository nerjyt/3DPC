"""Файл цен для статического сайта: data/prices.csv.

    python tools/export_prices.py              выгрузить свежие цены из базы сервера (админка, сборщик, CSV)
    python tools/export_prices.py --template   пустой шаблон со всеми деталями, чтобы вписать цены руками в Excel
    python tools/export_prices.py --out файл   сохранить в другое место

Рабочий порядок: на своём компьютере запусти сервер, обнови цены в админке, выгрузи файл, собери сайт
(python tools/build_static.py) и опубликуй. Шаблон нужен, если сервер не запускать вовсе.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import catalog_data as D  # noqa: E402
from app import prices, seed  # noqa: E402
from app.db import connect, init_db  # noqa: E402


def export_rows() -> list[list[str]]:
    init_db()
    with connect() as conn:
        best = prices.effective_prices(conn)
    rows = [seed.FIELDS]
    for cat, _ in D.CATEGORIES:
        for p in D.PARTS[cat]:
            info = best.get(p["id"])
            if info:
                rows.append([p["id"], str(info["price"]), info["store"], info.get("url") or "", "1",
                             info["updated"], p["name"].replace(";", ",")])
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--template", action="store_true", help="пустой шаблон вместо выгрузки из базы")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "prices.csv")
    ap.add_argument("--force", action="store_true", help="перезаписать существующий файл шаблоном")
    args = ap.parse_args()

    if args.template:
        if args.out.exists() and not args.force:
            print(f"{args.out} уже есть. Добавь --force, если хочешь заменить его пустым шаблоном.")
            return 1
        seed.write_csv(args.out, seed.template_rows())
        print(f"Шаблон: {args.out}. Впиши цены в колонку price (магазин и дату по желанию).")
        return 0

    rows = export_rows()
    if len(rows) == 1:
        print("В базе нет свежих цен. Обнови их в админке (/admin) или загрузи CSV, потом повтори.")
        return 1
    seed.write_csv(args.out, rows)
    print(f"Выгружено цен: {len(rows) - 1} → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
