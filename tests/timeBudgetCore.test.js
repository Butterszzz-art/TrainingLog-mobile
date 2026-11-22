const tb = require('../src/js/time-budget-core');
const { getMuscleGroup } = require('../exerciseMuscleMap');

const sets = (n, extra = {}) => Array.from({ length: n }, () => ({ reps: 10, weight: 50, ...extra }));

// BU's worked example: a full-body day that runs long as straight sets.
const fullBody = () => ({
  exercises: [
    { name: 'Hack Squat', sets: sets(3) },
    { name: 'Incline DB Press', sets: sets(3) },
    { name: 'Chest Supported Row', sets: sets(3) },
    { name: 'Seated Leg Curl', sets: sets(3) },
    { name: 'Overhead Cable Triceps Extension', sets: sets(3) },
    { name: 'Lateral Raise', sets: sets(4) },
  ],
});

describe('exercise classification', () => {
  test('compounds vs isolations', () => {
    ['Hack Squat', 'Incline DB Press', 'Chest Supported Row', 'Romanian Deadlift', 'Leg Press', 'Pull Up']
      .forEach(n => expect(tb.isCompound(n)).toBe(true));
    ['Lateral Raise', 'Seated Leg Curl', 'Leg Extension', 'Overhead Cable Triceps Extension', 'Cable Fly', 'Calf Raise']
      .forEach(n => expect(tb.isCompound(n)).toBe(false));
  });

  test('pairScore: antagonists and push/pull pair; same-muscle and heavy leg pairs do not', () => {
    expect(tb.pairScore('Incline DB Press', 'Chest Supported Row', getMuscleGroup)).toBe(3);
    expect(tb.pairScore('Seated Leg Curl', 'Leg Extension', getMuscleGroup)).toBe(3);
    expect(tb.pairScore('Seated Leg Curl', 'Overhead Cable Triceps Extension', getMuscleGroup)).toBe(2);
    expect(tb.pairScore('Bench Press', 'Incline DB Press', getMuscleGroup)).toBe(0);
    expect(tb.pairScore('Bench Press', 'Overhead Cable Triceps Extension', getMuscleGroup)).toBe(0);
    expect(tb.pairScore('Back Squat', 'Romanian Deadlift', getMuscleGroup)).toBe(0);
  });

  test('normaliseBudget only allows the offered budgets', () => {
    expect(tb.normaliseBudget(30)).toBe(30);
    expect(tb.normaliseBudget('45')).toBe(45);
    expect(tb.normaliseBudget(40)).toBeNull();
    expect(tb.normaliseBudget(null)).toBeNull();
  });
});

describe('restSecondsFor', () => {
  test('compound 2 min, isolation 75 s with no plan', () => {
    expect(tb.restSecondsFor('Back Squat', null, {}, {})).toBe(120);
    expect(tb.restSecondsFor('Lateral Raise', null, {}, {})).toBe(75);
  });

  test("the coach's planned rest wins over the default", () => {
    const day = { exercises: [{ name: 'Lateral Raise', sets: sets(3, { restSec: 60 }) }] };
    expect(tb.restSecondsFor('Lateral Raise', day, {}, {})).toBe(60);
  });

  test('short rest between superset halves while the partner has sets left', () => {
    const day = fullBody();
    const changes = { pairs: [['incline db press', 'chest supported row']] };
    expect(tb.restSecondsFor('Incline DB Press', day, { 'incline db press': 1 }, changes)).toBe(60); // both compound
    const iso = { pairs: [['seated leg curl', 'overhead cable triceps extension']] };
    expect(tb.restSecondsFor('Seated Leg Curl', day, { 'seated leg curl': 1 }, iso)).toBe(45);
    // Partner finished: back to normal rest
    expect(tb.restSecondsFor('Seated Leg Curl', day, { 'seated leg curl': 2, 'overhead cable triceps extension': 3 }, iso)).toBe(75);
  });

  test('planned supersets (supersetGroup) count as pairs', () => {
    const day = { exercises: [
      { name: 'Leg Curl', sets: sets(3), supersetGroup: 'A' },
      { name: 'Leg Extension', sets: sets(3), supersetGroup: 'A' },
    ] };
    expect(tb.partnerOf(day, 'leg curl', {})).toBe('leg extension');
    expect(tb.restSecondsFor('Leg Curl', day, { 'leg curl': 1 }, {})).toBe(45);
    expect(tb.nextInPair('Leg Curl', day, { 'leg curl': 1 }, {})).toBe('Leg Extension');
    expect(tb.nextInPair('Leg Curl', day, { 'leg curl': 3, 'leg extension': 3 }, {})).toBeNull();
  });
});

describe('estimates and pace', () => {
  test('a long straight-set day overruns a 30-min budget', () => {
    const p = tb.paceStatus({ day: fullBody(), done: {}, changes: {}, elapsedMs: 0, budgetMin: 30 });
    expect(p.plannedSets).toBe(19);
    expect(p.projectedMin).toBeGreaterThan(40);
    expect(p.status).toBe('behind');
    expect(p.overMin).toBeGreaterThan(10);
  });

  test('ahead / on / over / done', () => {
    const day = { exercises: [{ name: 'Lateral Raise', sets: sets(2) }] };
    expect(tb.paceStatus({ day, done: {}, elapsedMs: 0, budgetMin: 30 }).status).toBe('ahead');
    expect(tb.paceStatus({ day, done: {}, elapsedMs: 26 * 60000, budgetMin: 30 }).status).toBe('on');
    expect(tb.paceStatus({ day, done: {}, elapsedMs: 31 * 60000, budgetMin: 30 }).status).toBe('over');
    expect(tb.paceStatus({ day, done: { 'lateral raise': 2 }, elapsedMs: 31 * 60000, budgetMin: 30 }).status).toBe('done');
  });

  test('no budget: still estimates, never behind', () => {
    const p = tb.paceStatus({ day: fullBody(), done: {}, elapsedMs: 0, budgetMin: null });
    expect(p.budgetMin).toBeNull();
    expect(p.status).toBe('on');
    expect(tb.formatPace(p)).toMatch(/finish in ~\d+ min/);
  });

  test('cuts reduce planned sets; myo replaces remaining sets', () => {
    const day = fullBody();
    const base = tb.estimateRemainingSeconds(day, {}, {});
    expect(tb.estimateRemainingSeconds(day, {}, { cuts: { 'lateral raise': 1 } })).toBeLessThan(base);
    expect(tb.estimateRemainingSeconds(day, {}, { myo: ['lateral raise'] })).toBeLessThan(base);
    const items = tb.planItems(day, {}, { cuts: { 'lateral raise': 10 } });
    expect(items.find(i => i.key === 'lateral raise').planned).toBe(1); // never below one set
  });
});

describe('suggestCuts — BU order: pair, then myo-reps, then volume', () => {
  test('pairs come first, and the plan fits after applying the fixes', () => {
    const day = fullBody();
    const p = tb.paceStatus({ day, done: {}, elapsedMs: 0, budgetMin: 30 });
    const tips = tb.suggestCuts({ day, done: {}, overMin: p.overMin, muscleOf: getMuscleGroup, limit: 10 });
    expect(tips[0]).toMatchObject({ type: 'pair', keys: ['incline db press', 'chest supported row'] });
    const order = tips.map(t => t.type);
    const firstCut = order.indexOf('cut');
    if (firstCut >= 0) expect(order.slice(firstCut).every(t => t === 'cut')).toBe(true);
    let changes = {};
    tips.forEach((t) => { changes = tb.applySuggestion(changes, t); });
    expect(tb.estimateSessionMinutes(day, changes)).toBeLessThanOrEqual(34);
  });

  test('the anchor lift is never paired, myo-repped or cut', () => {
    const day = fullBody();
    const tips = tb.suggestCuts({ day, done: {}, overMin: 60, muscleOf: getMuscleGroup, limit: 50 });
    tips.forEach((t) => {
      expect(t.key).not.toBe('hack squat');
      if (t.keys) expect(t.keys).not.toContain('hack squat');
    });
  });

  test('a paired exercise is not also offered myo-reps', () => {
    const day = fullBody();
    const tips = tb.suggestCuts({ day, done: {}, overMin: 60, muscleOf: getMuscleGroup, limit: 50 });
    const paired = new Set(tips.filter(t => t.type === 'pair').flatMap(t => t.keys));
    tips.filter(t => t.type === 'myo').forEach(t => expect(paired.has(t.key)).toBe(false));
  });

  test('nothing to suggest when on pace', () => {
    expect(tb.suggestCuts({ day: fullBody(), done: {}, overMin: 0, muscleOf: getMuscleGroup })).toEqual([]);
  });

  test('started exercises are not offered as new pairs', () => {
    const day = fullBody();
    const done = { 'hack squat': 3, 'incline db press': 1 };
    const tips = tb.suggestCuts({ day, done, overMin: 20, muscleOf: getMuscleGroup, limit: 50 });
    tips.filter(t => t.type === 'pair').forEach(t => expect(t.keys).not.toContain('incline db press'));
  });
});

describe('countDoneSets', () => {
  test('sums entries per exercise and skips warm-ups', () => {
    const log = [
      { exercise: 'Hack Squat', repsArray: [5, 5, 8, 8], setTypeArray: ['warmup', 'warmup', 'standard', 'standard'] },
      { exercise: 'hack squat ', repsArray: [8] },
      { exercise: 'Lateral Raise', sets: 2 },
    ];
    expect(tb.countDoneSets(log)).toEqual({ 'hack squat': 3, 'lateral raise': 2 });
  });
});
