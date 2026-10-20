import httpx
import pytest
from fastapi.testclient import TestClient

from app import catalog, catalog_data, compat, prices
from app.db import connect


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VERSTAK_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("VERSTAK_ADMIN_TOKEN", "secret-token")
    monkeypatch.setenv("VERSTAK_AUTO_REFRESH", "0")
    from app.main import app
    with TestClient(app) as c:
        yield c


ADMIN = {"X-Admin-Token": "secret-token"}
GAME = catalog_data.PRESETS[1]["sel"]


# ───────── каталог ─────────

def test_part_ids_unique_and_presets_valid():
    ids = catalog.all_part_ids()
    assert len(ids) == len(set(ids)) == 50
    for pr in catalog_data.PRESETS:
        b = catalog.resolve_selection(pr["sel"])
        assert not [i for i in compat.evaluate(b) if i["level"] == "error"], pr["id"]


def test_catalog_endpoint_shape_and_reference_prices(client):
    data = client.get("/api/catalog").json()
    assert [c["id"] for c in data["categories"]] == catalog.CATEGORY_IDS
    cpu = next(p for p in data["parts"]["cpu"] if p["id"] == "r5-7500f")
    assert cpu["price"] == cpu["ref_price"] and cpu["price_kind"] == "ref"
    assert cpu["spec"].startswith("AM5") and len(cpu["buy"]) == 3
    assert data["parts"]["gpu"][0]["buy"] == []
    assert all(u["url"].startswith("https://") for u in cpu["buy"])


# ───────── проверка и сборки ─────────

def test_check_ok_and_conflicts(client):
    r = client.post("/api/check", json={"sel": GAME}).json()
    assert r["ok"] and r["total"] == 131300 and r["power"]["psu"] == 750
    bad = dict(GAME, cpu="r5-5600")  # AM4-процессор на плате AM5
    r = client.post("/api/check", json={"sel": bad}).json()
    assert not r["ok"] and any("Сокет не совпадает" in i["text"] for i in r["issues"])


def test_check_rejects_unknown_parts(client):
    assert client.post("/api/check", json={"sel": dict(GAME, cpu="nope")}).status_code == 422
    assert client.post("/api/check", json={"sel": {"cpu": "r5-7500f"}}).status_code == 422
    assert client.post("/api/check", json={"sel": dict(GAME, extra="x")}).status_code == 422
    assert client.post("/api/check", json={"sel": dict(GAME, cpu="5080")}).status_code == 422  # деталь из другой категории


def test_save_and_load_build(client):
    r = client.post("/api/builds", json={"sel": GAME, "color": "white", "rgb": "#29d3ff"})
    assert r.status_code == 200
    bid = r.json()["id"]
    got = client.get(f"/api/builds/{bid}").json()
    assert got["sel"] == GAME and got["color"] == "white" and got["rgb"] == "#29d3ff"
    assert client.get("/api/builds/missing").status_code == 404
    assert client.post("/api/builds", json={"sel": GAME, "color": "red"}).status_code == 422
    assert client.post("/api/builds", json={"sel": GAME, "rgb": "javascript:1"}).status_code == 422


# ───────── админка и цены ─────────

def test_admin_requires_token(client):
    assert client.get("/api/admin/overview").status_code == 401
    assert client.get("/api/admin/overview", headers={"X-Admin-Token": "wrong"}).status_code == 401
    assert client.get("/api/admin/overview", headers=ADMIN).status_code == 200
    assert client.post("/api/admin/refresh", json={}).status_code == 401


def test_manual_price_changes_catalog_and_total(client):
    r = client.post("/api/admin/manual-price", headers=ADMIN, json={"part_id": "r5-7500f", "price": 11990, "store": "Магазин А"})
    assert r.status_code == 200
    cpu = next(p for p in client.get("/api/catalog").json()["parts"]["cpu"] if p["id"] == "r5-7500f")
    assert (cpu["price"], cpu["price_kind"], cpu["price_store"]) == (11990, "live", "Магазин А")
    assert client.post("/api/check", json={"sel": GAME}).json()["total"] == 131300 - 13000 + 11990


def test_lowest_in_stock_price_wins_and_out_of_stock_ignored(client):
    for store, price, stock in [("А", 12500, True), ("Б", 11800, True), ("В", 10000, False)]:
        client.post("/api/admin/manual-price", headers=ADMIN,
                    json={"part_id": "r5-7500f", "price": price, "store": store, "in_stock": stock})
    cpu = next(p for p in client.get("/api/catalog").json()["parts"]["cpu"] if p["id"] == "r5-7500f")
    assert (cpu["price"], cpu["price_store"]) == (11800, "Б")


def test_implausible_price_rejected(client):
    r = client.post("/api/admin/manual-price", headers=ADMIN, json={"part_id": "r5-7500f", "price": 99})
    assert r.status_code == 422 and "далека" in r.json()["detail"]
    assert client.post("/api/admin/manual-price", headers=ADMIN, json={"part_id": "r5-7500f", "price": 9_900_000}).status_code == 422
    assert client.post("/api/admin/manual-price", headers=ADMIN, json={"part_id": "zzz", "price": 100}).status_code == 422


def test_csv_import(client):
    text = "part_id;price;store;url;in_stock\nr5-7500f;12 490;Магазин;https://shop.example/p;1\nnope;100;X;;1\nssd;1;X;;1\n"
    r = client.post("/api/admin/import-csv", headers=ADMIN, json={"csv": text}).json()
    assert r["imported"] == 1 and len(r["errors"]) == 2
    cpu = next(p for p in client.get("/api/catalog").json()["parts"]["cpu"] if p["id"] == "r5-7500f")
    assert cpu["price"] == 12490
    assert client.post("/api/admin/import-csv", headers=ADMIN, json={"csv": "a;b\n1;2"}).status_code == 422
    comma = "part_id,price,store\n990evo-1,8 990,Маг\n"
    assert client.post("/api/admin/import-csv", headers=ADMIN, json={"csv": comma}).json()["imported"] == 1


def test_add_and_delete_source_and_duplicates(client):
    ok = client.post("/api/admin/sources", headers=ADMIN, json={"part_id": "r5-7500f", "url": "https://www.citilink.ru/product/x-1/"})
    assert ok.status_code == 200
    dup = client.post("/api/admin/sources", headers=ADMIN, json={"part_id": "r5-7500f", "url": "https://www.citilink.ru/product/x-1/"})
    assert dup.status_code == 422
    assert client.post("/api/admin/sources", headers=ADMIN, json={"part_id": "r5-7500f", "url": "ftp://x.ru/1111"}).status_code == 422
    ov = client.get("/api/admin/overview", headers=ADMIN).json()
    part = next(p for p in ov["parts"] if p["id"] == "r5-7500f")
    assert part["sources"][0]["store"] == "Ситилинк"
    assert client.delete(f"/api/admin/sources/{ok.json()['id']}", headers=ADMIN).status_code == 200
    assert client.delete("/api/admin/sources/9999", headers=ADMIN).status_code == 404


# ───────── сборщик целиком (подставной магазин вместо сети) ─────────

def fake_shop(pages: dict[str, httpx.Response], robots="User-agent: *\nDisallow: /secret\n"):
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text=robots)
        return pages.get(req.url.path, httpx.Response(404))
    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)
    return prices.Fetcher(client=client, resolver=lambda h: ["93.184.216.34"], sleep=lambda s: None, min_delay=0)


def page(text):
    return httpx.Response(200, text=text, headers={"content-type": "text/html; charset=utf-8"})


def product(price, stock="InStock"):
    import json
    ldj = json.dumps({"@type": "Product", "offers": {"price": str(price), "priceCurrency": "RUB",
                                                       "availability": f"https://schema.org/{stock}"}})
    return page(f'<script type="application/ld+json">{ldj}</script>')


def sources_status(client):
    ov = client.get("/api/admin/overview", headers=ADMIN).json()
    return {s["url"].rsplit("/", 1)[-1]: s for p in ov["parts"] for s in p["sources"]}


def test_refresh_all_statuses_and_pause_on_block(client):
    adds = [("r5-7500f", "/ok"), ("r5-7500f", "/cheap"), ("r5-7500f", "/wrongitem"), ("r5-7500f", "/secret"),
            ("r5-7500f", "/gone"), ("r5-7500f", "/noprice"), ("r5-7500f", "/out")]
    for part, path in adds:
        client.post("/api/admin/sources", headers=ADMIN, json={"part_id": part, "url": f"https://shop.example{path}"})
    fetcher = fake_shop({
        "/ok": product(12990), "/cheap": product(11990), "/wrongitem": product(990),
        "/noprice": page("<html>нет цены</html>"),
        "/out": product(9990, "OutOfStock"),
    })
    summary = prices.refresh_all(fetcher=fetcher)
    st = sources_status(client)
    assert st["ok"]["status"] == "ok" and st["cheap"]["status"] == "ok"
    assert st["wrongitem"]["status"] == "suspicious"
    assert st["secret"]["status"] == "robots"
    assert st["gone"]["status"] == "error"
    assert st["noprice"]["status"] == "no_price"
    assert st["out"]["status"] == "out_of_stock"
    assert summary["ok"] == 2
    cpu = next(p for p in client.get("/api/catalog").json()["parts"]["cpu"] if p["id"] == "r5-7500f")
    assert (cpu["price"], cpu["price_kind"]) == (11990, "live")  # минимум среди «в наличии» и правдоподобных


def test_block_pauses_whole_store_and_next_run_skips_it(client):
    for i in range(3):
        client.post("/api/admin/sources", headers=ADMIN, json={"part_id": "r5-7500f", "url": f"https://shop.example/p{i}"})
    hits = []

    def handler(req):
        hits.append(req.url.path)
        return httpx.Response(404) if req.url.path == "/robots.txt" else httpx.Response(403, text="forbidden")

    fetcher = prices.Fetcher(client=httpx.Client(transport=httpx.MockTransport(handler)), resolver=lambda h: ["93.184.216.34"],
                             sleep=lambda s: None, min_delay=0)
    summary = prices.refresh_all(fetcher=fetcher)
    assert summary["blocked"] == 1 and summary["paused"] == 2
    assert hits.count("/p0") == 1 and "/p1" not in hits and "/p2" not in hits  # после отказа магазин не долбим
    hits.clear()
    again = prices.refresh_all(fetcher=fetcher)
    assert hits == [] and again == {"paused": 3}


def test_challenge_page_is_treated_as_block(client):
    client.post("/api/admin/sources", headers=ADMIN, json={"part_id": "r5-7500f", "url": "https://shop.example/c"})
    fetcher = fake_shop({"/c": page("<html><title>Just a moment...</title>captcha</html>")})
    assert prices.refresh_all(fetcher=fetcher)["blocked"] == 1


def test_stale_web_prices_expire(client):
    from datetime import datetime, timedelta, timezone
    client.post("/api/admin/sources", headers=ADMIN, json={"part_id": "r5-7500f", "url": "https://shop.example/ok"})
    prices.refresh_all(fetcher=fake_shop({"/ok": product(12000)}))
    with connect() as conn:
        assert "r5-7500f" in prices.effective_prices(conn)
        later = datetime.now(timezone.utc) + timedelta(hours=100)
        assert "r5-7500f" not in prices.effective_prices(conn, now=later)  # свежесть 72 часа, дальше — ориентир
