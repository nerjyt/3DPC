"""Работа с каталогом: поиск деталей, описания, ссылки «где купить», выдача для API."""
from __future__ import annotations

from urllib.parse import quote

from . import catalog_data as D

CATEGORY_IDS = [c for c, _ in D.CATEGORIES]
CATEGORY_NAMES = dict(D.CATEGORIES)

# Обычные ссылки на поиск в магазинах. Это просто переходы для человека, ничего не собирается.
SEARCH_LINKS = [
    ("DNS", "https://www.dns-shop.ru/search/?q={q}"),
    ("Ситилинк", "https://www.citilink.ru/search/?text={q}"),
    ("Яндекс Маркет", "https://market.yandex.ru/search?text={q}"),
]

_BY_ID: dict[str, tuple[str, dict]] = {}
for _cat, _items in D.PARTS.items():
    for _p in _items:
        if _p["id"] in _BY_ID:
            raise RuntimeError(f"Повторяющийся id детали: {_p['id']}")
        _BY_ID[_p["id"]] = (_cat, _p)


def get_part(part_id: str) -> tuple[str, dict] | None:
    return _BY_ID.get(part_id)


def part_in(cat: str, part_id: str) -> dict | None:
    found = _BY_ID.get(part_id)
    return found[1] if found and found[0] == cat else None


def all_part_ids() -> list[str]:
    return list(_BY_ID)


def spec_line(cat: str, p: dict) -> str:
    """Короткое описание для списка выбора."""
    if cat == "case":
        return f"{' / '.join(p['forms'])} · видеокарта до {p['gpuMax']} мм · кулер до {p['coolerMax']} мм"
    if cat == "cpu":
        igpu = " · есть встроенная графика" if p["igpu"] else ""
        return f"{p['socket']} · {p['cores']} ядер / {p['threads']} потоков · {p['clock']}{igpu}"
    if cat == "mb":
        return f"{p['socket']} · {p['form']} · {p['ram']} · {p['slots']} слота памяти"
    if cat == "cooler":
        if p["type"] == "aio":
            return f"СЖО, радиатор {p['rad']} мм · до {p['tdp']} Вт"
        kind = "низкопрофильный" if p["type"] == "low" else ("двухбашенный" if p.get("towers") == 2 else "башня")
        return f"{kind}, {p['height']} мм · до {p['tdp']} Вт"
    if cat == "ram":
        return f"{p['type']} · {p['speed']}{' · RGB' if p['rgb'] else ''}"
    if cat == "gpu":
        if p["id"] == "none":
            return "изображение через встроенную графику процессора"
        return f"{p['vram']} ГБ · длина {p['length']} мм · до {p['power']} Вт"
    if cat == "ssd":
        return f"M.2 {p['iface']} · чтение до {p['speed']}"
    if cat == "psu":
        return f"{p['watt']} Вт · {p['cert']} · {p['form']}{' · модульный' if p['modular'] else ''}"
    return ""


def buy_links(p: dict) -> list[dict]:
    if p["id"] == "none":
        return []
    q = quote(p["name"])
    return [{"store": s, "url": u.format(q=q)} for s, u in SEARCH_LINKS]


def default_selection() -> dict[str, str]:
    return dict(D.PRESETS[1]["sel"])


def resolve_selection(sel: dict[str, str]) -> dict[str, dict]:
    """Проверяет выбор и возвращает {категория: деталь}. Бросает ValueError, если что-то не так."""
    if not isinstance(sel, dict):
        raise ValueError("Выбор должен быть словарём")
    extra = set(sel) - set(CATEGORY_IDS)
    if extra:
        raise ValueError(f"Неизвестные категории: {', '.join(sorted(extra))}")
    b: dict[str, dict] = {}
    for cat in CATEGORY_IDS:
        pid = sel.get(cat)
        if pid is None:
            raise ValueError(f"Не выбрана деталь в категории «{CATEGORY_NAMES[cat]}»")
        part = part_in(cat, pid)
        if part is None:
            raise ValueError(f"Нет такой детали: {cat}/{pid}")
        b[cat] = part
    return b


def catalog_payload(prices: dict[str, dict], generated_at: str | None = None) -> dict:
    """Каталог для фронтенда. prices — результат prices.effective_prices()."""
    parts: dict[str, list[dict]] = {}
    for cat, items in D.PARTS.items():
        out = []
        for p in items:
            q = dict(p)
            info = prices.get(p["id"])
            if info:
                q.update(price=info["price"], price_kind="live", price_store=info["store"],
                         price_updated=info["updated"], price_url=info.get("url"))
            else:
                q.update(price=p["ref_price"], price_kind="ref", price_store=None, price_updated=None, price_url=None)
            q["spec"] = spec_line(cat, p)
            q["buy"] = buy_links(p)
            out.append(q)
        parts[cat] = out
    return {
        "categories": [{"id": c, "name": n} for c, n in D.CATEGORIES],
        "parts": parts,
        "presets": D.PRESETS,
        "rgb": D.RGB_OPTIONS,
        "tiers": D.TIERS,
        "generated_at": generated_at,
    }
