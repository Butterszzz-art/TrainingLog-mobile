const PT = require('../src/js/program-timeline');

describe('busy (maintenance) weeks', () => {
  test('normalize keeps busy changes, which need a week before them', () => {
    const s = PT.normalize({ changes: [{ kind: 'busy', afterWeek: 2, note: 'Exams' }, { kind: 'busy', afterWeek: 0 }] }, 4);
    expect(s.changes).toEqual([expect.objectContaining({ kind: 'busy', afterWeek: 2, note: 'Exams' })]);
  });

  test('slots: a busy copy of the week sits right after it', () => {
    const slots = PT.slots(3, { changes: [{ id: 'b', kind: 'busy', afterWeek: 1, note: '' }] });
    expect(slots.map(s => [s.week, s.kind])).toEqual([[1, 'week'], [1, 'busy'], [2, 'week'], [3, 'week']]);
  });

  test('maintenanceDay keeps about a third of the working sets (min 1), the first ones, and warm-ups', () => {
    const set = (reps, setType) => ({ reps, weight: 100, ...(setType ? { setType } : {}) });
    const day = { name: 'Lower', exercises: [
      { name: 'Squat', sets: [set(5, 'warmup'), set(6), set(6), set(8), set(8), set(8), set(8)] },
      { name: 'Leg Curl', sets: [set(12), set(12)] },
      { name: 'Calf Raise', sets: [set(15)] },
    ] };
    const m = PT.maintenanceDay(day);
    expect(m.maintenance).toBe(true);
    expect(m.exercises[0].sets.map(s => s.reps)).toEqual([5, 6, 6]); // warm-up + 2 of 6
    expect(m.exercises[1].sets).toHaveLength(1);
    expect(m.exercises[2].sets).toHaveLength(1);
    expect(day.exercises[0].sets).toHaveLength(7); // original untouched
    expect(PT.maintenanceDay(null)).toBeNull();
  });
});
