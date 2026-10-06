// Plain Node: the modules attach to globalThis when there's no window.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const window = globalThis;

const muscleMap = require('../exerciseMuscleMap');
const custom = require('../src/js/customExercises');
const auto = require('../src/js/exerciseAutoClassify');

const USER = 'lifter';

function logWorkouts(...names) {
  localStorage.setItem(`workouts_${USER}`, JSON.stringify([{ date: '2026-10-01', log: names.map((exercise) => ({ exercise, repsArray: [8], weightsArray: [60] })) }]));
}

function okFetch(results) {
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, results }) }));
  return fetchImpl;
}

beforeEach(() => {
  localStorage.clear();
  muscleMap.setCustomExerciseMuscleMap({});
  window.resolveExerciseMuscle = muscleMap.resolveExerciseMuscle;
  window.setCustomExerciseMuscleMap = muscleMap.setCustomExerciseMuscleMap;
  window.saveAiExerciseGuesses = custom.saveAiExerciseGuesses;
  window.hasPaidAccess = () => true;
  window.pocketCoachAIConsent = { get: () => 'granted' };
  window.showToast = jest.fn();
});

describe('unresolvedExerciseNames', () => {
  test('lists only distinct names nothing local can place', () => {
    logWorkouts('Bench Press', 'DB incline press', 'Larsen press', 'larsen press', 'Spoto press');
    expect(auto.unresolvedExerciseNames(USER)).toEqual(['Larsen press', 'Spoto press']);
  });

  test('skips names the AI was asked about within the last month', () => {
    logWorkouts('Larsen press', 'Spoto press');
    const now = Date.now();
    localStorage.setItem(`exerciseAiAttempts_${USER}`, JSON.stringify({ 'larsen press': now - 1000, 'spoto press': now - 40 * 864e5 }));
    expect(auto.unresolvedExerciseNames(USER, now)).toEqual(['Spoto press']);
  });
});

describe('classifyUnresolvedExercises', () => {
  test('saves confident guesses as AI custom exercises so volume counts them', async () => {
    logWorkouts('Larsen press', 'Spoto press', 'Zumba');
    const fetchImpl = okFetch([
      { name: 'Larsen press', muscleGroup: 'chest', confidence: 0.9, canonicalName: 'Larsen Press' },
      { name: 'Spoto press', muscleGroup: 'chest', confidence: 0.4, canonicalName: 'Spoto Press' },
      { name: 'Zumba', muscleGroup: null, confidence: 0, canonicalName: null },
    ]);
    const added = await auto.classifyUnresolvedExercises(USER, { fetchImpl });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ names: ['Larsen press', 'Spoto press', 'Zumba'] });
    expect(added.map((a) => a.name)).toEqual(['Larsen press']);
    expect(custom.loadCustomExercises(USER)[0]).toMatchObject({ name: 'Larsen press', muscleGroup: 'chest', source: 'ai', confidence: 0.9 });
    expect(muscleMap.getMuscleGroup('Larsen press')).toBe('chest');
    expect(muscleMap.getMuscleGroup('Spoto press')).toBe('other');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('AI guess'));

    // Every answered name is marked as asked, placed or not.
    const fetchAgain = okFetch([]);
    await auto.classifyUnresolvedExercises(USER, { fetchImpl: fetchAgain });
    expect(fetchAgain).not.toHaveBeenCalled();
  });

  test('never overwrites the user\'s own assignment', () => {
    custom.saveCustomExercise(USER, 'Larsen press', 'triceps');
    const added = custom.saveAiExerciseGuesses(USER, [{ name: 'larsen press', muscleGroup: 'chest', confidence: 1 }]);
    expect(added).toEqual([]);
    expect(custom.loadCustomExercises(USER)).toHaveLength(1);
    expect(custom.loadCustomExercises(USER)[0].muscleGroup).toBe('triceps');
  });

  test('saving the name by hand replaces the AI guess', () => {
    custom.saveAiExerciseGuesses(USER, [{ name: 'Larsen press', muscleGroup: 'chest', confidence: 0.9 }]);
    custom.saveCustomExercise(USER, 'Larsen press', 'triceps');
    const [entry] = custom.loadCustomExercises(USER);
    expect(entry.muscleGroup).toBe('triceps');
    expect(entry.source).toBeUndefined();
  });

  test.each([
    ['no AI consent', () => { window.pocketCoachAIConsent = { get: () => null }; }],
    ['declined consent', () => { window.pocketCoachAIConsent = { get: () => 'declined' }; }],
    ['free account', () => { window.hasPaidAccess = () => false; }],
  ])('sends nothing with %s', async (_label, setup) => {
    setup();
    logWorkouts('Larsen press');
    const fetchImpl = okFetch([]);
    expect(await auto.classifyUnresolvedExercises(USER, { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a failed request leaves names to retry next time', async () => {
    logWorkouts('Larsen press');
    const failing = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await auto.classifyUnresolvedExercises(USER, { fetchImpl: failing })).toEqual([]);
    expect(auto.unresolvedExerciseNames(USER)).toEqual(['Larsen press']);

    const throwing = jest.fn(async () => { throw new Error('offline'); });
    expect(await auto.classifyUnresolvedExercises(USER, { fetchImpl: throwing })).toEqual([]);
    expect(auto.unresolvedExerciseNames(USER)).toEqual(['Larsen press']);
  });

  test('sends nothing when every name is already placed', async () => {
    logWorkouts('Bench Press', 'benhc press', 'Paused squat 3x5');
    const fetchImpl = okFetch([]);
    await auto.classifyUnresolvedExercises(USER, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
