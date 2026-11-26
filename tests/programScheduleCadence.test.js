// Synchronous (fixed weekdays) vs asynchronous (days on / days off) splits.
const ps = require('../src/js/program-schedule.js');
const core = require('../src/js/programBuilderV2Core.js');

const days = [{ name: 'Push', exercises: [] }, { name: 'Pull', exercises: [] }, { name: 'Legs', exercises: [] }];
const d = iso => ps.parseLocalDate(iso);

describe('asynchronous split', () => {
  const program = { id: 'p1', name: 'PPL', days, frequency: [], schedule: { mode: 'async', onDays: 3, offDays: 1, weekdays: [] } };
  const sched = ps.createSchedule(program, { startDate: '2026-11-25' }); // a Wednesday

  test('trains N days, rests M days, repeats from the start date', () => {
    const pattern = Array.from({ length: 9 }, (_, i) => sched.dayFor(new Date(2026, 10, 25 + i)).isTraining);
    expect(pattern).toEqual([true, true, true, false, true, true, true, false, true]);
  });

  test('program days rotate across cycles, not weekdays', () => {
    const names = ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-29', '2026-11-30', '2026-12-03']
      .map(iso => sched.dayFor(d(iso)).day.name);
    expect(names).toEqual(['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Push']);
    expect(sched.dayFor(d('2026-11-28')).day).toBeNull();
  });

  test('cycle day and next training day', () => {
    expect(sched.dayFor(d('2026-11-28')).cycleDay).toBe(4);
    expect(sched.nextTrainingAfter(d('2026-11-27')).key).toBe('2026-11-29');
  });

  test('days before the start are not training days', () => {
    expect(sched.dayFor(d('2026-11-24')).isTraining).toBe(false);
  });

  test('label', () => {
    expect(ps.cadenceLabel(program)).toBe('3 on / 1 off');
  });
});

describe('synchronous split', () => {
  test('a builder program schedules from schedule.weekdays when frequency is empty', () => {
    const program = { id: 'p2', name: 'UL', days, frequency: [], schedule: { mode: 'sync', weekdays: [1, 3, 5] } };
    const sched = ps.createSchedule(program, { startDate: '2026-11-23' });
    expect(sched).not.toBeNull();
    const week = sched.weekOf(d('2026-11-23')).map(x => x.isTraining);
    expect(week).toEqual([true, false, true, false, true, false, false]);
    expect(ps.cadenceLabel(program)).toBe('Mon, Wed, Fri');
  });
});

describe('builder core', () => {
  test('normalizeCadence clamps and defaults', () => {
    expect(core.normalizeCadence({ mode: 'async', onDays: 12, offDays: 0 })).toEqual({ mode: 'async', onDays: 7, offDays: 1 });
    expect(core.normalizeCadence(undefined)).toEqual({ mode: 'sync', onDays: 3, offDays: 1 });
  });

  test('an asynchronous schedule needs no weekdays', () => {
    expect(core.validateStep('schedule', { schedule: { mode: 'async', onDays: 2, offDays: 1, weekdays: [] } })).toBe(true);
    expect(core.validateStep('schedule', { schedule: { mode: 'sync', weekdays: [] } })).toBe(false);
  });
});
