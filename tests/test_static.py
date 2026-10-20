"""Статический сайт: файл цен, сборка, выгрузка из базы."""
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import catalog_data, prices, seed
from app.db import connect, init_db

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
HEAD = "part_id;price;store;url;in_stock;updated;name\n"


def parse(rows: str, **kw):
    return seed.parse_seed(HEAD + rows, now=NOW, **kw)


# ───────── файл цен ─────────

def test_seed_takes_cheapest_in_stock_price_per_part():
    got, problems = parse(
        "r5-7500f;12 500;Ситилинк;https://www.citilink.ru/product/x;1;2026-10-18;\n"
        "r5-7500f;11 990;XCOM;;1;19.10.2026;\n"
        "r5-7500f;9 990;Дешёвый;;0;2026-10-18;\n")          # нет в наличии: не считается
    assert not problems
    assert got["r5-7500f"] == {"price": 11990, "store": "XCOM", "updated": "2026-10-19T00:00:00Z", "url": None}


def test_seed_keeps_store_url_only_when_http():
    got, _ = parse("r5-7500f;12000;A;https://shop.ru/p/1;1;2026-10-18;\nr5-5600;8000;B;javascript:alert(1);1;2026-10-18;\n")
    assert got["r5-7500f"]["url"] == "https://shop.ru/p/1"
    assert got["r5-5600"]["url"] is None


@pytest.mark.parametrize("row, fragment", [
    ("nope;1000;A;;1;2026-10-18;", "нет детали"),
    ("r5-7500f;abc;A;;1;2026-10-18;", "не распознана"),
    ("r5-7500f;1;A;;1;2026-10-18;", "слишком далека"),
    ("r5-7500f;99999999;A;;1;2026-10-18;", "слишком далека"),
    ("r5-7500f;12000;A;;1;;", "не указана дата"),
    ("r5-7500f;12000;A;;1;вчера;", "не распознана"),
    ("r5-7500f;12000;A;;1;2026-08-01;", "старше 30 дней"),
])
def test_seed_skips_bad_rows_and_says_why(row, fragment):
    got, problems = parse(row + "\n")
    assert got == {}
    assert len(problems) == 1 and fragment in problems[0]


def test_seed_ignores_unfilled_template_rows_and_handles_other_delimiters_and_bom():
    text = "﻿part_id,price,store,updated\nr5-7500f,,Магазин,2026-10-18\nr5-5600,\"8 990\",Х,2026-10-18\n"
    got, problems = seed.parse_seed(text, now=NOW)
    assert list(got) == ["r5-5600"] and got["r5-5600"]["price"] == 8990 and not problems


def test_seed_requires_columns():
    with pytest.raises(ValueError):
        seed.parse_seed("a;b\n1;2\n", now=NOW)


def test_seed_reads_windows_1251_files(tmp_path):
    f = tmp_path / "p.csv"
    f.write_bytes((HEAD + "r5-7500f;12000;Ситилинк;;1;2026-10-18;Ryzen\n").encode("cp1251"))
    got, problems = seed.load_seed(f, now=NOW)
    assert got["r5-7500f"]["store"] == "Ситилинк" and not problems


def test_missing_seed_file_means_no_prices(tmp_path):
    assert seed.load_seed(tmp_path / "none.csv") == ({}, [])


def test_template_covers_every_part_and_is_empty():
    rows = seed.template_rows(NOW)
    ids = {r[0] for r in rows[1:]}
    assert ids == {p["id"] for ps in catalog_data.PARTS.values() for p in ps if p["id"] != "none"}
    assert all(r[1] == "" and r[5] == "2026-10-19" for r in rows[1:])
    text = HEAD + "\n".join(";".join(r) for r in rows[1:])
    assert seed.parse_seed(text, now=NOW) == ({}, [])


# ───────── выгрузка → сборка ─────────

@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("VERSTAK_DB", str(tmp_path / "t.db"))
    init_db()
    return tmp_path


def run(*args, cwd=ROOT, env=None):
    return subprocess.run([sys.executable, *args], cwd=cwd, capture_output=True, text=True, env=env, timeout=120)


def test_export_then_build_puts_prices_into_the_page(db, monkeypatch):
    with connect() as conn:
        prices.set_manual_price(conn, "r5-7500f", 11990, store="Ситилинк")
        prices.set_manual_price(conn, "5070", 61000, store="XCOM")
    out = db / "prices.csv"
    import os
    env = {**os.environ, "VERSTAK_DB": str(db / "t.db")}
    r = run("tools/export_prices.py", "--out", str(out), env=env)
    assert r.returncode == 0, r.stderr
    lines = out.read_text(encoding="utf-8-sig").splitlines()
    assert lines[0] == "part_id;price;store;url;in_stock;updated;name" and len(lines) == 3

    site = db / "site"
    r = run("tools/build_static.py", "--out", str(site), "--prices", str(out))
    assert r.returncode == 0, r.stderr
    html = (site / "index.html").read_text(encoding="utf-8")
    data = json.loads(re.search(r"window\.VS_DEMO_CATALOG = (\{.*?\});\n", html, re.S).group(1).replace("<\\/", "</"))
    cpu = next(p for p in data["parts"]["cpu"] if p["id"] == "r5-7500f")
    assert (cpu["price"], cpu["price_kind"], cpu["price_store"]) == (11990, "live", "Ситилинк")
    other = next(p for p in data["parts"]["cpu"] if p["id"] == "r5-5600")
    assert other["price_kind"] == "ref"
    assert data["static_site"] is True


def test_export_refuses_when_database_has_no_prices(db):
    import os
    r = run("tools/export_prices.py", "--out", str(db / "x.csv"), env={**os.environ, "VERSTAK_DB": str(db / "t.db")})
    assert r.returncode == 1 and not (db / "x.csv").exists()


def test_template_command_does_not_overwrite_existing_file(tmp_path):
    f = tmp_path / "p.csv"
    f.write_text("мои цены")
    assert run("tools/export_prices.py", "--template", "--out", str(f)).returncode == 1
    assert f.read_text() == "мои цены"
    assert run("tools/export_prices.py", "--template", "--out", str(f), "--force").returncode == 0
    assert f.read_text(encoding="utf-8-sig").startswith("part_id;price;")


# ───────── сборка сайта ─────────

@pytest.fixture(scope="module")
def site(tmp_path_factory):
    out = tmp_path_factory.mktemp("s") / "site"
    r = run("tools/build_static.py", "--out", str(out), "--prices", str(out.parent / "none.csv"))
    assert r.returncode == 0, r.stderr
    return out


def test_site_is_self_contained_and_works_from_a_subfolder(site):
    html = (site / "index.html").read_text(encoding="utf-8")
    assert not re.search(r'(?:src|href)="/(?!/)', html)                  # нет путей от корня
    for f in re.findall(r'<script src="(vendor/[^"]+)"', html):
        assert (site / f).is_file()
    assert 'src="https://cdn' not in html                                  # three.js лежит рядом, а не на чужом CDN
    assert (site / ".nojekyll").exists()
    assert not list(site.rglob("*.db")) and not list(site.rglob("*token*"))  # админка и секреты не попадают на сайт


def test_single_file_build_uses_cdn_and_has_no_share_flag(tmp_path):
    f = tmp_path / "demo.html"
    r = run("tools/build_static.py", "--single", str(f), "--prices", str(tmp_path / "none.csv"))
    assert r.returncode == 0, r.stderr
    html = f.read_text(encoding="utf-8")
    assert "cdnjs.cloudflare.com/ajax/libs/three.js/r128" in html
    data = json.loads(re.search(r"window\.VS_DEMO_CATALOG = (\{.*?\});\n", html, re.S).group(1).replace("<\\/", "</"))
    assert "static_site" not in data                                       # в демо-странице кнопки «Поделиться» нет
