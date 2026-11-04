const { buildMacroStoryData, preWorkoutOptions } = require('../src/js/macro-sticker');

const DATE = new Date('2026-11-02T12:00:00');

describe('buildMacroStoryData', () => {
  test('nothing logged → null', () => {
    expect(buildMacroStoryData(null)).toBeNull();
    expect(buildMacroStoryData({ protein: 0, carbs: 0, fats: 0 })).toBeNull();
  });

  test('totals without targets', () => {
    const d = buildMacroStoryData({ protein: 150, carbs: 200, fats: 60 }, { date: DATE });
    expect(d.headline).toBe('1,940 kcal');
    expect(d.caption).toBe('eaten today');
    expect(d.kicker).toMatch(/^Today's fuel · /);
    expect(d.macros.map((m) => m.value)).toEqual(['150g', '200g', '60g']);
    expect(d.macros.every((m) => m.ratio === null && m.target === null)).toBe(true);
    expect(d.stamp).toBeNull();
    expect(d.preMeal).toBeNull();
  });

  test('calories logged on their own count towards the total', () => {
    const d = buildMacroStoryData({ protein: 10, carbs: 0, fats: 0, cals: 100 });
    expect(d.headline).toBe('140 kcal');
  });

  test('every target within 10% → On target', () => {
    const d = buildMacroStoryData({ protein: 180, carbs: 250, fats: 70 }, {
      targets: { calories: 2350, protein: 180, carbs: 260, fat: 70 },
    });
    expect(d.caption).toBe('of 2,350 kcal target');
    expect(d.stamp).toBe('On target');
    expect(d.macros[0].target).toBe('180g');
  });

  test('protein hit but carbs short → Protein hit', () => {
    const d = buildMacroStoryData({ protein: 175, carbs: 100, fats: 50 }, {
      targets: { calories: 2600, protein: 180, carbs: 300, fats: 70 },
    });
    expect(d.stamp).toBe('Protein hit');
    expect(d.macros[2].target).toBe('70g');
  });

  test('pre-workout meal from the food log lists its foods', () => {
    const preMeal = { key: 'log:breakfast', label: 'Breakfast', foods: ['Oats', 'Banana', 'Whey', 'Honey', 'Milk'], protein: 40, carbs: 90, fat: 10, kcal: 610 };
    const d = buildMacroStoryData({ protein: 100, carbs: 150, fats: 40 }, { preMeal });
    expect(d.preMeal.label).toBe('Pre-workout · Breakfast');
    expect(d.preMeal.foods).toBe('Oats · Banana · Whey +2 more');
    expect(d.preMeal.macros).toBe('40g P · 90g C · 10g F · 610 kcal');
  });
});

describe('preWorkoutOptions', () => {
  const log = [
    { date: '2026-11-02', meal: 'breakfast', name: 'Oats', protein: 10, carbs: 60, fat: 6, kcal: 330 },
    { date: '2026-11-02', meal: 'breakfast', name: 'Oats', protein: 5, carbs: 30, fat: 3, kcal: 165 },
    { date: '2026-11-02', meal: 'breakfast', name: 'Whey', protein: 25, carbs: 3, fat: 2, kcal: 130 },
    { date: '2026-11-02', meal: 'dinner', name: 'Rice', protein: 5, carbs: 80, fat: 1, kcal: 350 },
    { date: '2026-11-01', meal: 'lunch', name: 'Yesterday', protein: 50, carbs: 50, fat: 50, kcal: 850 },
  ];

  test('meal cards timed pre-workout come first, then food-log meals with food today', () => {
    const cards = [
      { protein: 30, carbs: 60, fats: 5, slot: 'pre_workout' },
      { protein: 40, carbs: 10, fats: 10, slot: 'breakfast' },
      { protein: 0, carbs: 0, fats: 0, slot: 'pre_workout' },
    ];
    const opts = preWorkoutOptions(log, cards, '2026-11-02');
    expect(opts.map((o) => o.key)).toEqual(['card:0', 'log:breakfast', 'log:dinner']);
    expect(opts[0]).toMatchObject({ label: 'Pre-workout', foods: [], protein: 30, carbs: 60, fat: 5, kcal: 405 });
    expect(opts[1]).toMatchObject({ label: 'Meal 1', foods: ['Oats', 'Whey'], protein: 40, carbs: 93, fat: 11, kcal: 625 });
  });

  test('handles missing data', () => {
    expect(preWorkoutOptions(null, null, '2026-11-02')).toEqual([]);
  });
});
