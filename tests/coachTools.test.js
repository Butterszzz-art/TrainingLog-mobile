const { TOOL_DEFS, runTool, e1rm } = require('../src/coach/tools');
const { athleteContext } = require('../src/coach/prompt');

const pack = {
  generatedAt: '2026-09-23T07:00:00.000Z',
  workouts: [
    { date: '2026-09-02', title: 'Legs A', exercises: [{ name: 'Back Squat', sets: [{ w: 120, r: 5 }, { w: 105, r: 5 }] }] },
    { date: '2026-09-09', title: 'Legs A', exercises: [{ name: 'Back Squat', sets: [{ w: 120, r: 5, rpe: 9 }] }] },
    { date: '2026-09-16', title: 'Push B', exercises: [{ name: 'Bench Press', sets: [{ w: 85, r: 5 }] }] },
  ],
  bodyweight: [
    { date: '2026-09-01', kg: 82 }, { date: '2026-09-08', kg: 81.6 },
    { date: '2026-09-15', kg: 81.1 }, { date: '2026-09-22', kg: 80.6 },
  ],
  macros: { targets: { calories: 2400, protein: 180, carbs: 250, fat: 75 } },
  program: {
    id: 'p1', name: 'PPL',
    days: [{ name: 'Legs A', exercises: [{ name: 'Back Squat', sets: [{ reps: 5, weight: 120 }] }] }],
  },
};

describe('coach tools', () => {
  test('every tool definition has a closed object schema', () => {
    TOOL_DEFS.forEach(t => {
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.additionalProperties).toBe(false);
    });
  });

  test('e1rm uses Epley and ignores high-rep sets', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(120, 5)).toBeCloseTo(140);
    expect(e1rm(60, 20)).toBeNull();
  });

  test('exercise history fuzzy-matches and reports e1RM per session', () => {
    const out = runTool('get_exercise_history', { exercise: 'squat' }, pack);
    expect(out.result.matched).toEqual(['Back Squat']);
    expect(out.result.sessions).toHaveLength(2);
    expect(out.result.sessions[1]).toMatchObject({ date: '2026-09-09', topSet: '120×5', e1rmKg: 140 });
    expect(out.trace).toBe('Back Squat · 2 sessions');
    expect(out.chart.points).toHaveLength(2);
  });

  test('exercise history lists logged names when nothing matches', () => {
    const out = runTool('get_exercise_history', { exercise: 'deadlift' }, pack);
    expect(out.result.exercisesLogged).toEqual(['Back Squat', 'Bench Press']);
  });

  test('body metrics computes a weekly rate from the 7-day trend', () => {
    const out = runTool('get_body_metrics', { days: 60 }, pack);
    expect(out.result.ratePerWeekKg).toBeLessThan(0);
    expect(out.result.bodyweight).toHaveLength(4);
  });

  test('missing sections come back as unavailable, not as empty data', () => {
    const out = runTool('get_recovery', {}, { generatedAt: pack.generatedAt });
    expect(out.result.sleep).toMatch(/turned off/);
  });

  test('program change is validated against the real program', () => {
    const bad = runTool('propose_program_change', {
      title: 'x', day: 'Legs B', rationale: 'r', changes: [{ op: 'remove_exercise', exercise: 'Back Squat' }],
    }, pack);
    expect(bad.isError).toBe(true);
    expect(bad.result.error).toMatch(/Legs A/);

    const good = runTool('propose_program_change', {
      title: 'Restart squat', day: 'legs a', rationale: 'Stalled 3 weeks.',
      changes: [{ op: 'set_sets', exercise: 'Back Squat', sets: [{ reps: 3, weight: 125 }, { reps: 5, weight: 110 }] }],
    }, pack);
    expect(good.isError).toBeUndefined();
    expect(good.card).toMatchObject({ type: 'program_change', day: 'Legs A', programId: 'p1' });
    expect(good.card.changes[0].sets).toEqual([{ reps: 3, weight: 125 }, { reps: 5, weight: 110 }]);
  });

  test('macro proposal must add up', () => {
    const bad = runTool('propose_macro_targets', { calories: 3000, protein: 180, carbs: 250, fat: 75, rationale: '' }, pack);
    expect(bad.isError).toBe(true);
    const good = runTool('propose_macro_targets', { calories: 2500, protein: 180, carbs: 275, fat: 75, rationale: 'hungry' }, pack);
    expect(good.card.from).toEqual(pack.macros.targets);
    expect(good.card.to.carbs).toBe(275);
  });

  test('remember trims and returns a memory event', () => {
    expect(runTool('remember', { fact: '  Left shoulder:\n no BTN press ' }, pack).memory).toBe('Left shoulder: no BTN press');
  });

  test('unknown tools and bad input do not throw', () => {
    expect(runTool('nope', {}, pack).isError).toBe(true);
    expect(runTool('get_program', null, pack).isError).toBe(true);
  });
});

describe('coach prompt', () => {
  test('athlete context fences memory and notes turned-off data', () => {
    const text = athleteContext({
      profile: { name: 'Sam', unit: 'lbs' },
      memory: [{ text: 'Hates lunges' }],
      access: { recovery: false, workouts: true },
      style: 'hype',
      today: '2026-09-23',
    });
    expect(text).toMatch('<memory>\n- Hates lunges\n</memory>');
    expect(text).toMatch('turned off coach access to: recovery');
    expect(text).toMatch('logged in lbs');
    expect(text).toMatch(/energetic/);
  });
});
