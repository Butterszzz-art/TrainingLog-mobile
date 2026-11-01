const fs = require('fs');
const vm = require('vm');
const T = require('../src/js/plan-today');

// A published master plan's phases (PlanToday.macroPhases, stored by
// client-coaching.js) drive the Macros tab: the plan's training weekdays pick
// training vs rest day, and the phase switches on its start date.
const plan = require('./fixtures/plan-v2-published.json');
const html = fs.readFileSync('index.html', 'utf8');
function extract(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`could not find ${startMarker}`);
  return html.slice(start, end);
}

const ENTRY = {
  source: 'coach',
  coachUsername: 'coach',
  planId: plan.planId,
  phases: T.macroPhases(plan),
  days: T.macroPhases(plan)[0].days,
  schedule: T.macroPhases(plan)[0].schedule,
  fallback: { days: { training: { protein: 150, carbs: 300, fat: 70 } }, schedule: { mon: 'training' } },
};

function setup(now) {
  const store = { coachNutritionAssignments_v1: JSON.stringify({ alice: ENTRY }) };
  const nodes = { trainingDayToggle: { checked: false }, carbCycleSelect: { value: 'normal' }, refeedDayToggle: { checked: false } };
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
    this.api = { getAssignedNutritionPlan, getAssignedNutritionTargetsForCurrentDay, applyCoachMacroScheduleForToday };
  `, ctx);
  // What the Macros tab does on open: apply today's day type, then read the target.
  const today = () => { ctx.api.applyCoachMacroScheduleForToday(); return ctx.api.getAssignedNutritionTargetsForCurrentDay('alice'); };
  return { api: ctx.api, today };
}

test('week 1 Monday: training-day targets (kcal as the coach set them)', () => {
  expect(setup('2026-11-09T08:00:00').today()).toEqual({ protein: 165, carbs: 275, fat: 65, calories: 2350 });
});

test('week 1 Wednesday: rest-day targets', () => {
  expect(setup('2026-11-11T08:00:00').today()).toEqual({ protein: 165, carbs: 190, fat: 65, calories: 2000 });
});

test('phase 2 starts on its date: maintenance on a training and a rest day', () => {
  expect(setup('2027-01-31T20:00:00').today()).toEqual({ protein: 165, carbs: 190, fat: 65, calories: 2000 }); // last cut Sunday
  expect(setup('2027-02-01T08:00:00').today()).toEqual({ protein: 165, carbs: 364, fat: 65, calories: 2700 });
  expect(setup('2027-02-03T08:00:00').today()).toEqual({ protein: 165, carbs: 364, fat: 65, calories: 2700 });
});

test('deload week uses phase 2 numbers', () => {
  const { api, today } = setup('2027-02-22T08:00:00');
  expect(today()).toEqual({ protein: 165, carbs: 364, fat: 65, calories: 2700 });
  expect(api.getAssignedNutritionPlan('alice').phaseType).toBe('deload');
});

test('the phase follows the local date, not UTC, just after midnight', () => {
  // 00:30 local on Monday 1 Feb is still Sunday in UTC for a client in the
  // Netherlands; the lookup must use the local calendar day.
  const { api } = setup('2027-02-01T00:30:00');
  expect(api.getAssignedNutritionPlan('alice').phaseType).toBe('maintain');
});

test('outside the plan the stand-alone coach plan applies', () => {
  const { api } = setup('2027-03-08T08:00:00');
  const p = api.getAssignedNutritionPlan('alice');
  expect(p.fromPlan).toBe(false);
  expect(p.days.training).toEqual({ protein: 150, carbs: 300, fat: 70 });
});

describe('ClientCoaching.coachMacroEntry', () => {
  global.window = global;
  const { coachMacroEntry } = require('../src/js/client-coaching.js');
  const active = new Set(['c1']);
  const macroPlan = { days: { training: { protein: 150, carbs: 300, fat: 70 } }, schedule: { mon: 'training' } };
  const assignments = [{ coachUid: 'c1', coachUsername: 'coach', macroPlan, updatedAt: '2026-11-01T00:00:00Z' }];

  test('a published plan from an active coach → phases, with the stand-alone plan as fallback', () => {
    const e = coachMacroEntry({ assignments, plan, planLoaded: true, activeUids: active, current: null, PlanToday: T, now: 1 });
    expect(e.phases.map(p => p.type)).toEqual(['cut', 'maintain', 'deload']);
    expect(e.planId).toBe(plan.planId);
    expect(e.fallback.days).toBe(macroPlan.days);
  });

  test('plan not loaded (offline) keeps stored phases; a coach who left clears them', () => {
    const current = { source: 'coach', coachUid: 'c1', phases: [{}] };
    expect(coachMacroEntry({ assignments, plan: null, planLoaded: false, activeUids: active, current, PlanToday: T })).toBeUndefined();
    expect(coachMacroEntry({ assignments: [], plan: null, planLoaded: true, activeUids: new Set(), current, PlanToday: T })).toBeNull();
  });

  test('no plan → the stand-alone day-type plan as before', () => {
    const e = coachMacroEntry({ assignments, plan: null, planLoaded: true, activeUids: active, current: null, PlanToday: T, now: 1 });
    expect(e.phases).toBeUndefined();
    expect(e.days).toBe(macroPlan.days);
  });
});
