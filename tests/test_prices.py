import json

import httpx
import pytest

from app import prices
from app.prices import Fetcher, RobotsRules, parse_price, to_rub


# ───────── нормализация цены ─────────

@pytest.mark.parametrize("raw, want", [
    ("12 990", 12990), ("12 990", 12990), ("12990.00", 12990), ("12 990,50", 12991),
    ("12.990", 12990), ("12,990", 12990), ("12990 ₽", 12990), (12990, 12990), (12990.4, 12990),
    ("1 299 990", 1299990), ("от 8 990 руб.", 8990),
])
def test_to_rub_ok(raw, want):
    assert to_rub(raw) == want


@pytest.mark.parametrize("raw", [None, "", "нет в наличии", "0", "-5", True, "abc", float("nan"), "1e12"])
def test_to_rub_rejects(raw):
    assert to_rub(raw) is None


# ───────── разбор HTML ─────────

def ld(obj):
    return f'<html><head><script type="application/ld+json">{json.dumps(obj, ensure_ascii=False)}</script></head></html>'


def test_jsonld_product_offer():
    html = ld({"@context": "https://schema.org", "@type": "Product", "name": "X",
               "offers": {"@type": "Offer", "price": "13990", "priceCurrency": "RUB",
                          "availability": "https://schema.org/InStock"}})
    got = parse_price(html)
    assert (got.price, got.in_stock, got.via) == (13990, True, "json-ld")


def test_jsonld_graph_and_list_and_aggregate():
    html = ld({"@graph": [{"@type": "BreadcrumbList"},
                          {"@type": ["Product", "Thing"], "offers": [
                              {"@type": "Offer", "price": 15000, "priceCurrency": "RUB"},
                              {"@type": "Offer", "price": 14500, "priceCurrency": "RUB"}]}]})
    assert parse_price(html).price == 14500
    agg = ld({"@type": "Product", "offers": {"@type": "AggregateOffer", "lowPrice": "9 990", "priceCurrency": "RUB"}})
    assert parse_price(agg).price == 9990


def test_jsonld_skips_foreign_currency_and_out_of_stock_preferred_last():
    usd = ld({"@type": "Product", "offers": {"price": "199", "priceCurrency": "USD"}})
    assert parse_price(usd) is None
    mixed = ld({"@type": "Product", "offers": [
        {"price": 9000, "priceCurrency": "RUB", "availability": "OutOfStock"},
        {"price": 9500, "priceCurrency": "RUB", "availability": "InStock"}]})
    got = parse_price(mixed)
    assert got.price == 9500 and got.in_stock is True
    only_out = ld({"@type": "Product", "offers": {"price": 9000, "priceCurrency": "RUB", "availability": "SoldOut"}})
    got = parse_price(only_out)
    assert got.price == 9000 and got.in_stock is False


def test_broken_jsonld_falls_through_to_microdata():
    html = ('<script type="application/ld+json">{ not json </script>'
            '<div itemscope itemtype="https://schema.org/Product"><span itemprop="price" content="7490">7 490 ₽</span>'
            '<link itemprop="availability" href="https://schema.org/InStock"></div>')
    got = parse_price(html)
    assert (got.price, got.in_stock, got.via) == (7490, True, "microdata")


def test_microdata_text_price_and_meta_tags():
    assert parse_price('<span itemprop="price">12 345 ₽</span>').price == 12345
    meta = '<meta property="product:price:amount" content="23990"><meta property="product:price:currency" content="RUB">'
    assert (parse_price(meta).price, parse_price(meta).via) == (23990, "meta")
    og = '<meta property="og:price:amount" content="1500.00"><meta property="og:price:currency" content="EUR">'
    assert parse_price(og) is None


def test_no_price_and_garbage_html():
    assert parse_price("<html><body>Привет</body></html>") is None
    assert parse_price("<<<>>> <script") is None


# ───────── robots.txt ─────────

XCOM_LIKE = """
User-agent: *
Disallow: /*?
Disallow: /compare/
Allow: /*?erid*
Allow: /configurator/pc-configurator/
Disallow: /configurator/pc-configurator/configurations/*
"""


def test_robots_wildcards_and_longest_match():
    r = RobotsRules(XCOM_LIKE)
    assert r.allowed("/catalog/cpu/ryzen-7500f/")
    assert not r.allowed("/catalog/cpu/?page=2")
    assert r.allowed("/catalog/cpu/ryzen-7500f/?erid=abc")
    assert not r.allowed("/compare/12")
    assert r.allowed("/configurator/pc-configurator/")
    assert not r.allowed("/configurator/pc-configurator/configurations/55")


def test_robots_prefix_disallow_and_dollar():
    r = RobotsRules("User-agent: *\nDisallow: /item\nDisallow: /*.pdf$\n")
    assert not r.allowed("/item12345.html")
    assert not r.allowed("/files/price.pdf")
    assert r.allowed("/files/price.pdf?x=1")
    assert r.allowed("/catalog/")


def test_robots_picks_our_group_over_star_and_ignores_empty_disallow():
    text = ("User-agent: *\nDisallow: /\n\nUser-agent: VerstakPriceBot\nDisallow:\n\n"
            "User-agent: Googlebot\nDisallow: /private\n")
    assert RobotsRules(text).allowed("/anything")
    only_star = "User-agent: Yandex\nDisallow: /x\n\nUser-agent: Googlebot\nDisallow: /y\n"
    assert RobotsRules(only_star).allowed("/x")  # правила только для других ботов
    assert RobotsRules("").allowed("/")


def test_robots_allow_wins_ties():
    assert RobotsRules("User-agent: *\nDisallow: /a\nAllow: /a\n").allowed("/a")


# ───────── загрузчик (без сети: подставной транспорт) ─────────

PUBLIC = lambda host: ["93.184.216.34"]  # noqa: E731


def make_fetcher(handler, resolver=PUBLIC, sleeps=None, clock=None):
    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False,
                          headers={"User-Agent": prices.USER_AGENT})
    sleeps = sleeps if sleeps is not None else []
    t = {"now": 0.0}
    return Fetcher(client=client, resolver=resolver, sleep=lambda s: (sleeps.append(s), t.__setitem__("now", t["now"] + s)),
                   clock=clock or (lambda: t["now"]), min_delay=6.0), sleeps


PRODUCT = ld({"@type": "Product", "offers": {"price": "9990", "priceCurrency": "RUB"}})


def test_fetch_ok_and_sends_honest_user_agent():
    seen = []

    def handler(req):
        seen.append((req.url.path, req.headers["user-agent"]))
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /cart\n")
        return httpx.Response(200, text=PRODUCT, headers={"content-type": "text/html; charset=utf-8"})

    f, _ = make_fetcher(handler)
    res = f.fetch("https://shop.example/product/1")
    assert res.status == "ok" and parse_price(res.html).price == 9990
    assert all(ua.startswith("VerstakPriceBot/") and "Mozilla" not in ua for _, ua in seen)


def test_fetch_respects_robots_and_does_not_request_page():
    seen = []

    def handler(req):
        seen.append(req.url.path)
        return httpx.Response(200, text="User-agent: *\nDisallow: /item\n")

    f, _ = make_fetcher(handler)
    res = f.fetch("https://shop.example/item123")
    assert res.status == "robots"
    assert seen == ["/robots.txt"]


def test_fetch_waits_between_requests_to_same_host_and_caches_robots():
    calls = []

    def handler(req):
        calls.append(req.url.path)
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(200, text=PRODUCT)

    f, sleeps = make_fetcher(handler)
    f.fetch("https://shop.example/a")
    f.fetch("https://shop.example/b")
    assert calls.count("/robots.txt") == 1
    assert len(sleeps) >= 2 and all(abs(s - 6.0) < 1e-6 for s in sleeps)


@pytest.mark.parametrize("code", [401, 403, 429, 503])
def test_fetch_blocked_statuses_stop_without_retry(code):
    calls = []

    def handler(req):
        calls.append(req.url.path)
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(code, headers={"retry-after": "7200"}, text="no")

    f, _ = make_fetcher(handler)
    res = f.fetch("https://shop.example/p")
    assert res.status == "blocked" and res.http == code
    assert calls == ["/robots.txt", "/p"]
    assert res.retry_after == 7200


def test_fetch_robots_403_means_blocked_and_page_not_requested():
    calls = []

    def handler(req):
        calls.append(req.url.path)
        return httpx.Response(403)

    f, _ = make_fetcher(handler)
    assert f.fetch("https://shop.example/p").status == "blocked"
    assert calls == ["/robots.txt"]


def test_fetch_robots_5xx_is_conservative():
    calls = []

    def handler(req):
        calls.append(req.url.path)
        return httpx.Response(500)

    f, _ = make_fetcher(handler)
    assert f.fetch("https://shop.example/p").status == "error"
    assert calls == ["/robots.txt"]


def test_fetch_rejects_private_hosts_and_bad_schemes():
    def handler(req):  # не должен вызываться
        raise AssertionError("запрос не должен уйти")

    f, _ = make_fetcher(handler, resolver=lambda h: ["127.0.0.1"])
    assert f.fetch("http://localhost/admin").status == "badurl"
    f2, _ = make_fetcher(handler, resolver=lambda h: ["93.184.216.34", "10.0.0.5"])
    assert f2.fetch("https://sneaky.example/").status == "badurl"
    f3, _ = make_fetcher(handler)
    assert f3.fetch("file:///etc/passwd").status == "badurl"
    assert f3.fetch("ftp://shop.example/x").status == "badurl"


def test_fetch_redirect_to_private_address_is_rejected():
    def handler(req):
        if req.url.host == "shop.example":
            if req.url.path == "/robots.txt":
                return httpx.Response(404)
            return httpx.Response(302, headers={"location": "http://internal.example/secret"})
        raise AssertionError("до внутреннего хоста дойти не должны")

    f, _ = make_fetcher(handler, resolver=lambda h: ["10.1.2.3"] if h == "internal.example" else ["93.184.216.34"])
    assert f.fetch("https://shop.example/p").status == "badurl"


def test_fetch_follows_safe_redirect_and_limits_hops():
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        if req.url.path == "/old":
            return httpx.Response(301, headers={"location": "/new"})
        if req.url.path == "/new":
            return httpx.Response(200, text=PRODUCT, headers={"content-type": "text/html"})
        return httpx.Response(302, headers={"location": req.url.path + "x"})

    f, _ = make_fetcher(handler)
    assert f.fetch("https://shop.example/old").status == "ok"
    assert f.fetch("https://shop.example/loop").status == "error"


def test_decode_windows_1251_from_meta():
    page = ('<html><head><meta charset="windows-1251"></head><body><span itemprop="price">5 490</span> Видеокарта</body></html>'
            ).encode("cp1251")

    def handler(req):
        return httpx.Response(404) if req.url.path == "/robots.txt" else httpx.Response(
            200, content=page, headers={"content-type": "text/html"})

    f, _ = make_fetcher(handler)
    res = f.fetch("https://old-shop.example/p")
    assert res.status == "ok" and "Видеокарта" in res.html and parse_price(res.html).price == 5490
