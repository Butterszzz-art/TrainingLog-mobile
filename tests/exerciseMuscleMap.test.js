const { getMuscleGroup } = require('../exerciseMuscleMap');

describe('getMuscleGroup', () => {
  test('matches exercise names case-insensitively', () => {
    expect(getMuscleGroup('bench press')).toBe('chest');
    expect(getMuscleGroup('  BENCH PRESS  ')).toBe('chest');
  });

  test('returns other for unknown or invalid inputs', () => {
    expect(getMuscleGroup('Unknown Move')).toBe('other');
    expect(getMuscleGroup(null)).toBe('other');
  });
});

describe('resolving names the tables do not know verbatim', () => {
  const { resolveExerciseMuscle, setCustomExerciseMuscleMap } = require('../exerciseMuscleMap');
  afterEach(() => setCustomExerciseMuscleMap({}));

  test.each([
    ['DB incline press', 'chest'],
    ['RDLs', 'hamstrings'],
    ['Lat raises', 'shoulders'],
    ['skullcrushers', 'triceps'],
    ['Pendlay rows', 'back'],
    ['sumo dl', 'back'],
  ])('expands abbreviations, plurals and word order: %s', (name, muscle) => {
    expect(resolveExerciseMuscle(name)).toEqual({ muscle, via: 'normalized' });
  });

  test.each([
    ['benhc press', 'chest'],
    ['lat pulldwon', 'back'],
    ['incline dumbell press', 'chest'],
    ['barbel row', 'back'],
  ])('corrects typos against the catalog vocabulary: %s', (name, muscle) => {
    expect(resolveExerciseMuscle(name)).toEqual({ muscle, via: 'corrected' });
  });

  test.each([
    ['Paused bench press 3x5', 'chest'],
    ['hip abduction machine', 'abductors'],
    ['tricep rope pushdowns', 'triceps'],
    ['incline smith press', 'chest'],
    ['wide grip row', 'back'],
    ['single leg nordic hamstring curl', 'hamstrings'],
    ['cable glute kickbacks', 'glutes'],
    ['smith calf raise 2s pause', 'calves'],
    ['paused hanging leg raise', 'abs'],
  ])('falls back to keyword rules, specific before broad: %s', (name, muscle) => {
    expect(resolveExerciseMuscle(name)).toEqual({ muscle, via: 'keyword' });
  });

  test('leaves names it cannot place as other, for the AI fallback', () => {
    expect(resolveExerciseMuscle('Larsen press')).toEqual({ muscle: 'other', via: null });
    expect(resolveExerciseMuscle('')).toEqual({ muscle: 'other', via: null });
  });

  test('custom assignments win, and match loosely too', () => {
    expect(resolveExerciseMuscle('Larsen press').muscle).toBe('other');
    setCustomExerciseMuscleMap({ 'larsen press': 'chest', 'bench press': 'triceps' });
    expect(resolveExerciseMuscle('Larsen press')).toEqual({ muscle: 'chest', via: 'exact' });
    expect(resolveExerciseMuscle('larsen presses')).toEqual({ muscle: 'chest', via: 'normalized' });
    expect(resolveExerciseMuscle('Bench Press').muscle).toBe('triceps');
  });
});
