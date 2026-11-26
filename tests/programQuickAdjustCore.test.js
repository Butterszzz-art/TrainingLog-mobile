// src/js/program-quick-adjust-core.js — the phone's "add 2 sets to bench",
// "remove a set", "more chest this week" actions.
const Q = require('../src/js/program-quick-adjust-core.js');

const muscleOf = name => ({
  'bench press': 'chest', 'incline db press': 'chest', 'cable fly': 'chest',
  'barbell row': 'back', 'barbell curl': 'biceps',
}[String(name).toLowerCase()] || 'other');

const rows = [
  { id: 'a', day: 'Mon', name: 'Bench Press', sets: 3 },
  { id: 'b', day: 'Mon', name: 'Cable Fly', sets: 2 },
  { id: 'c', day: 'Tue', name: 'Barbell Row', sets: 4 },
  { id: 'd', day: 'Thu', name: 'bench press', sets: 4 },
  { id: 'e', day: 'Thu', name: 'Barbell Curl', sets: 3 },
];

describe('exercises / weeklyVolume', () => {
  test('lists each exercise once with sessions and weekly sets (case-insensitive)', () => {
    expect(Q.exercises(rows)[0]).toEqual({ name: 'Bench Press', sessions: 2, weeklySets: 7 });
    expect(Q.exercises(rows)).toHaveLength(4);
  });
  test('weekly sets per muscle, biggest first', () => {
    const v = Q.weeklyVolume(rows, muscleOf);
    expect(v.map(x => [x.muscle, x.sets])).toEqual([['chest', 9], ['back', 4], ['biceps', 3]]);
    expect(v[0].label).toBe('Chest');
  });
});

describe('addSets / removeSets', () => {
  test('adds to every session of the exercise', () => {
    const plan = Q.addSets(rows, 'Bench Press', 2);
    expect(plan.changes.map(c => [c.id, c.from, c.to])).toEqual([['a', 3, 5], ['d', 4, 6]]);
    expect(plan.delta).toBe(4);
    expect(Q.describe(plan)).toBe('Bench Press · Mon 3→5 · Thu 4→6');
  });
  test('caps at MAX_SETS and explains when nothing changes', () => {
    const plan = Q.addSets([{ id: 'x', day: 'Mon', name: 'Squat', sets: Q.MAX_SETS }], 'Squat', 3);
    expect(plan.changes).toEqual([]);
    expect(plan.note).toMatch(/12 sets/);
  });
  test('removing never goes below one set', () => {
    const plan = Q.removeSets(rows, 'Cable Fly', 5);
    expect(plan.changes).toEqual([{ id: 'b', day: 'Mon', name: 'Cable Fly', from: 2, to: 1 }]);
    expect(Q.removeSets([{ id: 'z', day: 'Mon', name: 'Fly', sets: 1 }], 'Fly', 1).note).toMatch(/1 set/);
  });
  test('unknown exercise', () => {
    expect(Q.addSets(rows, 'Squat', 1).note).toMatch(/not in this program/);
  });
});

describe('changeMuscleVolume', () => {
  test('spreads added sets to the exercise with the fewest sets first', () => {
    // chest: Bench Mon 3, Fly Mon 2, Bench Thu 4 → Fly 3, then the 3/3 tie goes to Bench Mon (earlier), then Fly 4
    const plan = Q.changeMuscleVolume(rows, 'chest', 3, muscleOf);
    expect(plan.delta).toBe(3);
    expect(Object.fromEntries(plan.changes.map(c => [c.id, c.to]))).toEqual({ a: 4, b: 4 });
  });
  test('takes removed sets off the exercise with the most sets', () => {
    const plan = Q.changeMuscleVolume(rows, 'chest', -2, muscleOf);
    expect(plan.delta).toBe(-2);
    expect(Object.fromEntries(plan.changes.map(c => [c.id, c.to]))).toEqual({ d: 3, a: 2 });
  });
  test('muscle not trained', () => {
    expect(Q.changeMuscleVolume(rows, 'quads', 2, muscleOf).note).toMatch(/No quads exercises/);
  });
});

describe('adapters', () => {
  test('lifter programs: added sets copy the last set, removed come off the end', () => {
    const days = [{ name: 'Push', exercises: [{ name: 'Bench Press', sets: [{ reps: 5, weight: 100 }, { reps: 8, weight: 80 }] }] }];
    const r = Q.rowsFromDays(days);
    expect(r).toEqual([{ id: '0:0', day: 'Push', name: 'Bench Press', sets: 2 }]);
    const more = Q.applyToDays(days, Q.addSets(r, 'Bench Press', 2));
    expect(more[0].exercises[0].sets).toEqual([{ reps: 5, weight: 100 }, { reps: 8, weight: 80 }, { reps: 8, weight: 80 }, { reps: 8, weight: 80 }]);
    expect(days[0].exercises[0].sets).toHaveLength(2); // input untouched
    const less = Q.applyToDays(days, Q.removeSets(r, 'Bench Press', 1));
    expect(less[0].exercises[0].sets).toEqual([{ reps: 5, weight: 100 }]);
  });
  test('coach library week: sets is a number', () => {
    const week = { Mon: [{ name: 'Bench Press', sets: 3, reps: 10 }], Tue: [], Thu: [{ name: 'Bench Press', sets: 4, reps: 8 }] };
    const r = Q.rowsFromWeek(week, ['Mon', 'Tue', 'Wed', 'Thu']);
    expect(r.map(x => x.id)).toEqual(['Mon:0', 'Thu:0']);
    const out = Q.applyToWeek(week, Q.addSets(r, 'bench press', 1));
    expect(out.Mon[0]).toEqual({ name: 'Bench Press', sets: 4, reps: 10 });
    expect(out.Thu[0].sets).toBe(5);
    expect(week.Mon[0].sets).toBe(3);
  });
});

describe('plan', () => {
  test('routes an action to the right planner', () => {
    expect(Q.plan(rows, { mode: 'add', exercise: 'Barbell Row', n: 1 }).changes[0].to).toBe(5);
    expect(Q.plan(rows, { mode: 'remove', exercise: 'Barbell Row', n: 2 }).changes[0].to).toBe(2);
    expect(Q.plan(rows, { mode: 'volume', muscle: 'chest', n: -1 }, muscleOf).delta).toBe(-1);
  });
});

describe('applyToProgram (multi-week)', () => {
  const day = sets => ({ name: 'Push', exercises: [{ name: 'Bench Press', sets: Array.from({ length: sets }, () => ({ reps: 8 })) }] });
  test('mirrors week 1, re-runs the action on other weeks, leaves deloads alone', () => {
    const program = {
      id: 'p1', days: [day(3)],
      weeks: [{ week: 1, days: [day(3)] }, { week: 2, sameAs: 1 }, { week: 3, days: [day(4)] }, { week: 4, deload: true, days: [day(2)] }],
    };
    const action = { mode: 'add', exercise: 'Bench Press', n: 2 };
    const out = Q.applyToProgram(program, Q.plan(Q.rowsFromDays(Q.baseDays(program)), action), action);
    const n = d => d[0].exercises[0].sets.length;
    expect(n(out.days)).toBe(5);
    expect(n(out.weeks[0].days)).toBe(5);
    expect(out.weeks[1]).toEqual({ week: 2, sameAs: 1 });
    expect(n(out.weeks[2].days)).toBe(6);
    expect(n(out.weeks[3].days)).toBe(2);
    expect(n(program.days)).toBe(3);
  });
  test('weeks-only program plans from its first real week', () => {
    const program = { id: 'p2', weeks: [{ week: 1, days: [day(3)] }] };
    expect(Q.rowsFromDays(Q.baseDays(program))).toHaveLength(1);
    const action = { mode: 'remove', exercise: 'Bench Press', n: 1 };
    const out = Q.applyToProgram(program, Q.plan(Q.rowsFromDays(Q.baseDays(program)), action), action);
    expect(out.days).toBeUndefined();
    expect(out.weeks[0].days[0].exercises[0].sets).toHaveLength(2);
  });
});
