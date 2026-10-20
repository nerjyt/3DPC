"""Сбор цен с российских магазинов.

Принципы, которые тут соблюдены намеренно:
  * Читаются только страницы товаров, ссылки на которые добавил владелец сайта (в админке).
  * Перед каждой страницей проверяется robots.txt магазина (с учётом * и $). Закрыто — не трогаем.
  * Запросы к одному магазину идут не чаще, чем раз в VERSTAK_MIN_DELAY секунд (по умолчанию 6).
  * Бот представляется честно: свой User-Agent с контактом. Подмены под браузер нет.
  * Если магазин отвечает 401/403/429/503 или показывает капчу, сборщик не обходит защиту:
    он делает паузу для всего магазина (часы или по Retry-After) и пишет статус «заблокировано».
  * Цены не из карточки (скидка по карте, другая модель, опечатка) отсеиваются проверкой на правдоподобие.
Если магазин запрещает автоматический сбор в своих условиях, используй ручной ввод или CSV (см. README).
"""
from __future__ import annotations

import csv
import io
import ipaddress
import json
import logging
import os
import re
import socket
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from typing import Callable, Iterable
from urllib.parse import urljoin, urlsplit

import httpx

from . import catalog
from .db import connect, init_db, now_iso, parse_iso

log = logging.getLogger("verstak.prices")

AGENT_TOKEN = "VerstakPriceBot"
# Заголовки HTTP только ASCII, поэтому контакт чистим от кириллицы и переводов строк.
CONTACT = re.sub(r"[^\x20-\x7e]", "", os.environ.get("VERSTAK_CONTACT", "")).strip() or "not-set"
USER_AGENT = f"{AGENT_TOKEN}/1.0 (personal PC configurator; contact: {CONTACT})"
MIN_DELAY = float(os.environ.get("VERSTAK_MIN_DELAY", "6"))
WEB_MAX_AGE = timedelta(hours=float(os.environ.get("VERSTAK_WEB_MAX_AGE_HOURS", "72")))
MANUAL_MAX_AGE = timedelta(days=30)
BLOCK_PAUSE = timedelta(hours=6)
ROBOTS_TTL = 24 * 3600
MAX_BYTES = 2_500_000
SANITY_LOW, SANITY_HIGH = 0.3, 3.0  # допустимый разброс относительно ориентировочной цены

STORE_NAMES = {
    "citilink.ru": "Ситилинк", "regard.ru": "Регард", "xcom-shop.ru": "XCOM", "nix.ru": "НИКС",
    "onlinetrade.ru": "ОнлайнТрейд", "dns-shop.ru": "DNS", "market.yandex.ru": "Яндекс Маркет",
    "ozon.ru": "Ozon", "wildberries.ru": "Wildberries", "kns.ru": "KNS", "e2e4online.ru": "e2e4",
}
CHALLENGE_MARKERS = ("captcha", "qrator", "ddos-guard", "just a moment", "access denied", "are you a robot",
                     "подтвердите, что вы не робот", "проверка безопасности")


# ───────────────────────── robots.txt ─────────────────────────

class RobotsRules:
    """Разбор robots.txt по правилам Google: самое длинное совпадение побеждает, при ничьей разрешено."""

    def __init__(self, text: str, agent: str = AGENT_TOKEN):
        groups: list[tuple[list[str], list[tuple[bool, str]]]] = []
        agents: list[str] = []
        rules: list[tuple[bool, str]] = []
        in_rules = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            field_, value = (x.strip() for x in line.split(":", 1))
            field_ = field_.lower()
            if field_ == "user-agent":
                if in_rules:
                    groups.append((agents, rules))
                    agents, rules, in_rules = [], [], False
                agents.append(value.lower())
            elif field_ in ("allow", "disallow"):
                in_rules = True
                if value:  # пустой Disallow ничего не запрещает
                    rules.append((field_ == "allow", value))
        if agents or rules:
            groups.append((agents, rules))

        mine = agent.lower()
        best: tuple[int, list[tuple[bool, str]]] | None = None
        star: list[tuple[bool, str]] | None = None
        for ags, rls in groups:
            for a in ags:
                if a == "*":
                    star = (star or []) + rls
                elif a and a in mine:
                    if best is None or len(a) > best[0]:
                        best = (len(a), rls)
        chosen = best[1] if best else (star or [])
        self._rules = [(allow, self._compile(p), len(p.rstrip("$"))) for allow, p in chosen]

    @staticmethod
    def _compile(pattern: str) -> re.Pattern:
        anchored = pattern.endswith("$")
        body = pattern[:-1] if anchored else pattern
        rx = "".join(".*" if ch == "*" else re.escape(ch) for ch in body)
        return re.compile(rx + (r"\Z" if anchored else ""))

    def allowed(self, path_and_query: str) -> bool:
        best_len, verdict = -1, True
        for allow, rx, ln in self._rules:
            if rx.match(path_and_query):
                if ln > best_len or (ln == best_len and allow):
                    best_len, verdict = ln, allow
        return verdict


# ───────────────────────── разбор цены из HTML ─────────────────────────

@dataclass
class Parsed:
    price: int
    in_stock: bool | None
    via: str


_THOUSANDS = re.compile(r"\d{1,3}([.,]\d{3})+")


def to_rub(value) -> int | None:
    """Приводит «12 990», «12990.00», «12 990,50 ₽», 12990.0 к целым рублям. Ничего правдоподобного — None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        d = Decimal(str(value))
    else:
        s = re.sub(r"[\s\u00a0\u202f\u2009]", "", str(value)).lower()
        s = re.sub(r"руб(\.|лей|ля|ль)?|р\.?|₽|rub|rur|от", "", s)
        if not re.fullmatch(r"[\d.,]+", s):  # знаки, буквы и экспоненты (1e12) не принимаем
            return None
        if _THOUSANDS.fullmatch(s):
            s = re.sub(r"[.,]", "", s)
        else:
            s = s.replace(",", ".")
        try:
            d = Decimal(s)
        except InvalidOperation:
            return None
    if not d.is_finite() or d <= 0 or d > 100_000_000:
        return None
    return int(d.quantize(Decimal(1), rounding="ROUND_HALF_UP"))


def _stock(value) -> bool | None:
    if not value:
        return None
    v = str(value).lower()
    if any(k in v for k in ("outofstock", "soldout", "discontinued", "out_of_stock", "preorder", "backorder")):
        return False
    if "instock" in v or "in_stock" in v or "limitedavailability" in v or v in ("true", "1", "yes"):
        return True
    return None


class _Scan(HTMLParser):
    """Один проход по HTML: JSON-LD, микроразметка, meta-теги."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jsonld: list[str] = []
        self.meta: dict[str, str] = {}
        self.micro_price: list[str] = []
        self.micro_stock: list[str] = []
        self._in_ld = False
        self._ld_buf: list[str] = []
        self._want_text: str | None = None

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "script" and "ld+json" in a.get("type", "").lower():
            self._in_ld, self._ld_buf = True, []
        elif tag == "meta":
            key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
            if key and "content" in a:
                self.meta.setdefault(key, a["content"])
                if key == "price":
                    self.micro_price.append(a["content"])
                elif key == "availability":
                    self.micro_stock.append(a["content"])
        else:
            prop = a.get("itemprop", "").lower()
            if prop in ("price", "lowprice"):
                if a.get("content"):
                    self.micro_price.append(a["content"])
                else:
                    self._want_text = "price"
            elif prop == "availability":
                val = a.get("content") or a.get("href")
                if val:
                    self.micro_stock.append(val)

    def handle_endtag(self, tag):
        if tag == "script" and self._in_ld:
            self.jsonld.append("".join(self._ld_buf))
            self._in_ld = False
        if tag != "script":
            self._want_text = None

    def handle_data(self, data):
        if self._in_ld:
            self._ld_buf.append(data)
        elif self._want_text == "price" and data.strip():
            self.micro_price.append(data)
            self._want_text = None


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _types(node: dict) -> set[str]:
    t = node.get("@type")
    return {str(x) for x in (t if isinstance(t, list) else [t])} if t else set()


def _offer_price(offer: dict):
    if offer.get("price") not in (None, ""):
        return offer["price"]
    if offer.get("lowPrice") not in (None, ""):
        return offer["lowPrice"]
    spec = offer.get("priceSpecification")
    for s in (spec if isinstance(spec, list) else [spec]):
        if isinstance(s, dict) and s.get("price") not in (None, ""):
            return s["price"]
    return None


def _from_jsonld(blocks: Iterable[str]) -> Parsed | None:
    for raw in blocks:
        try:
            data = json.loads(raw.strip())
        except (ValueError, TypeError):
            continue
        for node in _walk(data):
            if not _types(node) & {"Product", "ProductGroup", "IndividualProduct"}:
                continue
            offers = node.get("offers")
            found: list[tuple[int, bool | None]] = []
            for off in (offers if isinstance(offers, list) else [offers]):
                if not isinstance(off, dict):
                    continue
                cur = str(off.get("priceCurrency") or "RUB").upper()
                if cur not in ("RUB", "RUR"):
                    continue
                price = to_rub(_offer_price(off))
                if price:
                    found.append((price, _stock(off.get("availability"))))
            if found:
                avail = [f for f in found if f[1] is not False]
                pool = avail or found
                price = min(p for p, _ in pool)
                return Parsed(price, True if avail and any(s for _, s in avail) else (None if avail else False), "json-ld")
    return None


def parse_price(html: str) -> Parsed | None:
    """Достаёт цену товара из HTML. Берётся только цена главного товара страницы."""
    scan = _Scan()
    try:
        scan.feed(html)
        scan.close()
    except Exception:  # битый HTML не повод падать
        pass
    got = _from_jsonld(scan.jsonld)
    if got:
        return got
    stock = next((s for s in (_stock(x) for x in scan.micro_stock) if s is not None), None)
    for raw in scan.micro_price:
        price = to_rub(raw)
        if price:
            return Parsed(price, stock, "microdata")
    for key in ("product:price:amount", "og:price:amount"):
        price = to_rub(scan.meta.get(key))
        if price:
            cur = (scan.meta.get("product:price:currency") or scan.meta.get("og:price:currency") or "RUB").upper()
            if cur in ("RUB", "RUR"):
                return Parsed(price, _stock(scan.meta.get("product:availability") or scan.meta.get("og:availability")),
                              "meta")
    return None


# ───────────────────────── загрузка страниц ─────────────────────────

@dataclass
class FetchResult:
    status: str  # ok | robots | blocked | error | badurl
    html: str | None = None
    http: int | None = None
    error: str | None = None
    retry_after: int | None = None


_META_CHARSET = re.compile(rb"<meta[^>]+charset=[\"']?\s*([\w-]+)", re.I)


def _decode(body: bytes, resp: httpx.Response) -> str:
    """Декодирует ответ: сначала кодировка из заголовка, потом из <meta charset>, иначе UTF-8."""
    enc = resp.charset_encoding
    if not enc:
        m = _META_CHARSET.search(body[:4096])
        enc = m.group(1).decode("ascii", "ignore") if m else "utf-8"
    try:
        return body.decode(enc, "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


def _default_resolver(host: str) -> list[str]:
    return sorted({ai[4][0] for ai in socket.getaddrinfo(host, None)})


class Fetcher:
    def __init__(self, client: httpx.Client | None = None, resolver: Callable[[str], list[str]] | None = None,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic,
                 min_delay: float = MIN_DELAY):
        self.client = client or httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
                     "Accept-Language": "ru-RU,ru;q=0.9"},
            timeout=httpx.Timeout(15.0), follow_redirects=False)
        self.resolver = resolver or _default_resolver
        self.sleep, self.clock, self.min_delay = sleep, clock, min_delay
        self._last: dict[str, float] = {}
        self._robots: dict[str, tuple[float, RobotsRules | None, str | None]] = {}

    # --- защита от обращений во внутреннюю сеть
    def _host_problem(self, host: str) -> tuple[str, str] | None:
        """None, если хост публичный. Иначе (статус, объяснение)."""
        try:
            ips = self.resolver(host)
        except OSError:
            return "error", "Не удалось найти сайт: DNS не отвечает или адрес записан с ошибкой"
        if not ips or not all(ipaddress.ip_address(ip.split("%")[0]).is_global for ip in ips):
            return "badurl", "Адрес не ведёт на публичный сайт"
        return None

    def _wait(self, host: str) -> None:
        last = self._last.get(host)
        if last is not None:
            gap = self.min_delay - (self.clock() - last)
            if gap > 0:
                self.sleep(gap)
        self._last[host] = self.clock()

    def _get(self, url: str, limit: int = MAX_BYTES) -> tuple[httpx.Response, bytes]:
        with self.client.stream("GET", url) as resp:
            body = bytearray()
            for chunk in resp.iter_bytes():
                body += chunk
                if len(body) > limit:
                    break
            return resp, bytes(body[:limit])

    def _rules_for(self, parts) -> tuple[RobotsRules | None, str | None]:
        """(правила, статус_ошибки). Если ошибка не None, страницу трогать нельзя."""
        key = f"{parts.scheme}://{parts.netloc}"
        cached = self._robots.get(key)
        if cached and self.clock() - cached[0] < ROBOTS_TTL:
            return cached[1], cached[2]
        self._wait(parts.netloc)
        rules, err = None, None
        try:
            resp, body = self._get(f"{key}/robots.txt", 500_000)
            if resp.status_code == 200:
                rules = RobotsRules(_decode(body, resp))
            elif resp.status_code in (401, 403, 429):
                err = "blocked"
            elif 400 <= resp.status_code < 500:
                rules = RobotsRules("")  # файла нет — ограничений нет
            else:
                err = "error"
        except httpx.HTTPError:
            err = "error"
        self._robots[key] = (self.clock(), rules, err)
        return rules, err

    def fetch(self, url: str) -> FetchResult:
        for _ in range(5):  # не больше 4 переходов по редиректам
            parts = urlsplit(url)
            if parts.scheme not in ("http", "https") or not parts.hostname:
                return FetchResult("badurl", error="Ссылка должна начинаться с http:// или https://")
            problem = self._host_problem(parts.hostname)
            if problem:
                return FetchResult(problem[0], error=problem[1])
            rules, err = self._rules_for(parts)
            if err == "blocked":
                return FetchResult("blocked", error="Магазин не отдаёт даже robots.txt. Похоже, он блокирует ботов.")
            if err:
                return FetchResult("error", error="Не удалось прочитать robots.txt магазина. Страницу не запрашивали.")
            path = parts.path or "/"
            if parts.query:
                path += "?" + parts.query
            if rules and not rules.allowed(path):
                return FetchResult("robots", error="Магазин запретил роботам эту страницу в robots.txt.")
            self._wait(parts.netloc)
            try:
                resp, body = self._get(url)
            except httpx.HTTPError as exc:
                return FetchResult("error", error=f"Сетевая ошибка: {type(exc).__name__}")
            code = resp.status_code
            if code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                url = urljoin(url, resp.headers["location"])
                continue
            if code in (401, 403, 429, 451, 503):
                ra = resp.headers.get("retry-after", "")
                return FetchResult("blocked", http=code, retry_after=int(ra) if ra.isdigit() else None,
                                   error=f"Магазин ответил {code}. Сборщик не обходит защиту и сделает паузу.")
            if code in (404, 410):
                return FetchResult("error", http=code, error="Страница не найдена. Проверь ссылку.")
            if code != 200:
                return FetchResult("error", http=code, error=f"Неожиданный ответ магазина: {code}")
            ctype = resp.headers.get("content-type", "")
            if ctype and "html" not in ctype.lower():
                return FetchResult("error", http=code, error="Это не HTML-страница")
            return FetchResult("ok", html=_decode(body, resp), http=code)
        return FetchResult("error", error="Слишком много перенаправлений")


# ───────────────────────── хранение ─────────────────────────

def store_name(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    for dom, name in STORE_NAMES.items():
        if host == dom or host.endswith("." + dom):
            return name
    return host or "магазин"


def _ref_price(part_id: str) -> int:
    found = catalog.get_part(part_id)
    if not found:
        raise ValueError(f"Нет детали с id «{part_id}»")
    return found[1]["ref_price"]


def plausible(part_id: str, price: int) -> bool:
    ref = _ref_price(part_id)
    return ref * SANITY_LOW <= price <= ref * SANITY_HIGH


def add_web_source(conn, part_id: str, url: str, store: str | None = None) -> int:
    _ref_price(part_id)
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("Ссылка должна начинаться с http:// или https://")
    url = url.strip()
    try:
        cur = conn.execute("INSERT INTO sources (part_id, store, url, kind) VALUES (?, ?, ?, 'web')",
                           (part_id, store or store_name(url), url))
    except Exception as exc:
        if "UNIQUE" in str(exc):
            raise ValueError("Такая ссылка для этой детали уже добавлена") from exc
        raise
    return cur.lastrowid


def _insert_price(conn, source_id: int, price: int, in_stock: bool) -> None:
    conn.execute("INSERT INTO prices (source_id, price, in_stock, fetched_at) VALUES (?, ?, ?, ?)",
                 (source_id, price, 1 if in_stock else 0, now_iso()))


def set_manual_price(conn, part_id: str, price, store: str = "Вручную", kind: str = "manual",
                     url: str | None = None, in_stock: bool = True) -> int:
    value = to_rub(price)
    if not value:
        raise ValueError("Цена не распознана")
    if not plausible(part_id, value):
        ref = _ref_price(part_id)
        raise ValueError(f"Цена {value} ₽ слишком далека от ориентира {ref} ₽. Проверь число "
                         "или обнови ref_price в app/catalog_data.py")
    row = conn.execute("SELECT id FROM sources WHERE part_id = ? AND store = ? AND COALESCE(url, '') = ?",
                       (part_id, store, url or "")).fetchone()
    if row:
        sid = row["id"]
        conn.execute("UPDATE sources SET status = 'ok', last_checked = ?, last_error = NULL, kind = ? WHERE id = ?",
                     (now_iso(), kind, sid))
    else:
        sid = conn.execute("INSERT INTO sources (part_id, store, url, kind, status, last_checked) "
                           "VALUES (?, ?, ?, ?, 'ok', ?)", (part_id, store, url, kind, now_iso())).lastrowid
    _insert_price(conn, sid, value, in_stock)
    return sid


def import_csv(conn, text: str) -> dict:
    """CSV с колонками part_id;price;store[;url][;in_stock]. Разделитель ; , или табуляция."""
    first = text.lstrip("\ufeff").splitlines()[0] if text.strip() else ""
    delim = max(";\t,", key=first.count)
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")), delimiter=delim)
    reader.fieldnames = [(f or "").strip().lower() for f in (reader.fieldnames or [])]
    if not {"part_id", "price"} <= set(reader.fieldnames):
        raise ValueError("В первой строке нужны колонки part_id и price (и желательно store)")
    done, errors = 0, []
    for n, row in enumerate(reader, start=2):
        if not (row.get("price") or "").strip():
            continue  # строка из шаблона, цену ещё не вписали
        try:
            stock = (row.get("in_stock") or "1").strip().lower() not in ("0", "false", "нет", "no")
            set_manual_price(conn, (row.get("part_id") or "").strip(), row.get("price"),
                             store=(row.get("store") or "CSV").strip() or "CSV", kind="csv",
                             url=(row.get("url") or "").strip() or None, in_stock=stock)
            done += 1
        except ValueError as exc:
            errors.append(f"строка {n}: {exc}")
    return {"imported": done, "errors": errors}


def effective_prices(conn, now: datetime | None = None) -> dict[str, dict]:
    """Лучшая свежая цена для каждой детали: минимум среди магазинов, где товар в наличии."""
    now = now or datetime.now(timezone.utc)
    rows = conn.execute("""
        SELECT s.id, s.part_id, s.store, s.kind, s.status, s.url, p.price, p.in_stock, p.fetched_at
        FROM sources s
        JOIN prices p ON p.id = (SELECT id FROM prices WHERE source_id = s.id ORDER BY fetched_at DESC, id DESC LIMIT 1)
    """).fetchall()
    best: dict[str, dict] = {}
    for r in rows:
        if r["status"] in ("suspicious", "robots") or not r["in_stock"]:
            continue
        fetched = parse_iso(r["fetched_at"])
        limit = WEB_MAX_AGE if r["kind"] == "web" else MANUAL_MAX_AGE
        if not fetched or now - fetched > limit:
            continue
        cur = best.get(r["part_id"])
        if cur is None or r["price"] < cur["price"]:
            best[r["part_id"]] = {"price": r["price"], "store": r["store"], "updated": r["fetched_at"],
                                  "source_id": r["id"], "url": r["url"] if r["kind"] == "web" else None}
    return best


# ───────────────────────── обновление ─────────────────────────

def _looks_like_challenge(html: str) -> bool:
    low = html[:60_000].lower()
    return any(m in low for m in CHALLENGE_MARKERS)


def refresh_source(conn, fetcher: Fetcher, src) -> str:
    res = fetcher.fetch(src["url"])
    status, error = res.status, res.error
    if res.status == "ok":
        parsed = parse_price(res.html or "")
        if parsed is None:
            if _looks_like_challenge(res.html or ""):
                status, error = "blocked", "Вместо страницы товара показана проверка на робота."
            else:
                status, error = "no_price", "На странице не нашлась цена (нет JSON-LD, микроразметки и meta)."
        elif not plausible(src["part_id"], parsed.price):
            status = "suspicious"
            error = (f"Найдена цена {parsed.price} ₽, это слишком далеко от ориентира {_ref_price(src['part_id'])} ₽. "
                     "Скорее всего, ссылка ведёт на другой товар.")
        elif parsed.in_stock is False:
            _insert_price(conn, src["id"], parsed.price, False)
            status, error = "out_of_stock", "Нет в наличии"
        else:
            _insert_price(conn, src["id"], parsed.price, True)
            status, error = "ok", None
    blocked_until = None
    if status == "blocked":
        pause = timedelta(seconds=min(res.retry_after, 86400)) if res.retry_after else BLOCK_PAUSE
        blocked_until = (datetime.now(timezone.utc) + pause).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute("UPDATE sources SET status = ?, last_checked = ?, last_error = ?, blocked_until = COALESCE(?, blocked_until) "
                 "WHERE id = ?", (status, now_iso(), error, blocked_until, src["id"]))
    return status


def refresh_all(fetcher: Fetcher | None = None, part_id: str | None = None,
                progress: Callable[[str], None] | None = None) -> dict:
    """Проходит по всем web-источникам. Магазины чередуются, чтобы не ждать паузы впустую."""
    fetcher = fetcher or Fetcher()
    init_db()
    summary: dict[str, int] = {}
    with connect() as conn:
        now = datetime.now(timezone.utc)
        q = "SELECT * FROM sources WHERE kind = 'web'" + (" AND part_id = ?" if part_id else "") + " ORDER BY id"
        rows = conn.execute(q, (part_id,) if part_id else ()).fetchall()
        queues: dict[str, list] = {}
        for r in rows:
            until = parse_iso(r["blocked_until"])
            if until and until > now:
                summary["paused"] = summary.get("paused", 0) + 1
                continue
            queues.setdefault(urlsplit(r["url"]).netloc, []).append(r)
        while queues:
            for host in list(queues):
                src = queues[host].pop(0)
                st = refresh_source(conn, fetcher, src)
                conn.commit()
                summary[st] = summary.get(st, 0) + 1
                if progress:
                    progress(f"{src['store']} / {src['part_id']}: {st}")
                if st == "blocked":  # один отказ — пауза для всего магазина
                    rest = queues[host]
                    fresh = conn.execute("SELECT blocked_until FROM sources WHERE id = ?", (src["id"],)).fetchone()
                    for other in rest:
                        conn.execute("UPDATE sources SET blocked_until = ? WHERE id = ?",
                                     (fresh["blocked_until"], other["id"]))
                    summary["paused"] = summary.get("paused", 0) + len(rest)
                    queues[host] = []
                if not queues[host]:
                    del queues[host]
    return summary


@dataclass
class PriceUpdater:
    """Фоновое обновление раз в N часов. Запускается вместе с сервером."""
    interval_hours: float = float(os.environ.get("VERSTAK_REFRESH_HOURS", "12"))
    first_delay: float = 60.0
    state: dict = field(default_factory=lambda: {"running": False, "last_run": None, "last_summary": None})
    _stop: threading.Event = field(default_factory=threading.Event)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._loop, name="price-updater", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        if self._stop.wait(self.first_delay):
            return
        while True:
            self.run_once()
            if self._stop.wait(self.interval_hours * 3600):
                return

    def run_once(self, part_id: str | None = None) -> bool:
        if not self._lock.acquire(blocking=False):
            return False
        try:
            self.state["running"] = True
            summary = refresh_all(part_id=part_id)
            self.state.update(last_run=now_iso(), last_summary=summary)
            log.info("Обновление цен: %s", summary)
        except Exception:  # фоновая задача не должна умирать
            log.exception("Ошибка обновления цен")
            self.state["last_summary"] = {"error": 1}
        finally:
            self.state["running"] = False
            self._lock.release()
        return True

    def run_in_background(self, part_id: str | None = None) -> bool:
        if self._lock.locked():
            return False
        threading.Thread(target=self.run_once, args=(part_id,), daemon=True).start()
        return True


if __name__ == "__main__":  # python -m app.prices [id_детали]
    import sys
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    print(refresh_all(part_id=sys.argv[1] if len(sys.argv) > 1 else None, progress=print))
