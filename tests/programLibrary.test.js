const core = require('../src/js/programBuilderV2Core');

function memoryGlobal() {
  const store = new Map();
  return {
    currentUser: 'lifter',
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
}

// A trimmed library program in the compact form the server sends.
function libraryProgram() {
  const dayA = {
    dayId: 'w1-d1',
    name: 'Lower 1',
    exercises: [
      { exerciseId: 'w1-d1-1', name: 'Squat', sets: [{ reps: 6, restSec: 240 }, { reps: 6, restSec: 240 }] },
      {
        exerciseId: 'w1-d1-2',
        name: 'Glute Kickback',
        techniques: ['RP', 'P'],
        sets: [{ reps: 8, repsMax: 10, restSec: 90 }],
      },
      { exerciseId: 'w1-d1-3', name: 'Hip Adduction', supersetGroup: 'A', sets: [{ reps: 12 }] },
    ],
  };
  const dayB = { dayId: 'w1-d2', name: 'Upper 1', exercises: [{ exerciseId: 'w1-d2-1', name: 'Barbell Row', sets: [{ reps: 8 }] }] };
  const dayC = { dayId: 'w5-d1', name: 'Lower 1 (12 sets)', exercises: [{ exerciseId: 'w5-d1-1', name: 'Squat', sets: [{ reps: 8 }] }] };
  const dayD = { dayId: 'w5-d2', name: 'Upper 1 (12 sets)', exercises: [{ exerciseId: 'w5-d2-1', name: 'Barbell Row', sets: [{ reps: 10 }] }] };
  return {
    id: 'demo-program',
    kind: 'program',
    rev: 'abc123',
    title: 'Demo 3-Week',
    goal: 'hypertrophy',
    split: { type: 'upperlower', name: 'Lower / Upper', daysPerWeek: 2 },
    schedule: { startDate: '', weekdays: [1, 3] },
    weeks: [
      { week: 1, label: 'Week 1', phase: '10 working sets', days: [dayA, dayB] },
      { week: 2, label: 'Week 2', phase: '10 working sets', sameAs: 1 },
      { week: 3, label: 'Week 3', phase: '12 working sets', days: [dayC, dayD] },
    ],
  };
}

describe('multi-week program schema', () => {
  test('normalizeDraft keeps weeks, rep ranges, techniques and supersets', () => {
    const draft = core.normalizeDraft(libraryProgram());
    expect(draft.weeks).toHaveLength(3);
    expect(draft.durationWeeks).toBe(3);
    expect(draft.weeks[1].sameAs).toBe(1);
    expect(draft.weeks[1].days).toBeUndefined();

    const kickback = draft.weeks[0].days[0].exercises[1];
    expect(kickback.sets[0].reps).toBe(8);
    expect(kickback.sets[0].repsMax).toBe(10);
    expect(kickback.techniques).toEqual(['RP', 'P']);
    expect(draft.weeks[0].days[0].exercises[2].supersetGroup).toBe('A');
    // plain sets get no stray repsMax / techniques
    expect(draft.weeks[0].days[0].exercises[0].sets[0]).not.toHaveProperty('repsMax');
    expect(draft.weeks[0].days[0].exercises[0]).not.toHaveProperty('techniques');
  });

  test('days is taken from the first week when a program only carries weeks', () => {
    const draft = core.normalizeDraft(libraryProgram());
    expect(draft.days.map((d) => d.name)).toEqual(['Lower 1', 'Upper 1']);
  });

  test('editing days flows into the first week and the weeks that point at it', () => {
    const first = core.normalizeDraft(libraryProgram());
    first.days[0].name = 'Lower (edited)';
    const saved = core.normalizeDraft(first);
    expect(saved.weeks[0].days[0].name).toBe('Lower (edited)');
    expect(core.getWeekDays(saved, 2)[0].name).toBe('Lower (edited)'); // sameAs week 1
    expect(core.getWeekDays(saved, 3)[0].name).toBe('Lower 1 (12 sets)'); // untouched
  });

  test('programs without weeks are unchanged', () => {
    const plain = core.normalizeDraft({ title: 'Plain', days: [{ name: 'Day A', exercises: [] }] });
    expect(plain).not.toHaveProperty('weeks');
    expect(plain).not.toHaveProperty('durationWeeks');
    expect(core.getWeekCount(plain)).toBe(1);
    expect(core.getWeekDays(plain, 7)[0].name).toBe('Day A');
  });

  test('getWeekDays resolves sameAs and wraps past the last week', () => {
    const program = core.normalizeDraft(libraryProgram());
    expect(core.getWeekCount(program)).toBe(3);
    expect(core.getWeekDays(program, 1)[0].name).toBe('Lower 1');
    expect(core.getWeekDays(program, 2)[0].name).toBe('Lower 1');
    expect(core.getWeekDays(program, 3)[0].name).toBe('Lower 1 (12 sets)');
    expect(core.getWeekDays(program, 4)[0].name).toBe('Lower 1'); // starts over
    expect(core.getWeekDays(program, 0)[0].name).toBe('Lower 1'); // clamps to week 1
  });

  test('formatReps shows a range only when there is one', () => {
    expect(core.formatReps({ reps: 8, repsMax: 10 })).toBe('8-10');
    expect(core.formatReps({ reps: 12 })).toBe('12');
    expect(core.formatReps({ reps: 12, repsMax: 12 })).toBe('12');
    expect(core.formatReps({ reps: null })).toBe('?');
  });
});

describe('importing and starting a library program', () => {
  test('import adds an editable copy without the server-only fields', () => {
    const g = memoryGlobal();
    const program = core.importLibraryProgram(g, libraryProgram(), { userId: 'lifter' });

    expect(program.id).toMatch(/^lib-demo-program-/);
    expect(program.programId).toBe(program.id);
    expect(program.name).toBe('Demo 3-Week');
    expect(program).not.toHaveProperty('kind');
    expect(program).not.toHaveProperty('rev');
    expect(program.source).toEqual({ type: 'library', id: 'demo-program', rev: 'abc123' });
    expect(program.frequency).toEqual(['Mon', 'Wed']); // from schedule.weekdays
    expect(program.days).toHaveLength(2);

    const saved = core.loadPrograms(g);
    expect(saved).toHaveLength(1);
    expect(saved[0].weeks).toHaveLength(3);
  });

  test('importing twice keeps two separate copies', () => {
    const g = memoryGlobal();
    const realNow = Date.now;
    let t = 1000;
    Date.now = () => (t += 5);
    try {
      core.importLibraryProgram(g, libraryProgram());
      core.importLibraryProgram(g, libraryProgram());
    } finally {
      Date.now = realNow;
    }
    const ids = core.loadPrograms(g).map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });

  test('a saved library program survives a round trip through the builder', () => {
    const g = memoryGlobal();
    const imported = core.importLibraryProgram(g, libraryProgram());
    const opened = core.normalizeDraft(core.loadPrograms(g).find((p) => p.id === imported.id));
    expect(opened.weeks).toHaveLength(3);
    expect(opened.weeks[0].days[0].exercises[1].sets[0].repsMax).toBe(10);
  });

  test('startProgram mirrors the program to the keys Today and the Log tab read', () => {
    const g = memoryGlobal();
    const imported = core.importLibraryProgram(g, libraryProgram());
    const started = core.startProgram(g, imported.id, { userId: 'lifter', startDate: '2026-09-21' });

    expect(started.startDate).toBe('2026-09-21');
    const active = JSON.parse(g.localStorage.getItem('activeProgram_lifter'));
    expect(active).toEqual({ programId: imported.id, programName: 'Demo 3-Week', startDate: '2026-09-21' });
    expect(JSON.parse(g.localStorage.getItem('activeProgram')).programId).toBe(imported.id);

    const legacy = JSON.parse(g.localStorage.getItem('programs_lifter'));
    expect(legacy).toHaveLength(1);
    expect(legacy[0].id).toBe(imported.id);
  });

  test('starting the same program again replaces its legacy copy rather than duplicating it', () => {
    const g = memoryGlobal();
    const imported = core.importLibraryProgram(g, libraryProgram());
    core.startProgram(g, imported.id, { userId: 'lifter', startDate: '2026-09-21' });
    core.startProgram(g, imported.id, { userId: 'lifter', startDate: '2026-10-05' });
    const legacy = JSON.parse(g.localStorage.getItem('programs_lifter'));
    expect(legacy).toHaveLength(1);
    expect(legacy[0].startDate).toBe('2026-10-05');
  });

  test('startProgram returns null for an unknown program', () => {
    expect(core.startProgram(memoryGlobal(), 'nope', { userId: 'lifter' })).toBeNull();
  });
});

describe('the Log tab follows the program week', () => {
  const ALL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function daysAgoISO(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function plannedDayName(daysSinceStart) {
    jest.resetModules();
    const g = memoryGlobal();
    global.localStorage = g.localStorage;
    global.currentUser = 'lifter';
    global.programBuilderV2Core = require('../src/js/programBuilderV2Core');

    // train every day so "training days done" equals "days since start"
    const lib = libraryProgram();
    lib.frequency = ALL_DAYS;
    const imported = global.programBuilderV2Core.importLibraryProgram(g, lib);
    global.programBuilderV2Core.startProgram(g, imported.id, { userId: 'lifter', startDate: daysAgoISO(daysSinceStart) });

    const { getTodaysPlannedDay } = require('../src/js/session-queue');
    return getTodaysPlannedDay().name;
  }

  afterEach(() => {
    delete global.programBuilderV2Core;
  });

  test('day 0 and 1 are week 1', () => {
    expect(plannedDayName(0)).toBe('Lower 1');
    expect(plannedDayName(1)).toBe('Upper 1');
  });

  test('days 2 and 3 are week 2, which repeats week 1', () => {
    expect(plannedDayName(2)).toBe('Lower 1');
    expect(plannedDayName(3)).toBe('Upper 1');
  });

  test('days 4 and 5 are week 3 with its own sets', () => {
    expect(plannedDayName(4)).toBe('Lower 1 (12 sets)');
    expect(plannedDayName(5)).toBe('Upper 1 (12 sets)');
  });

  test('after the last week the program starts over', () => {
    expect(plannedDayName(6)).toBe('Lower 1');
  });
});
