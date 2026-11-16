const fs = require('fs');
const vm = require('vm');
const g = require('../src/js/session-grouping.js');
const calculateWorkoutVolume = require('../calculateWorkoutVolume.js');

const volumeOf = workout => (typeof calculateWorkoutVolume === 'function'
  ? calculateWorkoutVolume(workout)
  : calculateWorkoutVolume.calculateWorkoutVolume(workout));

// One quick-logged set as the old code stored it: its own log entry.
function oneSet(exercise, weight, reps, extra = {}) {
  return {
    exercise,
    sets: 1,
    repsArray: [reps],
    weightsArray: [weight],
    rirArray: [extra.rir ?? null],
    setTypeArray: [extra.type || 'standard'],
    dropsetArray: [extra.type === 'dropset'],
    restPauseArray: [false],
    skippedArray: [false],
    completedArray: [false],
    unit: 'kg',
  };
}

describe('groupSessionLog', () => {
  test('non-consecutive sets of the same exercise form one block, in first-logged order', () => {
    const log = [
      oneSet('Heel Elevated Pendulum', 20, 8, { rir: 2 }),
      oneSet('Heel Elevated Pendulum', 20, 8, { rir: 1, type: 'top-set' }),
      oneSet('heel elevated pendulum ', 15, 10, { type: 'dropset' }),
      oneSet('Hamstring Curl', 40, 12),
      oneSet('Hamstring Curl', 40, 11),
      oneSet('Heel Elevated Pendulum', 20, 7),
    ];
    const blocks = g.groupSessionLog(log);
    expect(blocks.map(b => [b.name, b.sets.length])).toEqual([
      ['Heel Elevated Pendulum', 4],
      ['Hamstring Curl', 2],
    ]);
    const pendulum = blocks[0];
    expect(pendulum.sets.map(s => s.number)).toEqual([1, 2, 3, 4]);
    expect(pendulum.sets.map(s => s.entryIndex)).toEqual([0, 1, 2, 5]);
    expect(g.formatSetLine(pendulum.sets[0], 'kg')).toBe('20 kg × 8 · RIR 2');
    expect(g.formatSetLine(pendulum.sets[1], 'kg')).toBe('20 kg × 8 · RIR 1 · Top');
    expect(g.formatSetLine(pendulum.sets[2], 'kg')).toBe('15 kg × 10 · Drop');
  });

  test('groups by exerciseId first; id-less old entries join by name', () => {
    const log = [
      { ...oneSet('My Custom Press', 30, 10), exerciseId: 'custom_42' },
      oneSet('my custom press', 30, 9),
      { ...oneSet('Renamed Press', 30, 8), exerciseId: 'custom_42' },
      { ...oneSet('Other', 10, 10), exerciseId: 'custom_7' },
    ];
    const blocks = g.groupSessionLog(log);
    expect(blocks.map(b => b.sets.length)).toEqual([3, 1]);
    expect(blocks[0].entryIndexes).toEqual([0, 1, 2]);
  });

  test('derived ids match old names of any case/spacing', () => {
    expect(g.exerciseIdFor('  Hamstring   CURL ')).toBe(g.exerciseIdFor('hamstring curl'));
    const entry = oneSet('Hamstring Curl', 40, 12);
    expect(g.ensureExerciseId(entry)).toBe(true);
    expect(entry.exerciseId).toBe('ex_hamstring-curl');
    expect(g.ensureExerciseId(entry)).toBe(false);
  });

  test('collapsing never changes volume or set counts', () => {
    const log = [
      oneSet('Pendulum', 20, 8), oneSet('Pendulum', 20, 8), oneSet('Pendulum', 20, 8),
      oneSet('Hamstring Curl', 40, 12), oneSet('Hamstring Curl', 40, 11),
      oneSet('Pendulum', 22.5, 6),
    ];
    const collapsed = g.collapseSessionLog(log);
    expect(collapsed).toHaveLength(2);
    expect(collapsed.map(e => e.sets)).toEqual([4, 2]);
    expect(volumeOf({ log: collapsed })).toBe(volumeOf({ log }));
    const setCount = l => l.reduce((n, e) => n + e.repsArray.length, 0);
    expect(setCount(collapsed)).toBe(setCount(log));
    // Input untouched (no migration).
    expect(log).toHaveLength(6);
  });

  test('History exercises group by name with sets kept in order', () => {
    const grouped = g.groupHistoryExercises([
      { name: 'Pendulum', repsArray: [8], weightsArray: [20] },
      { name: 'Hamstring Curl', repsArray: [12], weightsArray: [40] },
      { name: 'pendulum', repsArray: [6], weightsArray: [22.5] },
    ]);
    expect(grouped.map(e => [e.name, e.repsArray, e.weightsArray])).toEqual([
      ['Pendulum', [8, 6], [20, 22.5]],
      ['Hamstring Curl', [12], [40]],
    ]);
  });
});

describe('appendToSessionEntry (live logging)', () => {
  function load() {
    const html = fs.readFileSync('index.html', 'utf8');
    const grab = (startMarker, endMarker) => {
      const start = html.indexOf(startMarker);
      return html.slice(start, html.indexOf(endMarker, start));
    };
    const context = {
      createDefaultAdvancedSet: () => ({}),
      DEFAULT_SET_TYPE: 'standard',
    };
    context.window = context;
    context.window.sessionGrouping = g;
    vm.createContext(context);
    vm.runInContext(grab('function appendToSessionEntry', 'function addLogEntry()'), context);
    vm.runInContext(grab('function normalizeEntry(entry)', 'function formatLastTimeSets'), context);
    vm.runInContext('function ensureAdvancedArray(e){ if(!Array.isArray(e.advancedArray)) e.advancedArray=[]; while(e.advancedArray.length<e.repsArray.length) e.advancedArray.push({}); return e.advancedArray; }', context);
    return context;
  }

  test('3 Pendulum, 2 Hamstring Curl, 1 Pendulum → 2 entries (4 + 2 sets)', () => {
    const ctx = load();
    const log = [];
    const logSet = (name, w, r) => {
      const e = { ...oneSet(name, w, r), exerciseId: g.exerciseIdFor(name) };
      if (!ctx.appendToSessionEntry(log, e)) log.push(e);
    };
    logSet('Pendulum', 20, 8); logSet('Pendulum', 20, 8); logSet('Pendulum', 20, 8);
    logSet('Hamstring Curl', 40, 12); logSet('Hamstring Curl', 40, 11);
    logSet('Pendulum', 20, 7);

    expect(log).toHaveLength(2);
    expect(log[0].repsArray).toEqual([8, 8, 8, 7]);
    expect(log[0].sets).toBe(4);
    expect(log[1].repsArray).toEqual([12, 11]);
    // Every per-set array stays aligned.
    ['weightsArray', 'rirArray', 'setTypeArray', 'completedArray', 'advancedArray'].forEach(key => {
      expect(log[0][key]).toHaveLength(4);
    });
    const blocks = g.groupSessionLog(log);
    expect(blocks.map(b => b.sets.length)).toEqual([4, 2]);
  });

  test('joins an old id-less entry, padding arrays it never had', () => {
    const ctx = load();
    const old = oneSet('Pendulum', 20, 8);
    delete old.rirArray;
    const log = [old];
    const e = { ...oneSet('pendulum', 20, 6, { rir: 1 }), exerciseId: g.exerciseIdFor('pendulum') };
    expect(ctx.appendToSessionEntry(log, e)).toBe(old);
    expect(old.rirArray).toEqual([null, 1]);
    expect(old.exerciseId).toBe('ex_pendulum');
  });

  test('keeps a separate entry for a different machine, unit or planned row', () => {
    const ctx = load();
    const base = oneSet('Pendulum', 20, 8);
    const alt = { ...oneSet('Pendulum', 20, 8), sessionCtx: { altMachine: true } };
    expect(ctx.appendToSessionEntry([base], alt)).toBeNull();
    expect(ctx.appendToSessionEntry([base], { ...oneSet('Pendulum', 45, 8), unit: 'lb' })).toBeNull();
    const planned = { ...oneSet('Pendulum', 20, 8), templateExerciseId: 'repeat_0' };
    expect(ctx.appendToSessionEntry([planned], oneSet('Pendulum', 20, 8))).toBeNull();
  });
});
