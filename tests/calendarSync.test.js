const ps = require('../src/js/program-schedule');
require('../src/js/programBuilderV2Core');
const cal = require('../src/js/calendar-sync');

function memoryStorage() {
  const store = {};
  return {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
  };
}

const ex = (name, sets, reps, repsMax) => ({
  name,
  sets: Array.from({ length: sets }, () => ({ reps, repsMax, weight: 0 })),
});

const program = {
  id: 'ul4',
  name: 'Upper/Lower 4x',
  frequency: ['Mon', 'Tue', 'Thu', 'Fri'],
  startDate: '2026-09-21',
  days: [
    { name: 'Upper A', exercises: [ex('Bench Press', 4, 6, 8), ex('Row', 3, 10)] },
    { name: 'Lower A', exercises: [ex('Back Squat', 4, 5)] },
    { name: 'Upper B', exercises: [ex('Incline Press', 4, 8)] },
    { name: 'Lower B', exercises: [ex('Deadlift', 3, 4)] },
  ],
};

function activate(user) {
  localStorage.setItem(`programs_${user}`, JSON.stringify([program]));
  localStorage.setItem(`activeProgram_${user}`, JSON.stringify({ programId: 'ul4', startDate: '2026-09-21' }));
}

beforeEach(() => {
  global.localStorage = memoryStorage();
  global.currentUser = 'athleteA';
});

test('no active program → no events', () => {
  const r = cal.buildEvents('athleteA', new Date(2026, 9, 8));
  expect(r.programName).toBe('');
  expect(r.events).toEqual([]);
});

test('lists training days from two weeks back to twelve weeks ahead', () => {
  activate('athleteA');
  const now = new Date(2026, 9, 8); // Thu 8 Oct
  const { programName, events } = cal.buildEvents('athleteA', now);
  expect(programName).toBe('Upper/Lower 4x');
  // 4 training days a week over 99 days ≈ 56–57 sessions.
  expect(events.length).toBeGreaterThanOrEqual(55);
  expect(events.length).toBeLessThanOrEqual(58);
  expect(events[0].date >= '2026-09-24').toBe(true);
  expect(events[events.length - 1].date <= '2026-12-31').toBe(true);
  const thu = events.find(e => e.date === '2026-10-08');
  expect(thu.title).toBe('Upper B');
  expect(events.find(e => e.date === '2026-10-07')).toBeUndefined(); // Wed rest
  const mon = events.find(e => e.date === '2026-10-12');
  expect(mon.title).toBe('Upper A');
  expect(mon.description).toContain('• Bench Press — 4 × 6–8');
  expect(mon.description).toContain('• Row — 3 × 10');
  expect(mon.description.startsWith('Upper/Lower 4x')).toBe(true);
});

test('a "Do it today" swap shows up in the events', () => {
  activate('athleteA');
  const wed = new Date(2026, 9, 7);
  expect(ps.swapIntoToday('2026-10-08', { user: 'athleteA', now: wed })).toBe(true);
  const { events } = cal.buildEvents('athleteA', wed);
  expect(events.find(e => e.date === '2026-10-07').title).toBe('Upper B');
  expect(events.find(e => e.date === '2026-10-08')).toBeUndefined();
});

test('disabled until the feed is created', () => {
  expect(cal.isEnabled('athleteA')).toBe(false);
  localStorage.setItem('calendarSync_athleteA', JSON.stringify({ path: '/cal/abc.ics' }));
  expect(cal.isEnabled('athleteA')).toBe(true);
});

// ── Meals and check-ins ────────────────────────────────────────────────────

const oats = { food: { name: 'Oats', per100: { kcal: 380, protein: 13, carbs: 60, fat: 7 } }, grams: 80 };
const chicken = { food: { name: 'Chicken', per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 } }, grams: 200 };
const mealPlan = {
  key: 'meals:abc',
  note: 'Drink water',
  times: { breakfast: '07:30', lunch: '12:30' },
  days: {
    training: { breakfast: [{ name: 'Oats bowl', items: [oats] }, { name: 'Eggs' }], lunch: [{ name: 'Chicken & rice', items: [chicken] }], dinner: [{ name: 'Salmon', items: [] }] },
    rest: { breakfast: [{ name: 'Rest oats', items: [oats] }] },
  },
};

test("coach meals land at the coach's times; slots without a time use the user's, else are left out", () => {
  localStorage.setItem('coachMealPlan_athleteA', JSON.stringify(mealPlan));
  localStorage.setItem('mealSetup_athleteA', JSON.stringify({ count: 3, names: { lunch: 'Midday' }, times: { breakfast: '09:00', dinner: '19:00' } }));
  const now = new Date(2026, 9, 8);
  const events = cal.mealEvents('athleteA', now);
  const day = events.filter(e => e.date === '2026-10-08');
  expect(day.map(e => [e.key, e.time, e.title])).toEqual([
    ['breakfast', '07:30', 'Breakfast · Oats bowl'],
    ['lunch', '12:30', 'Midday · Chicken & rice'],
    ['dinner', '19:00', 'Dinner · Salmon'],
  ]);
  expect(day[0].kind).toBe('meal');
  expect(day[0].description).toContain('• Oats — 80 g');
  expect(day[0].description).toContain('304 kcal');
  expect(day[0].description).toContain('Or: Eggs');
  expect(day[0].description).toContain('From your coach: Drink water');
  // Four weeks ahead, from today.
  const dates = [...new Set(events.map(e => e.date))];
  expect(dates[0]).toBe('2026-10-08');
  expect(dates.length).toBe(28);
});

test('rest days use the rest-day meals', () => {
  global.CoachMeals = { dayTypeFor: iso => (iso === '2026-10-09' ? 'rest' : 'training') };
  try {
    localStorage.setItem('coachMealPlan_athleteA', JSON.stringify(mealPlan));
    const events = cal.mealEvents('athleteA', new Date(2026, 9, 8));
    expect(events.filter(e => e.date === '2026-10-09').map(e => e.title)).toEqual(['Breakfast · Rest oats']);
  } finally {
    delete global.CoachMeals;
  }
});

test('without a coach plan, only planned meal times show', () => {
  localStorage.setItem('mealSetup_athleteA', JSON.stringify({ count: 4, times: { lunch: '13:00', snacks: '16:00' } }));
  const events = cal.mealEvents('athleteA', new Date(2026, 9, 8)).filter(e => e.date === '2026-10-08');
  expect(events.map(e => [e.title, e.time])).toEqual([['Meal 2', '13:00'], ['Meal 4', '16:00']]);
});

test("check-ins follow the coach's frequency from the last check-in", () => {
  global.checkinEngine = { loadCheckIns: () => [{ date: '2026-10-05' }, { date: '2026-09-28' }] };
  try {
    localStorage.setItem('coachCheckInEvery_athleteA', '7');
    const events = cal.checkInEvents('athleteA', new Date(2026, 9, 8));
    expect(events[0]).toMatchObject({ date: '2026-10-12', kind: 'checkin', title: 'Check-in for your coach' });
    expect(events[1].date).toBe('2026-10-19');
    expect(events[events.length - 1].date <= '2026-12-31').toBe(true);
    // Overdue → due today.
    localStorage.setItem('coachCheckInEvery_athleteA', '1');
    expect(cal.checkInEvents('athleteA', new Date(2026, 9, 20))[0].date).toBe('2026-10-20');
  } finally {
    delete global.checkinEngine;
  }
});

test('without a coach, weekly check-ins only for people who check in', () => {
  expect(cal.checkInEvents('athleteA', new Date(2026, 9, 8))).toEqual([]);
  global.checkinEngine = { loadCheckIns: () => [{ date: '2026-10-04' }] };
  global.prepModeApi = { getCurrentPhaseState: () => ({ checkInDay: 'Sunday' }) };
  try {
    const events = cal.checkInEvents('athleteA', new Date(2026, 9, 8));
    expect(events[0]).toMatchObject({ date: '2026-10-11', title: 'Weekly check-in' });
    expect(events[1].date).toBe('2026-10-18');
  } finally {
    delete global.checkinEngine;
    delete global.prepModeApi;
  }
});

test('buildEvents combines the kinds the user picked', async () => {
  activate('athleteA');
  localStorage.setItem('coachMealPlan_athleteA', JSON.stringify(mealPlan));
  localStorage.setItem('coachCheckInEvery_athleteA', '14');
  const now = new Date(2026, 9, 8);
  const all = cal.buildEvents('athleteA', now, { training: true, meals: true, checkins: true });
  const kinds = new Set(all.events.map(e => e.kind || 'training'));
  expect([...kinds].sort()).toEqual(['checkin', 'meal', 'training']);
  expect(all.events.length).toBeLessThanOrEqual(400);
  expect(typeof all.timeZone).toBe('string');
  const noMeals = cal.buildEvents('athleteA', now, { training: true, meals: false, checkins: true });
  expect(noMeals.events.some(e => e.kind === 'meal')).toBe(false);
  // The saved choice is used by default.
  localStorage.setItem('calendarSync_athleteA', JSON.stringify({ path: '/cal/abc.ics', include: { meals: false } }));
  expect(cal.readInclude('athleteA')).toEqual({ training: true, meals: false, checkins: true });
  expect(cal.buildEvents('athleteA', now).events.some(e => e.kind === 'meal')).toBe(false);
});

test('restore picks up a feed the server still has', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, enabled: true, path: '/cal/xyz.ics' }) }));
  localStorage.setItem('token', 't');
  try {
    expect(cal.isEnabled('athleteA')).toBe(false);
    await cal.restore();
    expect(cal.readState('athleteA').path).toBe('/cal/xyz.ics');
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/api\/calendar\/$/);
  } finally {
    delete global.fetch;
  }
});
