"""Сервер «Верстак»: API каталога и цен, сохранение сборок, админка. Запуск: python run.py"""
from __future__ import annotations

import logging
import os
import secrets
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import catalog, catalog_data, compat, prices
from .db import DATA_DIR, ROOT, connect, init_db, now_iso

log = logging.getLogger("verstak")
STATIC = ROOT / "static"
COLORS = ("black", "white")


# ───────────────────────── админский токен ─────────────────────────

def admin_token() -> str:
    """Токен берётся из VERSTAK_ADMIN_TOKEN, иначе создаётся один раз и лежит в data/admin_token.txt."""
    env = os.environ.get("VERSTAK_ADMIN_TOKEN")
    if env:
        return env
    f = Path(DATA_DIR) / "admin_token.txt"
    if not f.exists():
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(secrets.token_urlsafe(24))
        try:
            f.chmod(0o600)
        except OSError:
            pass
    return f.read_text().strip()


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    if not x_admin_token or not secrets.compare_digest(x_admin_token, admin_token()):
        raise HTTPException(401, "Нужен токен администратора (заголовок X-Admin-Token)")


# ───────────────────────── приложение ─────────────────────────

updater = prices.PriceUpdater()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
    print(f"\n  Админка: /admin   токен: {admin_token()}\n")
    if os.environ.get("VERSTAK_AUTO_REFRESH", "1") != "0":
        updater.start()
    yield
    updater.stop()


app = FastAPI(title="Верстак", lifespan=lifespan)


def current_prices() -> dict[str, dict]:
    with connect() as conn:
        return prices.effective_prices(conn)


def price_of(part: dict, live: dict[str, dict]) -> int:
    return live[part["id"]]["price"] if part["id"] in live else part["ref_price"]


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/catalog")
def get_catalog():
    return catalog.catalog_payload(current_prices(), now_iso())


class Selection(BaseModel):
    sel: dict[str, str]


@app.post("/api/check")
def check(body: Selection):
    """Проверка сборки на сервере: совместимость, потребление, итоговая цена."""
    try:
        b = catalog.resolve_selection(body.sel)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    live = current_prices()
    watts = compat.power_draw(b)
    issues = compat.evaluate(b)
    return {
        "issues": issues,
        "ok": not any(i["level"] == "error" for i in issues),
        "total": sum(price_of(p, live) for p in b.values()),
        "power": {"draw": watts, "psu": b["psu"]["watt"], "load": round(watts / b["psu"]["watt"], 3)},
        "gaming": compat.gaming_tier_text(b, catalog_data.TIERS),
    }


class BuildIn(BaseModel):
    sel: dict[str, str]
    color: str = "black"
    rgb: str = "#ff7a2f"


@app.post("/api/builds")
def save_build(body: BuildIn):
    import json
    try:
        b = catalog.resolve_selection(body.sel)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if body.color not in COLORS:
        raise HTTPException(422, "Цвет корпуса: black или white")
    if body.rgb not in {o["v"] for o in catalog_data.RGB_OPTIONS}:
        raise HTTPException(422, "Неизвестный цвет подсветки")
    live = current_prices()
    total = sum(price_of(p, live) for p in b.values())
    with connect() as conn:
        for _ in range(5):
            bid = secrets.token_urlsafe(6)
            try:
                conn.execute("INSERT INTO builds (id, sel, color, rgb, total, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                             (bid, json.dumps(body.sel), body.color, body.rgb, total, now_iso()))
                break
            except sqlite3.IntegrityError:
                continue
        else:
            raise HTTPException(500, "Не удалось создать ссылку, попробуй ещё раз")
    return {"id": bid, "url": f"/?build={bid}", "total": total}


@app.get("/api/builds/{build_id}")
def load_build(build_id: str):
    import json
    with connect() as conn:
        row = conn.execute("SELECT * FROM builds WHERE id = ?", (build_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Такой сборки нет")
    return {"id": row["id"], "sel": json.loads(row["sel"]), "color": row["color"], "rgb": row["rgb"],
            "created_at": row["created_at"]}


# ───────────────────────── админка ─────────────────────────

class SourceIn(BaseModel):
    part_id: str
    url: str = Field(min_length=8, max_length=800)
    store: str | None = Field(default=None, max_length=60)


class ManualPriceIn(BaseModel):
    part_id: str
    price: float
    store: str = Field(default="Вручную", max_length=60)
    in_stock: bool = True


class CsvIn(BaseModel):
    csv: str = Field(max_length=500_000)


class RefreshIn(BaseModel):
    part_id: str | None = None


admin = [Depends(require_admin)]


@app.get("/api/admin/overview", dependencies=admin)
def admin_overview():
    with connect() as conn:
        live = prices.effective_prices(conn)
        rows = conn.execute("""
            SELECT s.*, p.price, p.in_stock, p.fetched_at
            FROM sources s
            LEFT JOIN prices p ON p.id = (SELECT id FROM prices WHERE source_id = s.id ORDER BY fetched_at DESC, id DESC LIMIT 1)
            ORDER BY s.id""").fetchall()
    by_part: dict[str, list[dict]] = {}
    for r in rows:
        by_part.setdefault(r["part_id"], []).append({k: r[k] for k in r.keys() if k != "part_id"})
    out = []
    for cat, name in catalog_data.CATEGORIES:
        for p in catalog_data.PARTS[cat]:
            if p["id"] == "none":
                continue
            info = live.get(p["id"])
            out.append({"cat": cat, "cat_name": name, "id": p["id"], "name": p["name"], "ref_price": p["ref_price"],
                        "price": info["price"] if info else p["ref_price"],
                        "price_kind": "live" if info else "ref", "price_store": info["store"] if info else None,
                        "sources": by_part.get(p["id"], [])})
    return {"parts": out, "updater": updater.state, "min_delay": prices.MIN_DELAY,
            "user_agent": prices.USER_AGENT}


@app.post("/api/admin/sources", dependencies=admin)
def admin_add_source(body: SourceIn):
    with connect() as conn:
        try:
            sid = prices.add_web_source(conn, body.part_id, body.url, body.store)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    return {"id": sid}


@app.delete("/api/admin/sources/{source_id}", dependencies=admin)
def admin_delete_source(source_id: int):
    with connect() as conn:
        cur = conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
    if not cur.rowcount:
        raise HTTPException(404, "Источник не найден")
    return {"ok": True}


@app.post("/api/admin/manual-price", dependencies=admin)
def admin_manual_price(body: ManualPriceIn):
    with connect() as conn:
        try:
            sid = prices.set_manual_price(conn, body.part_id, body.price, store=body.store.strip() or "Вручную",
                                          in_stock=body.in_stock)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    return {"id": sid}


@app.post("/api/admin/import-csv", dependencies=admin)
def admin_import_csv(body: CsvIn):
    with connect() as conn:
        try:
            return prices.import_csv(conn, body.csv)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc


@app.get("/api/admin/csv-template", dependencies=admin, response_class=PlainTextResponse)
def admin_csv_template():
    lines = ["part_id;price;store;url;in_stock;name"]
    for cat, _ in catalog_data.CATEGORIES:
        for p in catalog_data.PARTS[cat]:
            if p["id"] != "none":
                lines.append(f"{p['id']};;Магазин;;1;{p['name'].replace(';', ',')}")
    return "\n".join(lines)


@app.post("/api/admin/refresh", dependencies=admin)
def admin_refresh(body: RefreshIn):
    if body.part_id and not catalog.get_part(body.part_id):
        raise HTTPException(422, "Нет такой детали")
    if not updater.run_in_background(body.part_id):
        raise HTTPException(409, "Обновление уже идёт")
    return {"started": True}


@app.get("/admin", include_in_schema=False)
def admin_page():
    return FileResponse(STATIC / "admin.html")


# фронтенд (должен быть смонтирован последним)
app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
