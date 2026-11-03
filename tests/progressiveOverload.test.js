const {
  getProgressiveOverloadSuggestion, suggestNextSession, suggestNextSet,
  setRir, liftType, weightStep
} = require('../progressiveOverload');

// One workout holding one exercise. sets: [[weight, reps, type?, rir?], ...]
const day = (exercise, sets, extra = {}, date) => ({
  date,
  log: [{
    exercise,
    unit: 'kg',
    weightsArray: sets.map(s => s[0]),
    repsArray: sets.map(s => s[1]),
    setTypeArray: sets.map(s => s[2] || 'standard'),
    rirArray: sets.map(s => (s[3] === undefined ? null : s[3])),
    ...extra
  }]
});

describe('effort and lift helpers', () => {
  test('RIR comes from chips, then per-set RPE, then entry fields, then the check-in', () => {
    expect(setRir({ rirArray: [1], targetRPE: 6 }, 0)).toBe(1);
    expect(setRir({ rpeArray: [8.5] }, 0)).toBe(1.5);
    expect(setRir({ rpeArray: [null], targetRIR: 3 }, 0)).toBe(3);
    expect(setRir({ targetRPE: 9 }, 0)).toBe(1);
    expect(setRir({ feltRIR: 4 }, 0)).toBe(4);
    expect(setRir({}, 0)).toBeNull();
  });

  test('lift type and weight step', () => {
    expect(liftType('Bench Press')).toBe('compound');
    expect(liftType('Lateral Raise')).toBe('isolation');
    expect(weightStep('Bench Press', 'kg')).toBe(2.5);
    expect(weightStep('Bench Press', 'lbs')).toBe(5);
    expect(weightStep('Dumbbell Press', 'kg')).toBe(1);
    expect(weightStep('Lateral Raise', 'lbs')).toBe(2.5);
  });
});

describe('suggestNextSession (top set drives progression)', () => {
  test('in range and on target → one more rep at the same weight', () => {
    const rec = suggestNextSession('Bench Press', [day('Bench Press', [[100, 8, 'standard', 2], [100, 8, 'standard', 2]], { repRange: '6-10' })]);
    expect(rec.strategy).toBe('increase-reps');
    expect(rec.topSet).toEqual({ weight: 100, reps: 9 });
    expect(rec.sets.map(s => s.reps)).toEqual([9, 9]);
  });

  test('top of the range at target effort → add weight and reset reps', () => {
    const rec = suggestNextSession('Bench Press', [day('Bench Press', [[100, 10, 'top-set', 2], [90, 8, 'backoff', 2]], { repRange: '6-10' })]);
    expect(rec.strategy).toBe('increase');
    expect(rec.topSet).toEqual({ weight: 102.5, reps: 6 });
    // Back-offs follow the next top set (−10%), not last week's back-off.
    expect(rec.sets[1]).toEqual({ weight: 92.5, reps: 8, setType: 'backoff' });
  });

  test('far easier than target → add weight now, keep reps', () => {
    const rec = suggestNextSession('Bench Press', [day('Bench Press', [[100, 7, 'standard', 5]], { repRange: '6-10' })]);
    expect(rec.strategy).toBe('increase');
    expect(rec.topSet).toEqual({ weight: 102.5, reps: 7 });
  });

  test('harder than planned or reps missed → repeat, never cut on one session', () => {
    const hard = suggestNextSession('Squat', [day('Squat', [[140, 6, 'standard', 0]], { repRange: '5-8' })]);
    expect(hard.strategy).toBe('repeat');
    expect(hard.topSet).toEqual({ weight: 140, reps: 6 });
    const missed = suggestNextSession('Squat', [day('Squat', [[140, 4, 'standard', 1]], { repRange: '5-8' })]);
    expect(missed.strategy).toBe('repeat');
    expect(missed.topSet.weight).toBe(140);
  });

  test('isolation lifts target ~1 rep left and use the small step', () => {
    const rec = suggestNextSession('Lateral Raise', [day('Lateral Raise', [[10, 15, 'standard', 0]], { repRange: '10-15' })]);
    expect(rec.liftType).toBe('isolation');
    expect(rec.strategy).toBe('increase');
    expect(rec.topSet).toEqual({ weight: 11, reps: 10 });
  });

  test('the top set is judged, not the back-offs', () => {
    const rec = suggestNextSession('Bench Press', [day('Bench Press', [[90, 4, 'backoff', 0], [100, 8, 'top-set', 2]], { repRange: '6-10' })]);
    expect(rec.strategy).toBe('increase-reps');
    expect(rec.topSet).toEqual({ weight: 100, reps: 9 });
  });

  test('Quick Log sets (one entry each) are merged into one session', () => {
    const w = {
      log: [
        { exercise: 'Bench Press', unit: 'kg', weightsArray: [100], repsArray: [10], setTypeArray: ['top-set'], rirArray: [2], repRange: '6-10' },
        { exercise: 'Bench Press', unit: 'kg', weightsArray: [90], repsArray: [8], setTypeArray: ['backoff'], rirArray: [2] },
        { exercise: 'Bench Press', unit: 'kg', weightsArray: [90], repsArray: [8], setTypeArray: ['backoff'], rirArray: [2] }
      ]
    };
    const rec = suggestNextSession('Bench Press', [w]);
    expect(rec.basedOnSessions).toBe(1);
    expect(rec.previousSets).toHaveLength(3);
    expect(rec.strategy).toBe('increase');
  });

  test('no range set → reps first hit at this weight, up to 2 more', () => {
    const workouts = [
      day('Row', [[60, 8, 'standard', 2]]),
      day('Row', [[60, 9, 'standard', 2]]),
      day('Row', [[60, 10, 'standard', 2]])
    ];
    const rec = suggestNextSession('Row', workouts);
    expect(rec.repRange).toEqual([8, 10]);
    expect(rec.strategy).toBe('increase');
    expect(rec.topSet).toEqual({ weight: 62.5, reps: 8 });
  });

  test('single rep target counts as both ends of the range', () => {
    const rec = suggestNextSession('Bench', [day('Bench', [[100, 8], [100, 8]], { repGoal: 8, targetRPE: 8 })]);
    expect(rec.strategy).toBe('increase');
    expect(rec.topSet).toEqual({ weight: 102.5, reps: 8 });
    expect(getProgressiveOverloadSuggestion('Bench', [day('Bench', [[100, 8]], { repGoal: 8, targetRPE: 8 })])).toMatch(/add weight/i);
  });

  test('stalled for 2 sessions with high effort → deload', () => {
    const workouts = [
      day('Squat', [[140, 6, 'standard', 2], [140, 6], [140, 6]], { repRange: '5-8' }),
      day('Squat', [[140, 6, 'standard', 1], [140, 6], [140, 6]], { repRange: '5-8' }),
      day('Squat', [[140, 5, 'standard', 0], [140, 5], [140, 5]], { repRange: '5-8' })
    ];
    const rec = suggestNextSession('Squat', workouts);
    expect(rec.strategy).toBe('deload');
    expect(rec.stalled).toBe(true);
    expect(rec.topSet.weight).toBe(125);
    expect(rec.sets).toHaveLength(2);
  });

  test('stalled but effort fine → keep progressing with a note, no deload', () => {
    const workouts = [
      day('Squat', [[140, 6, 'standard', 2]], { repRange: '5-8' }),
      day('Squat', [[140, 6, 'standard', 2]], { repRange: '5-8' }),
      day('Squat', [[140, 6, 'standard', 2]], { repRange: '5-8' })
    ];
    const rec = suggestNextSession('Squat', workouts);
    expect(rec.strategy).toBe('increase-reps');
    expect(rec.message).toMatch(/no progress for 2 sessions/i);
  });

  test('no effort logged → reps-only double progression with a nudge', () => {
    const rec = suggestNextSession('Press', [day('Press', [[50, 8]], { repRange: '6-10' })]);
    expect(rec.effort).toBe('unknown');
    expect(rec.strategy).toBe('increase-reps');
    expect(rec.message).toMatch(/reps left/i);
  });

  test('marked maxed out → more reps instead of more weight', () => {
    const rec = suggestNextSession('Leg Press', [day('Leg Press', [[200, 10, 'standard', 3], [200, 10]], { maxedOut: true })]);
    expect(rec.strategy).toBe('maxed-out');
    expect(rec.sets[0].weight).toBe(200);
    expect(rec.sets[0].reps).toBe(11);
    expect(rec.message).toMatch(/maxed out/i);
  });

  test('lbs use 5 lb steps', () => {
    const w = day('Bench Press', [[225, 10, 'standard', 2]], { repRange: '6-10', unit: 'lbs' });
    expect(suggestNextSession('Bench Press', [w]).topSet).toEqual({ weight: 230, reps: 6 });
  });
});

describe('suggestNextSet (in-session advice)', () => {
  const D = '2026-11-03';
  const today = (...entries) => [{ date: D, log: entries }];
  const set = (weight, reps, type, rir, extra = {}) => ({
    exercise: 'Bench Press', unit: 'kg', weightsArray: [weight], repsArray: [reps], setTypeArray: [type], rirArray: [rir], ...extra
  });

  test('nothing logged today → no next-set advice', () => {
    expect(suggestNextSet('Bench Press', [{ date: '2026-11-01', log: [set(100, 6, 'top-set', 2)] }], { date: D })).toBeNull();
  });

  test('after the top set, back-off weight depends on how it went', () => {
    const on = suggestNextSet('Bench Press', today(set(100, 6, 'top-set', 2)), { date: D });
    expect(on).toMatchObject({ kind: 'backoff', setType: 'backoff', weight: 90, reps: 6, repRange: [6, 8], restLabel: '2–3 min' });
    expect(suggestNextSet('Bench Press', today(set(100, 6, 'top-set', 0)), { date: D }).weight).toBe(85);
    expect(suggestNextSet('Bench Press', today(set(100, 6, 'top-set', 3)), { date: D }).weight).toBe(95);
  });

  test('back-off far too easy → add a step; on target → keep', () => {
    const easy = suggestNextSet('Bench Press', today(set(100, 6, 'top-set', 2), set(90, 8, 'backoff', 4)), { date: D });
    expect(easy.weight).toBe(92.5);
    const on = suggestNextSet('Bench Press', today(set(100, 6, 'top-set', 2), set(90, 7, 'backoff', 2)), { date: D });
    expect(on.weight).toBe(90);
    expect(on.reps).toBe(7);
  });

  test('reps below the range or harder than planned → drop ~5% or stop', () => {
    const rec = suggestNextSet('Bench Press', today(set(100, 6, 'top-set', 2), set(90, 4, 'backoff', 1)), { date: D });
    expect(rec.weight).toBe(85);
    expect(rec.warn).toBe(true);
    expect(rec.message).toMatch(/stop here/i);
  });

  test('failure on a compound gets a nudge; isolation rest is shorter', () => {
    const rec = suggestNextSet('Bench Press', today(set(100, 8, 'standard', 0, { repRange: '6-10' })), { date: D });
    expect(rec.message).toMatch(/leave 1–3 reps/i);
    const iso = suggestNextSet('Cable Fly', today({ ...set(20, 12, 'standard', 1), exercise: 'Cable Fly' }), { date: D });
    expect(iso.restLabel).toBe('~90 s');
    expect(iso.message).not.toMatch(/leave 1–3 reps/i);
  });

  test('no effort logged → keep, with a nudge', () => {
    const rec = suggestNextSet('Bench Press', today(set(100, 8, 'standard', null)), { date: D });
    expect(rec.weight).toBe(100);
    expect(rec.message).toMatch(/log reps left/i);
  });
});

describe('alt machine / alt gym entries', () => {
  const { isAltSessionEntry } = require('../progressiveOverload');
  const bench = (weight, extra = {}) => ({
    exercise: 'Bench', weightsArray: [weight], repsArray: [8], repGoal: 8, unit: 'kg', ...extra
  });

  test('isAltSessionEntry reads the entry tag, then the legacy workout tag', () => {
    expect(isAltSessionEntry(bench(100))).toBe(false);
    expect(isAltSessionEntry(bench(100, { sessionCtx: { altMachine: true } }))).toBe(true);
    expect(isAltSessionEntry(bench(100, { sessionCtx: { altGym: true, gymName: 'X' } }))).toBe(true);
    expect(isAltSessionEntry(bench(100), { _sessionCtx: { altGym: true } })).toBe(true);
    expect(isAltSessionEntry(bench(100), { _sessionCtx: { altGym: false, altMachine: false } })).toBe(false);
  });

  test('suggestion by name ignores the newer alt-gym session', () => {
    const workouts = [
      { log: [bench(100)] },
      { log: [bench(140, { sessionCtx: { altGym: true } })] }
    ];
    const next = suggestNextSession('Bench', workouts);
    expect(next.previousSets).toEqual([{ reps: 8, weight: 100 }]);
    expect(next.basedOnSessions).toBe(1);
  });

  test('legacy whole-workout tag is still skipped', () => {
    const workouts = [
      { log: [bench(100)] },
      { _sessionCtx: { altMachine: true }, log: [bench(60)] }
    ];
    expect(suggestNextSession('Bench', workouts).previousSets).toEqual([{ reps: 8, weight: 100 }]);
  });

  test('no suggestion is made from an alt entry itself', () => {
    const alt = bench(140, { sessionCtx: { altMachine: true } });
    expect(suggestNextSession(alt, [{ log: [bench(100)] }, { log: [alt] }])).toBeNull();
  });

  test('only alt sessions logged → nothing to base a suggestion on', () => {
    expect(suggestNextSession('Bench', [{ log: [bench(100, { sessionCtx: { altGym: true } })] }])).toBeNull();
  });

  const atGym = (weight, gymName, extra = {}) => bench(weight, { sessionCtx: { altMachine: false, altGym: true, gymName, ...extra } });

  test('at a saved gym, suggestions come from earlier visits to that gym only', () => {
    const workouts = [
      { log: [atGym(80, 'PureGym Soho')] },
      { log: [bench(100)] },
      { log: [atGym(60, 'Hotel')] },
    ];
    const here = suggestNextSession('Bench', workouts, { gymKey: 'puregym soho' });
    expect(here.previousSets).toEqual([{ reps: 8, weight: 80 }]);
    expect(here.basedOnSessions).toBe(1);
    // The usual gym still only sees usual-gym sessions.
    expect(suggestNextSession('Bench', workouts, { gymKey: '' }).previousSets).toEqual([{ reps: 8, weight: 100 }]);
    // A gym with no history has nothing to go on.
    expect(suggestNextSession('Bench', workouts, { gymKey: 'new place' })).toBeNull();
    // An unnamed gym is never compared.
    expect(suggestNextSession('Bench', workouts, { gymKey: null })).toBeNull();
  });

  test('gym names match regardless of case and spacing', () => {
    const workouts = [{ log: [atGym(80, '  PureGym   SOHO ')] }];
    expect(suggestNextSession('Bench', workouts, { gymKey: 'puregym soho' }).previousSets).toEqual([{ reps: 8, weight: 80 }]);
  });

  test('an entry at a named gym is judged against that gym', () => {
    const current = atGym(82.5, 'PureGym Soho');
    const workouts = [{ log: [atGym(80, 'PureGym Soho')] }, { log: [bench(100)] }, { log: [current] }];
    const next = suggestNextSession(current, workouts);
    expect(next).not.toBeNull();
    expect(next.basedOnSessions).toBe(2);
  });

  test('a different machine at a saved gym is still not compared', () => {
    const workouts = [{ log: [atGym(80, 'PureGym Soho', { altMachine: true })] }];
    expect(suggestNextSession('Bench', workouts, { gymKey: 'puregym soho' })).toBeNull();
  });
});

describe('isComparableEntry / entryGymKey', () => {
  const { isComparableEntry, entryGymKey } = require('../progressiveOverload');
  test('keys', () => {
    expect(entryGymKey({})).toBe('');
    expect(entryGymKey({ sessionCtx: { altMachine: true } })).toBeNull();
    expect(entryGymKey({ sessionCtx: { altGym: true, gymName: '' } })).toBeNull();
    expect(entryGymKey({ sessionCtx: { altGym: true, gymName: ' A  B ' } })).toBe('a b');
    expect(entryGymKey({}, { _sessionCtx: { altGym: true, gymName: 'X' } })).toBe('x');
  });
  test('comparable only at the same gym', () => {
    const e = { sessionCtx: { altGym: true, gymName: 'X' } };
    expect(isComparableEntry(e, null, 'x')).toBe(true);
    expect(isComparableEntry(e, null, '')).toBe(false);
    expect(isComparableEntry({}, null, '')).toBe(true);
    expect(isComparableEntry({}, null, null)).toBe(false);
  });
});
