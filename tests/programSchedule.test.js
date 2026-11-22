const ps = require('../src/js/program-schedule');
const core = require('../src/js/programBuilderV2Core');

function memoryStorage() {
  const store = {};
  return {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
  };
}

const ex = (name, sets, reps, weight) => ({
  name,
  sets: Array.from({ length: sets }, () => ({ reps, weight })),
});

// Mon/Tue/Thu/Fri upper/lower, started Monday 2026-09-21.
const program = {
  id: 'ul4',
  name: 'Upper/Lower 4x',
  frequency: ['Mon', 'Tue', 'Thu', 'Fri'],
  startDate: '2026-09-21',
  days: [
    { name: 'Upper A', exercises: [ex('Bench Press', 4, 6, 80)] },
    { name: 'Lower A', exercises: [ex('Back Squat', 4, 5, 100)] },
    { name: 'Upper B', exercises: [ex('Incline Press', 4, 8, 30), ex('Pull-up', 3, 8, 0)] },
    { name: 'Lower B', exercises: [ex('Deadlift', 3, 4, 140)] },
  ],
};

const date = s => ps.parseLocalDate(s);

beforeEach(() => {
  global.localStorage = memoryStorage();
  global.currentUser = 'athleteA';
});

describe('createSchedule', () => {
  test('follows training days since the start date', () => {
    const schedule = ps.createSchedule(program, { startDate: '2026-09-21' }, { core });
    // Thu 8 Oct: 10 training days before it → day index 2 (Upper B), week 3.
    const thu = schedule.dayFor(date('2026-10-08'));
    expect(thu.isTraining).toBe(true);
    expect(thu.day.name).toBe('Upper B');
    expect(thu.weekNum).toBe(3);
    expect(schedule.dayFor(date('2026-10-07')).isTraining).toBe(false);
    expect(schedule.dayFor(date('2026-09-20')).isTraining).toBe(false); // before start
  });

  test('weekOf returns Monday to Sunday', () => {
    const schedule = ps.createSchedule(program, { startDate: '2026-09-21' }, { core });
    const week = schedule.weekOf(date('2026-10-08'));
    expect(week.map(d => d.abbr)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(week.map(d => (d.day ? d.day.name : null))).toEqual(
      ['Upper A', 'Lower A', null, 'Upper B', 'Lower B', null, null]
    );
  });

  test('nextTrainingAfter skips rest days', () => {
    const schedule = ps.createSchedule(program, { startDate: '2026-09-21' }, { core });
    const next = schedule.nextTrainingAfter(date('2026-10-07'));
    expect(next.key).toBe('2026-10-08');
    expect(next.day.name).toBe('Upper B');
  });

  test('returns null for a program it cannot schedule', () => {
    expect(ps.createSchedule({ ...program, days: [] }, { startDate: '2026-09-21' })).toBeNull();
    expect(ps.createSchedule({ ...program, frequency: ['Funday'] }, { startDate: '2026-09-21' })).toBeNull();
    expect(ps.createSchedule({ ...program, startDate: '' }, {})).toBeNull();
  });
});

describe('swapIntoToday', () => {
  function seedActive() {
    localStorage.setItem('programs_athleteA', JSON.stringify([program]));
    localStorage.setItem('activeProgram_athleteA', JSON.stringify({ programId: 'ul4', startDate: '2026-09-21' }));
  }

  test('training day: the two sessions trade places', () => {
    seedActive();
    const now = date('2026-10-08');
    expect(ps.swapIntoToday('2026-10-09', { now })).toBe(true);
    const schedule = ps.getActiveSchedule();
    expect(schedule.dayFor(now).day.name).toBe('Lower B');
    expect(schedule.dayFor(date('2026-10-09')).day.name).toBe('Upper B');
  });

  test('rest day: the pulled-forward date becomes rest', () => {
    seedActive();
    const now = date('2026-10-07'); // Wednesday rest
    expect(ps.swapIntoToday('2026-10-08', { now })).toBe(true);
    const schedule = ps.getActiveSchedule();
    expect(schedule.dayFor(now).isTraining).toBe(true);
    expect(schedule.dayFor(now).day.name).toBe('Upper B');
    expect(schedule.dayFor(date('2026-10-08')).isTraining).toBe(false);
  });

  test('ignores past dates, rest days and today', () => {
    seedActive();
    const now = date('2026-10-08');
    expect(ps.swapIntoToday('2026-10-06', { now })).toBe(false);
    expect(ps.swapIntoToday('2026-10-10', { now })).toBe(false); // Saturday rest
    expect(ps.swapIntoToday('2026-10-08', { now })).toBe(false);
  });

  test('overrides from another program are ignored', () => {
    seedActive();
    localStorage.setItem('programDayOverrides_athleteA', JSON.stringify({ programId: 'other', dates: { '2026-10-08': null } }));
    expect(ps.getActiveSchedule().dayFor(date('2026-10-08')).day.name).toBe('Upper B');
  });
});

describe('dayProgress', () => {
  const day = program.days[2]; // Incline Press 4 sets, Pull-up 3 sets

  test('a loaded program workout counts ticked sets only', () => {
    const workouts = [{
      date: '2026-10-08',
      metadata: { source: 'program', programDay: 'Upper B' },
      log: [
        { exercise: 'Incline Press', repsArray: [8, 8, 8, 8], weightsArray: [30, 30, 30, 30], completedArray: [true, true, true, true] },
        { exercise: 'Pull-up', repsArray: [8, 8, 8], weightsArray: [0, 0, 0], completedArray: [true, false, false] },
      ],
    }];
    const p = ps.dayProgress(day, workouts);
    expect(p.lifts.map(l => [l.done, l.planned, l.complete])).toEqual([[4, 4, true], [1, 3, false]]);
    expect(p.doneSets).toBe(5);
    expect(p.totalSets).toBe(7);
    expect(p.doneKg).toBe(960);
    expect(p.started).toBe(true);
    expect(p.complete).toBe(false);
  });

  test('sets logged by hand count as done, matched by name', () => {
    const workouts = [{ date: '2026-10-08', log: [
      { exercise: 'incline press ', repsArray: [8, 8], weightsArray: [30, 30], completedArray: [false, false] },
      { exercise: 'Pull-up', repsArray: [8, 8, 8, 8], weightsArray: [0, 0, 0, 0] },
    ] }];
    const p = ps.dayProgress(day, workouts);
    expect(p.lifts[0].done).toBe(2);
    expect(p.lifts[1].done).toBe(3); // capped at the plan
    expect(p.complete).toBe(false);
  });

  test('nothing logged', () => {
    const p = ps.dayProgress(day, []);
    expect(p.started).toBe(false);
    expect(p.doneSets).toBe(0);
  });
});

describe('the coach\'s repeat / pause weeks (program.timeline)', () => {
  // Two-week program: week 1 benches 80, week 2 benches 85; Mon/Wed/Fri from Mon 2 Nov 2026.
  const day = (name, w) => ({ name, exercises: [ex('Bench Press', 3, 5, w)] });
  const twoWeeks = {
    id: 'blk', name: 'Block', frequency: ['Mon', 'Wed', 'Fri'],
    days: [day('A', 80), day('B', 80), day('C', 80)],
    weeks: [
      { week: 1, days: [day('A', 80), day('B', 80), day('C', 80)] },
      { week: 2, deload: true, days: [day('A', 85), day('B', 85), day('C', 85)] },
    ],
  };
  const withTimeline = changes => Object.assign({}, twoWeeks, { timeline: { startDate: '', changes } });
  const bench = d => d.day && d.day.exercises[0].sets[0].weight;

  test('a repeated week comes round again; later weeks move back', () => {
    const s = ps.createSchedule(withTimeline([{ id: 'r', kind: 'repeat', afterWeek: 1 }]), { startDate: '2026-11-02' }, { core });
    expect(bench(s.dayFor(date('2026-11-09')))).toBe(80); // week 1 again
    expect(s.dayFor(date('2026-11-09'))).toMatchObject({ weekNum: 1, repeat: true });
    expect(bench(s.dayFor(date('2026-11-16')))).toBe(85);
    expect(s.dayFor(date('2026-11-16')).weekNum).toBe(2);
  });

  test('rest days after a week\'s last session keep that week; the pause starts on Monday', () => {
    const s = ps.createSchedule(withTimeline([{ id: 'p', kind: 'pause', afterWeek: 1 }]), { startDate: '2026-11-02' }, { core });
    // Week 1's last session is Friday 6 Nov; the pause is the week of 9 Nov.
    expect(s.dayFor(date('2026-11-07'))).toMatchObject({ weekNum: 1, pause: false }); // Saturday
    expect(s.dayFor(date('2026-11-08'))).toMatchObject({ weekNum: 1, pause: false }); // Sunday
    expect(s.dayFor(date('2026-11-10')).pause).toBe(true); // Tuesday of the pause week
    expect(s.dayFor(date('2026-11-15')).pause).toBe(true); // its Sunday
    const plain = ps.createSchedule(twoWeeks, { startDate: '2026-11-02' }, { core });
    expect(plain.dayFor(date('2026-11-08')).weekNum).toBe(1);
    expect(plain.dayFor(date('2026-11-09')).weekNum).toBe(2);
  });

  test('a pause week has no sessions and says so; training resumes after it', () => {
    const s = ps.createSchedule(withTimeline([{ id: 'p', kind: 'pause', afterWeek: 1, note: 'Holiday' }]), { startDate: '2026-11-02' }, { core });
    const mon = s.dayFor(date('2026-11-09'));
    expect(mon).toMatchObject({ isTraining: false, pause: true, pauseNote: 'Holiday', phase: 'Pause week', weekNum: 1 });
    expect(s.weekOf(date('2026-11-09')).filter(d => d.isTraining)).toHaveLength(0);
    expect(s.nextTrainingAfter(date('2026-11-09')).key).toBe('2026-11-16');
    expect(bench(s.dayFor(date('2026-11-16')))).toBe(85);
  });

  test('a busy week repeats the week at maintenance volume, then the block carries on', () => {
    const s = ps.createSchedule(withTimeline([{ id: 'b', kind: 'busy', afterWeek: 1, note: 'Exams' }]), { startDate: '2026-11-02' }, { core });
    const mon = s.dayFor(date('2026-11-09'));
    expect(mon).toMatchObject({ isTraining: true, busy: true, busyNote: 'Exams', phase: 'Busy week · maintenance', weekNum: 1 });
    expect(mon.day.maintenance).toBe(true);
    expect(mon.day.exercises[0].sets).toHaveLength(1); // 3 sets → 1, same load
    expect(bench(mon)).toBe(80);
    expect(s.dayFor(date('2026-11-02')).day.exercises[0].sets).toHaveLength(3); // week 1 untouched
    expect(bench(s.dayFor(date('2026-11-16')))).toBe(85);
    expect(s.dayFor(date('2026-11-16')).busy).toBe(false);
  });

  test('without a timeline nothing changes', () => {
    const s = ps.createSchedule(twoWeeks, { startDate: '2026-11-02' }, { core });
    expect(bench(s.dayFor(date('2026-11-09')))).toBe(85);
    expect(s.dayFor(date('2026-11-09')).pause).toBe(false);
  });

  test('an imported coach program keeps its deload weeks', () => {
    global.localStorage = memoryStorage();
    const imported = core.importLibraryProgram({ localStorage: global.localStorage }, Object.assign({ id: 'coach-x-p1', title: 'Block' }, twoWeeks), { userId: 'athleteA' });
    expect(imported.weeks[1].deload).toBe(true);
  });
});
