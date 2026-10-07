const { buildWeightStoryData } = require('../src/js/weight-sticker');

// Daily weigh-ins from `start`, changing by `perDay` kg each day.
function series(start, days, from, perDay) {
  const out = [];
  const t0 = new Date(`${start}T00:00:00`);
  for (let i = 0; i < days; i++) {
    const d = new Date(t0);
    d.setDate(d.getDate() + i);
    out.push({ date: d.toISOString().slice(0, 10), weightKg: from + perDay * i });
  }
  return out;
}

describe('buildWeightStoryData', () => {
  test('needs at least two weigh-ins in range', () => {
    expect(buildWeightStoryData([])).toBeNull();
    expect(buildWeightStoryData([{ date: '2026-09-01', weightKg: 80 }])).toBeNull();
    // Two entries, but only the last falls inside 4 weeks.
    expect(buildWeightStoryData([{ date: '2026-01-01', weightKg: 82 }, { date: '2026-09-01', weightKg: 80 }], { range: '4w' })).toBeNull();
  });

  test('a cut on pace: change on the 7-day average, ON PLAN stamp and a plan line', () => {
    // −0.5 kg/week for 12 weeks
    const log = series('2026-06-01', 85, 90, -0.5 / 7);
    const d = buildWeightStoryData(log, { range: '12w', goal: 'cut', planKgPerWeek: -0.5 });
    expect(d.kicker).toBe('Cut · 12 weeks');
    expect(d.headline).toMatch(/^−[56]\.\d kg$/);
    expect(d.caption).toBe('down in 12 weeks');
    expect(d.stamp.text).toMatch(/^On plan · −0\.5 kg\/wk$/);
    expect(d.plan).toHaveLength(2);
    expect(d.trend[0].x).toBe(0);
    expect(d.trend[d.trend.length - 1].x).toBe(1);
  });

  test('a cut losing much faster than planned is "Ahead of plan"', () => {
    const log = series('2026-08-01', 29, 90, -1.2 / 7);
    const d = buildWeightStoryData(log, { range: '4w', goal: 'cut', planKgPerWeek: -0.5 });
    expect(d.stamp.text).toMatch(/^Ahead of plan/);
  });

  test('moving away from the goal shows consistency, never the wrong-way change', () => {
    const log = series('2026-08-01', 29, 80, 0.5 / 7);
    const d = buildWeightStoryData(log, { range: '4w', goal: 'cut', planKgPerWeek: -0.5 });
    expect(d.headline).toBe('29');
    expect(d.caption).toBe('weigh-ins in 4 weeks');
    expect(d.stamp).toBeNull();
    expect(d.plan).toBeNull();
  });

  test('maintenance inside the band is "held"', () => {
    const log = series('2026-08-01', 29, 80, 0.2 / 28);
    const d = buildWeightStoryData(log, { range: '4w', goal: 'maintain' });
    expect(d.headline).toBe('4 weeks');
    expect(d.caption).toMatch(/^held within 0\.\d kg$/);
    expect(d.stamp.text).toBe('Holding steady');
  });

  test('a bulk in lb converts every number', () => {
    const log = series('2026-08-01', 29, 70, 0.3 / 7);
    const d = buildWeightStoryData(log, { range: '4w', goal: 'bulk', planKgPerWeek: 0.3, unit: 'lb' });
    expect(d.unit).toBe('lb');
    expect(d.headline).toMatch(/^\+\d\.\d lb$/);
    expect(d.stamp.text).toMatch(/^On plan · \+0\.7 lb\/wk$/);
    expect(d.startText).toMatch(/ lb$/);
  });

  test('reads legacy entries (weight + unit) and keeps one reading per day', () => {
    const log = [
      { date: '2026-09-01', weight: 176.4, unit: 'lb' },
      { date: '2026-09-01', weight: 176.4, unit: 'lb' },
      { date: '2026-09-15', weight: '78', unit: 'kg' },
    ];
    const d = buildWeightStoryData(log, { range: 'all' });
    expect(d.entries).toBe(2);
    expect(d.points[0].kg).toBeCloseTo(80, 1);
    expect(d.points[1].kg).toBe(78);
  });

  test('without a goal it reports the signed change', () => {
    const log = series('2026-08-01', 29, 80, -0.4 / 7);
    const d = buildWeightStoryData(log, { range: '4w' });
    expect(d.kicker).toBe('Bodyweight · 4 weeks');
    expect(d.headline).toMatch(/^−\d\.\d kg$/);
    expect(d.caption).toBe('in 4 weeks');
  });
});
