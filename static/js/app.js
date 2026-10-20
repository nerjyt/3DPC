/* Верстак: интерфейс. Каталог и цены приходят с сервера (/api/catalog), правила совместимости считаются тут же в браузере.
   Если сервера нет (демо-версия одним файлом), каталог берётся из window.VS_DEMO_CATALOG. */
(async function () {
'use strict';
const VS = window.VS = window.VS || {};
const $ = s => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rub = n => n.toLocaleString('ru-RU') + ' ₽';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; if (m === 1 && h !== 11) return a; if (m >= 2 && m <= 4 && (h < 12 || h > 14)) return b; return c; };
const fmtDate = iso => { try {
  if (/T00:00:00Z$/.test(iso)) return new Date(iso).toLocaleDateString('ru-RU', {day:'numeric', month:'short', timeZone:'UTC'});   // цену записали с датой без времени
  return new Date(iso).toLocaleString('ru-RU', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}); } catch (e) { return ''; } };
const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null;

/* ───────── Каталог ───────── */
let DEMO = false;
async function fetchCatalog() {
  const r = await fetch('/api/catalog', {headers: {accept: 'application/json'}});
  if (!r.ok) throw new Error('catalog ' + r.status);
  return r.json();
}
let CAT;
try {
  if (window.VS_DEMO_CATALOG) { CAT = window.VS_DEMO_CATALOG; DEMO = true; }
  else CAT = await fetchCatalog();
} catch (e) {
  $('#stageMsg').textContent = 'Не удалось загрузить каталог. Если запускаешь локально, проверь, что сервер работает: python run.py';
  return;
}
const CATS = CAT.categories, PARTS = CAT.parts, PRESETS = CAT.presets, RGB_OPTS = CAT.rgb, TIERS = CAT.tiers;
const STATIC_SITE = DEMO && !!CAT.static_site;   // сайт на бесплатном хостинге: без сервера, цены лежат в самой странице
const CAT_NAME = Object.fromEntries(CATS.map(c => [c.id, c.name]));
const byId = (cat, id) => PARTS[cat].find(p => p.id === id) || PARTS[cat][0];
const DEFAULT = PRESETS.find(p => p.id === 'game') || PRESETS[0];

/* ───────── Состояние ───────── */
const KEY = 'verstak-build-v2';
const S = {sel: {...DEFAULT.sel}, color: 'black', rgb: '#ff7a2f', glass: true, explode: false, spin: !reduceMotion,
           labels: false, inspect: null, open: null, preset: DEFAULT.id};
function applySaved(saved) {
  if (!saved || !saved.sel) return;
  for (const c of CATS) if (saved.sel[c.id] && PARTS[c.id].some(p => p.id === saved.sel[c.id])) S.sel[c.id] = saved.sel[c.id];
  if (saved.color === 'white' || saved.color === 'black') S.color = saved.color;
  if (RGB_OPTS.some(o => o.v === saved.rgb)) S.rgb = saved.rgb;
  S.preset = saved.preset || null;
}
try { applySaved(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({sel: S.sel, color: S.color, rgb: S.rgb, preset: S.preset})); } catch (e) {} };
const build = (sel = S.sel) => { const b = {}; for (const c of CATS) b[c.id] = byId(c.id, sel[c.id]); return b; };
const totalOf = b => CATS.reduce((s, c) => s + b[c.id].price, 0);

// сборка по ссылке вида /?build=abc (с сервером) или /?b=корпус.cpu.плата...&c=white&r=%23ff7a2f (статический сайт: всё в самой ссылке)
if (STATIC_SITE) {
  const q = new URLSearchParams(location.search), ids = (q.get('b') || '').split('.');
  if (ids.length === CATS.length && CATS.every((c, i) => PARTS[c.id].some(p => p.id === ids[i]))) {
    applySaved({sel: Object.fromEntries(CATS.map((c, i) => [c.id, ids[i]])), color: q.get('c'), rgb: q.get('r')});
    S.preset = null;
  }
}
if (!DEMO) {
  const id = new URLSearchParams(location.search).get('build');
  if (id && /^[\w-]{3,32}$/.test(id)) {
    try {
      const r = await fetch('/api/builds/' + encodeURIComponent(id));
      if (r.ok) { const d = await r.json(); applySaved({sel: d.sel, color: d.color, rgb: d.rgb}); S.preset = null; }
    } catch (e) {}
  }
}

/* ───────── Совместимость ───────── */
const {evaluate, draw} = VS.rules;
function optionConflict(cat, opt) {
  const e = evaluate(build({...S.sel, [cat]: opt.id})).find(i => i.level === 'error' && i.parts.includes(cat));
  return e ? e.text : null;
}

/* ───────── Панель ───────── */
const presetsEl = $('#presets');
for (const p of PRESETS) {
  const bt = document.createElement('button');
  bt.className = 'chip'; bt.textContent = p.label; bt.dataset.preset = p.id;
  presetsEl.appendChild(bt);
}
presetsEl.addEventListener('click', e => {
  const bt = e.target.closest('[data-preset]'); if (!bt) return;
  const p = PRESETS.find(x => x.id === bt.dataset.preset);
  S.sel = {...p.sel}; S.color = p.color; S.preset = p.id; S.open = null;
  changed(true);
});

const rgbEl = $('#rgb');
for (const o of RGB_OPTS) {
  const bt = document.createElement('button');
  bt.className = 'sw'; bt.dataset.v = o.v; bt.title = o.name; bt.setAttribute('aria-label', o.name);
  if (o.v.startsWith('#')) bt.style.setProperty('--c', o.v);
  rgbEl.appendChild(bt);
}
rgbEl.addEventListener('click', e => {
  const bt = e.target.closest('.sw'); if (!bt) return;
  S.rgb = bt.dataset.v; save(); syncRgb(); if (R) R.applyRgb();
});
const syncRgb = () => rgbEl.querySelectorAll('.sw').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.rgb)));

const chevron = '<svg class="chev" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 8l5 5 5-5"/></svg>';
let shownTotal = 0, totalAnim = 0;

function priceNote(p) {
  if (!p.price) return '';
  if (p.price_kind === 'live') return `Цена из магазина «${p.price_store}», обновлено ${fmtDate(p.price_updated)}`;
  return DEMO ? 'Ориентировочная цена' : 'Ориентир: свежей цены из магазина пока нет';
}
function buyBlock(p) {
  if (!p.buy || !p.buy.length) return '';
  const links = p.buy.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.store)}</a>`).join('');
  const src = p.price_kind === 'live' && safeUrl(p.price_url)
    ? `<a class="buy-src" href="${esc(safeUrl(p.price_url))}" target="_blank" rel="noopener noreferrer">страница с этой ценой</a>` : '';
  return `<div class="buy"><span class="eyebrow">Где купить</span>${links}${src}</div>`;
}

function render() {
  const b = build();
  const issues = evaluate(b);
  const errors = issues.filter(i => i.level === 'error'), warns = issues.filter(i => i.level === 'warn');

  animateTotal(totalOf(b));
  const st = $('#status');
  if (errors.length) { st.dataset.level = 'error'; st.textContent = `${errors.length} ${plural(errors.length, 'конфликт', 'конфликта', 'конфликтов')}`; }
  else if (warns.length) { st.dataset.level = 'warn'; st.textContent = `${warns.length} ${plural(warns.length, 'замечание', 'замечания', 'замечаний')}`; }
  else { st.dataset.level = 'ok'; st.textContent = 'Всё совместимо'; }

  const w = draw(b), load = w / b.psu.watt;
  $('#powerTxt').textContent = `≈ ${w} Вт из ${b.psu.watt} Вт · ${Math.round(load * 100)}%`;
  const bar = $('#powerBar');
  bar.style.width = Math.min(100, load * 100) + '%';
  bar.style.background = load > 1 ? 'var(--bad)' : load > 0.8 ? 'var(--warn)' : 'var(--ok)';
  $('#tierTxt').textContent = b.gpu.id === 'none' ? (b.cpu.igpu ? TIERS[0] : 'Нужна видеокарта') : TIERS[b.gpu.tier];
  $('#specTxt').textContent = [
    `${b.cpu.cores}/${b.cpu.threads}`, `${b.ram.size} ГБ ${b.ram.type}`,
    b.gpu.id === 'none' ? 'без видеокарты' : `${b.gpu.vram} ГБ видео`, `${b.ssd.cap} SSD`
  ].join(' · ');

  const priced = CATS.map(c => b[c.id]).filter(p => p.price);
  const live = priced.filter(p => p.price_kind === 'live');
  const stamps = live.map(p => p.price_updated).filter(Boolean).sort();
  $('#priceTxt').innerHTML = DEMO && !STATIC_SITE ? 'Ориентировочные. Живые цены работают в версии с сервером.'
    : live.length ? `${live.length} из ${priced.length} из магазинов${stamps.length ? `<small>обновлено ${fmtDate(stamps[stamps.length - 1])}</small>` : ''}`
    : STATIC_SITE ? 'Ориентировочные, цены из магазинов пока не загружены' : 'Ориентировочные, магазины ещё не опрошены';

  const order = {error: 0, warn: 1, info: 2}, tag = {error: 'Конфликт', warn: 'Внимание', info: 'Совет'};
  $('#issues').innerHTML = issues.slice().sort((a, c) => order[a.level] - order[c.level])
    .map(i => `<li class="issue" data-level="${i.level}"><span class="tag">${tag[i.level]}</span><p>${esc(i.text)}</p></li>`).join('');

  const catLevel = {};
  for (const i of issues) if (i.level !== 'info') for (const p of i.parts) if (catLevel[p] !== 'error') catLevel[p] = i.level;
  const f = document.activeElement;
  const fKey = f && f.dataset ? (f.dataset.id ? `opt:${f.dataset.cat}:${f.dataset.id}` : f.dataset.head ? `head:${f.dataset.head}` : f.dataset.color ? `color:${f.dataset.color}` : null) : null;

  $('#cats').innerHTML = CATS.map(c => {
    const p = b[c.id], open = S.open === c.id;
    const name = c.id === 'case' ? `${p.name}, ${S.color === 'white' ? 'белый' : 'чёрный'}` : p.name;
    let opts = '';
    if (open) {
      const colors = c.id === 'case' ? `<div class="colors"><span class="eyebrow">Цвет</span>${['black', 'white'].map(v => `<button class="chip" data-color="${v}" aria-pressed="${S.color === v}">${v === 'black' ? 'Чёрный' : 'Белый'}</button>`).join('')}</div>` : '';
      opts = `<div class="opts" id="opts-${c.id}" role="radiogroup" aria-label="${esc(c.name)}">${colors}${PARTS[c.id].map(o => {
        const bad = optionConflict(c.id, o);
        const liveDot = o.price_kind === 'live' ? `<i class="dot-live" title="${esc(priceNote(o))}"></i>` : '';
        return `<button class="opt" role="radio" aria-checked="${o.id === p.id}" data-cat="${c.id}" data-id="${o.id}"${bad ? ' data-bad="true"' : ''}>
          <span class="radio"></span><span class="opt-name">${esc(o.name)}</span><span class="opt-price">${liveDot}${o.price ? rub(o.price) : '—'}</span>
          <span class="opt-spec">${esc(o.spec)}</span>${bad && o.id !== p.id ? `<span class="opt-warn">${esc(bad)}</span>` : ''}</button>`;
      }).join('')}${buyBlock(p)}</div>`;
    }
    const lvl = catLevel[c.id];
    const liveDot = p.price_kind === 'live' ? `<i class="dot-live" title="${esc(priceNote(p))}"></i>` : '';
    return `<section class="cat" data-open="${open}" id="cat-${c.id}">
      <button class="cat-head" data-head="${c.id}" aria-expanded="${open}" aria-controls="opts-${c.id}">
        <span class="cat-name eyebrow">${lvl ? `<span class="flag" data-level="${lvl}"></span>` : ''}${esc(c.name)}</span>
        <span class="cat-price">${liveDot}${p.price ? rub(p.price) : '—'}</span>
        <span class="cat-pick">${esc(name)}</span>${chevron}
      </button>${opts}</section>`;
  }).join('');

  if (fKey) {
    const [k, a, bb] = fKey.split(':');
    const el = k === 'opt' ? document.querySelector(`.opt[data-cat="${a}"][data-id="${bb}"]`) : k === 'head' ? document.querySelector(`[data-head="${a}"]`) : document.querySelector(`[data-color="${a}"]`);
    if (el) el.focus({preventScroll: true});
  }

  presetsEl.querySelectorAll('[data-preset]').forEach(bt => bt.setAttribute('aria-pressed', String(bt.dataset.preset === S.preset)));
  const [W, H, D] = b.case.dims;
  $('#plate').innerHTML = `<b>${esc(b.case.name)}</b><span>Г ${D} × Ш ${W} × В ${H} мм</span>`;
  return issues;
}
function animateTotal(to) {
  const from = shownTotal; cancelAnimationFrame(totalAnim);
  if (reduceMotion || from === to) { shownTotal = to; $('#total').textContent = rub(to); return; }
  const t0 = performance.now(), dur = 450;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    shownTotal = Math.round(from + (to - from) * e);
    $('#total').textContent = rub(shownTotal);
    if (k < 1) totalAnim = requestAnimationFrame(step);
  };
  totalAnim = requestAnimationFrame(step);
}

function openChanged() {
  render();
  if (R) { R.highlightOpen(); if (S.inspect && S.open) R.inspect(S.open); }
}
$('#cats').addEventListener('click', e => {
  const head = e.target.closest('[data-head]');
  if (head) { S.open = S.open === head.dataset.head ? null : head.dataset.head; openChanged(); return; }
  const color = e.target.closest('[data-color]');
  if (color) { S.color = color.dataset.color; S.preset = null; changed(); return; }
  const opt = e.target.closest('.opt');
  if (opt) { S.sel[opt.dataset.cat] = opt.dataset.id; S.preset = null; changed(); }
});
$('#cats').addEventListener('keydown', e => {
  const opt = e.target.closest('.opt'); if (!opt) return;
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const all = [...opt.parentElement.querySelectorAll('.opt')], i = all.indexOf(opt);
  all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus();
});

function changed(caseMaybeChanged) {
  save(); render();
  if (R) { R.rebuild(caseMaybeChanged); if (S.inspect) R.inspect(S.inspect); }
}

$('#reset').addEventListener('click', () => {
  S.sel = {...DEFAULT.sel}; S.color = 'black'; S.rgb = '#ff7a2f'; S.preset = DEFAULT.id; S.open = null;
  syncRgb(); changed(true); if (R) R.applyRgb(); toast('Вернул игровую сборку');
});

function showCopy(text, okMsg) {
  const box = $('#copybox');
  const fallback = () => { box.hidden = false; box.value = text; box.focus(); box.select(); toast('Выдели текст и скопируй вручную'); };
  try { navigator.clipboard.writeText(text).then(() => { box.hidden = true; toast(okMsg); }, fallback); } catch (e) { fallback(); }
}
$('#copy').addEventListener('click', () => {
  const b = build();
  const lines = CATS.map(c => `${c.name}: ${b[c.id].name}${c.id === 'case' ? (S.color === 'white' ? ' (белый)' : ' (чёрный)') : ''} — ${b[c.id].price ? rub(b[c.id].price) : '—'}`);
  showCopy(`Сборка ПК — ${rub(totalOf(b))}\n` + lines.join('\n'), 'Список скопирован');
});
const shareBtn = $('#share');
if (!DEMO) {
  shareBtn.hidden = false;
  shareBtn.addEventListener('click', async () => {
    shareBtn.disabled = true;
    try {
      const r = await fetch('/api/builds', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({sel: S.sel, color: S.color, rgb: S.rgb})});
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      showCopy(location.origin + d.url, 'Ссылка на сборку скопирована');
    } catch (e) { toast('Не получилось создать ссылку'); }
    shareBtn.disabled = false;
  });
}
if (STATIC_SITE) {
  shareBtn.hidden = false;
  shareBtn.addEventListener('click', () => {
    const q = new URLSearchParams({b: CATS.map(c => S.sel[c.id]).join('.'), c: S.color, r: S.rgb});
    showCopy(location.origin + location.pathname + '?' + q, 'Ссылка на сборку скопирована');
  });
}
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

/* ───────── Кнопки стенда ───────── */
const tGlass = $('#tGlass'), tExplode = $('#tExplode'), tSpin = $('#tSpin'), tLabels = $('#tLabels'), tInspect = $('#tInspect');
function syncTools() {
  tGlass.setAttribute('aria-pressed', String(S.glass));
  tExplode.setAttribute('aria-pressed', String(S.explode));
  tSpin.setAttribute('aria-pressed', String(S.spin));
  tLabels.setAttribute('aria-pressed', String(S.labels));
  tInspect.setAttribute('aria-pressed', String(!!S.inspect));
}
tGlass.addEventListener('click', () => { S.glass = !S.glass; syncTools(); });
tExplode.addEventListener('click', () => {
  S.explode = !S.explode;
  if (S.explode && S.inspect && R) R.exitInspect();
  syncTools(); if (R) R.fitAfterExplode();
});
tSpin.addEventListener('click', () => { S.spin = !S.spin; syncTools(); });
tLabels.addEventListener('click', () => { S.labels = !S.labels; syncTools(); if (R) R.setLabels(S.labels); });
tInspect.addEventListener('click', () => {
  if (!R) return;
  if (S.inspect) { R.exitInspect(); return; }
  if (S.explode) { S.explode = false; R.fitAfterExplode(); }
  if (!S.open) { S.open = 'cpu'; render(); R.highlightOpen(); }
  R.inspect(S.open);
});
$('#tView').addEventListener('click', () => { if (R) R.resetView(); });
$('#legendClose').addEventListener('click', () => { if (R) R.exitInspect(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && S.inspect && R) R.exitInspect(); });

/* ───────── Живое обновление цен ───────── */
async function refreshPrices() {
  if (DEMO || document.hidden) return;
  try {
    const fresh = await fetchCatalog();
    let changedAny = false;
    for (const cat of Object.keys(fresh.parts)) {
      for (const np of fresh.parts[cat]) {
        const old = PARTS[cat].find(p => p.id === np.id); if (!old) continue;
        if (old.price !== np.price || old.price_kind !== np.price_kind) changedAny = true;
        Object.assign(old, {price: np.price, price_kind: np.price_kind, price_store: np.price_store, price_updated: np.price_updated, price_url: np.price_url, buy: np.buy});
      }
    }
    if (changedAny) { render(); toast('Цены обновились'); }
  } catch (e) { /* без сети просто остаёмся на текущих */ }
}
if (!DEMO) {
  setInterval(refreshPrices, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPrices(); });
}

/* ───────── 3D и старт ───────── */
let R = null;
syncRgb(); syncTools(); render();
try {
  R = VS.createEngine({
    $, S, reduceMotion, build, evaluate, render: openChanged, toast, esc, CAT_NAME,
    onInspect(cat) { S.inspect = cat; syncTools(); },
  });
  $('#stageMsg').hidden = true;
  VS.engine = R;
} catch (e) {
  console.error(e);
  $('#stageMsg').textContent = e.message === 'lib'
    ? '3D-библиотека не загрузилась. Список деталей и проверка совместимости работают.'
    : 'Браузер не поддерживает WebGL. Список деталей и проверка совместимости работают.';
}
})();
