"""Собирает сайт без сервера, который можно выложить на любой бесплатный статический хостинг.

    python tools/build_static.py                    папка dist/site (index.html + vendor/), цены из data/prices.csv
    python tools/build_static.py --out public       другая папка
    python tools/build_static.py --prices my.csv    другой файл с цен
    python tools/build_static.py --single f.html    один HTML-файл, three.js с CDN (для демо-страницы)

Админки, сборщика цен и базы на таком сайте нет: цены вшиваются в страницу при сборке (python tools/export_prices.py
готовит для них файл), а ссылка «Поделиться» хранит выбор прямо в адресе.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import catalog, seed  # noqa: E402

STATIC = ROOT / "static"
VENDOR = ["three.min.js", "OrbitControls.js", "RoundedBoxGeometry.js"]
CDN = (
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n'
    '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>\n'
    '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/geometries/RoundedBoxGeometry.js"></script>\n'
)
LOCAL = "".join(f'<script src="vendor/{f}"></script>\n' for f in VENDOR)


def read(rel: str) -> str:
    return (STATIC / rel).read_text(encoding="utf-8")


def js_block(code: str) -> str:
    return "<script>\n" + code.replace("</script", "<\\/script") + "\n</script>\n"


def render_html(prices: dict[str, dict], *, vendor: str, static_site: bool) -> str:
    """vendor: 'local' (скрипты лежат рядом, vendor/) или 'cdn' (всё в одном файле)."""
    html = read("index.html")
    css = read("css/app.css")
    html, n = re.subn(r'<link rel="stylesheet" href="/css/app\.css">', lambda _: "<style>\n" + css + "\n</style>", html)
    assert n == 1, "не нашёл ссылку на app.css"

    payload = catalog.catalog_payload(prices, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    if static_site:
        payload["static_site"] = True
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    scripts = (
        (LOCAL if vendor == "local" else CDN)
        + js_block("window.VS_DEMO_CATALOG = " + data + ";")
        + js_block(read("js/rules.js"))
        + js_block(read("js/engine3d.js"))
        + js_block(read("js/app.js"))
    )
    html, n = re.subn(r'<script src="/vendor/three\.min\.js"></script>.*?<script src="/js/app\.js"></script>\n',
                      lambda _: scripts, html, flags=re.S)
    assert n == 1, "не нашёл блок скриптов"
    assert not re.search(r'(?:src|href)="/(?!/)', html), "в странице остались абсолютные пути, на подпапке хостинга они сломаются"
    return html


def build_site(out: Path, prices: dict[str, dict]) -> None:
    if out.exists():
        shutil.rmtree(out)
    (out / "vendor").mkdir(parents=True)
    (out / "index.html").write_text(render_html(prices, vendor="local", static_site=True), encoding="utf-8")
    for f in VENDOR:
        shutil.copy(STATIC / "vendor" / f, out / "vendor" / f)
    (out / ".nojekyll").write_text("")  # GitHub Pages: отдавать файлы как есть


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "dist" / "site")
    ap.add_argument("--prices", type=Path, default=ROOT / "data" / "prices.csv")
    ap.add_argument("--single", type=Path, help="собрать один HTML-файл с CDN вместо папки")
    args = ap.parse_args()

    prices, problems = seed.load_seed(args.prices)
    for p in problems:
        print("  ! " + p)
    if prices:
        oldest = min(v["updated"] for v in prices.values())
        age = (datetime.now(timezone.utc) - datetime.strptime(oldest, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)).days
        print(f"Цены из {args.prices.name}: {len(prices)} деталей, самая старая {age} дн. назад")
        if age > 7:
            print("  ! Есть цены старше недели. Обнови файл, иначе на сайте будет стоять дата, которой уже нельзя верить.")
    else:
        print(f"Файла цен нет или он пуст ({args.prices}): на сайте будут ориентировочные цены.")

    if args.single:
        args.single.parent.mkdir(parents=True, exist_ok=True)
        args.single.write_text(render_html(prices, vendor="cdn", static_site=False), encoding="utf-8")
        print(f"{args.single}  {args.single.stat().st_size / 1024:.0f} КБ")
    else:
        build_site(args.out, prices)
        size = sum(f.stat().st_size for f in args.out.rglob("*") if f.is_file()) / 1024
        print(f"Сайт: {args.out}  {size:.0f} КБ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
