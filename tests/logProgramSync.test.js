/**
 * TestFlight feedback: the training log and the program stayed two separate
 * logs, exercises couldn't be reordered, and a program restored from the
 * backend never loaded.
 */
const grouping = require('../src/js/session-grouping');
global.sessionGrouping = grouping;
const sc = require('../src/js/set-complete');
const sq = require('../src/js/session-queue');
const ps = require('../src/js/program-schedule');

const planned = (exercise, sets) => ({
  exercise,
  templateExerciseId: exercise.toLowerCase(),
  sets: sets.length,
  repsArray: sets.map(s => s[1]),
  weightsArray: sets.map(s => s[0]),
  setTypeArray: sets.map(() => 'standard'),
  completedArray: sets.map(() => false),
  skippedArray: sets.map(() => false),
  rirArray: sets.map(() => null),
});
const logged = (exercise, sets) => ({
  exercise,
  sets: sets.length,
  repsArray: sets.map(s => s[1]),
  weightsArray: sets.map(s => s[0]),
  setTypeArray: sets.map(() => 'standard'),
  completedArray: sets.map(() => false),
  skippedArray: sets.map(() => false),
  rirArray: sets.map(s => (s[2] === undefined ? null : s[2])),
  unit: 'kg',
});

describe('quick log fills the loaded plan', () => {
  test('a logged set ticks the next planned set of that exercise', () => {
    const log = [planned('Incline Machine Press', [[50, 6], [50, 6]]), planned('Cable Fly', [[30, 8]])];
    const res = sc.fillPlannedSets(log, logged('Incline Machine Press', [[52.5, 6, 1]]));
    expect(res.leftover).toBeNull();
    expect(log[0].completedArray).toEqual([true, false]);
    expect(log[0].weightsArray).toEqual([52.5, 50]);
    expect(log[0].rirArray[0]).toBe(1);
    expect(log).toHaveLength(2);
  });

  test('extra sets past the plan come back as a ticked leftover entry', () => {
    const log = [planned('Row', [[60, 8]])];
    const res = sc.fillPlannedSets(log, logged('Row', [[60, 8], [60, 7]]));
    expect(log[0].completedArray).toEqual([true]);
    expect(res.leftover.repsArray).toEqual([7]);
    expect(res.leftover.completedArray).toEqual([true]);
  });

  test('an exercise not in the plan is left to the normal path', () => {
    expect(sc.fillPlannedSets([planned('Row', [[60, 8]])], logged('Curl', [[14, 10]]))).toBeNull();
  });
});

describe('loading the program into a day already logged freeform', () => {
  test('one workout: logged sets count as done and replace planned ones, plan order kept', () => {
    const workout = {
      date: '2026-11-23', title: 'Workout on 2026-11-23',
      log: [logged('Curl', [[14, 10]]), logged('Cable Fly', [[30, 8], [30, 8]])],
    };
    const plan = [planned('Incline Press', [[50, 6], [50, 6]]), planned('Cable Fly', [[28, 8], [28, 8], [28, 8]])];
    sq.mergePlannedIntoWorkout(workout, plan, { source: 'program', planned: true, programDay: 'Chest & Back' }, 'Chest & Back');
    expect(workout.title).toBe('Chest & Back');
    expect(workout.metadata).toMatchObject({ source: 'program', planned: true });
    expect(workout.log.map(e => e.exercise)).toEqual(['Curl', 'Incline Press', 'Cable Fly', 'Cable Fly']);
    expect(workout.log[0].completedArray).toEqual([true]);
    expect(workout.log[2].completedArray).toEqual([true, true]);
    // Three planned Cable Fly sets, two already done: one left to do.
    expect(workout.log[3].repsArray).toEqual([8]);
    expect(workout.log[3].completedArray).toEqual([false]);
  });
});

describe('move an exercise up or down', () => {
  const log = [logged('A', [[1, 1]]), logged('B', [[1, 1]]), logged('A', [[2, 2]]), logged('C', [[1, 1]])];

  test('moves the whole card, its entries kept together', () => {
    const down = grouping.moveExercise(log, [0, 2], 1);
    expect(down.map(e => e.exercise)).toEqual(['B', 'A', 'A', 'C']);
    const up = grouping.moveExercise(log, [3], -1);
    expect(up.map(e => e.exercise)).toEqual(['A', 'A', 'C', 'B']);
  });

  test('null at the ends', () => {
    expect(grouping.moveExercise(log, [0, 2], -1)).toBeNull();
    expect(grouping.moveExercise(log, [3], 1)).toBeNull();
  });
});

describe('active program restored from the backend', () => {
  test('a whole program object stored as the active record still loads', () => {
    expect(ps.normalizeActiveRecord({ id: 'p1', name: 'PPL', startDate: '2026-11-02', days: [{}] }))
      .toEqual({ programId: 'p1', programName: 'PPL', startDate: '2026-11-02' });
    const rec = { programId: 'p2', programName: 'UL', startDate: '2026-11-02' };
    expect(ps.normalizeActiveRecord(rec)).toBe(rec);
    expect(ps.normalizeActiveRecord(null)).toBeNull();
  });

  test('getActiveSchedule finds it', () => {
    const store = {};
    global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    const program = { id: 'p1', name: 'PPL', startDate: '2026-11-02', frequency: ['Mon', 'Wed', 'Fri'], days: [{ name: 'Push', exercises: [] }] };
    store.programs_sam = JSON.stringify([program]);
    store.activeProgram_sam = JSON.stringify(program);
    expect(ps.getActiveSchedule('sam')).not.toBeNull();
  });
});

describe('replace exercise', () => {
  test('loaded session: done sets stay, the rest move to the new lift at its last weight', () => {
    const entry = planned('Lat Pulldown', [[91, 3], [87.5, 6], [87.5, 6]]);
    entry.completedArray = [true, false, false];
    entry.nextSessionRecommendation = { message: 'x' };
    const log = [planned('Low Row', [[60, 7]]), entry];
    const out = sc.replaceExercise(log, [1], 'One Arm Pulldown', { planned: true, lastWeightFor: () => 55 });
    expect(out.map(e => e.exercise)).toEqual(['Low Row', 'Lat Pulldown', 'One Arm Pulldown']);
    expect(out[1].repsArray).toEqual([3]);
    expect(out[1].completedArray).toEqual([true]);
    expect(out[2]).toMatchObject({ repsArray: [6, 6], weightsArray: [55, 55], completedArray: [false, false], replacedFrom: 'Lat Pulldown' });
    expect(out[2].nextSessionRecommendation).toBeUndefined();
    expect(log[1].exercise).toBe('Lat Pulldown'); // input untouched
  });

  test('nothing done yet: the whole card becomes the new lift', () => {
    const out = sc.replaceExercise([planned('Cable Fly', [[30, 8], [30, 8]])], [0], 'Pec Deck', { planned: true });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ exercise: 'Pec Deck', repsArray: [8, 8], weightsArray: [0, 0] });
  });

  test('freeform workout: a rename of every set', () => {
    const out = sc.replaceExercise([logged('Incline Press', [[50, 6], [50, 6]])], [0], 'Incline Machine Press', { planned: false });
    expect(out[0]).toMatchObject({ exercise: 'Incline Machine Press', weightsArray: [50, 50] });
  });
});
