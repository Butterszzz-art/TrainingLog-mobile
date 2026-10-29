const Core = require('../src/js/food-core.js');
const { mealShareItem, mealTotals, entriesFromSharedMeal, templateFromSharedMeal } = require('../src/js/meal-share.js');

const chicken = Core.normalizeFood({ id: 'c1', source: 'usda', name: 'Chicken breast', per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 } });
const rice = Core.normalizeFood({ id: 'r1', source: 'usda', name: 'White rice', per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, servings: [{ label: 'cup', grams: 158 }] });
const logged = [
  Core.makeEntry(chicken, { grams: 200, amount: 200, unit: 'g', date: '2026-10-29', meal: 'lunch', now: 1, rand: 'a' }),
  Core.makeEntry(rice, { grams: 316, amount: 2, unit: 'cup', date: '2026-10-29', meal: 'lunch', now: 2, rand: 'b' }),
];

describe('mealShareItem', () => {
  test('sends only names, amounts and macros', () => {
    const item = mealShareItem(logged, 'lunch', 'Lunch');
    expect(item.type).toBe('meal');
    expect(item.name).toBe('Lunch');
    expect(item.data.meal).toBe('lunch');
    expect(item.data.items[0]).toEqual({ name: 'Chicken breast', amount: 200, unit: 'g', grams: 200, kcal: 330, protein: 62, carbs: 0, fat: 7.2, fibre: 0 });
    expect(item.data.items[1]).toMatchObject({ name: 'White rice', amount: 2, unit: 'cup', grams: 316 });
    // Nothing else from the log entry (ids, dates, sources, per-100 data).
    expect(Object.keys(item.data.items[1]).sort()).toEqual(['amount', 'carbs', 'fat', 'grams', 'kcal', 'name', 'protein', 'unit']);
  });

  test('an empty meal sends nothing', () => {
    expect(mealShareItem([], 'lunch', 'Lunch')).toBeNull();
  });
});

describe('mealTotals', () => {
  test('adds up the foods', () => {
    expect(mealTotals(mealShareItem(logged, 'lunch', 'Lunch').data)).toEqual({ kcal: 741, protein: 70.5, carbs: 88.5, fat: 8.1 });
    expect(mealTotals(null)).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('entriesFromSharedMeal (logging a received meal)', () => {
  const data = mealShareItem(logged, 'lunch', 'Lunch').data;

  test('foods keep their amounts and macros', () => {
    const entries = entriesFromSharedMeal(data, { date: '2026-10-30', meal: 'dinner', now: 5, rand: 'x' });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ date: '2026-10-30', meal: 'dinner', name: 'Chicken breast', grams: 200, amount: 200, unit: 'g', kcal: 330, protein: 62 });
    expect(entries[1]).toMatchObject({ name: 'White rice', grams: 316, amount: 2, unit: 'cup' });
    expect(entries[0].fiber).toBe(0);
    expect(Core.totals(entries).kcal).toBe(mealTotals(data).kcal);
    expect(new Set(entries.map(e => e.id)).size).toBe(2);
  });

  test('odd portions log exactly what was sent', () => {
    const entries = entriesFromSharedMeal({ items: [{ name: 'Salmon', amount: 150, unit: 'g', grams: 150, kcal: 310, protein: 31, carbs: 0, fat: 20 }] }, { date: '2026-10-30', meal: 'dinner', now: 1 });
    expect(entries[0]).toMatchObject({ kcal: 310, protein: 31, carbs: 0, fat: 20 });
  });

  test('a food without grams counts as one serving', () => {
    const entries = entriesFromSharedMeal({ items: [{ name: 'Protein bar', kcal: 210, protein: 20, carbs: 22, fat: 7 }] }, { date: '2026-10-30', meal: 'snacks', now: 1 });
    expect(entries[0]).toMatchObject({ name: 'Protein bar', amount: 1, unit: 'serving', kcal: 210, protein: 20, carbs: 22, fat: 7 });
  });

  test('bad data logs nothing', () => {
    expect(entriesFromSharedMeal(null, { date: '2026-10-30', meal: 'lunch' })).toEqual([]);
    expect(entriesFromSharedMeal({ items: [{ kcal: 100 }] }, { date: '2026-10-30', meal: 'lunch' })).toEqual([]);
  });
});

describe('templateFromSharedMeal (saving a received meal)', () => {
  test('becomes a saved meal that logs the same foods', () => {
    const data = mealShareItem(logged, 'lunch', 'Lunch').data;
    const tpl = templateFromSharedMeal('Lunch (from @ana)', data, { now: 1, rand: 'r' });
    expect(tpl.name).toBe('Lunch (from @ana)');
    expect(tpl.items).toHaveLength(2);
    const again = Core.entriesFromTemplate(tpl, { date: '2026-10-31', meal: 'lunch', now: 1 });
    expect(Core.totals(again).kcal).toBe(mealTotals(data).kcal);
  });
});
