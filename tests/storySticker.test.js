const { buildStickerData, sessionFocus, trendPoints } = require('../src/js/story-sticker');
const { getMuscleGroup } = require('../exerciseMuscleMap');

const set = (exercise, weights, reps) => ({ exercise, weightsArray: weights, repsArray: reps, unit: 'kg' });

const legDay = (date, extWeight, curlWeight = 70) => ({
  date,
  log: [set('Leg Extension', [extWeight, extWeight], [6, 6]), set('Seated Leg Curl', [curlWeight], [8])],
});

describe('buildStickerData', () => {
  test('totals volume, sets and unique exercises (duplicate entries count once)', () => {
    const w = {
      date: '2026-09-29',
      log: [set('Seated Leg Curl', [77.5], [7]), set('Seated Leg Curl', [82.5], [6]), set('Leg Extension', [170], [6])],
    };
    const d = buildStickerData(w, [w], getMuscleGroup);
    expect(d.volume).toBeCloseTo(77.5 * 7 + 82.5 * 6 + 170 * 6);
    expect(d.sets).toBe(3);
    expect(d.exercises).toBe(2);
    expect(d.topLift).toMatchObject({ exercise: 'Leg Extension', weight: 170, reps: 6 });
  });

  test('flags a PR when the top lift beats every earlier session', () => {
    const history = [legDay('2026-09-15', 150), legDay('2026-09-22', 160)];
    const today = legDay('2026-09-29', 170);
    const d = buildStickerData(today, history.concat(today), getMuscleGroup);
    expect(d.progress).toEqual({ kind: 'pr', text: 'New Leg Extension PR' });
    expect(d.trend).toHaveLength(3);
    expect(d.trend[2]).toBeGreaterThan(d.trend[0]);
  });

  test('compares volume with the last session of the same focus', () => {
    const lastLeg = legDay('2026-09-22', 170, 70);
    const push = { date: '2026-09-25', log: [set('Bench Press', [100], [5])] };
    const today = legDay('2026-09-29', 170, 70); // same weights, one extra set
    today.log.push(set('Seated Leg Curl', [70], [8]));
    const d = buildStickerData(today, [lastLeg, push, today], getMuscleGroup);
    expect(d.progress.kind).toBe('volume');
    expect(d.progress.text).toMatch(/^\d+% more volume than last leg day$/);
  });

  test('never shows a decline', () => {
    const lastLeg = legDay('2026-09-22', 170, 90);
    const today = legDay('2026-09-29', 160, 60);
    const d = buildStickerData(today, [lastLeg, today], getMuscleGroup);
    expect(d.progress).toBeNull();
  });

  test('first ever session has no trend line and no progress', () => {
    const today = legDay('2026-09-29', 170);
    const d = buildStickerData(today, [today], getMuscleGroup);
    expect(d.trend).toEqual([d.topLift.e1rm]);
    expect(d.progress).toBeNull();
  });

  test('ignores later sessions and duplicated archive copies', () => {
    const past = legDay('2026-09-22', 160);
    const copy = JSON.parse(JSON.stringify(past));
    const future = legDay('2026-10-06', 200);
    const today = legDay('2026-09-29', 170);
    const d = buildStickerData(today, [past, copy, future, today], getMuscleGroup);
    expect(d.trend).toHaveLength(2);
    expect(d.progress.kind).toBe('pr');
  });

  test('trend keeps at most the last 8 sessions', () => {
    const history = Array.from({ length: 12 }, (_, i) => legDay(`2026-07-${String(i + 1).padStart(2, '0')}`, 100 + i));
    const today = legDay('2026-09-29', 170);
    const d = buildStickerData(today, history.concat(today), getMuscleGroup);
    expect(d.trend).toHaveLength(8);
  });

  test('features the most improved lift, not just the heaviest', () => {
    const w = (date, press, ext) => ({ date, log: [set('Leg Press', [press], [10]), set('Leg Extension', [ext], [6])] });
    const today = w('2026-09-29', 200, 170);
    const d = buildStickerData(today, [w('2026-09-15', 200, 150), w('2026-09-22', 200, 160), today], getMuscleGroup);
    expect(d.topLift.exercise).toBe('Leg Extension');
    expect(d.progress).toEqual({ kind: 'pr', text: 'New Leg Extension PR' });
  });
});

describe('sessionFocus', () => {
  test('buckets by majority of sets', () => {
    expect(sessionFocus(legDay('2026-09-29', 100), getMuscleGroup)).toBe('leg');
    expect(sessionFocus({ log: [set('Bench Press', [1], [1]), set('Squat', [1], [1])] }, getMuscleGroup)).toBeNull();
  });
});

describe('trendPoints', () => {
  test('maps oldest to the left and the highest value to the top', () => {
    const pts = trendPoints([100, 110, 120], 200, 50);
    expect(pts[0]).toEqual({ x: 0, y: 50 });
    expect(pts[2]).toEqual({ x: 200, y: 0 });
  });
  test('needs two points', () => {
    expect(trendPoints([100], 200, 50)).toEqual([]);
  });
});
