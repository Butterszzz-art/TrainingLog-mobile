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
  expect(cal.buildEvents('athleteA', new Date(2026, 9, 8))).toEqual({ programName: '', events: [] });
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
