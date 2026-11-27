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

  test('beating last time still counts when the tip was Repeat (last time missed reps)', () => {
    const history = [
      workout('2026-11-14', [entry('Bench Press', [[80, 5, 'top-set']], { repRange: '6-8' })]),
      workout(TODAY, [entry('Bench Press', [[80, 7, 'top-set']], { repRange: '6-8' })]),
    ];
    const w = evaluateWin('Bench Press', history, TODAY);
    expect(w).toMatchObject({ beat: true, followed: false, kind: 'reps', delta: 2 });
  });

  test('a heavier weight than last time earns it even after a Repeat tip', () => {
    // Last time 12.5 × 6 at 0 RIR (harder than planned → Repeat); today 15 × 6.
    const history = [
      workout('2026-10-29', [entry('Single Overhead Extension', [[12.5, 6, 'standard', 0], [12.5, 6, 'standard', 0]])]),
      workout(TODAY, [entry('Single Overhead Extension', [[15, 6, 'standard', 1]])]),
    ];
    const w = evaluateWin('Single Overhead Extension', history, TODAY);
    expect(w).toMatchObject({ kind: 'weight', delta: 2.5, today: { weight: 15, reps: 6 } });
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

describe('back-off sets and rep PRs', () => {
  test('a back-off that beats last time\'s back-off earns a card', () => {
    const history = [
      workout('2026-11-14', [entry('Single Overhead Extension', [[15, 6, 'top-set'], [14, 6, 'backoff']])]),
      workout(TODAY, [entry('Single Overhead Extension', [[15, 6, 'top-set'], [14, 8, 'backoff', 0]])]),
    ];
    const wins = win.evaluateBackoffWins('Single Overhead Extension', history, TODAY);
    expect(wins).toHaveLength(1);
    expect(wins[0]).toMatchObject({ scope: 'backoff', index: 0, kind: 'reps', delta: 2 });
    expect(describeWin(wins[0]).kicker).toBe('Back-off beaten');
  });

  test('untagged lighter sets after the top set count as back-offs', () => {
    const history = [
      workout('2026-11-14', [entry('Low Row', [[60, 7], [50, 8]])]),
      workout(TODAY, [entry('Low Row', [[60, 7], [52.5, 8]])]),
    ];
    const wins = win.evaluateBackoffWins('Low Row', history, TODAY);
    expect(wins[0]).toMatchObject({ kind: 'weight', delta: 2.5 });
  });

  test('rep PR: more reps than ever at a weight done before', () => {
    const history = [
      workout('2026-11-01', [entry('Curl', [[14, 7], [16, 5]])]),
      workout('2026-11-14', [entry('Curl', [[16, 6], [14, 6]])]),
      workout(TODAY, [entry('Curl', [[16, 6], [14, 8]])]),
    ];
    const prs = win.evaluateRepPRs('Curl', history, TODAY);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ scope: 'rep-pr', today: { weight: 14, reps: 8 }, last: { weight: 14, reps: 7 }, delta: 1 });
    expect(describeWin(prs[0]).title).toBe('Most reps ever at 14 kg');
  });

  test('no rep PR at a brand-new weight, or when a heavier set had more reps', () => {
    const history = [
      workout('2026-11-14', [entry('Curl', [[16, 9], [14, 6]])]),
      workout(TODAY, [entry('Curl', [[18, 6], [14, 8]])]),
    ];
    expect(win.evaluateRepPRs('Curl', history, TODAY)).toEqual([]);
  });

  test('checkAndCelebrate: top set first, then the back-off gets its own card', () => {
    document.body.innerHTML = '';
    localStorage.clear();
    localStorage.setItem('fitnessAppUser', 'kim');
    globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
    localStorage.setItem('workouts_kim', JSON.stringify([
      workout('2026-11-14', [entry('Press', [[40, 6, 'top-set'], [35, 8, 'backoff']])]),
      workout(TODAY, [entry('Press', [[42.5, 6, 'top-set']])]),
    ]));
    expect(win.checkAndCelebrate('Press', TODAY)).toMatchObject({ kind: 'weight' });
    document.getElementById('_overloadWin')._close();
    localStorage.setItem('workouts_kim', JSON.stringify([
      workout('2026-11-14', [entry('Press', [[40, 6, 'top-set'], [35, 8, 'backoff']])]),
      workout(TODAY, [entry('Press', [[42.5, 6, 'top-set'], [35, 10, 'backoff']])]),
    ]));
    const second = win.checkAndCelebrate('Press', TODAY);
    expect(second).toMatchObject({ scope: 'rep-pr', today: { weight: 35, reps: 10 } });
    expect(win.checkAndCelebrate('Press', TODAY)).toBeNull();
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

describe('success buzz', () => {
  afterEach(() => {
    delete globalThis.Capacitor;
    delete globalThis.navigator.vibrate;
  });

  test('native app: uses the Haptics plugin, not vibrate', async () => {
    const notification = jest.fn(() => Promise.resolve());
    globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: { notification } } };
    globalThis.navigator.vibrate = jest.fn();
    win.haptic();
    await Promise.resolve();
    expect(notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    expect(globalThis.navigator.vibrate).not.toHaveBeenCalled();
  });

  test('native call fails: falls back to vibrate', async () => {
    globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: { notification: () => Promise.reject(new Error('no')) } } };
    globalThis.navigator.vibrate = jest.fn();
    win.haptic();
    await new Promise(r => setTimeout(r, 0));
    expect(globalThis.navigator.vibrate).toHaveBeenCalledWith([12, 40, 18]);
  });

  test('web: vibrate only', () => {
    globalThis.Capacitor = { isNativePlatform: () => false, Plugins: {} };
    globalThis.navigator.vibrate = jest.fn();
    win.haptic();
    expect(globalThis.navigator.vibrate).toHaveBeenCalled();
  });
});

describe('another gym (Alt Gym session context)', () => {
  const alt = { sessionCtx: { altMachine: false, altGym: true, gymName: 'Home' } };
  const history = [
    workout('2026-11-14', [entry('Seated Band Hamstring Curl', [[68, 6, 'top-set', 1], [63, 7, 'backoff', 0]], alt)]),
    workout(TODAY, [entry('Seated Band Hamstring Curl', [[70, 5, 'top-set']], alt)]),
  ];

  test('beating last time at the same gym earns the card', () => {
    const w = evaluateWin('Seated Band Hamstring Curl', history, TODAY, undefined, 'home');
    expect(w).not.toBeNull();
    expect(w.today).toEqual({ weight: 70, reps: 5 });
    expect(w.last).toMatchObject({ weight: 68, reps: 6 });
  });

  test('usual-gym comparison still ignores those sets', () => {
    expect(evaluateWin('Seated Band Hamstring Curl', history, TODAY)).toBeNull();
  });

  test('an unnamed alt gym has nothing to compare with', () => {
    expect(evaluateWin('Seated Band Hamstring Curl', history, TODAY, undefined, null)).toBeNull();
  });
});
