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

describe('barcodes', () => {
  test('check digit', () => {
    expect(Core.validBarcode('8710400002970')).toBe(true);
    expect(Core.validBarcode('8710400002971')).toBe(false);
    expect(Core.validBarcode('012345678905')).toBe(true); // UPC-A
    expect(Core.validBarcode('96385074')).toBe(true);     // EAN-8
    expect(Core.validBarcode('123')).toBe(false);
  });
  test('UPC-A padded, spaces stripped', () => {
    expect(Core.normalizeBarcode('0 12345 67890 5')).toBe('0012345678905');
  });
  test('findByBarcode prefers the first list', () => {
    const mine = { id: 'custom:1', barcode: '8710400002970' };
    const recent = { id: 'off:8710400002970', barcode: '8710400002970' };
    expect(Core.findByBarcode([[mine], [recent]], '8710400002970').id).toBe('custom:1');
    expect(Core.findByBarcode([[], [recent]], '8710400002970').id).toBe('off:8710400002970');
    expect(Core.findByBarcode([[mine]], 'nope')).toBeNull();
  });
});

describe('custom foods', () => {
  test('per 100 g with optional nutrients left out when blank', () => {
    const { food } = Core.customFoodFromForm({ name: ' Oma’s stamppot ', kcal: '', protein: '4', carbs: '12', fat: '5', fiber: '', ironMg: '1.2',
      servings: [{ label: '1 bord', grams: '350' }, { label: '', grams: '10' }] }, { now: 5, rand: 'r1' });
    expect(food).toMatchObject({ id: 'custom:r1', source: 'custom', name: 'Oma’s stamppot', basis: 'g', updatedAt: 5 });
    expect(food.per100).toEqual({ kcal: 109, protein: 4, carbs: 12, fat: 5, ironMg: 1.2 });
    expect(food.servings).toEqual([{ label: '1 bord', grams: 350 }]);
  });
  test('editing keeps the id', () => {
    expect(Core.customFoodFromForm({ name: 'x', protein: 1 }, { id: 'custom:keep' }).food.id).toBe('custom:keep');
  });
  test('validation errors', () => {
    expect(Core.customFoodFromForm({ name: '' }).error).toMatch(/name/);
    expect(Core.customFoodFromForm({ name: 'x', protein: 60, carbs: 60 }).error).toMatch(/100 g/);
    expect(Core.customFoodFromForm({ name: 'x', protein: -1 }).error).toMatch(/negative/);
    expect(Core.customFoodFromForm({ name: 'x', kcal: 2000 }).error).toMatch(/950/);
    expect(Core.customFoodFromForm({ name: 'x', barcode: '12' }).error).toMatch(/barcode/);
  });
  test('barcode stored normalized', () => {
    expect(Core.customFoodFromForm({ name: 'x', barcode: '012345678905' }).food.barcode).toBe('0012345678905');
  });
});

test('amountLabel', () => {
  expect(Core.amountLabel({ amount: 250, unit: 'g' })).toBe('250 g');
  expect(Core.amountLabel({ amount: 1, unit: '1 bakje (500g)' })).toBe('1 × 1 bakje (500g)');
});

describe('editing and copying', () => {
  const e = Core.makeEntry(kwark, { grams: 250, amount: 250, unit: 'g', date: '2026-10-28', meal: 'breakfast', now: 1, rand: 'a' });
  test('editEntry rescales from per-100 data', () => {
    const x = Core.editEntry(e, { grams: 500, amount: 1, unit: '1 bakje (500g)', meal: 'snacks' });
    expect(x).toMatchObject({ id: e.id, kcal: 265, protein: 45, sodiumMg: 200, grams: 500, amount: 1, unit: '1 bakje (500g)', meal: 'snacks' });
  });
  test('editEntry with only a meal keeps the numbers', () => {
    expect(Core.editEntry(e, { meal: 'lunch' })).toMatchObject({ kcal: 133, meal: 'lunch' });
  });
  test('copyEntries: new ids, new date', () => {
    const c = Core.copyEntries([e, e], '2026-10-29', { now: 10, rand: 'z' });
    expect(c.map(x => x.date)).toEqual(['2026-10-29', '2026-10-29']);
    expect(new Set([e.id, ...c.map(x => x.id)]).size).toBe(3);
    expect(c[0].kcal).toBe(133);
  });
  test('saved meal round trip', () => {
    const tpl = Core.templateFromEntries('Ontbijt', [e], { now: 1, rand: 't' });
    expect(tpl).toMatchObject({ id: 'meal:t', name: 'Ontbijt' });
    const back = Core.entriesFromTemplate(tpl, { date: '2026-10-30', meal: 'breakfast', now: 5, rand: 'q' });
    expect(back[0]).toMatchObject({ date: '2026-10-30', meal: 'breakfast', kcal: 133, grams: 250, name: 'Magere kwark' });
    expect(Core.templateFromEntries('x', [])).toBeNull();
  });
});

describe('recipes', () => {
  const rice = { id: 'usda:1', source: 'usda', name: 'Rice', basis: 'g', per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 }, servings: [] };
  const chicken = { id: 'off:1', source: 'off', name: 'Kipfilet', basis: 'g', per100: { kcal: 105, protein: 23, carbs: 0, fat: 1.5 }, servings: [] };
  test('per 100 g and per serving from ingredients', () => {
    const r = Core.recipeFood({ name: 'Kip met rijst', servings: 2, ingredients: [{ food: rice, grams: 300 }, { food: chicken, grams: 300 }] }, { rand: 'r' });
    expect(r.food).toMatchObject({ id: 'custom:recipe-r', source: 'recipe', name: 'Kip met rijst' });
    expect(r.food.per100).toMatchObject({ kcal: 118, carbs: 14 });
    expect(Math.abs(r.food.per100.protein - 12.85)).toBeLessThanOrEqual(0.051);
    expect(r.food.servings[0].grams).toBe(300);
    expect(r.perServing).toMatchObject({ kcal: 353, carbs: 42 });
    expect(Math.abs(r.perServing.protein - 38.55)).toBeLessThanOrEqual(0.051);
    // Only rice lists fibre, so the recipe's fibre would be too low: left out.
    expect(r.food.per100.fiber).toBeUndefined();
    expect(r.food.recipe.ingredients).toHaveLength(2);
  });
  test('validation', () => {
    expect(Core.recipeFood({ name: '', servings: 1, ingredients: [{ food: rice, grams: 1 }] }).error).toMatch(/name/);
    expect(Core.recipeFood({ name: 'x', servings: 0, ingredients: [{ food: rice, grams: 1 }] }).error).toMatch(/servings/);
    expect(Core.recipeFood({ name: 'x', servings: 1, ingredients: [{ food: rice, grams: 0 }] }).error).toMatch(/ingredient/);
  });
  test('schema.org recipe on a page', () => {
    const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],"name":"Pasta pesto","recipeYield":["4","4 porties"],"recipeIngredient":["400 g pasta","1 pot pesto"],"nutrition":{"@type":"NutritionInformation","calories":"610 kcal","proteinContent":"18 g","carbohydrateContent":"75,5 g","fatContent":"25 g"}}]}</script></html>`;
    expect(Core.parseRecipeJsonLd(html)).toEqual({ name: 'Pasta pesto', servings: 4, perServing: { kcal: 610, protein: 18, carbs: 75.5, fat: 25, fiber: null, sugar: null }, ingredients: ['400 g pasta', '1 pot pesto'] });
    expect(Core.parseRecipeJsonLd('<html>no recipe</html>')).toBeNull();
    expect(Core.parseRecipeJsonLd('<script type="application/ld+json">{bad json</script>')).toBeNull();
  });
});

describe('data quality', () => {
  test('kcalCheck: matching label passes', () => {
    expect(Core.kcalCheck({ kcal: 435, protein: 5, carbs: 67, fat: 15 }).ok).toBe(true);
  });
  test('kcalCheck: EU fibre at 2 kcal/g passes', () => {
    expect(Core.kcalCheck({ kcal: 370, protein: 13, carbs: 59, fat: 7, fiber: 10 }).ok).toBe(true);
  });
  test('kcalCheck: more than 15 % off fails, with the expected value', () => {
    expect(Core.kcalCheck({ kcal: 467, protein: 3.3, carbs: 20, fat: 2 })).toEqual({ ok: false, expected: 111 });
  });
  test('kcalCheck: small values get a 10 kcal margin', () => {
    expect(Core.kcalCheck({ kcal: 12, protein: 0, carbs: 1, fat: 0 }).ok).toBe(true);
  });
  test('entries from a bad label are flagged; good ones are not', () => {
    const bad = { ...kwark, per100: { kcal: 300, protein: 9, carbs: 4, fat: 0.1 } };
    expect(Core.makeEntry(bad, { grams: 100, date: '2026-10-28', now: 1 }).flag).toBe('kcal_mismatch');
    expect(Core.makeEntry(kwark, { grams: 100, date: '2026-10-28', now: 1 }).flag).toBeUndefined();
  });
  test('coach foods keep their note and coach name, other sources do not', () => {
    const c = Core.normalizeFood({ ...kwark, id: 'coach:c1:x', source: 'coach', note: 'Mijn favoriet', coachUsername: 'arman' });
    expect(c).toMatchObject({ source: 'coach', note: 'Mijn favoriet', coachUsername: 'arman' });
    expect(Core.normalizeFood({ ...kwark, note: 'x', coachUsername: 'y' }).note).toBeUndefined();
  });
});

describe('fibre & micros', () => {
  const byKey = rows => Object.fromEntries(rows.map(r => [r.key, r]));
  test('no data is "nodata", never 0', () => {
    const r = byKey(Core.microSummary([{ kcal: 100, protein: 1, carbs: 1, fat: 1 }], 2000));
    expect(r.ironMg).toMatchObject({ status: 'nodata', total: null });
    expect(Core.microSummary([], 0).every(x => x.status === 'nodata')).toBe(true);
  });
  test('partial data is a minimum with a count', () => {
    const r = byKey(Core.microSummary([{ ironMg: 3 }, { kcal: 1 }, { ironMg: 2 }], 2000));
    expect(r.ironMg).toMatchObject({ status: 'partial', total: 5, missing: 1, of: 3, ref: 14 });
  });
  test('low / ok against an aim, high against a limit', () => {
    const r = byKey(Core.microSummary([{ fiber: 12, calciumMg: 900, sodiumMg: 3000 }], 2000));
    expect(r.fiber.status).toBe('low');
    expect(r.calciumMg.status).toBe('ok');
    expect(r.sodiumMg).toMatchObject({ status: 'high', percent: 125 });
  });
  test('sugar and sat fat limits follow the day\'s calories', () => {
    const r = byKey(Core.microSummary([{ sugar: 60, satFat: 10 }], 2000));
    expect(r.sugar).toMatchObject({ ref: 50, status: 'high' });
    expect(r.satFat).toMatchObject({ ref: 22, status: 'ok' });
  });
  test('without a target the limits use 2000 kcal', () => {
    expect(byKey(Core.microSummary([{ sugar: 10 }])).sugar.ref).toBe(50);
  });
  test('over a limit wins over missing data', () => {
    const r = byKey(Core.microSummary([{ sodiumMg: 2500 }, { kcal: 5 }], 2000));
    expect(r.sodiumMg.status).toBe('high');
  });
});

describe('weekly averages (coach export)', () => {
  const day = (date, kcal, onTarget) => ({ date, logged: kcal > 0, intake: kcal > 0 ? { kcal, protein: 150, carbs: 200, fat: 60 } : null, onTarget });
  test('groups by Monday-start week, averages logged days only', () => {
    // 2026-10-26 is a Monday.
    const rows = Core.weeklyAverages([day('2026-10-28', 2000, true), day('2026-10-27', 0, null), day('2026-10-26', 3000, false), day('2026-10-25', 2500, true)],
      { kcal: 2500, protein: 180, carbs: 280, fat: 70 });
    expect(rows[0][0]).toBe('Week starting');
    expect(rows.slice(1).map(r => r.slice(0, 3))).toEqual([['2026-10-19', '1/1', 2500], ['2026-10-26', '2/3', 2500]]);
    expect(rows[2][6]).toBe(1);
    expect(rows[2][7]).toBe(2500);
  });
  test('no target leaves the target columns empty', () => {
    const rows = Core.weeklyAverages([day('2026-10-28', 2000, null)], null);
    expect(rows[1].slice(6)).toEqual(['', '', '', '', '']);
  });
});

describe('progressive search helpers', () => {
  const f = (id, name, extra = {}) => ({ id, name, brand: '', source: 'off', per100: { kcal: 1, protein: 0, carbs: 0, fat: 0 }, servings: [], ...extra });
  test('combineSourceResults: local first, then OFF top, USDA top, rest', () => {
    const off = Array.from({ length: 14 }, (_, i) => f(`off:${i}`, `O${i}`));
    const usda = [f('usda:1', 'U1', { source: 'usda' })];
    const out = Core.combineSourceResults([[f('custom:1', 'Mine', { source: 'custom' })]], off, usda, 25);
    expect(out[0].id).toBe('custom:1');
    expect(out[13].id).toBe('usda:1');
    expect(out[14].id).toBe('off:12');
  });
  test('combineSourceResults: a source still loading (null) is skipped', () => {
    expect(Core.combineSourceResults([[]], null, [f('usda:1', 'U')], 25).map(x => x.id)).toEqual(['usda:1']);
  });
  test('isWeakSearch: no result containing every word → weak', () => {
    expect(Core.isWeakSearch('yoghurd', [f('off:1', 'Yoghurt')])).toBe(true);
    expect(Core.isWeakSearch('griekse yoghurt', [f('off:1', 'Griekse yoghurt 0%')])).toBe(false);
    expect(Core.isWeakSearch('kwark', [])).toBe(true);
  });
});
