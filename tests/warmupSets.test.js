const W = require('../src/js/warmup-sets.js');

const weights = r => r.sets.map(s => s.weight);

describe('classifyExercise', () => {
  test.each([
    ['Barbell Back Squat', 'barbell', true],
    ['Bench Press', 'barbell', true],
    ['Deadlift', 'barbell', true],
    ['Dumbbell Bench Press', 'other', true],
    ['Leg Press', 'other', true],
    ['Smith Machine Squat', 'other', true],
    ['Lat Pulldown', 'other', true],
    ['Barbell Curl', 'barbell', false],
    ['Lateral Raise', 'other', false],
    ['Leg Extension', 'other', false],
  ])('%s', (name, equipment, compound) => {
    expect(W.classifyExercise(name)).toEqual({ equipment, compound });
  });
});

describe('buildWarmupSets', () => {
  test('barbell squat 5x5 at 100 kg: bar, 50%, 70%, 85% (BU worked example)', () => {
    const r = W.buildWarmupSets({ exercise: 'Squat', workWeight: 100, workReps: 5, unit: 'kg' });
    expect(r.reason).toBe('ramp');
    expect(weights(r)).toEqual([20, 50, 70, 85]);
    expect(r.sets.map(s => s.reps)).toEqual([8, 5, 3, 1]);
    expect(r.sets[0].isBar).toBe(true);
  });

  test('barbell at 8+ reps: bar, 50%, 70%', () => {
    const r = W.buildWarmupSets({ exercise: 'Bench Press', workWeight: 80, workReps: 8 });
    expect(weights(r)).toEqual([20, 40, 55]);
  });

  test('rounds to loadable plates and drops duplicate rungs', () => {
    const r = W.buildWarmupSets({ exercise: 'Bench Press', workWeight: 42.5, workReps: 10 });
    // 50% = 21.25 -> 22.5, too close to the bar (dropped); 70% = 29.75 -> 30
    expect(weights(r)).toEqual([20, 30]);
  });

  test('lbs use a 45 lb bar and 5 lb steps', () => {
    const r = W.buildWarmupSets({ exercise: 'Deadlift', workWeight: 315, workReps: 3, unit: 'lbs' });
    expect(weights(r)).toEqual([45, 160, 220, 270]);
  });

  test('barbell at or under the bar needs no ramp', () => {
    expect(W.buildWarmupSets({ exercise: 'Bench Press', workWeight: 20, workReps: 10 }).reason).toBe('light');
  });

  test('dumbbell / machine compound: 50% and 70%, no bar', () => {
    const r = W.buildWarmupSets({ exercise: 'Leg Press', workWeight: 200, workReps: 10 });
    expect(weights(r)).toEqual([100, 140]);
  });

  test('isolation: one set at about half', () => {
    const r = W.buildWarmupSets({ exercise: 'Lateral Raise', workWeight: 12, workReps: 12 });
    expect(weights(r)).toEqual([5]);
    expect(W.buildWarmupSets({ exercise: 'Barbell Curl', workWeight: 40, workReps: 10 }).sets.length).toBe(1);
  });

  test('muscle already trained today: no warm-up', () => {
    const r = W.buildWarmupSets({ exercise: 'Incline Bench Press', workWeight: 80, alreadyWarm: true });
    expect(r).toEqual({ sets: [], reason: 'warm' });
  });

  test('no weight: nothing', () => {
    expect(W.buildWarmupSets({ exercise: 'Pull-up', workWeight: 0 }).reason).toBe('none');
  });

  test('warm-up sets stay below the work weight and rise', () => {
    for (const w of [25, 37.5, 60, 142.5, 250]) {
      const s = weights(W.buildWarmupSets({ exercise: 'Squat', workWeight: w, workReps: 3 }));
      s.forEach((x, i) => { expect(x).toBeLessThan(w); if (i) expect(x).toBeGreaterThan(s[i - 1]); });
    }
  });
});

describe('pickWorkTarget', () => {
  test('heaviest suggested set wins', () => {
    const rec = { unit: 'kg', sets: [{ weight: 100, reps: 5 }, { weight: 102.5, reps: 3 }] };
    expect(W.pickWorkTarget(rec, null)).toEqual({ weight: 102.5, reps: 3, unit: 'kg', source: 'suggestion' });
  });
  test('falls back to last session', () => {
    const last = { unit: 'lbs', sets: [{ weight: 135, reps: 8 }] };
    expect(W.pickWorkTarget(null, last)).toEqual({ weight: 135, reps: 8, unit: 'lbs', source: 'last' });
  });
  test('nothing logged before: null', () => {
    expect(W.pickWorkTarget(null, null)).toBeNull();
  });
});

describe('today checks', () => {
  const muscle = n => (/bench|fly/i.test(n) ? 'chest' : /squat/i.test(n) ? 'quads' : 'other');
  const today = {
    log: [{ exercise: 'Bench Press', repsArray: [5], weightsArray: [100] }],
    warmups: [{ exercise: 'Squat', weight: 20, reps: 8 }],
  };

  test('another exercise for the same muscle warms it', () => {
    expect(W.findWarmingExercise('Cable Fly', today, muscle)).toBe('Bench Press');
  });
  test('warm-ups count as having trained the muscle', () => {
    expect(W.findWarmingExercise('Hack Squat', today, muscle)).toBe('Squat');
  });
  test('the exercise itself does not count', () => {
    expect(W.findWarmingExercise('Squat', today, muscle)).toBeNull();
  });
  test('unknown muscle never counts as warm', () => {
    expect(W.findWarmingExercise('Mystery Move', today, muscle)).toBeNull();
  });
  test('hasWorkSetToday / warmupsDoneFor', () => {
    expect(W.hasWorkSetToday('bench press', today)).toBe(true);
    expect(W.hasWorkSetToday('Squat', today)).toBe(false);
    expect(W.warmupsDoneFor('squat', today)).toHaveLength(1);
  });
});
