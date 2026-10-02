const posingEngine = require('../posingEngine');

describe('posingEngine', () => {
  const userId = 'posing-engine-user';
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

  test('logs sessions and returns weekly progress against targets', () => {
    posingEngine.setWeeklyTarget(userId, { sessions: 4, minutes: 80 });
    posingEngine.logPosingSession(userId, { date: '2026-03-23', minutes: 20, notes: 'Quarter turns' });
    posingEngine.logPosingSession(userId, { date: '2026-03-24', minutes: 25, notes: 'Transitions' });

    const weekly = posingEngine.getWeeklySummary(userId, '2026-03-26');
    expect(weekly.sessions).toBe(2);
    expect(weekly.totalMinutes).toBe(45);
    expect(weekly.targetSessions).toBe(4);
    expect(weekly.targetMinutes).toBe(80);
  });

  test('calculates streak and overdue warnings', () => {
    posingEngine.logPosingSession(userId, { date: '2026-03-25', minutes: 15 });
    posingEngine.logPosingSession(userId, { date: '2026-03-26', minutes: 20 });

    expect(posingEngine.calculateStreak(userId, '2026-03-26')).toBe(2);

    const overdue = posingEngine.getOverdueStatus(userId, '2026-03-29');
    expect(overdue.overdue).toBe(true);
    expect(overdue.daysSinceLastSession).toBe(3);
  });

  test('keeps the photo count from a photo check-in', () => {
    const withPhotos = posingEngine.logPosingSession(userId, { id: 'ps1', date: '2026-03-25', minutes: 2, photoCount: 8 });
    const plain = posingEngine.logPosingSession(userId, { date: '2026-03-25', minutes: 10 });
    expect(withPhotos).toMatchObject({ id: 'ps1', photoCount: 8 });
    expect(plain).not.toHaveProperty('photoCount');
  });
});
