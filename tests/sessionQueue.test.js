const { getTodaysPlannedDay } = require('../src/js/session-queue');

describe('session-queue', () => {
  beforeEach(() => {
    const store = {};
    global.localStorage = {
      getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: key => { delete store[key]; }
    };
    global.currentUser = 'athleteA';
  });

  function seedProgram({ startDate, frequency, days }) {
    localStorage.setItem('activeProgram_athleteA', JSON.stringify({ programId: 'p1', startDate }));
    localStorage.setItem('programs_athleteA', JSON.stringify([
      { id: 'p1', name: 'Push Pull Legs', frequency, startDate, days }
    ]));
  }

  test('returns null when there is no active program', () => {
    expect(getTodaysPlannedDay()).toBeNull();
  });

  test("returns today's day with its exercises when today is a training day", () => {
    const today = new Date();
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][today.getDay()];
    const startDate = today.toISOString().slice(0, 10);

    seedProgram({
      startDate,
      frequency: [dow],
      days: [
        { name: 'Push A', exercises: [{ name: 'Bench press', sets: [{ reps: 8, weight: 95 }, { reps: 8, weight: 95 }] }] }
      ]
    });

    const result = getTodaysPlannedDay();
    expect(result).not.toBeNull();
    expect(result.name).toBe('Push A');
    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0].name).toBe('Bench press');
  });

  test('returns null on a rest day (today not in frequency)', () => {
    const today = new Date();
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][today.getDay()];
    const otherDay = dow === 'Mon' ? 'Tue' : 'Mon';
    const startDate = today.toISOString().slice(0, 10);

    seedProgram({
      startDate,
      frequency: [otherDay],
      days: [{ name: 'Push A', exercises: [] }]
    });

    expect(getTodaysPlannedDay()).toBeNull();
  });

  test('returns null when the program has no days', () => {
    seedProgram({ startDate: new Date().toISOString().slice(0, 10), frequency: ['Mon'], days: [] });
    expect(getTodaysPlannedDay()).toBeNull();
  });
});

describe('buildProgramDayLog', () => {
  const { buildProgramDayLog } = require('../src/js/session-queue');

  test('turns a program day into template-style log entries', () => {
    const day = {
      name: 'Upper B',
      exercises: [
        { name: 'Incline Press', sets: [{ reps: 8, weight: 30 }, { reps: 8, weight: 30 }] },
        { name: 'Pull-up', sets: [{ reps: 6 }, { reps: 6 }, { reps: 6 }] },
      ],
    };
    const log = buildProgramDayLog(day, '2026-10-08', name => (name === 'Pull-up' ? 5 : 99));
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      exercise: 'Incline Press',
      sets: 2,
      repsArray: [8, 8],
      weightsArray: [30, 30], // planned weight wins over last time's
      completedArray: [false, false],
      date: '2026-10-08',
    });
    expect(log[1].weightsArray).toEqual([5, 5, 5]); // no planned weight: last time's
  });

  test('blank weight when there is no plan or history', () => {
    const log = buildProgramDayLog({ exercises: [{ name: 'Curl', sets: [{ reps: 12 }] }] }, '2026-10-08');
    expect(log[0].weightsArray).toEqual([0]);
  });
});
