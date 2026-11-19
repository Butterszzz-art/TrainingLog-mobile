// Runs in Europe/Amsterdam: Jest's globalSetup (tests/setup/timezone.js) pins the zone.
const N = require('../src/js/coach-nudges-core');

// Thursday 19 November 2026, local time.
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 11, 19, 6, 0); // Thu 06:00
const settings = (over = {}) => N.normalizeSettings(Object.entries(over).map(([id, v]) => ({ id, ...v })));
const kinds = list => list.map(p => `${p.date} ${p.kind}`);

describe('normalizeSettings', () => {
  test('defaults: train, food, weigh-in, check-in on; sleep and water off', () => {
    const s = N.normalizeSettings(null);
    expect(s.map(x => x.id)).toEqual(['workout', 'food', 'weighin', 'checkin', 'sleep', 'water']);
    expect(s.filter(x => x.enabled).map(x => x.id)).toEqual(['workout', 'food', 'weighin', 'checkin']);
  });

  test('keeps the old reminders.js list and fixes bad values', () => {
    const s = N.normalizeSettings([
      { id: 'workout', label: 'Workout reminder', time: '18:15', days: [1, 3, 3, 9], enabled: false, message: 'x' },
      { id: 'weighin', time: '7:30', enabled: true },
    ]);
    expect(s[0]).toEqual({ id: 'workout', enabled: false, time: '18:15', days: [1, 3] });
    expect(s[2].time).toBe('07:30'); // invalid → default
  });
});

describe('planNudges', () => {
  test('plans 7 days of food and weigh-in pings, check-ins only when due', () => {
    const list = N.planNudges({ settings: settings({ workout: { enabled: false } }), now: NOW, checkinDates: ['2026-11-22'] });
    expect(list.filter(p => p.kind === 'food')).toHaveLength(7);
    expect(list.filter(p => p.kind === 'weighin')).toHaveLength(7);
    expect(list.filter(p => p.kind === 'checkin').map(p => p.date)).toEqual(['2026-11-22']);
    // soonest first, at the set local time
    expect(list[0].kind).toBe('weighin');
    expect(new Date(list[0].at).getHours()).toBe(7);
    expect(new Date(list[0].at).getMinutes()).toBe(30);
  });

  test('no check-in rhythm: no check-in ping', () => {
    const list = N.planNudges({ settings: settings(), now: NOW, checkinDates: [] });
    expect(list.some(p => p.kind === 'checkin')).toBe(false);
  });

  test('skips today when it is already done, but not later days', () => {
    const list = N.planNudges({ settings: settings(), now: NOW, done: { weighin: true, food: true } });
    expect(list.some(p => p.date === '2026-11-19' && (p.kind === 'weighin' || p.kind === 'food'))).toBe(false);
    expect(list.some(p => p.date === '2026-11-20' && p.kind === 'weighin')).toBe(true);
  });

  test('skips times that already passed today', () => {
    const list = N.planNudges({ settings: settings(), now: at(2026, 11, 19, 9, 0) });
    expect(list.some(p => p.date === '2026-11-19' && p.kind === 'weighin')).toBe(false);
    expect(list.some(p => p.date === '2026-11-19' && p.kind === 'food')).toBe(true);
  });

  test('workout: follows the program and names the session; rest days are quiet', () => {
    const training = new Map([['2026-11-19', 'Push A · Week 2'], ['2026-11-21', 'Legs']]);
    const list = N.planNudges({ settings: settings(), now: NOW, training }).filter(p => p.kind === 'workout');
    expect(list.map(p => p.date)).toEqual(['2026-11-19', '2026-11-21']); // Sat counts, Fri doesn't
    expect(list.every(p => p.tab === 'logTab')).toBe(true);
    // Same day → same line on every re-plan.
    const again = N.planNudges({ settings: settings(), now: NOW + 60000, training }).filter(p => p.kind === 'workout');
    expect(again.map(p => p.title)).toEqual(list.map(p => p.title));
  });

  test('workout without a program uses the chosen days', () => {
    const list = N.planNudges({ settings: settings({ workout: { days: [1, 3] } }), now: NOW, training: null }).filter(p => p.kind === 'workout');
    expect(list.map(p => p.date)).toEqual(['2026-11-23', '2026-11-25']); // Mon, Wed
    list.forEach(p => expect(p.title + p.body).not.toMatch(/\{/));
  });

  test('workout logged today: no ping today', () => {
    const training = { '2026-11-19': 'Pull' };
    expect(N.planNudges({ settings: settings(), now: NOW, training, done: { workout: true } }).some(p => p.kind === 'workout')).toBe(false);
  });

  test('check-in ping names the coach when coached', () => {
    const [p] = N.planNudges({ settings: settings(), now: NOW, checkinDates: ['2026-11-19'], coach: 'sam' }).filter(x => x.kind === 'checkin');
    expect(p.body).toContain('sam');
    expect(p.tab).toBe('checkInTab');
    const [self] = N.planNudges({ settings: settings(), now: NOW, checkinDates: ['2026-11-19'] }).filter(x => x.kind === 'checkin');
    expect(self.body).not.toMatch(/\{|undefined/);
  });

  test('paused (vacation / sick): nothing', () => {
    expect(N.planNudges({ settings: settings(), now: NOW, paused: true })).toEqual([]);
  });

  test('ids are stable per kind and day and inside allIds', () => {
    const list = N.planNudges({ settings: settings({ sleep: { enabled: true }, water: { enabled: true } }), now: NOW, checkinDates: ['2026-11-20'] });
    const ids = new Set(N.allIds());
    list.forEach(p => expect(ids.has(p.id)).toBe(true));
    expect(new Set(list.map(p => p.id)).size).toBe(list.length);
    expect(N.idFor('food', 0)).toBe(N.idFor('food', 0));
    // Clear of the meal reminders (7100-7179).
    N.allIds().forEach(id => expect(id).toBeGreaterThanOrEqual(7300));
  });

  test('never more than MAX pings (iOS limit is shared with meal reminders)', () => {
    const all = settings({ sleep: { enabled: true }, water: { enabled: true }, workout: { days: [0, 1, 2, 3, 4, 5, 6] } });
    const days = Array.from({ length: 7 }, (_, i) => N.dateKey(NOW + i * 86400000));
    const list = N.planNudges({ settings: all, now: NOW, checkinDates: days });
    expect(list.length).toBe(N.MAX);
    expect(list.every((p, i) => i === 0 || list[i - 1].at <= p.at)).toBe(true);
  });
});

test('summary', () => {
  expect(N.summary(N.normalizeSettings(null))).toBe('4 on');
  expect(N.summary(N.normalizeSettings([]).map(s => ({ ...s, enabled: false })))).toBe('Off');
});
