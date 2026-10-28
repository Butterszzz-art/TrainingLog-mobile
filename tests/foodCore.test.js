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
