const M = require('../src/js/program-model.js');
const Examples = require('../coach/example-programs.js');

describe('coach example programs', () => {
  test('every example reads as a valid program/2 without losing rows', () => {
    Examples.list.forEach(({ id }) => {
      const raw = Examples.build(id);
      const p = M.readProgram(raw);
      expect(p).not.toBeNull();
      expect(p.name).toBe(raw.name);
      expect(p.weeks).toHaveLength(raw.weeks.length);
      raw.weeks.forEach((w, i) => {
        if (!w.days) return;
        w.days.forEach((d, j) => expect(p.weeks[i].days[j].exercises).toHaveLength(d.exercises.length));
      });
    });
  });

  test('upper/lower example: 3 mesocycles of 4 weeks, 5 training days', () => {
    const p = M.readProgram(Examples.build('upper-lower-lower-focus'));
    expect(p.weeks).toHaveLength(12);
    expect(p.blocks.map(b => b.id)).toEqual(['meso1', 'meso2', 'meso3']);
    expect(M.blockRuns(p).map(r => [r.from, r.to])).toEqual([[1, 4], [5, 8], [9, 12]]);
    expect(M.weekDays(p, 1).map(d => d.weekday)).toEqual([1, 2, 3, 4, 6]);
  });

  test('rows carry sets, reps, RIR, %1RM and the rest pattern', () => {
    const p = M.readProgram(Examples.build('upper-lower-lower-focus'));
    const row = (week, dayId, name) => M.weekDays(p, week).find(d => d.dayId === dayId).exercises.find(e => e.name === name);

    const legPress = row(9, 'd1', 'Leg Press');
    expect(legPress).toMatchObject({ sets: 3, repsMin: 12, rir: 2, lastSetRir: 1, loadPct: 80, restSec: 60 });
    expect(row(1, 'd1', 'Hip Thrust')).toMatchObject({ sets: 2, repsMin: 4, rir: 1, lastSetRir: 0, loadPct: 85, restSec: 180 });
    expect(row(5, 'd1', 'Seated Hamstring Curl').restSec).toBe(120);
    // First appearance gets 3 minutes, whatever the mesocycle.
    expect(row(5, 'd1', 'Glute Kickback').restSec).toBe(180);
    expect(row(9, 'd2', 'Cable Upright Row').restSec).toBe(180);
    expect(row(1, 'd2', 'Cable Upright Row')).toBeUndefined();
    // Adductor: 2 min straight sets, 60 s as a superset; crunches always 60 s.
    expect(row(1, 'd1', 'Hip Adduction Machine').restSec).toBe(120);
    expect(row(5, 'd1', 'Hip Adduction Machine').restSec).toBe(60);
    expect(row(1, 'd1', 'Cable Crunch').restSec).toBe(60);
    // Myo-reps have no RIR target.
    expect(row(5, 'd5', 'Leg Press')).toMatchObject({ sets: 3, repsMin: 15, rir: null, loadPct: 45 });
    expect(row(5, 'd5', 'Leg Press').notes).toMatch(/myo-reps/i);
  });

  test('parseCell keeps the full RIR order when a row has more than two sets', () => {
    expect(Examples._parseCell('8x4 (2>2>1>0)')).toMatchObject({ repsMin: 8, sets: 4, rir: 2, lastSetRir: 0, cellNotes: ['RIR per set 2 > 2 > 1 > 0'] });
    expect(Examples._parseCell('10x2 (1>1)')).toMatchObject({ rir: 1, lastSetRir: null });
  });

  test('build returns a fresh copy each time', () => {
    const a = Examples.build('upper-lower-lower-focus');
    a.weeks[0].days[0].exercises.length = 0;
    expect(Examples.build('upper-lower-lower-focus').weeks[0].days[0].exercises.length).toBeGreaterThan(0);
    expect(Examples.build('nope')).toBeNull();
  });
});
