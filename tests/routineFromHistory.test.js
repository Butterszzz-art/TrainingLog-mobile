const usual = require('../src/js/usual-session');
const todaySession = require('../src/js/today-session');
const sessionQueue = require('../src/js/session-queue');

function key(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// A fixed Wednesday so weekdays in the history are predictable.
const NOW = new Date(2026, 10, 11);
function daysAgo(n) {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  d.setDate(d.getDate() - n);
  return key(d);
}
function entry(exercise, reps, weight, n = 3) {
  return { exercise, repsArray: Array(n).fill(reps), weightsArray: Array(n).fill(weight) };
}
const push = d => ({ date: d, title: `Workout on ${d}`, log: [entry('Bench Press', 8, 80), entry('Overhead Press', 10, 40)] });
const pull = d => ({ date: d, title: `Workout on ${d}`, log: [entry('Barbell Row', 8, 70), entry('Lat Pulldown', 10, 55)] });
const legs = d => ({ date: d, title: `Workout on ${d}`, log: [entry('Back Squat', 5, 100), entry('Leg Press', 12, 150)] });
const muscleOf = n => ({ 'bench press': 'chest', 'overhead press': 'shoulders', 'barbell row': 'back', 'lat pulldown': 'back', 'back squat': 'legs', 'leg press': 'legs' }[n.toLowerCase()]);

describe('buildProgramFromHistory', () => {
  // Mon push, Wed pull, Fri legs for three weeks (NOW is a Wednesday).
  const history = [
    push(daysAgo(23)), pull(daysAgo(21)), legs(daysAgo(19)),
    push(daysAgo(16)), pull(daysAgo(14)), legs(daysAgo(12)),
    push(daysAgo(9)), pull(daysAgo(7)), legs(daysAgo(5)),
  ];

  test('one day per routine, usual next first, on the weekdays trained', () => {
    const plan = usual.buildProgramFromHistory(history, { now: NOW, muscleOf });
    expect(plan.days.map(d => d.name)).toEqual(['Chest & Shoulders', 'Back', 'Legs']);
    expect(plan.frequency).toEqual(['Mon', 'Wed', 'Fri']);
    expect(plan.name).toBe('Chest & Shoulders / Back / Legs');
    expect(plan.days[0].exercises[0]).toEqual({
      name: 'Bench Press',
      sets: [1, 2, 3].map(() => ({ setType: 'straight', reps: 8, weight: 80, restSec: 120 })),
    });
  });

  test('ignores one-off sessions and anything older than four weeks', () => {
    const plan = usual.buildProgramFromHistory([...history, { date: daysAgo(3), log: [entry('Hip Thrust', 10, 60)] }, push(daysAgo(40))], { now: NOW, muscleOf });
    expect(plan.days).toHaveLength(3);
    expect(plan.sessions).toBe(9);
  });

  test('null without a routine', () => {
    expect(usual.buildProgramFromHistory([push(daysAgo(2))], { now: NOW })).toBeNull();
    expect(usual.buildProgramFromHistory([], { now: NOW })).toBeNull();
  });

  test('long names fall back to "My routine"', () => {
    const named = history.map(w => ({ ...w, title: { 'Bench Press': 'Heavy Upper Push Session', 'Barbell Row': 'Heavy Upper Pull Session', 'Back Squat': 'Heavy Lower Session' }[w.log[0].exercise] }));
    expect(usual.buildProgramFromHistory(named, { now: NOW }).name).toBe('My routine');
  });
});

describe('sessionToTemplate / sameLifts', () => {
  test("today's merged lifts become template data the template loader reads", () => {
    const day = daysAgo(0);
    const session = usual.sessionsByDay([
      { date: day, log: [{ exercise: 'Bench Press', repsArray: [8], weightsArray: [80] }] },
      { date: day, log: [{ exercise: 'Bench Press', repsArray: [7], weightsArray: [80] }, entry('Dips', 10, 0, 2)] },
    ], { on: day })[0];
    const data = usual.sessionToTemplate(session, 'Push');
    expect(data.title).toBe('Push');
    expect(data.exercises.map(e => [e.name, e.sets.length])).toEqual([['Bench Press', 2], ['Dips', 2]]);
    expect(data.exercises[0].sets[1]).toMatchObject({ targetReps: 7, targetWeight: 80 });
    // Round-trips through the Phase 1 template reader.
    expect(todaySession.templateToDay(data, { name: 'Push' }).exercises[0].sets).toHaveLength(2);
  });

  test('sameLifts ignores order and case', () => {
    expect(usual.sameLifts(['Bench Press', 'Dips'], ['dips', 'bench press'])).toBe(true);
    expect(usual.sameLifts(['Bench Press'], ['Bench Press', 'Dips'])).toBe(false);
    expect(usual.sameLifts([], [])).toBe(false);
  });
});

describe('saveTodayAsRoutine', () => {
  let store;
  beforeEach(() => {
    store = {};
    global.localStorage = {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    };
    global.currentUser = 'athleteA';
    global.resistanceTemplatesCache = [];
    global.showToast = jest.fn();
    global.persistTemplateRecord = jest.fn((name, data) => {
      global.resistanceTemplatesCache.push({ id: `local_${name}`, name, data });
      return Promise.resolve();
    });
    todaySession.clearHistoryMemo();
  });
  afterEach(() => {
    delete global.persistTemplateRecord;
    delete global.resistanceTemplatesCache;
    delete global.showToast;
  });

  const today = () => key(new Date());

  test('offers and saves a freeform day once', () => {
    localStorage.setItem('workouts_athleteA', JSON.stringify([{ date: today(), log: [entry('Bench Press', 8, 80, 2), entry('Dips', 10, 0, 2)] }]));
    expect(sessionQueue.canSaveTodayAsRoutine(null)).toBe(true);
    const name = sessionQueue.saveTodayAsRoutine();
    expect(name).toBe('Bench Press day');
    expect(global.persistTemplateRecord).toHaveBeenCalledTimes(1);
    expect(global.persistTemplateRecord.mock.calls[0][1].exercises.map(e => e.name)).toEqual(['Bench Press', 'Dips']);
    // Same lifts are now a saved routine: not offered again, not saved twice.
    expect(sessionQueue.canSaveTodayAsRoutine(null)).toBe(false);
    expect(sessionQueue.saveTodayAsRoutine()).toBe('Bench Press day');
    expect(global.persistTemplateRecord).toHaveBeenCalledTimes(1);
  });

  test('a taken name gets a number', () => {
    global.resistanceTemplatesCache.push({ id: 'x', name: 'Bench Press day', data: { exercises: [{ name: 'Squat', sets: [{ targetReps: 5 }] }] } });
    localStorage.setItem('workouts_athleteA', JSON.stringify([{ date: today(), log: [entry('Bench Press', 8, 80, 2)] }]));
    expect(sessionQueue.saveTodayAsRoutine()).toBe('Bench Press day 2');
  });

  test('not offered with nothing lifted, or on a program or template day', () => {
    expect(sessionQueue.canSaveTodayAsRoutine(null)).toBe(false);
    localStorage.setItem('workouts_athleteA', JSON.stringify([{ date: today(), log: [entry('Bench Press', 8, 80, 2)] }]));
    expect(sessionQueue.canSaveTodayAsRoutine({ source: 'program' })).toBe(false);
    expect(sessionQueue.canSaveTodayAsRoutine({ source: 'template' })).toBe(false);
    expect(sessionQueue.canSaveTodayAsRoutine({ source: 'match' })).toBe(true);
  });
});
