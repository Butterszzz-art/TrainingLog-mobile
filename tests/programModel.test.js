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
