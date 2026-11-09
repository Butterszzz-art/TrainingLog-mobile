const todaySession = require('../src/js/today-session');
const programSchedule = require('../src/js/program-schedule');
const { getTodaysPlannedDay, sessionMetadata } = require('../src/js/session-queue');

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localKey(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const builderTemplate = {
  id: 'local_1',
  name: 'Push A',
  data: {
    title: 'Push A',
    exercises: [
      { id: 'e1', name: 'Bench press', sets: [{ targetReps: 8, targetWeight: 80 }, { targetReps: 8, targetWeight: 80 }] },
      { id: 'e2', name: 'Lateral raise', sets: [{ targetReps: 15, targetWeight: 10 }] },
    ],
  },
};

describe('today-session', () => {
  let store;
  beforeEach(() => {
    store = {};
    global.localStorage = {
      getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: key => { delete store[key]; },
    };
    global.currentUser = 'athleteA';
  });

  describe('templateToDay', () => {
    test('converts a builder template (exercises with target sets)', () => {
      const day = todaySession.templateToDay(builderTemplate.data, { name: 'Push A', templateId: 'local_1' });
      expect(day).toMatchObject({ name: 'Push A', source: 'template', templateId: 'local_1' });
      expect(day.exercises).toHaveLength(2);
      expect(day.exercises[0].sets).toEqual([
        { reps: 8, weight: 80, setType: 'standard' },
        { reps: 8, weight: 80, setType: 'standard' },
      ]);
    });

    test('converts a template saved from a workout (log entries)', () => {
      const day = todaySession.templateToDay({
        title: 'Legs',
        log: [{ exercise: 'Squat', repsArray: [5, 5, 5], weightsArray: [100, 100, 100] }],
      });
      expect(day.name).toBe('Legs');
      expect(day.exercises[0]).toMatchObject({ name: 'Squat' });
      expect(day.exercises[0].sets).toHaveLength(3);
    });

    test('returns null for a template with no lifts', () => {
      expect(todaySession.templateToDay({ exercises: [] })).toBeNull();
      expect(todaySession.templateToDay(null)).toBeNull();
    });
  });

  describe('getTodaysSession', () => {
    test('is null with no program and no template picked', () => {
      expect(todaySession.getTodaysSession()).toBeNull();
      expect(getTodaysPlannedDay()).toBeNull();
    });

    test("a template picked today becomes today's session", () => {
      todaySession.pickTemplateForToday(builderTemplate);
      const day = getTodaysPlannedDay();
      expect(day).toMatchObject({ name: 'Push A', source: 'template', templateId: 'local_1' });
      expect(day.exercises.map(e => e.name)).toEqual(['Bench press', 'Lateral raise']);
    });

    test("yesterday's pick is ignored", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      todaySession.pickTemplateForToday(builderTemplate, { now: yesterday });
      expect(todaySession.getTodaysSession()).toBeNull();
    });

    test("the program's day wins over a template pick", () => {
      const today = new Date();
      localStorage.setItem('activeProgram_athleteA', JSON.stringify({ programId: 'p1', startDate: localKey(today) }));
      localStorage.setItem('programs_athleteA', JSON.stringify([{
        id: 'p1', name: 'PPL', frequency: [DOW[today.getDay()]], startDate: localKey(today),
        days: [{ name: 'Pull A', exercises: [{ name: 'Row', sets: [{ reps: 10 }] }] }],
      }]));
      todaySession.pickTemplateForToday(builderTemplate);
      expect(getTodaysPlannedDay()).toMatchObject({ name: 'Pull A', source: 'program', programId: 'p1' });
    });

    test('on a program rest day the template pick is used', () => {
      const today = new Date();
      const otherDay = DOW[(today.getDay() + 1) % 7];
      localStorage.setItem('activeProgram_athleteA', JSON.stringify({ programId: 'p1', startDate: localKey(today) }));
      localStorage.setItem('programs_athleteA', JSON.stringify([{
        id: 'p1', name: 'PPL', frequency: [otherDay], startDate: localKey(today),
        days: [{ name: 'Pull A', exercises: [{ name: 'Row', sets: [{ reps: 10 }] }] }],
      }]));
      todaySession.pickTemplateForToday(builderTemplate);
      expect(getTodaysPlannedDay()).toMatchObject({ name: 'Push A', source: 'template' });
    });
  });

  describe('isLoadedFrom', () => {
    test('matches the template workout loaded today', () => {
      const day = todaySession.pickTemplateForToday(builderTemplate);
      const w = { date: localKey(), metadata: sessionMetadata(day), log: [] };
      expect(todaySession.isLoadedFrom(w, day, localKey())).toBe(true);
      expect(todaySession.isLoadedFrom({ ...w, metadata: { source: 'template', templateId: 'other' } }, day, localKey())).toBe(false);
      expect(todaySession.isLoadedFrom({ ...w, date: '2020-01-01' }, day, localKey())).toBe(false);
    });

    test('matches a program day by name', () => {
      const day = { name: 'Pull A', source: 'program', programId: 'p1', exercises: [] };
      const w = { date: localKey(), metadata: sessionMetadata(day) };
      expect(w.metadata).toMatchObject({ source: 'program', planned: true, programDay: 'Pull A' });
      expect(todaySession.isLoadedFrom(w, day, localKey())).toBe(true);
    });
  });

  describe('dayProgress with a loaded template', () => {
    test('counts only ticked sets in a planned workout', () => {
      const day = todaySession.templateToDay(builderTemplate.data, { name: 'Push A', templateId: 'local_1' });
      const workout = {
        date: localKey(),
        metadata: { source: 'template', planned: true, templateId: 'local_1' },
        log: [
          { exercise: 'Bench press', repsArray: [8, 8], weightsArray: [80, 80], completedArray: [true, false] },
          { exercise: 'Lateral raise', repsArray: [15], weightsArray: [10], completedArray: [false] },
        ],
      };
      const progress = programSchedule.dayProgress(day, [workout]);
      expect(progress.doneSets).toBe(1);
      expect(progress.totalSets).toBe(3);
      expect(progress.doneKg).toBe(640);
      expect(progress.started).toBe(true);
      expect(progress.complete).toBe(false);
    });

    test('sets logged outside a planned workout still count straight away', () => {
      const day = todaySession.templateToDay(builderTemplate.data, { name: 'Push A' });
      const workout = { date: localKey(), log: [{ exercise: 'Lateral raise', repsArray: [15], weightsArray: [10] }] };
      expect(programSchedule.dayProgress(day, [workout]).doneSets).toBe(1);
    });
  });
});
