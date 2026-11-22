const te = require('../coach/time-efficiency');
const M = require('../src/js/program-model');

const fullBody = () => ({ dayId: 'd1', label: 'Full A', exercises: [
  { id: 'e1', name: 'Hack Squat', sets: 3, type: 'compound' },
  { id: 'e2', name: 'Incline DB Press', sets: 3 },
  { id: 'e3', name: 'Leg Curl', sets: 3 },
  { id: 'e4', name: 'Chest Supported Row', sets: 3 },
  { id: 'e5', name: 'Overhead Cable Triceps Extension', sets: 3 },
  { id: 'e6', name: 'Lateral Raise', sets: 4 },
] });

describe('compressDay', () => {
  test('pairs antagonists like BU\'s worked example, partners side by side, letters in order', () => {
    const r = te.compressDay(fullBody());
    expect(r.pairs).toEqual([['Incline DB Press', 'Chest Supported Row'], ['Leg Curl', 'Overhead Cable Triceps Extension']]);
    expect(r.day.exercises.map(e => [e.name, e.superset || null])).toEqual([
      ['Hack Squat', null], ['Incline DB Press', 'A'], ['Chest Supported Row', 'A'],
      ['Leg Curl', 'B'], ['Overhead Cable Triceps Extension', 'B'], ['Lateral Raise', null],
    ]);
    expect(r.afterMin).toBeLessThan(r.beforeMin - 8);
  });

  test('the anchor lift and existing supersets are kept; input is not changed', () => {
    const day = fullBody();
    day.exercises[4].superset = 'A';
    day.exercises[5].superset = 'A';
    const r = te.compressDay(day);
    expect(r.day.exercises.find(e => e.name === 'Hack Squat').superset).toBeUndefined();
    expect(r.day.exercises.filter(e => e.superset === 'A').map(e => e.name)).toEqual(['Overhead Cable Triceps Extension', 'Lateral Raise']);
    expect(r.pairs).toHaveLength(1);
    expect(day.exercises[1].superset).toBeUndefined();
  });

  test('compressProgramDay applies to the same day in every week', () => {
    const program = { weeks: [{ days: [fullBody()] }, { days: [fullBody()] }] };
    te.compressProgramDay(program, 'd1');
    program.weeks.forEach(w => expect(w.days[0].exercises[1].superset).toBe('A'));
  });

  test('supersets survive the program model and reach the app as supersetGroup', () => {
    const r = te.compressDay(fullBody());
    const p = M.readProgram({ name: 'P', weeks: [{ days: [Object.assign({ weekday: 1 }, r.day)] }] });
    const lib = M.toLibrary(p, {});
    expect(lib.days[0].exercises.map(e => e.supersetGroup || null)).toEqual([null, 'A', 'A', 'B', 'B', null]);
    // Bad letters are dropped
    expect(M.readProgram({ name: 'P', weeks: [{ days: [{ weekday: 1, exercises: [{ name: 'Curl', superset: 'Z' }] }] }] }).weeks[0].days[0].exercises[0].superset).toBeUndefined();
  });
});

describe('sessionTimeCard', () => {
  const d = {
    sessionTimes: [
      { date: '2026-11-20', durationMin: 62, sets: 18, otherMin: 20, targetMin: 45 },
      { date: '2026-11-18', durationMin: 58, sets: 17, otherMin: 16, targetMin: 45 },
      { date: '2026-11-16', durationMin: 44, sets: 16, otherMin: 4 },
    ],
    weeklyMuscleSets: { quads: 9, chest: 3, back: 6.5 },
  };

  test('summarize', () => {
    expect(te.summarize(d.sessionTimes)).toEqual({ count: 3, avgMin: 55, avgTarget: 45, overCount: 2, targetCount: 2, minPerSet: 3.2, otherShare: 24 });
    expect(te.summarize([])).toBeNull();
  });

  test('card: average, target chip, over count, tip and muscle bands', () => {
    const html = te.sessionTimeCard(d);
    expect(html).toMatch(/Session time/);
    expect(html).toMatch(/2 of 2 ran 5\+ min over target/);
    expect(html).toMatch(/Compress/);
    expect(html).toMatch(/te-mus--ok[^>]*>Quads <b>9/);
    expect(html).toMatch(/te-mus--low[^>]*>Chest <b>3/);
    expect(html).toMatch(/te-mus--mid[^>]*>Back <b>6.5/);
  });

  test('empty and loading states', () => {
    expect(te.sessionTimeCard({}, { loading: true })).toMatch(/Loading/);
    expect(te.sessionTimeCard({})).toMatch(/Appears once/);
  });
});
