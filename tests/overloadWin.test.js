const { JSDOM } = require('jsdom');

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

const win = require('../src/js/overload-win');
const { evaluateWin, describeWin, beats, alreadyCelebrated, markCelebrated } = win;

const TODAY = '2026-11-18';

function entry(exercise, sets, over = {}) {
  return Object.assign({
    exercise,
    sets: sets.length,
    weightsArray: sets.map(s => s[0]),
    repsArray: sets.map(s => s[1]),
    setTypeArray: sets.map(s => s[2] || 'standard'),
    rirArray: sets.map(s => (s[3] === undefined ? 2 : s[3])),
    unit: 'kg',
  }, over);
}

function workout(date, log, extra = {}) {
  return Object.assign({ date, log }, extra);
}

describe('beats', () => {
  test('more reps at the same weight', () => {
    expect(beats({ weight: 80, reps: 9 }, { weight: 80, reps: 8 })).toBe(true);
  });
  test('more weight at the same reps', () => {
    expect(beats({ weight: 82.5, reps: 8 }, { weight: 80, reps: 8 })).toBe(true);
  });
  test('more weight with a higher e1RM, fewer reps', () => {
    expect(beats({ weight: 90, reps: 6 }, { weight: 80, reps: 8 })).toBe(true);
  });
  test('a lighter high-rep set never beats a heavier top set', () => {
    expect(beats({ weight: 70, reps: 15 }, { weight: 80, reps: 8 })).toBe(false);
  });
  test('matching exactly is not a beat', () => {
    expect(beats({ weight: 80, reps: 8 }, { weight: 80, reps: 8 })).toBe(false);
  });
});

describe('evaluateWin', () => {
  test('followed the plan: hit the Add weight tip on the top set', () => {
    // Last time: top set 80 × 8 at the top of a 6–8 range → tip 82.5 × 6.
    const history = [
      workout('2026-11-14', [entry('Bench Press', [[80, 8, 'top-set'], [72.5, 10, 'backoff']], { repRange: '6-8' })]),
      workout(TODAY, [entry('Bench Press', [[82.5, 6, 'top-set'], [72.5, 10, 'backoff']], { repRange: '6-8' })]),
    ];
    const w = evaluateWin('Bench Press', history, TODAY);
    expect(w).not.toBeNull();
    expect(w.followed).toBe(true);
    expect(w.pastTip).toBe(false);
    expect(w.kind).toBe('weight');
    expect(w.delta).toBe(2.5);
    expect(w.today).toEqual({ weight: 82.5, reps: 6 });
    expect(w.last).toMatchObject({ weight: 80, reps: 8 });
    const copy = describeWin(w);
    expect(copy.title).toBe('You followed the plan');
    expect(copy.chips.map(c => c.text)).toContain('Suggestion matched');
  });

  test('beat the tip: more reps than suggested', () => {
    const history = [
      workout('2026-11-14', [entry('Bench Press', [[80, 8, 'top-set']], { repRange: '6-8' })]),
      workout(TODAY, [entry('Bench Press', [[82.5, 8, 'top-set']], { repRange: '6-8' })]),
    ];
    const w = evaluateWin('Bench Press', history, TODAY);
    expect(w.followed).toBe(true);
    expect(w.pastTip).toBe(true);
    expect(describeWin(w).title).toBe('Plan beaten');
  });

  test('beat last time without a loading tip: more reps at the same weight', () => {
    const history = [
      workout('2026-11-10', [entry('Incline DB Press', [[30, 10]])]),
      workout('2026-11-14', [entry('Incline DB Press', [[30, 10]])]),
      workout(TODAY, [entry('Incline DB Press', [[30, 12], [30, 11]])]),
    ];
    const w = evaluateWin('Incline DB Press', history, TODAY);
    expect(w).not.toBeNull();
    expect(w.beat).toBe(true);
    expect(w.kind).toBe('reps');
    expect(w.delta).toBe(2);
    expect(describeWin(w).deltaUnit).toBe('reps');
  });

  test('only the top set counts: back-off sets can not earn it', () => {
    const history = [
      workout('2026-11-14', [entry('Squat', [[120, 5, 'top-set'], [100, 8, 'backoff']], { repRange: '3-5' })]),
      // Top set matched exactly; back-offs got more reps and more weight.
      workout(TODAY, [entry('Squat', [[120, 5, 'top-set', 0], [110, 10, 'backoff']], { repRange: '3-5' })]),
    ];
    expect(evaluateWin('Squat', history, TODAY)).toBeNull();
  });

  test('a session of only back-off sets earns nothing', () => {
    const history = [
      workout('2026-11-14', [entry('Squat', [[120, 5, 'top-set']])]),
      workout(TODAY, [entry('Squat', [[125, 8, 'backoff']])]),
    ];
    expect(evaluateWin('Squat', history, TODAY)).toBeNull();
  });

  test('no card for a lift done for the first time', () => {
    expect(evaluateWin('Bench Press', [workout(TODAY, [entry('Bench Press', [[60, 8]])])], TODAY)).toBeNull();
  });

  test('no card for matching last time exactly', () => {
    const history = [
      workout('2026-11-14', [entry('Row', [[70, 10]])]),
      workout(TODAY, [entry('Row', [[70, 10]])]),
    ];
    expect(evaluateWin('Row', history, TODAY)).toBeNull();
  });

  test('no card when the tip was Repeat (last time missed reps)', () => {
    const history = [
      workout('2026-11-14', [entry('Bench Press', [[80, 5, 'top-set']], { repRange: '6-8' })]),
      workout(TODAY, [entry('Bench Press', [[80, 7, 'top-set']], { repRange: '6-8' })]),
    ];
    expect(evaluateWin('Bench Press', history, TODAY)).toBeNull();
  });

  test('no card at an alt gym', () => {
    const history = [
      workout('2026-11-14', [entry('Bench Press', [[80, 8]])]),
      workout(TODAY, [entry('Bench Press', [[90, 8]], { sessionCtx: { altGym: true, gymName: 'Hotel gym' } })]),
    ];
    expect(evaluateWin('Bench Press', history, TODAY)).toBeNull();
  });

  test('streak counts sessions in a row the top set went up', () => {
    const history = [
      workout('2026-11-04', [entry('Squat', [[110, 5, 'top-set']])]),
      workout('2026-11-08', [entry('Squat', [[110, 5, 'top-set']])]),
      workout('2026-11-11', [entry('Squat', [[115, 5, 'top-set']])]),
      workout('2026-11-14', [entry('Squat', [[117.5, 5, 'top-set']])]),
      workout(TODAY, [entry('Squat', [[120, 5, 'top-set']])]),
    ];
    const w = evaluateWin('Squat', history, TODAY);
    expect(w.streak).toBe(3);
    expect(describeWin(w).chips[0]).toEqual({ text: '🔥 3 sessions in a row', fire: true });
  });

  test('a one-session improvement shows no streak chip', () => {
    const history = [
      workout('2026-11-14', [entry('Row', [[70, 10]])]),
      workout(TODAY, [entry('Row', [[70, 11]])]),
    ];
    expect(evaluateWin('Row', history, TODAY).streak).toBe(0);
  });

  test('history order does not matter', () => {
    const history = [
      workout(TODAY, [entry('Row', [[72.5, 10]])]),
      workout('2026-11-14', [entry('Row', [[70, 10]])]),
    ];
    expect(evaluateWin('Row', history, TODAY)).toMatchObject({ kind: 'weight', delta: 2.5 });
  });
});

describe('once per exercise per session', () => {
  beforeEach(() => localStorage.clear());

  test('marks and recalls per day, case-insensitive', () => {
    expect(alreadyCelebrated('sam', TODAY, 'Bench Press')).toBe(false);
    markCelebrated('sam', TODAY, 'Bench Press');
    expect(alreadyCelebrated('sam', TODAY, 'bench press')).toBe(true);
    expect(alreadyCelebrated('sam', TODAY, 'Squat')).toBe(false);
    expect(alreadyCelebrated('sam', '2026-11-19', 'Bench Press')).toBe(false);
  });

  test('checkAndCelebrate fires once, then stays quiet for that lift today', () => {
    localStorage.setItem('fitnessAppUser', 'sam');
    localStorage.setItem('workouts_sam', JSON.stringify([
      workout('2026-11-14', [entry('Row', [[70, 10]])]),
      workout(TODAY, [entry('Row', [[70, 11]])]),
    ]));
    globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
    expect(win.checkAndCelebrate('Row', TODAY)).not.toBeNull();
    expect(document.getElementById('_overloadWin')).not.toBeNull();
    expect(win.checkAndCelebrate('Row', TODAY)).toBeNull();
    document.getElementById('_overloadWin')._close();
  });

  test('a PR card for the same lift gets the overload line instead of a second card', () => {
    document.body.innerHTML = `
      <div id="_prModal"><div class="pr-modal-items">
        <div class="pr-modal-item"><span class="pr-modal-item-name">Row</span><span class="pr-modal-item-detail">75 kg × 10</span></div>
      </div></div>`;
    localStorage.setItem('fitnessAppUser', 'sam');
    localStorage.setItem('workouts_sam', JSON.stringify([
      workout('2026-11-14', [entry('Row', [[70, 10]])]),
      workout(TODAY, [entry('Row', [[75, 10]])]),
    ]));
    expect(win.checkAndCelebrate('Row', TODAY)).not.toBeNull();
    expect(document.querySelector('.pr-modal-overload').textContent).toBe('↑ +5 kg vs last time');
    expect(document.getElementById('_overloadWin')).toBeNull();
  });
});
