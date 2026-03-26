const gamification = require('../gamification');

describe('gamification engine', () => {
  const userId = 'gamification_test_user';
  let memoryStorage = {};

  beforeAll(() => {
    global.localStorage = {
      getItem: key => (Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : null),
      setItem: (key, value) => {
        memoryStorage[key] = String(value);
      },
      removeItem: key => {
        delete memoryStorage[key];
      },
      clear: () => {
        memoryStorage = {};
      }
    };
  });

  beforeEach(() => {
    localStorage.clear();
  });

  test('awards workout XP once per workout id', () => {
    const first = gamification.awardXp(userId, 'completed_workout', {
      workoutId: 'workout-1',
      date: '2026-03-20T12:00:00.000Z'
    });
    const second = gamification.awardXp(userId, 'completed_workout', {
      workoutId: 'workout-1',
      date: '2026-03-20T12:00:00.000Z'
    });

    expect(first.totalXp).toBe(60);
    expect(second.totalXp).toBe(60);
    expect(second.metrics.workoutsCompleted).toBe(1);
  });

  test('prevents duplicate daily compliance rewards by day key', () => {
    const first = gamification.awardXp(userId, 'full_daily_compliance', {
      date: '2026-03-21T07:00:00.000Z'
    });
    const second = gamification.awardXp(userId, 'full_daily_compliance', {
      date: '2026-03-21T15:30:00.000Z'
    });

    expect(first.totalXp).toBe(70);
    expect(second.totalXp).toBe(70);
    expect(second.metrics.fullComplianceDays).toBe(1);
  });

  test('unlocks required bodybuilding badges', () => {
    gamification.awardXp(userId, 'completed_workout', { workoutId: 'w1', date: '2026-03-10T10:00:00.000Z' });
    gamification.awardXp(userId, 'checkin_submitted', { date: '2026-03-10T10:00:00.000Z' });
    gamification.awardXp(userId, 'full_daily_compliance', { date: '2026-03-10T10:00:00.000Z' });
    gamification.awardXp(userId, 'full_weekly_compliance', { date: '2026-03-12T10:00:00.000Z' });
    gamification.awardXp(userId, 'macros_complete', { date: '2026-03-13T10:00:00.000Z', weeksOut: 9 });

    const state = gamification.getGamificationState(userId);
    const keys = state.badges.map(b => b.key);

    expect(keys).toEqual(expect.arrayContaining([
      'first_workout',
      'first_checkin',
      'first_full_compliance_day',
      'single_digit_weeks_out',
      'perfect_week'
    ]));
  });

  test('level curve progresses as XP grows', () => {
    const low = gamification.resolveLevelState ? gamification.resolveLevelState(0) : { level: 1 };
    const high = gamification.resolveLevelState ? gamification.resolveLevelState(4000) : { level: 1 };

    expect(low.level).toBe(1);
    expect(high.level).toBeGreaterThan(low.level);
  });
});
