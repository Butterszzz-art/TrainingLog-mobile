/**
 * @jest-environment node
 */
const NI = require('../src/js/nutrition-insights.js');
const Core = require('../src/js/food-core.js');

const END = '2026-10-25'; // a Sunday
const dayN = n => NI.addDays(END, -n);

// 28 days at 2,400 kcal while losing 0.5 kg/week (≈ 550 kcal/day deficit).
function cutData() {
  const days = [];
  const weights = [];
  for (let i = 27; i >= 0; i--) {
    days.push({ date: dayN(i), kcal: 2400, protein: 160, carbs: i % 2 ? 180 : 260, fat: 70 });
    if (i % 2 === 0) weights.push({ date: dayN(i), kg: 85 - ((27 - i) * 0.5) / 7 });
  }
  return { days, weights };
}

describe('real maintenance', () => {
  test('intake corrected for weight trend', () => {
    const { days, weights } = cutData();
    const m = NI.estimateMaintenance({ days, weights, end: END });
    expect(m.avgIntake).toBe(2400);
    expect(m.kgPerWeek).toBeCloseTo(-0.5, 2);
    // 2400 + 0.5/7 × 7700 ≈ 2950
    expect(m.kcal).toBe(2950);
    expect(m.confidence).toBe('good');
  });
  test('not enough data → null', () => {
    const { days, weights } = cutData();
    expect(NI.estimateMaintenance({ days: days.slice(-5), weights, end: END })).toBeNull();
    expect(NI.estimateMaintenance({ days, weights: weights.slice(-2), end: END })).toBeNull();
    // Weigh-ins only within 4 days
    expect(NI.estimateMaintenance({ days, weights: [{ date: dayN(3), kg: 80 }, { date: dayN(2), kg: 80 }, { date: dayN(0), kg: 80 }], end: END })).toBeNull();
  });
  test('stable weight → maintenance equals intake, rough with few weigh-ins', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ date: dayN(i), kcal: 2600 }));
    const weights = [{ date: dayN(13), kg: 80 }, { date: dayN(6), kg: 80 }, { date: dayN(0), kg: 80 }];
    const m = NI.estimateMaintenance({ days, weights, end: END });
    expect(m.kcal).toBe(2600);
    expect(m.confidence).toBe('rough');
  });
});

describe('session volume', () => {
  test('app workout log', () => {
    expect(NI.sessionVolume({ log: [{ weightsArray: [100, 100], repsArray: [5, 5] }, { weightsArray: [20], repsArray: [10] }] })).toBe(1200);
  });
  test('coach pack shape', () => {
    expect(NI.sessionVolume({ exercises: [{ sets: [{ w: 60, r: 10 }, { w: 60, r: 8 }] }] })).toBe(1080);
  });
});

describe('carbs vs volume', () => {
  test('low-carb training days show less volume', () => {
    const { days } = cutData();
    const sessions = [];
    for (let i = 0; i < 28; i += 2) sessions.push({ date: dayN(i), volume: 10000 }); // even i = 260 g carbs
    for (let i = 1; i < 28; i += 4) sessions.push({ date: dayN(i), volume: 9000 });  // odd i = 180 g carbs
    const c = NI.carbsVsVolume({ days, sessions, end: END });
    expect(c.high.avgVolume).toBe(10000);
    expect(c.low.avgVolume).toBe(9000);
    expect(c.diffPct).toBe(-10);
    expect(c.points.length).toBe(sessions.length);
  });
  test('too few sessions on one side → no comparison, points kept', () => {
    const { days } = cutData();
    const c = NI.carbsVsVolume({ days, sessions: [{ date: dayN(0), volume: 5000 }], end: END });
    expect(c.diffPct).toBeNull();
    expect(c.points).toHaveLength(1);
  });
});

describe('food log analysis', () => {
  const mk = (date, meal, name, protein, extra = {}) => ({ date, meal, name, protein, kcal: protein * 4, carbs: 0, fat: 0, ...extra });
  const entries = [];
  for (let i = 0; i < 7; i++) {
    entries.push(mk(dayN(i), 'breakfast', 'Havermout', 10, { fiber: 8, ironMg: 3 }));
    entries.push(mk(dayN(i), 'dinner', 'Kipfilet', 45, { ironMg: 1 }));
  }
  test('protein per meal per logged day', () => {
    const p = NI.proteinByMeal(entries, dayN(6), END);
    expect(p).toEqual({ perMeal: { breakfast: 10, lunch: 0, dinner: 45, snacks: 0 }, days: 7 });
  });
  test('micro averages per day, partial when some foods lack data', () => {
    const m = NI.microAverages(entries, dayN(6), END, 2500, Core);
    const iron = m.rows.find(r => r.key === 'ironMg');
    expect(iron.total).toBe(4);
    const fibre = m.rows.find(r => r.key === 'fiber');
    expect(fibre).toMatchObject({ total: 8, status: 'partial' });
    expect(m.rows.find(r => r.key === 'vitDUg').status).toBe('nodata');
  });
});

describe('supplements', () => {
  test('each candidate is tied to the data', () => {
    const micros = { rows: [{ key: 'vitDUg', total: null, status: 'nodata' }, { key: 'ironMg', total: 6, ref: 14, status: 'low', missing: 0 }] };
    const entries = Array.from({ length: 25 }, (_, i) => ({ date: dayN(i % 7), name: 'Kipfilet' }));
    const s = NI.supplementCandidates({ month: 10, micros, avgProtein: 120, proteinTarget: 180, sessions: 4, entries });
    expect(s.map(x => x.id)).toEqual(['vitamin_d', 'creatine', 'protein_powder', 'omega_3', 'iron']);
    expect(s[0].why).toMatch(/October to March/);
    expect(s.every(x => x.name)).toBe(true);
  });
  test('summer, enough protein, fish eaten, untrained → nothing', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({ date: dayN(i % 7), name: i === 3 ? 'Gerookte zalm' : 'Rijst' }));
    expect(NI.supplementCandidates({ month: 6, micros: { rows: [] }, avgProtein: 180, proteinTarget: 180, sessions: 0, entries })).toEqual([]);
  });
  test('iron is only suggested when every food listed iron', () => {
    const micros = { rows: [{ key: 'ironMg', total: 6, ref: 14, status: 'low', missing: 3 }] };
    expect(NI.supplementCandidates({ month: 6, micros, sessions: 0 }).map(x => x.id)).not.toContain('iron');
  });
});

describe('facts and rules review', () => {
  const { days, weights } = cutData();
  const sessions = [];
  for (let i = 0; i < 28; i += 2) sessions.push({ date: dayN(i), volume: 10000 });
  for (let i = 1; i < 28; i += 4) sessions.push({ date: dayN(i), volume: 9000 });
  const entries = [];
  for (let i = 0; i < 7; i++) {
    entries.push({ date: dayN(i), meal: 'breakfast', name: 'Havermout', protein: 10, kcal: 300, fiber: 8 });
    entries.push({ date: dayN(i), meal: 'dinner', name: 'Kipfilet', protein: 50, kcal: 400 });
  }
  const facts = NI.buildNutritionFacts({ start: dayN(6), end: END, days, weights, sessions, entries, target: { calories: 2500, protein: 180, carbs: 250, fat: 70 }, Core, month: 9 });

  test('facts', () => {
    expect(facts.week).toMatchObject({ daysLogged: 7, avgKcal: 2400, avgProtein: 160 });
    expect(facts.maintenance.kcal).toBe(2950);
    expect(facts.carbsVsVolume.diffPct).toBe(-10);
    expect(facts.weightChangeKg).toBeCloseTo(-0.5, 1);
    expect(facts.supplementCandidates.map(s => s.id)).toContain('vitamin_d');
  });
  test('rules review: work on protein, breakfast and carbs; think about maintenance', () => {
    const r = NI.rulesReview(facts);
    const text = r.items.map(i => `${i.kind}: ${i.text}`).join('\n');
    expect(text).toMatch(/work_on: Protein averaged 160 g against your 180 g/);
    expect(text).toMatch(/work_on: Breakfast has 10 g protein against 50 g at dinner/);
    expect(text).toMatch(/work_on: Training days under 200 g carbs averaged 10% less volume/);
    expect(text).toMatch(/think_about: Your real maintenance is about 2,950 kcal/);
    expect(r.items.length).toBeLessThanOrEqual(5);
    expect(r.supplements.length).toBeLessThanOrEqual(3);
  });
});
