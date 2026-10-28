/**
 * @jest-environment node
 */
const Core = require('../src/js/food-core.js');

const kwark = {
  id: 'off:8718452000001', source: 'off', name: 'Magere kwark', brand: 'Jumbo', barcode: '8718452000001', basis: 'g',
  per100: { kcal: 53, protein: 9, carbs: 4, fat: 0.1, sodiumMg: 40 },
  servings: [{ label: '1 bakje (500g)', grams: 500 }],
};

describe('scaleNutrients', () => {
  test('scales per 100 g and rounds', () => {
    expect(Core.scaleNutrients(kwark.per100, 250)).toEqual({ kcal: 133, protein: 22.5, carbs: 10, fat: 0.3, sodiumMg: 100 });
  });
  test('missing nutrients stay missing (not 0)', () => {
    const n = Core.scaleNutrients(kwark.per100, 100);
    expect(n.fiber).toBeUndefined();
    expect(n.ironMg).toBeUndefined();
  });
  test('bad grams give nothing', () => {
    expect(Core.scaleNutrients(kwark.per100, 'abc')).toEqual({});
    expect(Core.scaleNutrients(null, 100)).toEqual({});
  });
});

describe('gramsFor', () => {
  test('grams and ml pass through', () => {
    expect(Core.gramsFor(kwark, 150, 'g')).toBe(150);
    expect(Core.gramsFor(kwark, 200, 'ml')).toBe(200);
  });
  test('serving label multiplies by its grams', () => {
    expect(Core.gramsFor(kwark, 0.5, '1 bakje (500g)')).toBe(250);
  });
  test('zero / negative / empty is 0', () => {
    expect(Core.gramsFor(kwark, 0, 'g')).toBe(0);
    expect(Core.gramsFor(kwark, -5, 'g')).toBe(0);
    expect(Core.gramsFor(kwark, '', 'g')).toBe(0);
  });
});

describe('normalizeFood', () => {
  test('keeps known fields only', () => {
    const f = Core.normalizeFood({ ...kwark, evil: '<script>', per100: { ...kwark.per100, bogus: 5 } });
    expect(f.evil).toBeUndefined();
    expect(f.per100.bogus).toBeUndefined();
    expect(f.servings).toHaveLength(1);
  });
  test('rejects food without core numbers', () => {
    expect(Core.normalizeFood({ id: 'x', per100: { kcal: 10 } })).toBeNull();
  });
  test('unknown source falls back to usda, basis to g', () => {
    const f = Core.normalizeFood({ ...kwark, source: 'weird', basis: 'oz' });
    expect(f.source).toBe('usda');
    expect(f.basis).toBe('g');
  });
});

describe('local search', () => {
  test('every typed word must start a word of name or brand', () => {
    expect(Core.matchesQuery(kwark, 'mag kw')).toBe(true);
    expect(Core.matchesQuery(kwark, 'jumbo kwark')).toBe(true);
    expect(Core.matchesQuery(kwark, 'kwark volle')).toBe(false);
  });
  test('accents are ignored', () => {
    expect(Core.matchesQuery({ name: 'Crème fraîche', brand: '' }, 'creme')).toBe(true);
  });
  test('addRecent puts newest first, once, capped', () => {
    let list = [];
    for (let i = 0; i < 70; i++) list = Core.addRecent(list, { ...kwark, id: `off:${i}` }, i);
    list = Core.addRecent(list, { ...kwark, id: 'off:5' }, 100);
    expect(list).toHaveLength(60);
    expect(list[0].id).toBe('off:5');
    expect(list.filter(f => f.id === 'off:5')).toHaveLength(1);
  });
  test('mergeResults: local first, dedupe by id and barcode', () => {
    const remote = [{ ...kwark }, { ...kwark, id: 'usda:1', barcode: kwark.barcode }, { ...kwark, id: 'usda:2', barcode: undefined }];
    const mine = { ...kwark, id: 'custom:1', source: 'custom', barcode: undefined };
    const out = Core.mergeResults([[mine], [kwark]], remote, 10);
    expect(out.map(f => f.id)).toEqual(['custom:1', kwark.id, 'usda:2']);
  });
});

test('source labels', () => {
  expect(Core.sourceLabel('off')).toBe('OFF');
  expect(Core.sourceLabel('usda')).toBe('USDA');
  expect(Core.sourceLabel('custom')).toBe('Custom');
});

describe('food log entries', () => {
  const entry = Core.makeEntry(kwark, { grams: 250, amount: 0.5, unit: '1 bakje (500g)', date: '2026-10-28', meal: 'breakfast', now: 1, rand: 'abc' });

  test('makeEntry: id, meal, scaled nutrients, food kept for editing', () => {
    expect(entry.id).toBe('2026-10-28-abc');
    expect(entry.meal).toBe('breakfast');
    expect(entry).toMatchObject({ kcal: 133, protein: 22.5, carbs: 10, fat: 0.3, sodiumMg: 100, grams: 250, amount: 0.5, source: 'off', ref: kwark.id });
    expect(entry.per100.kcal).toBe(53);
    expect(entry.ironMg).toBeUndefined();
  });

  test('makeEntry: unknown meal becomes snacks', () => {
    expect(Core.makeEntry(kwark, { grams: 100, date: '2026-10-28', meal: 'brunch', now: 1 }).meal).toBe('snacks');
  });

  test('progressDelta: add then remove leaves the day unchanged', () => {
    const add = Core.progressDelta(entry, 1);
    const sub = Core.progressDelta(entry, -1);
    expect(add).toEqual({ protein: 23, carbs: 10, fats: 0, cals: 133 - (23 * 4 + 10 * 4) });
    for (const k of Object.keys(add)) expect(add[k] + sub[k]).toBe(0);
    // Whole-gram macros plus direct cals add up to the food's kcal.
    expect(add.protein * 4 + add.carbs * 4 + add.fats * 9 + add.cals).toBe(entry.kcal);
  });

  test('foodFromEntry rebuilds the food (also for old entries without per100)', () => {
    expect(Core.foodFromEntry(entry).per100.kcal).toBe(53);
    const old = { id: 'x', name: 'Rice', source: 'usda', grams: 200, kcal: 260, protein: 5, carbs: 56, fat: 0.6 };
    expect(Core.foodFromEntry(old).per100).toMatchObject({ kcal: 130, protein: 2.5, carbs: 28, fat: 0.3 });
  });

  test('totals counts entries missing a nutrient', () => {
    const t = Core.totals([entry, { kcal: 100, protein: 1, carbs: 2, fat: 3 }]);
    expect(t).toMatchObject({ kcal: 233, protein: 23.5, sodiumMg: 100 });
    expect(t.missing.sodiumMg).toBe(1);
  });

  test('groupByMeal orders meals and entries', () => {
    const g = Core.groupByMeal([{ meal: 'dinner', t: 2 }, { meal: 'weird', t: 1 }, { meal: 'dinner', t: 1 }]);
    expect(g.dinner.map(e => e.t)).toEqual([1, 2]);
    expect(g.snacks).toHaveLength(1);
  });

  test('trimLog keeps the last 90 days', () => {
    const log = [{ date: '2026-07-29' }, { date: '2026-07-30' }, { date: '2026-10-28' }, { foo: 1 }];
    expect(Core.trimLog(log, '2026-10-28').map(e => e.date)).toEqual(['2026-07-30', '2026-10-28']);
  });

  test('mealForHour', () => {
    expect([7, 12, 16, 19, 23].map(Core.mealForHour)).toEqual(['breakfast', 'lunch', 'snacks', 'dinner', 'snacks']);
  });

  test('migrateOldDiary: same ids every time, distinct per entry', () => {
    const old = { '2026-10-01': [{ name: 'A', kcal: 10, protein: 1, carbs: 1, fat: 0, t: 1 }, { name: 'A', kcal: 10, protein: 1, carbs: 1, fat: 0, t: 1 }], bad: 'x' };
    const a = Core.migrateOldDiary(old);
    const b = Core.migrateOldDiary(old);
    expect(a).toHaveLength(2);
    expect(a.map(e => e.id)).toEqual(b.map(e => e.id));
    expect(new Set(a.map(e => e.id)).size).toBe(2);
    expect(Core.migrateOldDiary([])).toEqual([]);
  });
});

describe('CSV', () => {
  test('quotes and defuses formulas', () => {
    expect(Core.csvCell('a,b')).toBe('"a,b"');
    expect(Core.csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(Core.csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(Core.csvCell('-5')).toBe('-5');
    expect(Core.csvCell('@sum')).toBe("'@sum");
  });
  test('food log rows: header + one row per entry, missing nutrient empty', () => {
    const rows = Core.foodLogRows([{ date: '2026-10-28', meal: 'lunch', name: 'Kip', kcal: 100, protein: 20, carbs: 0, fat: 2, source: 'off' }]);
    expect(rows[0].slice(0, 3)).toEqual(['Date', 'Meal', 'Food']);
    expect(rows[1].slice(0, 3)).toEqual(['2026-10-28', 'Lunch', 'Kip']);
    expect(rows[1][rows[0].indexOf('Iron (mg)')]).toBe('');
  });
});
