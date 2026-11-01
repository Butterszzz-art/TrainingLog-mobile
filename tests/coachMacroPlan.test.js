const fs = require('fs');
const vm = require('vm');

// A coach's macro plan by day type (stored by client-coaching.js under
// coachNutritionAssignments_v1) drives the Macros tab: the weekly pattern
// picks today's day type unless the athlete picked one by hand today.
const html = fs.readFileSync('index.html', 'utf8');
function extract(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`could not find ${startMarker}`);
  return html.slice(start, end);
}

const PLAN = {
  source: 'coach',
  coachUsername: 'coachkim',
  days: {
    training: { protein: 180, carbs: 250, fat: 70, calories: 2350 },
    rest: { protein: 180, carbs: 150, fat: 75, calories: 1995 },
    high: { protein: 180, carbs: 350, fat: 60, calories: 2660 },
  },
  // 2026-11-01 is a Sunday, 2026-11-03 a Tuesday.
  schedule: { mon: 'training', tue: 'low', wed: null, thu: 'rest', fri: 'training', sat: 'rest', sun: 'high' },
};

function setup({ plan = PLAN, now = '2026-11-01T10:00:00', dayContext = null } = {}) {
  const store = {
    coachNutritionAssignments_v1: JSON.stringify({ alice: plan }),
    ...(dayContext ? { macroDayContext_alice: JSON.stringify(dayContext) } : {}),
  };
  const nodes = {
    trainingDayToggle: { checked: false },
    carbCycleSelect: { value: 'normal' },
    refeedDayToggle: { checked: false },
  };
  const RealDate = Date;
  const ctx = {
    currentUser: 'alice',
    window: {},
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    document: { getElementById: id => nodes[id] || null, querySelectorAll: () => [] },
    getTodayDateString: () => now.slice(0, 10),
    getMacroDayContextKey: () => 'macroDayContext_alice',
    updateMacroUI: () => {},
    Date: class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } },
  };
  vm.createContext(ctx);
  vm.runInContext(`
    ${extract('function getMacroCyclingSettings()', 'function getMacroDayContextKey()')}
    this.api = { getAssignedNutritionTargetsForCurrentDay, applyCoachMacroScheduleForToday };
  `, ctx);
  return { api: ctx.api, nodes };
}

test("today's weekday picks the coach's day type and its targets", () => {
  const { api, nodes } = setup();
  expect(api.applyCoachMacroScheduleForToday()).toBe(true);
  expect(nodes.carbCycleSelect.value).toBe('high');
  expect(api.getAssignedNutritionTargetsForCurrentDay('alice')).toEqual({ protein: 180, carbs: 350, fat: 60, calories: 2660 });
});

test('a day type the coach left empty falls back to the training day', () => {
  const { api, nodes } = setup({ now: '2026-11-03T10:00:00' }); // Tuesday = low, which has no targets
  expect(api.applyCoachMacroScheduleForToday()).toBe(false);
  nodes.carbCycleSelect.value = 'low';
  expect(api.getAssignedNutritionTargetsForCurrentDay('alice').calories).toBe(2350);
});

test('a rest day uses the rest targets', () => {
  const { api, nodes } = setup({ now: '2026-11-05T10:00:00' }); // Thursday = rest
  expect(api.applyCoachMacroScheduleForToday()).toBe(true);
  expect(nodes.trainingDayToggle.checked).toBe(false);
  expect(api.getAssignedNutritionTargetsForCurrentDay('alice').calories).toBe(1995);
});

test("a day type picked by hand today isn't overridden", () => {
  const { api, nodes } = setup({ dayContext: { date: '2026-11-01', dayTypeSetByHand: true, carbCycle: 'normal' } });
  expect(api.applyCoachMacroScheduleForToday()).toBe(false);
  expect(nodes.carbCycleSelect.value).toBe('normal');
});

test("yesterday's hand pick doesn't block today's pattern", () => {
  const { api } = setup({ dayContext: { date: '2026-10-31', dayTypeSetByHand: true } });
  expect(api.applyCoachMacroScheduleForToday()).toBe(true);
});

test('plans that did not come from a coach are left alone', () => {
  const { api } = setup({ plan: { ...PLAN, source: undefined } });
  expect(api.applyCoachMacroScheduleForToday()).toBe(false);
});
