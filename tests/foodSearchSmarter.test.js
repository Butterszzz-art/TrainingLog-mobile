const Core = require('../src/js/food-core.js');

describe('parseFoodQuery (an amount typed with the food)', () => {
  test.each([
    ['200g chicken breast', { q: 'chicken breast', grams: 200 }],
    ['chicken breast 200 g', { q: 'chicken breast', grams: 200 }],
    ['150 gram kipfilet', { q: 'kipfilet', grams: 150 }],
    ['0.5 kg rijst', { q: 'rijst', grams: 500 }],
    ['1,5 l melk', { q: 'melk', ml: 1500 }],
    ['2 eggs', { q: 'eggs', count: 2 }],
    ['2x banana', { q: 'banana', count: 2 }],
    ['1 cup rice', { q: 'rice', count: 1, servingHint: 'cup' }],
    ['3 slices bread', { q: 'bread', count: 3, servingHint: 'slice' }],
  ])('%s', (text, expected) => {
    expect(Core.parseFoodQuery(text)).toEqual(expected);
  });

  test.each(['2% milk', '0% kwark', '7up', 'cola zero', '100 chicken', 'kwark'])('leaves "%s" alone', (text) => {
    expect(Core.parseFoodQuery(text)).toEqual({ q: text.toLowerCase() });
  });

  test('ignores impossible amounts', () => {
    expect(Core.parseFoodQuery('9000 g rice')).toEqual({ q: '9000 g rice' });
  });
});

describe('plurals', () => {
  test('a plural search matches a singular name and the other way round', () => {
    expect(Core.matchesQuery({ name: 'Egg, whole', brand: '' }, 'eggs')).toBe(true);
    expect(Core.matchesQuery({ name: 'Tomatoes', brand: '' }, 'tomato')).toBe(true);
    expect(Core.matchesQuery({ name: 'Blueberries', brand: '' }, 'blueberry')).toBe(true);
    expect(Core.matchesQuery({ name: 'Rice', brand: '' }, 'eggs')).toBe(false);
  });
});

describe('recent foods: counts and ranking', () => {
  const food = (id, name) => ({ id, source: 'usda', name, per100: { kcal: 100, protein: 1, carbs: 1, fat: 1 } });

  test('addRecent counts uses and meals', () => {
    let list = Core.addRecent([], food('a', 'Oats'), 1, 'breakfast');
    list = Core.addRecent(list, food('a', 'Oats'), 2, 'breakfast');
    list = Core.addRecent(list, food('a', 'Oats'), 3, 'snacks');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'a', uses: 3, usedAt: 3, meals: { breakfast: 2, snacks: 1 } });
  });

  test('older entries without counts count as one use', () => {
    const list = Core.addRecent([{ ...food('a', 'Oats'), usedAt: 1 }], food('a', 'Oats'), 2, 'lunch');
    expect(list[0].uses).toBe(2);
  });

  test('rankRecent puts what you often have at this meal first', () => {
    const day = 864e5;
    const now = 100 * day;
    const list = [
      { ...food('new', 'Pizza'), uses: 1, meals: { dinner: 1 }, usedAt: now - day },
      { ...food('oats', 'Oats'), uses: 12, meals: { breakfast: 12 }, usedAt: now - 3 * day },
      { ...food('chicken', 'Chicken'), uses: 10, meals: { lunch: 6, dinner: 4 }, usedAt: now - 2 * day },
    ];
    expect(Core.rankRecent(list, { meal: 'breakfast', now }).map(f => f.id)).toEqual(['oats', 'chicken', 'new']);
    expect(Core.rankRecent(list, { meal: 'lunch', now }).map(f => f.id)).toEqual(['chicken', 'oats', 'new']);
  });

  test('rankRecent copes with empty or odd lists', () => {
    expect(Core.rankRecent(null, {})).toEqual([]);
    expect(Core.rankRecent([null, food('a', 'A')], {}).map(f => f.id)).toEqual(['a']);
  });
});
