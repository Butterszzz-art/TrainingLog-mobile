// src/js/program-timeline.js — a coach's repeat / pause weeks for one client,
// and where that client is in the program today.
const T = require('../src/js/program-timeline.js');

// Library shape (what the client imports): blocks with week ranges, deload flags.
const program = {
  weeks: [{ week: 1 }, { week: 2 }, { week: 3 }, { week: 4, deload: true }, { week: 5 }, { week: 6 }],
  blocks: [{ name: 'Accumulation', goal: 'Volume up', fromWeek: 1, toWeek: 4 }, { name: 'Intensification', goal: '', fromWeek: 5, toWeek: 6 }],
};

describe('normalize', () => {
  test('keeps valid changes in week order, drops bad ones, needs a start date or a change', () => {
    const s = T.normalize({
      programId: 'p1', startDate: '2026-11-02',
      changes: [
        { kind: 'pause', afterWeek: 2, note: '  Holiday   in Spain ' },
        { kind: 'repeat', afterWeek: 1 },
        { kind: 'repeat', afterWeek: 0 }, // nothing to repeat yet
        { kind: 'skip', afterWeek: 1 },
        { kind: 'pause', afterWeek: 9 }, // past the last week
        { kind: 'repeat', afterWeek: 1, id: 'mine' },
      ],
    }, 6);
    expect(s.startDate).toBe('2026-11-02');
    expect(s.changes.map(c => [c.kind, c.afterWeek])).toEqual([['repeat', 1], ['repeat', 1], ['pause', 2]]);
    expect(s.changes[1].id).toBe('mine');
    expect(s.changes[2].note).toBe('Holiday in Spain');
    expect(T.normalize({ startDate: 'nope', changes: [] })).toBeNull();
    expect(T.normalize({ startDate: '', changes: [{ kind: 'pause', afterWeek: 0 }] }).changes).toHaveLength(1);
  });
});

describe('slots', () => {
  test('repeats and pauses are laid into the sequence of weeks', () => {
    const list = T.slots(4, { changes: [{ id: 'a', kind: 'repeat', afterWeek: 2 }, { id: 'b', kind: 'pause', afterWeek: 3, note: 'Holiday' }, { id: 'c', kind: 'pause', afterWeek: 0 }] });
    expect(list.map(s => s.kind === 'pause' ? 'P' : s.kind === 'repeat' ? 'R' + s.week : 'W' + s.week)).toEqual(['P', 'W1', 'W2', 'R2', 'W3', 'P', 'W4']);
    expect(list[5]).toMatchObject({ slot: 6, week: null, note: 'Holiday', changeId: 'b' });
    expect(T.slots(3, null).map(s => s.week)).toEqual([1, 2, 3]);
  });
});

describe('weekMeta', () => {
  test('reads blocks from the library shape and the coach v2 shape', () => {
    expect(T.weekMeta(program).map(m => [m.block && m.block.name, m.deload])).toEqual([
      ['Accumulation', false], ['Accumulation', false], ['Accumulation', false], ['Accumulation', true], ['Intensification', false], ['Intensification', false]]);
    const v2 = { blocks: [{ id: 'b1', name: 'Base' }], weeks: [{ block: 'b1' }, { block: 'b1', deload: true }, {}] };
    expect(T.weekMeta(v2).map(m => [m.block && m.block.name, m.block && m.block.toWeek, m.deload])).toEqual([['Base', 2, false], ['Base', 2, true], [null, null, false]]);
  });
});

describe('locate', () => {
  // Mon/Wed/Fri, starting Monday 2 Nov 2026.
  const base = { program, startDate: '2026-11-02', weekdays: ['Mon', 'Wed', 'Fri'] };
  const at = (iso, schedule) => T.locate(Object.assign({}, base, { schedule, today: new Date(iso + 'T12:00:00') }));

  test('plain program: block, week in block, deload, weeks left', () => {
    const p = at('2026-11-18'); // third week
    expect(p).toMatchObject({ before: false, finished: false, slotNumber: 3, totalSlots: 6, programWeek: 3, weekInBlock: 3, blockSlots: 4, blockIndex: 0, blockCount: 2, deload: false, weeksLeft: 3 });
    expect(p.block.name).toBe('Accumulation');
    expect(at('2026-11-23')).toMatchObject({ programWeek: 4, deload: true, weekInBlock: 4 });
    expect(at('2026-11-30')).toMatchObject({ programWeek: 5, weekInBlock: 1, blockSlots: 2, blockIndex: 1 });
    expect(at('2026-10-30')).toMatchObject({ before: true, slotNumber: 1 });
    expect(at('2026-12-14')).toMatchObject({ finished: true, weeksLeft: 0 });
  });

  test('a repeat makes the block longer; a pause shows as a pause in the block before it', () => {
    const schedule = { changes: [{ id: 'r', kind: 'repeat', afterWeek: 2 }, { id: 'p', kind: 'pause', afterWeek: 2, note: 'Holiday' }] };
    // W1 W2 R2 P W3 W4 W5 W6
    expect(at('2026-11-16', schedule)).toMatchObject({ slotNumber: 3, programWeek: 2, repeat: true, weekInBlock: 3, blockSlots: 5, totalSlots: 8 });
    const pause = at('2026-11-23', schedule);
    expect(pause).toMatchObject({ pause: true, programWeek: null, note: 'Holiday', weekInBlock: 0 });
    expect(pause.block.name).toBe('Accumulation');
    expect(at('2026-11-30', schedule)).toMatchObject({ programWeek: 3, weekInBlock: 4 });
    expect(pause.monday(3).getDate()).toBe(23); // slot 4 starts Monday 23 Nov
  });

  test('a mid-week start counts rounds of training days, like the day-by-day schedule', () => {
    const p = T.locate({ program, startDate: '2026-11-04', weekdays: ['Mon', 'Wed', 'Fri'], today: new Date('2026-11-09T09:00:00') });
    expect(p.slotNumber).toBe(1); // Wed, Fri, Mon = the first three sessions
    expect(T.locate({ program, startDate: '2026-11-04', weekdays: ['Mon', 'Wed', 'Fri'], today: new Date('2026-11-11T09:00:00') }).slotNumber).toBe(2);
    expect(T.locate({ program, startDate: '', today: new Date() })).toBeNull();
  });
});
