const usual = require('../src/js/usual-session');
const todaySession = require('../src/js/today-session');
const { getTodaysPlannedDay, sessionMetadata, sessionSourceLabel } = require('../src/js/session-queue');

function key(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function daysAgo(n, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() - n);
  return key(d);
}
function entry(exercise, reps, weight, n = 3) {
  return { exercise, repsArray: Array(n).fill(reps), weightsArray: Array(n).fill(weight) };
}
const push = (date, w = 80, title = `Workout on ${date}`) => ({ date, title, log: [entry('Bench Press', 8, w), entry('Overhead Press', 10, 40), entry('Lateral Raise', 15, 10, 2)] });
const pull = (date, w = 70, title = `Workout on ${date}`) => ({ date, title, log: [entry('Barbell Row', 8, w), entry('Lat Pulldown', 10, 55), entry('Biceps Curl', 12, 14, 2)] });
const legs = (date, title = `Workout on ${date}`) => ({ date, title, log: [entry('Back Squat', 5, 100), entry('Romanian Deadlift', 8, 90), entry('Leg Press', 12, 150)] });

const muscleOf = name => ({ 'bench press': 'chest', 'overhead press': 'shoulders', 'lateral raise': 'shoulders', 'barbell row': 'back', 'lat pulldown': 'back', 'biceps curl': 'arms', 'back squat': 'legs', 'romanian deadlift': 'legs', 'leg press': 'legs' }[name.toLowerCase()]);

describe('usual-session', () => {
  describe('sessionsByDay', () => {
    test('merges workouts on the same day and skips unticked planned sets and warm-ups', () => {
      const date = daysAgo(1);
      const sessions = usual.sessionsByDay([
        { date, title: 'Push A', metadata: { source: 'template', planned: true }, log: [
          { exercise: 'Bench Press', repsArray: [5, 8, 8], weightsArray: [40, 80, 80], completedArray: [true, true, false], setTypeArray: ['warmup', 'standard', 'standard'] },
        ] },
        { date, title: `Workout on ${date}`, log: [entry('Dips', 10, 0, 2)] },
      ]);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].titles).toEqual(['Push A']);
      expect(sessions[0].lifts.map(l => [l.name, l.sets.length])).toEqual([['Bench Press', 1], ['Dips', 2]]);
    });
  });

  describe('inferUsualNext', () => {
    test('push/pull/legs: the routine done longest ago is next, with last sets as targets', () => {
      const history = [
        push(daysAgo(9), 77.5), pull(daysAgo(8)), legs(daysAgo(7)),
        push(daysAgo(5), 80), pull(daysAgo(4)), legs(daysAgo(2)),
      ];
      const next = usual.inferUsualNext(history, { muscleOf });
      expect(next).toMatchObject({ source: 'rotation', name: 'Chest & Shoulders', timesDone: 2, lastDone: daysAgo(5) });
      expect(next.exercises.map(e => e.name)).toEqual(['Bench Press', 'Overhead Press', 'Lateral Raise']);
      expect(next.exercises[0].sets).toEqual([{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }, { reps: 8, weight: 80 }]);
      expect(next.rotationKey).toBe('bench press|lateral raise|overhead press');
    });

    test('uses the routine title when the lifter named it', () => {
      const history = [push(daysAgo(6), 80, 'Push Day'), pull(daysAgo(5)), push(daysAgo(3), 80, 'Push Day'), pull(daysAgo(1))];
      expect(usual.inferUsualNext(history, { muscleOf }).name).toBe('Push Day');
    });

    test('a lift dropped from a routine once still counts it as the same routine', () => {
      const shortPush = { date: daysAgo(3), log: [entry('Bench Press', 8, 80), entry('Overhead Press', 10, 40)] };
      const groups = usual.groupSessions(usual.sessionsByDay([push(daysAgo(6)), shortPush]));
      expect(groups).toHaveLength(1);
    });

    test('no routine: one-off sessions, or only old ones', () => {
      expect(usual.inferUsualNext([push(daysAgo(3))])).toBeNull();
      expect(usual.inferUsualNext([push(daysAgo(30)), push(daysAgo(25))])).toBeNull();
      expect(usual.inferUsualNext([])).toBeNull();
    });

    test("today's workouts don't count as history", () => {
      const next = usual.inferUsualNext([push(daysAgo(4)), pull(daysAgo(3)), push(daysAgo(2)), pull(daysAgo(1)), push(daysAgo(0))], { muscleOf });
      expect(next.exercises[0].name).toBe('Bench Press');
      expect(next.lastDone).toBe(daysAgo(2));
    });
  });

  describe('matchToday', () => {
    test("compares today's freeform lifts with the closest past session", () => {
      const today = { date: daysAgo(0), log: [entry('Barbell Row', 8, 72.5, 2)] };
      const match = usual.matchToday([push(daysAgo(5)), pull(daysAgo(4)), today], { muscleOf });
      expect(match).toMatchObject({ source: 'match', matchedDate: daysAgo(4), name: 'Back & Arms' });
      expect(match.exercises.map(e => e.name)).toEqual(['Barbell Row', 'Lat Pulldown', 'Biceps Curl']);
    });

    test('nothing logged today, or nothing shared, gives no match', () => {
      expect(usual.matchToday([push(daysAgo(2))])).toBeNull();
      expect(usual.matchToday([push(daysAgo(2)), { date: daysAgo(0), log: [entry('Hip Thrust', 10, 60)] }])).toBeNull();
    });
  });

  test('lastDoneLabel', () => {
    const now = new Date(2026, 10, 10); // Tue
    expect(usual.lastDoneLabel('2026-11-09', key(now))).toBe('yesterday');
    expect(usual.lastDoneLabel('2026-11-06', key(now))).toBe('Fri');
    expect(usual.lastDoneLabel('2026-10-29', key(now))).toBe('12 days ago');
  });
});

describe('today-session from history', () => {
  let store;
  beforeEach(() => {
    store = {};
    global.localStorage = {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    };
    global.currentUser = 'athleteA';
    delete global.getOverloadWorkouts;
    todaySession.clearHistoryMemo();
  });

  const seed = (live, archived = []) => {
    localStorage.setItem('workouts_athleteA', JSON.stringify(live));
    localStorage.setItem('workoutHistory_athleteA', JSON.stringify(archived));
  };

  test('with no program or pick, today is "your usual next" from archived history', () => {
    seed([], [push(daysAgo(10)), pull(daysAgo(9)), push(daysAgo(6)), pull(daysAgo(5))]);
    const day = getTodaysPlannedDay();
    expect(day).toMatchObject({ source: 'rotation', lastDoneLabel: expect.any(String) });
    expect(day.exercises[0].name).toBe('Bench Press');
    expect(sessionSourceLabel(day)).toMatch(/^Your usual next · last done /);
    expect(sessionMetadata(day)).toMatchObject({ source: 'rotation', planned: true, rotationKey: day.rotationKey });
  });

  test('once freeform lifting starts, today is compared with the matching past session', () => {
    seed([{ date: daysAgo(0), log: [entry('Lat Pulldown', 10, 57.5, 1)] }], [push(daysAgo(4)), pull(daysAgo(3))]);
    const day = getTodaysPlannedDay();
    expect(day).toMatchObject({ source: 'match', matchedDate: daysAgo(3) });
    expect(sessionSourceLabel(day)).toBe(`Compared with last ${usual.lastDoneLabel(daysAgo(3), daysAgo(0))}`);
  });

  test('a started "usual next" stays today\'s session as a pick', () => {
    seed([], [push(daysAgo(10)), pull(daysAgo(9)), push(daysAgo(6)), pull(daysAgo(5))]);
    const day = getTodaysPlannedDay();
    todaySession.pickSessionForToday(day);
    const w = { date: daysAgo(0), metadata: sessionMetadata(day), log: [] };
    const again = getTodaysPlannedDay();
    expect(again).toMatchObject({ source: 'rotation', rotationKey: day.rotationKey });
    expect(todaySession.isLoadedFrom(w, again, daysAgo(0))).toBe(true);
  });

  test('an active program keeps rest days as rest days (no history suggestion)', () => {
    const today = new Date();
    const otherDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(today.getDay() + 1) % 7];
    localStorage.setItem('activeProgram_athleteA', JSON.stringify({ programId: 'p1', startDate: daysAgo(0) }));
    localStorage.setItem('programs_athleteA', JSON.stringify([{ id: 'p1', name: 'PPL', frequency: [otherDay], startDate: daysAgo(0), days: [{ name: 'Pull A', exercises: [{ name: 'Row', sets: [{ reps: 10 }] }] }] }]));
    seed([], [push(daysAgo(10)), pull(daysAgo(9)), push(daysAgo(6)), pull(daysAgo(5))]);
    expect(getTodaysPlannedDay()).toBeNull();
  });

  test('uses getOverloadWorkouts when the app provides it', () => {
    global.getOverloadWorkouts = () => [legs(daysAgo(8)), legs(daysAgo(4))];
    const day = getTodaysPlannedDay();
    expect(day.exercises[0].name).toBe('Back Squat');
    delete global.getOverloadWorkouts;
  });
});
