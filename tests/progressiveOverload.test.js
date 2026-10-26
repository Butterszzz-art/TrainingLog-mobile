const { getProgressiveOverloadSuggestion, suggestNextSession } = require('../progressiveOverload');

describe('getProgressiveOverloadSuggestion', () => {
  test('suggests weight and rep increase when goals met', () => {
    const workouts = [
      {
        log: [
          {
            exercise: 'Bench',
            weightsArray: [100, 100],
            repsArray: [8, 8],
            goal: 100,
            repGoal: 8,
            unit: 'kg',
            targetRPE: 8,
            rpeArray: [7.5, 8]
          }
        ]
      }
    ];
    const msg = getProgressiveOverloadSuggestion('Bench', workouts);
    expect(msg).toMatch(/target RPE/i);
    expect(msg).toMatch(/linear progression/i);
  });

  test('returns maintain/reduce signal when sets are failed', () => {
    const workouts = [
      {
        log: [
          {
            exercise: 'Squat',
            weightsArray: [100, 100],
            repsArray: [5, 5],
            completedArray: [true, false],
            unit: 'kg',
            targetRPE: 8,
            rpeArray: [8.5, 9]
          }
        ]
      }
    ];

    const recommendation = suggestNextSession('Squat', workouts);
    expect(recommendation.strategy).toBe('reduce');
    expect(recommendation.sets[0].weight).toBeLessThan(100);
  });

  test('uses average historical trend for progression rate', () => {
    const workouts = [
      { log: [{ exercise: 'Press', weightsArray: [50], repsArray: [8], unit: 'kg' }] },
      { log: [{ exercise: 'Press', weightsArray: [52.5], repsArray: [8], unit: 'kg' }] },
      { log: [{ exercise: 'Press', weightsArray: [55], repsArray: [8], unit: 'kg' }] }
    ];

    const recommendation = suggestNextSession('Press', workouts);
    expect(recommendation.averageRate.weightDelta).toBeGreaterThan(2);
    expect(recommendation.sets[0].weight).toBeGreaterThan(55);
  });

  test('suggests more reps instead of more weight when marked maxed out', () => {
    const workouts = [
      {
        log: [
          {
            exercise: 'Leg Press',
            weightsArray: [200, 200],
            repsArray: [10, 10],
            unit: 'kg',
            targetRPE: 8,
            rpeArray: [7, 7],
            maxedOut: true
          }
        ]
      }
    ];

    const recommendation = suggestNextSession('Leg Press', workouts);
    expect(recommendation.strategy).toBe('maxed-out');
    expect(recommendation.sets[0].weight).toBe(200);
    expect(recommendation.sets[0].reps).toBeGreaterThan(10);
    expect(recommendation.message).toMatch(/maxed out/i);
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
