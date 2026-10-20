"""Правила совместимости живут в двух местах: app/compat.py (эталон) и static/js/rules.js (мгновенная реакция страницы).
Тест прогоняет через оба варианта одни и те же сборки и требует побуквенно одинаковый результат."""
import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from app import catalog_data, compat

ROOT = Path(__file__).resolve().parent.parent
CATS = ["case", "cpu", "mb", "cooler", "ram", "gpu", "ssd", "psu"]

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="нужен Node.js для запуска rules.js")

JS_RUNNER = """
const rules = require(process.argv[1]);
let raw = ''; process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => { process.stdout.write(JSON.stringify(JSON.parse(raw).map(b => rules.evaluate(b)))); });
"""


def _run_js(builds: list[dict]) -> list[list[dict]]:
    out = subprocess.run(
        ["node", "-e", JS_RUNNER, str(ROOT / "static" / "js" / "rules.js")],
        input=json.dumps(builds), capture_output=True, text=True, timeout=120, check=True,
    )
    return json.loads(out.stdout)


def _build(sel: dict) -> dict:
    return {c: next(p for p in catalog_data.PARTS[c] if p["id"] == sel[c]) for c in CATS}


def _random_builds(n: int, seed: int = 7) -> list[dict]:
    rnd = random.Random(seed)
    return [{c: rnd.choice(catalog_data.PARTS[c]) for c in CATS} for _ in range(n)]


def test_parity_on_presets():
    builds = [_build(p["sel"]) for p in catalog_data.PRESETS]
    js = _run_js(builds)
    for b, res in zip(builds, js):
        assert res == compat.evaluate(b)


def test_parity_on_random_builds():
    builds = _random_builds(4000)
    js = _run_js(builds)
    py = [compat.evaluate(b) for b in builds]
    assert js == py
    # тест имеет смысл, только если в выборке встречаются все виды замечаний
    levels = {i["level"] for res in py for i in res}
    assert levels == {"error", "warn", "info"}
    texts = {i["text"][:18] for res in py for i in res}
    assert len(texts) >= 14


def test_parity_every_gpu_cpu_psu_pair():
    """Мощность и рекомендации по БП: все сочетания CPU × GPU × БП на одной нейтральной базе."""
    base = _build(catalog_data.PRESETS[1]["sel"])
    builds = []
    for cpu in catalog_data.PARTS["cpu"]:
        for gpu in catalog_data.PARTS["gpu"]:
            for psu in catalog_data.PARTS["psu"]:
                builds.append({**base, "cpu": cpu, "gpu": gpu, "psu": psu})
    assert _run_js(builds) == [compat.evaluate(b) for b in builds]


def test_parity_every_case_with_every_board_and_cooler():
    base = _build(catalog_data.PRESETS[1]["sel"])
    builds = [{**base, "case": c, "mb": m, "cooler": k}
              for c in catalog_data.PARTS["case"] for m in catalog_data.PARTS["mb"] for k in catalog_data.PARTS["cooler"]]
    assert _run_js(builds) == [compat.evaluate(b) for b in builds]
