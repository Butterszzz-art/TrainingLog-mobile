// Regression: progressive overload "forgot" any exercise not trained in the
// last 7 days, because archiveOldWorkouts() moves older workouts out of
// workouts_{user} and the overload lookups only read that list.
const { archiveOldWorkouts } = require('../archiveOldWorkouts');
const { getOverloadHistory } = require('../src/js/workout-data');
const { suggestNextSession } = require('../progressiveOverload');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-09T12:00:00Z').getTime();
const day = n => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const user = 'u1';

function makeLocalStorage() {
  return {
    store: {},
    getItem(key) { return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null; },
    setItem(key, val) { this.store[key] = String(val); },
    removeItem(key) { delete this.store[key]; },
    clear() { this.store = {}; }
  };
}

const bench = (daysAgo, weight) => ({
  id: `bench-${daysAgo}`,
  title: 'Push',
  date: day(daysAgo),
  log: [{ exercise: 'Bench Press', repsArray: [8, 8, 8], weightsArray: [weight, weight, weight], unit: 'kg', repGoal: 8 }]
});
const squat = { id: 'squat-2', title: 'Legs', date: day(2), log: [{ exercise: 'Squat', repsArray: [5], weightsArray: [120] }] };

beforeEach(() => {
  global.localStorage = makeLocalStorage();
});

test('exercise last trained 10 days ago still gets a suggestion after archiving', () => {
  localStorage.setItem(`workouts_${user}`, JSON.stringify([bench(10, 80), squat]));
  archiveOldWorkouts(user, NOW);

  // Confirms the precondition: the bench session left the 7-day list.
  const active = JSON.parse(localStorage.getItem(`workouts_${user}`));
  expect(active.map(w => w.id)).toEqual(['squat-2']);
  expect(suggestNextSession('Bench Press', active)).toBeNull();

  const history = getOverloadHistory(user);
  expect(history.map(w => w.id)).toEqual(['bench-10', 'squat-2']);
  const rec = suggestNextSession('Bench Press', history);
  expect(rec).not.toBeNull();
  expect(rec.sets[0].weight).toBeGreaterThanOrEqual(80);
});

test('uses the newest session across archive and active list', () => {
  localStorage.setItem(`workoutHistory_${user}`, JSON.stringify([bench(20, 75), bench(12, 80)]));
  localStorage.setItem(`workouts_${user}`, JSON.stringify([squat]));

  const history = getOverloadHistory(user);
  const last = [...history].reverse().find(w => w.log.some(e => e.exercise === 'Bench Press'));
  expect(last.id).toBe('bench-12');
});

test('falls back to backend copies once local storage is purged (> 4 weeks)', () => {
  localStorage.setItem(`workouts_${user}`, JSON.stringify([squat]));
  const remote = [{ date: new Date(NOW - 35 * DAY).toISOString(), title: 'Push', log: bench(35, 70).log }];

  const history = getOverloadHistory(user, { remote });
  expect(history).toHaveLength(2);
  expect(suggestNextSession('Bench Press', history)).not.toBeNull();
});

test('ignores backend copies of days that still exist locally (no double counting)', () => {
  localStorage.setItem(`workoutHistory_${user}`, JSON.stringify([bench(10, 80)]));
  const remote = [{ date: new Date(NOW - 10 * DAY).toISOString(), title: 'Push', log: bench(10, 80).log }];

  expect(getOverloadHistory(user, { remote })).toHaveLength(1);
});

test('an in-memory active list overrides localStorage', () => {
  localStorage.setItem(`workouts_${user}`, JSON.stringify([]));
  localStorage.setItem(`workoutHistory_${user}`, JSON.stringify([bench(10, 80)]));

  const history = getOverloadHistory(user, { active: [squat] });
  expect(history.map(w => w.id)).toEqual(['bench-10', 'squat-2']);
});

test('includes the on-device backend snapshot (workouts purged > 4 weeks ago)', async () => {
  const data = require('../src/js/workout-data');
  localStorage.setItem(`workouts_${user}`, JSON.stringify([squat]));
  global.window = { SERVER_URL: 'https://api.test' };
  localStorage.setItem('token', 't');
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, items: [{ id: 'b1', date: new Date(NOW - 40 * DAY).toISOString(), workout: bench(40, 70) }] })
  }));
  try {
    await data.loadFullWorkoutHistory(user);
    const history = data.getOverloadHistory(user);
    expect(history.map(w => w.id)).toContain('bench-40');
  } finally {
    delete global.window;
    delete global.fetch;
  }
});
