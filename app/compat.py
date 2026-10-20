"""Проверка совместимости комплектующих.

Это эталон правил. Такие же правила (слово в слово) работают в браузере, в static/js/rules.js,
чтобы страница реагировала мгновенно. Тест tests/test_parity.py сверяет оба варианта на тысячах
случайных сборок, поэтому при изменении правил меняй оба файла.
"""
from __future__ import annotations

import math

Issue = dict  # {"level": "error"|"warn"|"info", "parts": [...], "mark": str|None, "text": str}


def rad_max(case: dict) -> int:
    return max(case["radTop"], case["radFront"])


def power_draw(b: dict) -> int:
    """Грубая оценка максимального потребления: процессор + видеокарта + 65 Вт на остальное."""
    return b["cpu"]["power"] + b["gpu"]["power"] + 65


def js_round(x: float) -> int:
    """Math.round из JavaScript (половинки округляются вверх), чтобы тексты совпадали."""
    return math.floor(x + 0.5)


def recommended_psu(watts: int) -> int:
    return math.ceil(watts * 1.4 / 50) * 50


def evaluate(b: dict) -> list[Issue]:
    """b — словарь {категория: деталь}. Возвращает список замечаний."""
    issues: list[Issue] = []

    def add(level: str, parts: list[str], mark: str | None, text: str) -> None:
        issues.append({"level": level, "parts": parts, "mark": mark, "text": text})

    case, cpu, mb, ram, gpu, cooler, psu = b["case"], b["cpu"], b["mb"], b["ram"], b["gpu"], b["cooler"], b["psu"]

    if cpu["socket"] != mb["socket"]:
        add("error", ["cpu", "mb"], "mb", f"Сокет не совпадает: у процессора {cpu['socket']}, у платы {mb['socket']}.")
    if ram["type"] != mb["ram"]:
        add("error", ["ram", "mb"], "ram", f"Плата работает с {mb['ram']}, а выбрана память {ram['type']}.")
    if ram["sticks"] > mb["slots"]:
        add("error", ["ram", "mb"], "ram", f"В комплекте {ram['sticks']} модуля памяти, а на плате {mb['slots']} слота.")
    if mb["form"] not in case["forms"]:
        add("error", ["mb", "case"], "mb",
            f"Плата {mb['form']} не встанет в {case['name']}: корпус берёт {' и '.join(case['forms'])}.")
    if case["psu"] == "SFX" and psu["form"] != "SFX":
        add("error", ["psu", "case"], "psu", f"{case['name']} рассчитан на компактные блоки SFX, а выбран ATX.")
    if gpu["id"] != "none" and gpu["length"] > case["gpuMax"]:
        add("error", ["gpu", "case"], "gpu",
            f"Видеокарта длиной {gpu['length']} мм не влезет: в корпусе максимум {case['gpuMax']} мм.")
    if cooler["type"] != "aio" and cooler["height"] > case["coolerMax"]:
        add("error", ["cooler", "case"], "cooler",
            f"Кулер высотой {cooler['height']} мм упрётся в боковую панель: в корпусе максимум {case['coolerMax']} мм.")
    if cooler["type"] == "aio" and cooler["rad"] > rad_max(case):
        add("error", ["cooler", "case"], "cooler",
            f"Радиатор {cooler['rad']} мм некуда поставить: {case['name']} берёт максимум {rad_max(case)} мм.")
    if gpu["id"] == "none" and not cpu["igpu"]:
        add("error", ["gpu", "cpu"], "cpu",
            f"Не будет изображения: у {cpu['name']} нет встроенной графики, нужна видеокарта.")

    w = power_draw(b)
    load = w / psu["watt"]
    rec = recommended_psu(w)
    if load > 1:
        add("error", ["psu", "gpu", "cpu"], "psu",
            f"Блоку на {psu['watt']} Вт не хватит мощности: сборка берёт до ≈{w} Вт. Нужен от {rec} Вт.")
    elif load > 0.8:
        add("warn", ["psu"], "psu",
            f"Блок питания загружен на {js_round(load * 100)}%. Для запаса лучше взять от {rec} Вт.")
    if gpu.get("psuRec") and psu["watt"] < gpu["psuRec"] and load <= 1:
        add("warn", ["psu", "gpu"], "psu",
            f"Для {gpu['label']} производитель рекомендует блок питания от {gpu['psuRec']} Вт.")
    if cooler["tdp"] < cpu["power"]:
        add("warn", ["cooler", "cpu"], "cooler",
            f"{cooler['name']} рассеивает ≈{cooler['tdp']} Вт, а {cpu['name']} под нагрузкой выдаёт до {cpu['power']} Вт. "
            "Процессор будет сбрасывать частоты.")
    if gpu.get("conn") == "16-pin" and not psu["native16"]:
        add("info", ["psu", "gpu"], None,
            f"У {gpu['label']} разъём питания 12V-2x6. С этим блоком подключишь через переходник из комплекта карты.")
    if not case["fansIncluded"]:
        add("info", ["case"], None,
            f"В {case['name']} нет вентиляторов в комплекте, на модели показаны рекомендуемые. "
            "Заложи около 6 000 ₽ на 4–6 штук.")
    if gpu["id"] != "none" and gpu["tier"] - cpu["tier"] >= 3:
        add("info", ["cpu", "gpu"], None, f"Процессор будет сдерживать {gpu['label']} в играх. Стоит взять CPU помощнее.")
    if gpu["id"] != "none" and cpu["tier"] - gpu["tier"] >= 3:
        add("info", ["cpu", "gpu"], None, "Видеокарта заметно слабее процессора. Часть бюджета лучше перенести на неё.")
    return issues


def gaming_tier_text(b: dict, tiers: list[str]) -> str:
    gpu, cpu = b["gpu"], b["cpu"]
    if gpu["id"] == "none":
        return tiers[0] if cpu["igpu"] else "Нужна видеокарта"
    return tiers[gpu["tier"]]
