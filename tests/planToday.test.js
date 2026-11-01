/**
 * @jest-environment node
 */
// src/js/plan-today.js against a published plan/2 made by the backend
// (fixtures/plan-v2-published.json, anonymised): Cut weeks 1–12, Maintain
// 13–15, Deload 16, starting Monday 2026-11-09; one 4-week Mon/Tue/Thu/Fri
// program linked from program week 1, 13 and 16.
const plan = require('./fixtures/plan-v2-published.json');
const T = require('../src/js/plan-today');

describe('PlanToday.resolve', () => {
  test('week 1 Monday: Lower A, training-day targets', () => {
    const r = T.resolve(plan, '2026-11-09');
    expect([r.phase.type, r.planWeek, r.phaseWeek, r.programWeek, r.dayType]).toEqual(['cut', 1, 1, 1, 'training']);
    expect(r.day.name).toBe('Lower A');
    expect(T.exerciseTarget(r.day.exercises[0])).toBe('2 × 6–10 · RIR 3 · rest 2–3 min');
    expect(r.targets).toEqual({ kcal: 2350, protein: 165, carbs: 275, fat: 65 });
  });

  test('Wednesday is a rest day with rest-day targets', () => {
    const r = T.resolve(plan, '2026-11-11');
    expect([r.dayType, r.day]).toEqual(['rest', null]);
    expect(r.targets).toEqual({ kcal: 2000, protein: 165, carbs: 190, fat: 65 });
  });

  test('week 3 Tuesday: Upper A with RIR 2 and last set 1 on isolation work', () => {
    const r = T.resolve(plan, '2026-11-24');
    expect([r.planWeek, r.programWeek, r.day.name]).toEqual([3, 3, 'Upper A']);
    const raise = r.day.exercises.find(e => /^Cable lateral raise/.test(e.name));
    expect(T.exerciseTarget(raise)).toBe('4 × 10–20 · RIR 2 (last set 1) · rest 1–2 min');
    expect(T.rirLabel(r.day.exercises[0])).toBe('RIR 2');
  });

  test('Thursday and Friday map to Lower B and Upper B', () => {
    expect(T.resolve(plan, '2026-11-12').day.name).toBe('Lower B');
    expect(T.resolve(plan, '2026-11-13').day.name).toBe('Upper B');
    expect(T.resolve(plan, '2026-11-15').dayType).toBe('rest');
  });

  test('past the 4 authored weeks the last week repeats', () => {
    const r = T.resolve(plan, '2026-12-07'); // week 5
    expect([r.planWeek, r.programWeek, r.repeatsLastWeek]).toEqual([5, 4, true]);
    expect(r.day.name).toBe('Lower A');
  });

  test('week 13: maintenance targets from the phase start date, on both day types', () => {
    const mon = T.resolve(plan, '2027-02-01');
    expect([mon.phase.type, mon.planWeek, mon.phaseWeek]).toEqual(['maintain', 13, 1]);
    expect(mon.targets).toEqual({ kcal: 2700, protein: 165, carbs: 364, fat: 65 });
    expect(T.resolve(plan, '2027-02-03').targets).toEqual({ kcal: 2700, protein: 165, carbs: 364, fat: 65 });
    expect(T.resolve(plan, '2027-01-31').phase.type).toBe('cut');
  });

  test('week 16: deload with phase 2 nutrition', () => {
    const r = T.resolve(plan, '2027-02-22');
    expect([r.phase.type, r.planWeek, r.dayType]).toEqual(['deload', 16, 'training']);
    expect(r.targets).toEqual({ kcal: 2700, protein: 165, carbs: 364, fat: 65 });
  });

  test('before and after the plan', () => {
    expect(T.resolve(plan, '2026-11-08')).toEqual({ phase: null, before: true, after: false });
    expect(T.resolve(plan, '2027-03-01')).toEqual({ phase: null, before: false, after: true });
  });
});

describe('PlanToday.macroPhases', () => {
  test('one date range per phase; Mon/Tue/Thu/Fri are training days', () => {
    const ranges = T.macroPhases(plan);
    expect(ranges.map(r => [r.type, r.from, r.to])).toEqual([
      ['cut', '2026-11-09', '2027-01-31'], ['maintain', '2027-02-01', '2027-02-21'], ['deload', '2027-02-22', '2027-02-28'],
    ]);
    expect(ranges[0].days).toEqual({ training: { protein: 165, carbs: 275, fat: 65, calories: 2350 }, rest: { protein: 165, carbs: 190, fat: 65, calories: 2000 } });
    expect(ranges[0].schedule).toEqual({ mon: 'training', tue: 'training', wed: 'rest', thu: 'training', fri: 'training', sat: 'rest', sun: 'rest' });
  });
});

describe('PlanToday.composeProgram', () => {
  test('16 plan weeks from the program, last authored week repeating, labelled by phase', () => {
    const p = T.composeProgram(plan);
    expect(p.weeks).toHaveLength(16);
    expect(p.schedule).toEqual({ startDate: '2026-11-09', weekdays: [1, 2, 4, 5] });
    expect(p.frequency).toEqual(['Mon', 'Tue', 'Thu', 'Fri']);
    expect(p.weeks.map(w => w.phase)).toEqual([...Array(12).fill('Cut'), 'Maintain', 'Maintain', 'Maintain', 'Deload']);
    expect(p.weeks[2].days[1].exercises.find(e => /^Cable lateral/.test(e.name)).sets.map(s => s.rir)).toEqual([2, 2, 2, 1]);
    expect(p.weeks[10]).toMatchObject({ days: plan.programs.prog_a.weeks[3].days }); // week 11 → program week 4
    expect(p.planId).toBe(plan.planId);
  });

  test('works with the Program tab schedule: right session on the right date', () => {
    const ps = require('../src/js/program-schedule');
    const core = { getWeekDays: T.weekDays, getWeekCount: p => p.weeks.length };
    const program = T.composeProgram(plan);
    const s = ps.createSchedule(program, { startDate: '2026-11-09' }, { core });
    const on = iso => s.dayFor(ps.parseLocalDate(iso));
    expect([on('2026-11-24').day.name, on('2026-11-24').weekNum, on('2026-11-24').phase]).toEqual(['Upper A', 3, 'Cut']);
    expect(on('2026-11-25').isTraining).toBe(false);
    expect([on('2027-02-22').day.name, on('2027-02-22').weekNum, on('2027-02-22').phase]).toEqual(['Lower A', 16, 'Deload']);
  });
});

describe('MyPlan today block', () => {
  test('week, phase, day, targets and the session with RIR', () => {
    require('../src/js/plan-preview');
    const { todayHtml } = require('../src/js/my-plan');
    const html = todayHtml(plan, '2026-11-24');
    expect(html).toContain('Today · week 3 of 16 · Cut · program week 3');
    expect(html).toContain('Training day · Upper A');
    expect(html).toContain('2350 kcal');
    expect(html).toContain('4 × 10–20 · RIR 2 (last set 1) · rest 1–2 min');
    expect(todayHtml(plan, '2026-11-25')).toMatch(/Rest day[\s\S]*2000 kcal/);
    expect(todayHtml(plan, '2027-03-08')).toBe('');
  });
});

test('plan programs count calendar weeks: a Sunday rest day stays in its week', () => {
  const ps = require('../src/js/program-schedule');
  const core = { getWeekDays: T.weekDays, getWeekCount: p => p.weeks.length };
  const s = ps.createSchedule(T.composeProgram(plan), { startDate: '2026-11-09' }, { core });
  expect(s.dayFor(ps.parseLocalDate('2026-11-29')).weekNum).toBe(3); // Sunday of week 3
  expect(s.dayFor(ps.parseLocalDate('2026-11-30')).weekNum).toBe(4);
});
