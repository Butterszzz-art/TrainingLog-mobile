const core = require('../src/js/programBuilderV2Core');

function createMemoryGlobal() {
  const store = new Map();
  return {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
}

describe('programBuilderV2Core coach foundations', () => {
  test('default coach exercise includes sets/reps and RIR/RPE note fields', () => {
    const exercise = core.createDefaultExercise({ name: 'Back Squat' });
    expect(exercise.name).toBe('Back Squat');
    expect(exercise).toHaveProperty('rpeNote');
    expect(exercise).toHaveProperty('rirNote');
    expect(exercise).toHaveProperty('progressionNotes');
    expect(Array.isArray(exercise.sets)).toBe(true);
    expect(exercise.sets[0].reps).toBe(8);
  });

  test('normalizeDraft preserves coach builder fields', () => {
    const normalized = core.normalizeDraft({
      title: 'Offseason Strength Block',
      split: { type: 'upperlower', name: 'UL Split', daysPerWeek: 4 },
      archetype: 'strength',
      progressionNotes: 'Add 5 lb weekly when RPE <= 8',
      days: [
        {
          dayId: 'd1',
          name: 'Upper 1',
          exercises: [
            {
              exerciseId: 'e1',
              name: 'Bench Press',
              rpeNote: 'Top set at 8',
              progressionNotes: 'Use microplates if needed',
              sets: [{ reps: 5, rpe: 8, rir: 2 }],
            },
          ],
        },
      ],
    });

    expect(normalized.title).toBe('Offseason Strength Block');
    expect(normalized.split.name).toBe('UL Split');
    expect(normalized.days[0].exercises[0].sets[0].rir).toBe(2);
    expect(normalized.days[0].exercises[0].rpeNote).toBe('Top set at 8');
    expect(normalized.progressionNotes).toContain('Add 5 lb weekly');
  });

  test('save, duplicate templates and assign program to client', () => {
    const fakeGlobal = createMemoryGlobal();
    const baseProgram = core.normalizeDraft({
      coachId: 'coach-1',
      title: 'General Athletic Prep',
      archetype: 'general',
      days: [{ dayId: 'd1', name: 'Day 1', exercises: [] }],
    });

    const saved = core.saveProgramTemplate(fakeGlobal, baseProgram);
    expect(saved).toBeTruthy();

    const duplicated = core.duplicateProgramTemplate(fakeGlobal, saved.templateId);
    expect(duplicated.title).toContain('(Copy)');
    const duplicatedLatest = core.duplicateProgramTemplate(fakeGlobal, null);
    expect(duplicatedLatest.title).toContain('(Copy)');

    const assignment = core.assignProgramToClient(fakeGlobal, {
      coachId: 'coach-1',
      clientId: 'athlete-99',
      clientName: 'Avery',
      archetype: 'general',
      program: baseProgram,
    });

    expect(assignment.clientName).toBe('Avery');
    expect(assignment.program.title).toBe('General Athletic Prep');

    const assignments = core.loadProgramAssignments(fakeGlobal);
    expect(assignments).toHaveLength(1);
  });
});
