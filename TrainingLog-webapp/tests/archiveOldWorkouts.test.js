const { archiveOldWorkouts } = require('../archiveOldWorkouts');

describe('archiveOldWorkouts', () => {
  beforeEach(() => {
    global.localStorage = {
      store: {},
      getItem(key) { return this.store[key] || null; },
      setItem(key, val) { this.store[key] = String(val); },
      clear() { this.store = {}; }
    };
  });

  test('moves workouts older than 7 days to history', () => {
    const user = 'u1';
    const workoutsKey = `workouts_${user}`;
    const historyKey = `workoutHistory_${user}`;
    const oldDate = new Date(Date.now() - 8 * 86400000).toISOString().split('T')[0];
    const recentDate = new Date().toISOString().split('T')[0];
    const workouts = [
      { title: 'Old', date: oldDate, log: [{}] },
      { title: 'Recent', date: recentDate, log: [{}] }
    ];
    localStorage.setItem(workoutsKey, JSON.stringify(workouts));

    archiveOldWorkouts(user, Date.now());

    const remaining = JSON.parse(localStorage.getItem(workoutsKey));
    const history = JSON.parse(localStorage.getItem(historyKey));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe('Recent');
    expect(history).toHaveLength(1);
    expect(history[0].title).toBe('Old');
  });
});
