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
    const savedHistory = JSON.parse(localStorage.getItem(historyKey));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe('Recent');
    expect(savedHistory).toHaveLength(1);
    expect(savedHistory[0].title).toBe('Old');
  });

  test('carries sessionRating through to the Log History stores', () => {
    const user = 'u1';
    const oldDate = new Date(Date.now() - 8 * 86400000).toISOString().split('T')[0];
    const sessionRating = { progressive: 4, fatigue: 3, missedWeightGoal: 1, missedRepGoal: 2, ratedAt: oldDate };
    const workouts = [
      { id: 'w-old', title: 'Old', date: oldDate, log: [{ exercise: 'Squat', repsArray: [5], weightsArray: [100] }], sessionRating }
    ];
    localStorage.setItem(`workouts_${user}`, JSON.stringify(workouts));

    archiveOldWorkouts(user, Date.now());

    const genericHistory = JSON.parse(localStorage.getItem('workoutHistory'));
    const legacyHistory = JSON.parse(localStorage.getItem('tl_workout_history_v1'));

    expect(genericHistory[0].sessionRating).toEqual(sessionRating);
    expect(legacyHistory[0].sessionRating).toEqual(sessionRating);
    expect(legacyHistory[0].workout.sessionRating).toEqual(sessionRating);
  });
});
