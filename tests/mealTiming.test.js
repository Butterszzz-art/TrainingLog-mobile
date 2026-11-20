// Runs in Europe/Amsterdam: Jest's globalSetup (tests/setup/timezone.js) pins the zone.
const MT = require('../src/js/meal-timing-core');
const Core = require('../src/js/food-core');

const H = MT.HOUR;
// Local (Amsterdam, UTC+1 in November) time on a day.
const at = (date, time) => MT.timeOnDay(date, time);
const entry = (date, meal, time, extra = {}) => ({ id: `${date}-${meal}-${time}`, date, meal, name: 'x', kcal: 100, eatenAt: time ? at(date, time) : undefined, ...extra });

describe('clock helpers', () => {
  test('duration', () => {
    expect(MT.duration(4 * H + 5 * MT.MIN)).toBe('4h 05m');
    expect(MT.duration(45 * MT.MIN)).toBe('45m');
    expect(MT.duration(16 * H)).toBe('16h');
    expect(MT.duration(-1)).toBe('');
  });

  test('timeOnDay keeps the moment on the food log (UTC) day', () => {
    const noon = MT.timeOnDay('2026-11-17', '12:30');
    expect(MT.hhmm(noon)).toBe('12:30');
    expect(new Date(noon).toISOString().slice(0, 10)).toBe('2026-11-17');
    // 00:30 in Amsterdam on the UTC day 17th is the night after the 17th.
    const late = MT.timeOnDay('2026-11-17', '00:30');
    expect(new Date(late).toISOString()).toBe('2026-11-17T23:30:00.000Z');
    expect(MT.timeOnDay('2026-11-17', '25:00')).toBeNull();
    expect(MT.timeOnDay('nope', '10:00')).toBeNull();
  });

  test('clockLabel', () => {
    expect(MT.clockLabel(485)).toBe('08:05');
    expect(MT.clockLabel(null)).toBe('');
  });
});

describe('stampEntry', () => {
  const now = at('2026-11-17', '13:10');
  test('logged for today with no meal time yet: now', () => {
    const e = MT.stampEntry({ id: 'a', date: '2026-11-17', meal: 'lunch' }, [], { today: '2026-11-17', now });
    expect(e.eatenAt).toBe(now);
  });
  test('the meal already has a time: that time', () => {
    const lunch = entry('2026-11-17', 'lunch', '12:30');
    const e = MT.stampEntry({ id: 'b', date: '2026-11-17', meal: 'lunch' }, [lunch], { today: '2026-11-17', now });
    expect(e.eatenAt).toBe(lunch.eatenAt);
  });
  test('an earlier day stays without a time unless the meal has one', () => {
    expect(MT.stampEntry({ id: 'c', date: '2026-11-15', meal: 'lunch' }, [], { today: '2026-11-17', now }).eatenAt).toBeUndefined();
  });
  test('coach plan foods not ticked off are never stamped', () => {
    const e = MT.stampEntry({ id: 'd', date: '2026-11-17', meal: 'lunch', coach: {}, confirmed: false }, [], { today: '2026-11-17', now });
    expect(e.eatenAt).toBeUndefined();
  });
  test('a time it already has is kept', () => {
    const e = MT.stampEntry({ id: 'e', date: '2026-11-17', meal: 'lunch', eatenAt: 5 }, [], { today: '2026-11-17', now });
    expect(e.eatenAt).toBe(5);
  });
});

describe('daySummary', () => {
  test('first, last, window and gaps per meal (earliest food of each meal)', () => {
    const d = '2026-11-17';
    const s = MT.daySummary([
      entry(d, 'breakfast', '08:00'), entry(d, 'breakfast', '08:20'),
      entry(d, 'lunch', '12:30'), entry(d, 'dinner', '19:00'),
      entry(d, 'snacks', null), // no time: left out
      entry(d, 'meal5', '15:00', { coach: {}, confirmed: false }), // planned only
    ], at(d, '22:00'));
    expect(s.meals).toBe(3);
    expect(MT.hhmm(s.first)).toBe('08:00');
    expect(MT.hhmm(s.last)).toBe('19:00');
    expect(s.window).toBe(11 * H);
    expect(s.gaps).toEqual([4.5 * H, 6.5 * H]);
    expect(s.avgGap).toBe(5.5 * H);
    expect(s.longestGap).toBe(6.5 * H);
  });
  test('future times (copied or planned) are not eaten yet', () => {
    const d = '2026-11-17';
    const s = MT.daySummary([entry(d, 'breakfast', '08:00'), entry(d, 'dinner', '19:00')], at(d, '10:00'));
    expect(s.meals).toBe(1);
  });
  test('no timed meals → null', () => {
    expect(MT.daySummary([entry('2026-11-17', 'lunch', null)], Date.now())).toBeNull();
  });
});

describe('fastStatus', () => {
  const log = [
    entry('2026-11-16', 'breakfast', '12:00'),
    entry('2026-11-16', 'dinner', '19:30'),
    entry('2026-11-17', 'breakfast', '11:30'),
    entry('2026-11-17', 'lunch', '15:00'),
  ];
  const plan = { on: true, hours: 16 };

  test('plan off: time since the last meal, no goal', () => {
    const s = MT.fastStatus(log, { on: false }, at('2026-11-17', '17:00'));
    expect(s.state).toBe('fasting');
    expect(s.elapsed).toBe(2 * H);
    expect(s.goal).toBeUndefined();
  });

  test('plan on, inside the 8h window that opened at the first meal after the fast', () => {
    const s = MT.fastStatus(log, plan, at('2026-11-17', '17:00'));
    expect(s.state).toBe('eating');
    expect(MT.hhmm(s.windowStart)).toBe('11:30');
    expect(MT.hhmm(s.windowEnd)).toBe('19:30');
    expect(s.left).toBe(2.5 * H);
  });

  test('plan on, window closed: fasting since the last meal towards 16h', () => {
    const s = MT.fastStatus(log, plan, at('2026-11-17', '23:00'));
    expect(s.state).toBe('fasting');
    expect(s.elapsed).toBe(8 * H);
    expect(s.progress).toBe(0.5);
    expect(MT.hhmm(s.goalAt)).toBe('07:00');
    expect(s.done).toBe(false);
  });

  test('"start fast now" closes the window early; a meal after it takes over', () => {
    const started = at('2026-11-17', '16:00');
    const s = MT.fastStatus(log, { ...plan, startedAt: started }, at('2026-11-17', '17:00'));
    expect(s.state).toBe('fasting');
    expect(s.manual).toBe(true);
    expect(s.elapsed).toBe(H);
    const after = [...log, entry('2026-11-17', 'dinner', '16:30')];
    expect(MT.fastStatus(after, { ...plan, startedAt: started }, at('2026-11-17', '17:00')).state).toBe('eating');
  });

  test('nothing timed, or nothing for 36h+: none', () => {
    expect(MT.fastStatus([], plan, Date.now()).state).toBe('none');
    expect(MT.fastStatus(log, plan, at('2026-11-19', '12:00')).state).toBe('none');
  });
});

describe('pastFasts and weekStats', () => {
  const log = [
    entry('2026-11-15', 'breakfast', '13:00'), entry('2026-11-15', 'dinner', '20:00'),
    entry('2026-11-16', 'breakfast', '12:00'), entry('2026-11-16', 'dinner', '19:00'),
    entry('2026-11-17', 'breakfast', '09:00'),
  ];
  const now = at('2026-11-17', '10:00');

  test('gaps of 8h+ are fasts', () => {
    const f = MT.pastFasts(log, now);
    expect(f.map(x => x.length)).toEqual([16 * H, 14 * H]);
  });

  test('weekly averages', () => {
    const w = MT.weekStats(log, { on: true, hours: 16 }, now);
    expect(w.days).toBe(3);
    expect(w.fasts).toBe(2);
    expect(w.avgFast).toBe(15 * H);
    expect(w.longestFast).toBe(16 * H);
    expect(w.goalHit).toBe(1);
    expect(w.avgWindow).toBe(7 * H); // the one-meal day has no window
    expect(MT.clockLabel(w.avgFirst)).toBe('11:20');
  });
});

test('weekStats averages late meals around midnight, not noon', () => {
  const log = [
    entry('2026-11-15', 'breakfast', '12:00'), entry('2026-11-15', 'dinner', '23:30'),
    entry('2026-11-16', 'breakfast', '12:00'), entry('2026-11-16', 'dinner', '00:30'),
  ];
  const w = MT.weekStats(log, null, at('2026-11-17', '10:00'));
  expect(MT.clockLabel(w.avgLast)).toBe('00:00');
});

describe('normalizePlan', () => {
  test('defaults and bounds', () => {
    expect(MT.normalizePlan(null)).toEqual({ on: false, hours: 16 });
    expect(MT.normalizePlan({ on: 1, hours: 18, startedAt: 5 })).toEqual({ on: true, hours: 18, startedAt: 5 });
    expect(MT.normalizePlan({ hours: 40 }).hours).toBe(16);
  });
});

describe('food-core leaves eaten times behind on copies and repeats', () => {
  test('copyEntries drops eatenAt', () => {
    const [c] = Core.copyEntries([{ id: 'a', date: '2026-11-16', meal: 'lunch', eatenAt: 123 }], '2026-11-17', { now: 1 });
    expect(c.eatenAt).toBeUndefined();
  });
  test('repeat snapshots drop eatenAt', () => {
    const r = Core.repeatFromEntry({ id: 'a', date: '2026-11-16', meal: 'lunch', name: 'Shake', eatenAt: 123 }, { now: 1 });
    expect(r.entry.eatenAt).toBeUndefined();
  });
});

describe('scheduled meals', () => {
  const d = '2026-11-17';
  const times = { breakfast: '08:00', lunch: '12:30', dinner: '19:00' };
  const meals = ['breakfast', 'lunch', 'dinner'];

  test('normalizeMealSetup keeps valid times and remind, leaves them out when unset', () => {
    expect(Core.normalizeMealSetup({ count: 3, names: {} })).toEqual({ count: 3, names: {} });
    const s = Core.normalizeMealSetup({ count: 3, names: {}, times: { breakfast: '8:05', lunch: '25:00', dinner: 'x', snacks: '21:30' }, remind: true });
    expect(s.times).toEqual({ breakfast: '08:05', snacks: '21:30' });
    expect(s.remind).toBe(true);
    expect(Core.normalizeMealSetup({ remind: 'yes' }).remind).toBeUndefined();
  });

  test('daySchedule: eaten, due, late and upcoming in time order', () => {
    const log = [entry(d, 'breakfast', '08:10')];
    const s = MT.daySchedule(log, times, meals, d, at(d, '12:20'));
    expect(s.map(x => [x.meal, x.status])).toEqual([['breakfast', 'eaten'], ['lunch', 'due'], ['dinner', 'upcoming']]);
    const later = MT.daySchedule(log, times, meals, d, at(d, '14:00'));
    expect(later[1].status).toBe('late');
    expect(MT.nextMeal(later).meal).toBe('dinner');
  });

  test('daySchedule: only meals in use with a time; planned coach food is not eaten', () => {
    const log = [entry(d, 'lunch', null, { coach: {}, confirmed: false })];
    const s = MT.daySchedule(log, { ...times, meal5: '22:00' }, ['lunch', 'dinner'], d, at(d, '12:30'));
    expect(s.map(x => x.meal)).toEqual(['lunch', 'dinner']);
    expect(s[0].status).toBe('due');
  });

  test('nextMeal: nothing left → null', () => {
    expect(MT.nextMeal([{ meal: 'dinner', status: 'eaten' }])).toBeNull();
  });

  test('reminderPlan: 7 days, skips past times and meals already logged today', () => {
    const plan = MT.reminderPlan({
      times, meals, labels: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' },
      entries: [entry(d, 'lunch', null)], today: d, now: at(d, '10:00'),
    });
    // today: breakfast is past, lunch is logged → only dinner; then 6 days × 3
    expect(plan.length).toBe(1 + 6 * 3);
    expect(plan[0].meal).toBe('dinner');
    expect(MT.hhmm(plan[0].at)).toBe('19:00');
    expect(plan[0].title).toBe('Dinner · 19:00');
    expect(plan[1].date).toBe('2026-11-18');
    const ids = plan.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach(id => expect(MT.allReminderIds()).toContain(id));
  });

  test('reminderPlan: no times → nothing', () => {
    expect(MT.reminderPlan({ times: null, meals, today: d, now: 0 })).toEqual([]);
  });
});
