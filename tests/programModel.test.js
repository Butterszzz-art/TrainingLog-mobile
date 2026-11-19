// src/js/program-model.js — pocketcoach.program/2. The same file is
// src/programs/model.js in traininglog-backend; these cases mirror its tests.
const M = require('../src/js/program-model.js');

const row = (name, extra = {}) => ({ name, sets: 2, repsMin: 6, repsMax: 10, rir: 3, lastSetRir: null, restSec: 120, restSecMax: 180, type: 'compound', ...extra });
const block = () => ({
  schema: M.SCHEMA,
  name: 'Upper / Lower',
  weeks: [{ days: [
    { dayId: 'd4', weekday: 5, label: 'Upper B', exercises: [row('Machine lateral raise', { sets: 4, repsMin: 12, repsMax: 20, type: 'isolation' })] },
    { dayId: 'd1', weekday: 1, label: 'Lower A', exercises: [row('Hack squat'), row('Ab-wheel roll-out', { rir: null, type: 'core' })] },
    { dayId: 'd2', weekday: 2, label: 'Upper A', exercises: [row('Cable lateral raise', { sets: 4, type: 'isolation' })] },
    { dayId: 'd3', weekday: 4, label: 'Lower B', exercises: [row('Lying leg curl')] },
  ] }],
});

describe('program model', () => {
  test('parsers read the spreadsheet notation', () => {
    expect(M.parseReps('6-10')).toEqual({ repsMin: 6, repsMax: 10 });
    expect(M.parseRir('3 (last set 2)')).toEqual({ rir: 3, lastSetRir: 2 });
    expect(M.parseRir('-')).toEqual({ rir: null, lastSetRir: null });
    expect(M.parseRest('2-3 min')).toEqual({ restSec: 120, restSecMax: 180 });
    expect(M.parseRest('90s')).toEqual({ restSec: 90, restSecMax: null });
    expect(M.parseDayLabel('Thu - Lower B (hamstrings and hips)')).toEqual({ weekday: 4, label: 'Lower B', focus: 'hamstrings and hips' });
  });

  test('quick entry: "Squat 4x6-8" is still the shortcut, now with RIR and rest', () => {
    expect(M.parseQuickEntry('Squat 4x6-8')).toMatchObject({ name: 'Squat', sets: 4, repsMin: 6, repsMax: 8 });
    expect(M.parseQuickEntry('Cable lateral raise 4x10-20 @2/1 1-2min'))
      .toMatchObject({ name: 'Cable lateral raise', sets: 4, repsMin: 10, repsMax: 20, rir: 2, lastSetRir: 1, restSec: 60, restSecMax: 120 });
    expect(M.parseQuickEntry('Face pull')).toMatchObject({ name: 'Face pull', sets: 3, repsMin: 10 });
  });

  test('old single-week programs read as one repeating week', () => {
    const p = M.readProgram({ name: 'PPL', days: { Mon: ['Bench Press', { name: 'Row', sets: 4, reps: 8, repsMax: 12 }], Thu: [{ name: 'Squat', sets: 3, reps: 5 }] } });
    expect(p.weeks).toHaveLength(1);
    expect(p.weeks[0].days.map(d => [d.weekday, d.label])).toEqual([[1, 'Mon'], [4, 'Thu']]);
    expect(p.weeks[0].days[0].exercises[0]).toMatchObject({ name: 'Bench Press', sets: 3, repsMin: 10 });
  });

  test('days sort by weekday; a clean program has no warnings', () => {
    const p = M.readProgram(block());
    expect(p.weeks[0].days.map(d => d.label)).toEqual(['Lower A', 'Upper A', 'Lower B', 'Upper B']);
    expect(M.validate(p)).toEqual([]);
  });

  test('copy week → next keeps week 1 intact; RIR can differ per week', () => {
    const p = M.copyWeek(M.readProgram(block()), 1);
    p.weeks[1].days[1].exercises[0].lastSetRir = 2;
    const again = M.readProgram(p);
    expect(M.weekDays(again, 1)[1].exercises[0].lastSetRir).toBeNull();
    expect(M.weekDays(again, 2)[1].exercises[0].lastSetRir).toBe(2);
  });

  test('toLibrary sends per-set RIR (last set too) and keeps old-app fields', () => {
    const p = M.copyWeek(M.readProgram(block()), 1);
    p.weeks[1].days[1].exercises[0].lastSetRir = 2;
    const lib = M.toLibrary(M.readProgram(p));
    expect(lib.frequency).toEqual(['Mon', 'Tue', 'Thu', 'Fri']);
    expect(lib.days[0]).toMatchObject({ name: 'Lower A', weekday: 1 });
    expect(lib.weeks[1].days[1].exercises[0].sets.map(s => s.rir)).toEqual([3, 3, 3, 2]);
    expect(M.toLibrary(M.readProgram(block())).weeks).toBeUndefined();
  });

  test('guessType', () => {
    expect(M.guessType('Hack squat (or Smith squat), deep')).toBe('compound');
    expect(M.guessType('Cable lateral raise')).toBe('isolation');
    expect(M.guessType('Triceps rope pressdown')).toBe('isolation');
    expect(M.guessType('Ab-wheel roll-out')).toBe('core');
  });
});

describe('mesocycles, deloads and loads', () => {
  const base = {
    schema: M.SCHEMA, name: 'Hypertrophy year',
    blocks: [{ id: 'acc', name: 'Accumulation', goal: 'Volume up' }, { id: 'gone', name: 'Unused' }],
    weeks: [
      { block: 'acc', days: [{ dayId: 'd1', weekday: 1, label: 'Lower', exercises: [
        { name: 'Squat', sets: 3, repsMin: 6, repsMax: 8, rir: 3, lastSetRir: 2, loadPct: 72.4 },
        { name: 'Leg curl', sets: 2, repsMin: 10, rir: 3, loadKg: 40 },
        { name: 'Plank', type: 'core', sets: 2, repsMin: 30, rir: null },
      ] }] },
      { block: 'acc', sameAs: 1 }, { block: 'acc', sameAs: 1 }, { block: 'acc', sameAs: 1 }, { block: 'nope', sameAs: 1 },
    ],
  };

  test('blocks, week block/deload and row loads survive readProgram; unknown or unused blocks are dropped', () => {
    const p = M.readProgram(base);
    expect(p.blocks).toEqual([{ id: 'acc', name: 'Accumulation', goal: 'Volume up' }]);
    expect(p.weeks.map(w => w.block || null)).toEqual(['acc', 'acc', 'acc', 'acc', null]);
    expect(p.weeks[0].days[0].exercises[0].loadPct).toBe(72.5);
    expect(p.weeks[0].days[0].exercises[1].loadKg).toBe(40);
    expect('loadPct' in p.weeks[0].days[0].exercises[2]).toBe(false);
    expect(M.blockRuns(p).map(r => [r.block && r.block.name, r.from, r.to])).toEqual([['Accumulation', 1, 4], [null, 5, 5]]);
    // A program without blocks reads exactly as before.
    expect('blocks' in M.readProgram({ name: 'x', weeks: [{ days: [] }] })).toBe(false);
  });

  test('progressWeeks ramps RIR, sets and load across a block and ends with a deload', () => {
    const p = M.progressWeeks(M.readProgram(base), 1, 4, { rirStart: 3, rirEnd: 1, setsPerWeek: 1, setsMax: 5, pctPerWeek: 2.5, kgPerWeek: 2.5, deloadLast: true });
    const squat = w => p.weeks[w - 1].days[0].exercises[0];
    expect([1, 2, 3].map(w => squat(w).rir)).toEqual([3, 2, 1]);
    expect([1, 2, 3].map(w => squat(w).lastSetRir)).toEqual([2, 1, 0]);
    expect([1, 2, 3].map(w => squat(w).sets)).toEqual([3, 4, 5]);
    expect([1, 2, 3].map(w => squat(w).loadPct)).toEqual([72.5, 75, 77.5]);
    expect(p.weeks[2].days[0].exercises[1].loadKg).toBe(45);
    expect(p.weeks[3].deload).toBe(true);
    expect(squat(4)).toMatchObject({ sets: 2, rir: 5, lastSetRir: null, loadPct: 65 });
    expect(p.weeks[1].days[0].exercises[2].rir).toBeNull(); // core keeps no RIR
    expect(p.weeks.map(w => w.block || null)).toEqual(['acc', 'acc', 'acc', 'acc', null]);
    expect(p.weeks[4].sameAs).toBe(1); // outside the range: untouched
  });

  test('toLibrary: phase carries block and deload; loads become set weight / % note', () => {
    const p = M.progressWeeks(M.readProgram(base), 1, 4, { rirStart: 3, rirEnd: 1, deloadLast: true });
    const lib = M.toLibrary(p, { id: 'x' });
    expect(lib.weeks.map(w => w.phase)).toEqual(['Accumulation', 'Accumulation', 'Accumulation', 'Accumulation · Deload', undefined]);
    expect(lib.blocks).toEqual([{ name: 'Accumulation', goal: 'Volume up', fromWeek: 1, toWeek: 4 }]);
    const ex = lib.weeks[0].days[0].exercises;
    expect(ex[0].notes).toBe('72.5% of 1RM');
    expect(ex[0].sets[0].percent1RM).toBe(72.5);
    expect(ex[1].sets[0].weight).toBe(40);
    // …and the library shape reads back with the same loads.
    const back = M.readProgram(lib);
    expect(back.weeks[0].days[0].exercises[1].loadKg).toBe(40);
  });

  test('cells and quick entry understand loads', () => {
    expect(M.parseCell('4x6-8 @2/1 75%')).toEqual({ sets: 4, repsMin: 6, repsMax: 8, rir: 2, lastSetRir: 1, loadPct: 75, loadKg: null });
    expect(M.parseCell('@1')).toEqual({ rir: 1, lastSetRir: null });
    expect(M.parseCell('100kg')).toEqual({ loadPct: null, loadKg: 100 });
    expect(M.parseCell('')).toBeNull();
    expect(M.parseCell('-')).toBeNull();
    expect(M.formatCell({ sets: 4, repsMin: 6, repsMax: 8, rir: 2, lastSetRir: 1, loadPct: 75 })).toBe('4×6-8 @2/1 75%');
    expect(M.parseQuickEntry('Squat 4x6-8 @2 80% 3min')).toMatchObject({ name: 'Squat', sets: 4, rir: 2, loadPct: 80, restSec: 180 });
    expect(M.parseLoad('102.5 kg')).toEqual({ loadPct: null, loadKg: 102.5 });
  });

  test('validate flags a block split in two', () => {
    const p = M.readProgram({ name: 'x', blocks: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], weeks: [
      { block: 'a', days: [] }, { block: 'b', days: [] }, { block: 'a', days: [] }] });
    expect(M.validate(p).some(w => /A is split/.test(w.message))).toBe(true);
  });
});
