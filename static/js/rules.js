/* Правила совместимости. Это копия app/compat.py для мгновенной реакции страницы.
   Эталон на сервере; тест tests/test_parity.py сверяет оба варианта. Меняешь правило тут, меняй и там. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.VS = root.VS || {}).rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const radMax = c => Math.max(c.radTop, c.radFront);
  const draw = b => b.cpu.power + b.gpu.power + 65;

  function evaluate(b) {
    const I = [];
    const add = (level, parts, mark, text) => I.push({level, parts, mark, text});
    if (b.cpu.socket !== b.mb.socket)
      add('error', ['cpu','mb'], 'mb', `Сокет не совпадает: у процессора ${b.cpu.socket}, у платы ${b.mb.socket}.`);
    if (b.ram.type !== b.mb.ram)
      add('error', ['ram','mb'], 'ram', `Плата работает с ${b.mb.ram}, а выбрана память ${b.ram.type}.`);
    if (b.ram.sticks > b.mb.slots)
      add('error', ['ram','mb'], 'ram', `В комплекте ${b.ram.sticks} модуля памяти, а на плате ${b.mb.slots} слота.`);
    if (!b.case.forms.includes(b.mb.form))
      add('error', ['mb','case'], 'mb', `Плата ${b.mb.form} не встанет в ${b.case.name}: корпус берёт ${b.case.forms.join(' и ')}.`);
    if (b.case.psu === 'SFX' && b.psu.form !== 'SFX')
      add('error', ['psu','case'], 'psu', `${b.case.name} рассчитан на компактные блоки SFX, а выбран ATX.`);
    if (b.gpu.id !== 'none' && b.gpu.length > b.case.gpuMax)
      add('error', ['gpu','case'], 'gpu', `Видеокарта длиной ${b.gpu.length} мм не влезет: в корпусе максимум ${b.case.gpuMax} мм.`);
    if (b.cooler.type !== 'aio' && b.cooler.height > b.case.coolerMax)
      add('error', ['cooler','case'], 'cooler', `Кулер высотой ${b.cooler.height} мм упрётся в боковую панель: в корпусе максимум ${b.case.coolerMax} мм.`);
    if (b.cooler.type === 'aio' && b.cooler.rad > radMax(b.case))
      add('error', ['cooler','case'], 'cooler', `Радиатор ${b.cooler.rad} мм некуда поставить: ${b.case.name} берёт максимум ${radMax(b.case)} мм.`);
    if (b.gpu.id === 'none' && !b.cpu.igpu)
      add('error', ['gpu','cpu'], 'cpu', `Не будет изображения: у ${b.cpu.name} нет встроенной графики, нужна видеокарта.`);
    const w = draw(b), load = w / b.psu.watt, rec = Math.ceil(w * 1.4 / 50) * 50;
    if (load > 1) add('error', ['psu','gpu','cpu'], 'psu', `Блоку на ${b.psu.watt} Вт не хватит мощности: сборка берёт до ≈${w} Вт. Нужен от ${rec} Вт.`);
    else if (load > 0.8) add('warn', ['psu'], 'psu', `Блок питания загружен на ${Math.round(load * 100)}%. Для запаса лучше взять от ${rec} Вт.`);
    if (b.gpu.psuRec && b.psu.watt < b.gpu.psuRec && load <= 1)
      add('warn', ['psu','gpu'], 'psu', `Для ${b.gpu.label} производитель рекомендует блок питания от ${b.gpu.psuRec} Вт.`);
    if (b.cooler.tdp < b.cpu.power)
      add('warn', ['cooler','cpu'], 'cooler', `${b.cooler.name} рассеивает ≈${b.cooler.tdp} Вт, а ${b.cpu.name} под нагрузкой выдаёт до ${b.cpu.power} Вт. Процессор будет сбрасывать частоты.`);
    if (b.gpu.conn === '16-pin' && !b.psu.native16)
      add('info', ['psu','gpu'], null, `У ${b.gpu.label} разъём питания 12V-2x6. С этим блоком подключишь через переходник из комплекта карты.`);
    if (!b.case.fansIncluded)
      add('info', ['case'], null, `В ${b.case.name} нет вентиляторов в комплекте, на модели показаны рекомендуемые. Заложи около 6 000 ₽ на 4–6 штук.`);
    if (b.gpu.id !== 'none' && b.gpu.tier - b.cpu.tier >= 3)
      add('info', ['cpu','gpu'], null, `Процессор будет сдерживать ${b.gpu.label} в играх. Стоит взять CPU помощнее.`);
    if (b.gpu.id !== 'none' && b.cpu.tier - b.gpu.tier >= 3)
      add('info', ['cpu','gpu'], null, `Видеокарта заметно слабее процессора. Часть бюджета лучше перенести на неё.`);
    return I;
  }

  return {evaluate, draw, radMax};
});
