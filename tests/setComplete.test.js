const { JSDOM } = require('jsdom');
const overload = require('../progressiveOverload');

// set-complete.js attaches to `window` in the app, globalThis here.
const window = globalThis;
const dom = new JSDOM('<!DOCTYPE html><body></body>');
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
const _store = {};
globalThis.localStorage = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: k => { delete _store[k]; },
  clear: () => { Object.keys(_store).forEach(k => delete _store[k]); },
};

function plannedWorkout(log, date = '2026-11-17') {
  return { title: 'Upper A', date, metadata: { source: 'program', planned: true, programDay: 'Upper A' }, log, restBreaks: [] };
}

function benchEntry(over = {}) {
  return Object.assign({
    exercise: 'Bench Press',
    sets: 3,
    repsArray: [5, 8, 8],
    weightsArray: [100, 100, 100],
    rirArray: [null, null, null],
    completedArray: [false, false, false],
    skippedArray: [false, false, false],
    setTypeArray: ['top-set', 'backoff', 'backoff'],
    unit: 'kg',
    date: '2026-11-17',
  }, over);
}

function load() {
  jest.resetModules();
  window.suggestNextSet = overload.suggestNextSet;
  window.suggestNextSession = overload.suggestNextSession;
  return require('../src/js/set-complete');
}

describe('set-complete pure helpers', () => {
  const sc = load();

  test('completedEntry keeps only ticked sets, index-aligned', () => {
    const e = benchEntry({ completedArray: [true, false, true], rirArray: [1, null, 2] });
    const c = sc.completedEntry(e);
    expect(c.repsArray).toEqual([5, 8]);
    expect(c.rirArray).toEqual([1, 2]);
    expect(c.setTypeArray).toEqual(['top-set', 'backoff']);
    expect(c.sets).toBe(2);
    expect(sc.completedEntry(benchEntry())).toBeNull();
  });

  test('completedWorkouts narrows only planned workouts', () => {
    const manual = { date: '2026-11-16', log: [benchEntry()] };
    const out = sc.completedWorkouts([manual, plannedWorkout([benchEntry()])]);
    expect(out[0]).toBe(manual);
    expect(out[1].log).toEqual([]);
  });

  test('nextOpenSet skips ticked and skipped sets across a block', () => {
    const log = [benchEntry({ completedArray: [true, true, true] }), benchEntry({ completedArray: [false, false, false], skippedArray: [true, false, false] })];
    expect(sc.nextOpenSet(log, [0, 1])).toEqual([1, 1]);
    expect(sc.nextOpenSet([benchEntry({ completedArray: [true, true, true] })], [0])).toBeNull();
  });

  test('applyBackoffWeight fills open back-off sets only', () => {
    const w = plannedWorkout([benchEntry({ completedArray: [true, true, false] })]);
    expect(sc.applyBackoffWeight(w, 'bench press', 90)).toBe(1);
    expect(w.log[0].weightsArray).toEqual([100, 100, 90]);
  });

  test('applyBackoffWeight leaves a back-off weight the plan prescribed', () => {
    const w = plannedWorkout([benchEntry({ plannedBackoffWeight: true })]);
    expect(sc.applyBackoffWeight(w, 'Bench Press', 90)).toBe(0);
    expect(w.log[0].weightsArray).toEqual([100, 100, 100]);
  });

  test('restSecondsFor: plan, then advice, then 2 min', () => {
    expect(sc.restSecondsFor({ restSec: 180 }, 0, { restSeconds: 90 })).toBe(180);
    expect(sc.restSecondsFor({ setDefinitions: [{ restSeconds: 75 }] }, 0, null)).toBe(75);
    expect(sc.restSecondsFor({}, 0, { restSeconds: 150 })).toBe(150);
    expect(sc.restSecondsFor({}, 0, null)).toBe(120);
  });
});

describe('completeSet', () => {
  let sc;
  let started;
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    sc = load();
    window.currentUser = 'u1';
    started = [];
    window.startRestTimerSeconds = s => started.push(s);
    window.renderWorkouts = jest.fn();
    window.showToast = jest.fn();
    delete window.PerformanceMode;
  });
  afterEach(() => jest.useRealTimers());

  function save(workouts) { localStorage.setItem('workouts_u1', JSON.stringify(workouts)); }
  function stored() { return JSON.parse(localStorage.getItem('workouts_u1')); }

  test('ticking the top set logs it, works out the back-offs and starts rest', () => {
    save([plannedWorkout([benchEntry({ rirArray: [1, null, null] })])]);
    const logged = jest.fn();
    document.addEventListener('tl:set-logged', logged);

    const advice = sc.completeSet(0, 0, 0, true);
    jest.runAllTimers();

    const e = stored()[0].log[0];
    expect(e.completedArray).toEqual([true, false, false]);
    expect(advice.kind).toBe('backoff');
    // Back-offs worked out from the top set (100 kg, on target → −10%).
    expect(e.weightsArray[0]).toBe(100);
    expect(e.weightsArray[1]).toBe(advice.weight);
    expect(e.weightsArray[2]).toBe(advice.weight);
    expect(advice.weight).toBeLessThan(100);
    // The advice sits on the exercise's card (renderSetAdvice), not in a toast.
    expect(e.setAdvice).toMatchObject({ kind: 'backoff', weight: advice.weight, warn: false });
    expect(e.setAdvice.message).toContain('Back-off sets updated');
    expect(window.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Back-off'), expect.anything());
    expect(logged).toHaveBeenCalledTimes(1);
    expect(started).toEqual([advice.restSeconds]);
    document.removeEventListener('tl:set-logged', logged);
  });

  test('the plan\'s rest wins over the advice', () => {
    save([plannedWorkout([benchEntry({ restSec: 200 })])]);
    sc.completeSet(0, 0, 0, true);
    jest.runAllTimers();
    expect(started).toEqual([200]);
  });

  test('performance mode keeps its own rest unless the plan sets one', () => {
    window.PerformanceMode = { getSettings: () => ({ active: true }) };
    save([plannedWorkout([benchEntry()])]);
    sc.completeSet(0, 0, 0, true);
    jest.runAllTimers();
    expect(started).toEqual([]);
  });

  test('unticking only clears the tick', () => {
    save([plannedWorkout([benchEntry({ completedArray: [true, false, false] })])]);
    expect(sc.completeSet(0, 0, 0, false)).toBeNull();
    jest.runAllTimers();
    expect(stored()[0].log[0].completedArray).toEqual([false, false, false]);
    expect(started).toEqual([]);
  });

  test('RIR and Top/BO are kept per set, and tapping again clears them', () => {
    save([plannedWorkout([benchEntry({ setTypeArray: ['standard', 'standard', 'standard'] })])]);
    sc.setSetRir(0, 0, 1, 2);
    expect(stored()[0].log[0].rirArray[1]).toBe(2);
    sc.setSetRir(0, 0, 1, 2);
    expect(stored()[0].log[0].rirArray[1]).toBeNull();
    sc.setSetRole(0, 0, 0, 'top');
    expect(stored()[0].log[0].setTypeArray[0]).toBe('top-set');
    sc.setSetRole(0, 0, 0, 'backoff');
    expect(stored()[0].log[0].setTypeArray[0]).toBe('backoff');
    sc.setSetRole(0, 0, 0, 'backoff');
    expect(stored()[0].log[0].setTypeArray[0]).toBe('standard');
  });

  test('next-session advice is judged on ticked sets only', () => {
    save([plannedWorkout([benchEntry({ setTypeArray: ['standard', 'standard', 'standard'], weightsArray: [60, 200, 200] })])]);
    sc.completeSet(0, 0, 0, true);
    const rec = stored()[0].log[0].nextSessionRecommendation;
    expect(rec).toBeTruthy();
    expect(rec.previousSets).toEqual([{ reps: 5, weight: 60 }]);
  });
});

describe('in-card set advice', () => {
  test('unticking clears it; dismiss clears every entry of the lift', () => {
    const sc2 = require('../src/js/set-complete');
    const entry = { exercise: 'Row', setAdvice: { message: 'x' } };
    sc2.stampSetAdvice(entry, null, 0);
    expect(entry.setAdvice).toBeUndefined();
    sc2.stampSetAdvice(entry, { message: 'Drop to 80 kg', warn: true, weight: 80, reps: 6, unit: 'kg' }, 0);
    expect(entry.setAdvice).toMatchObject({ message: 'Drop to 80 kg', warn: true, weight: 80, reps: 6 });
  });
});
