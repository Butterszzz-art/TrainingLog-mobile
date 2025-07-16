const { loadUserExercises, saveUserExercise } = require('../exerciseAutocomplete');

describe('exercise autocomplete helpers', () => {
  beforeEach(() => {
    global.localStorage = {
      store: {},
      getItem(key) { return this.store[key] || null; },
      setItem(key, val) { this.store[key] = String(val); },
      removeItem(key) { delete this.store[key]; },
      clear() { this.store = {}; }
    };
  });

  test('saveUserExercise adds new exercise', () => {
    const list = saveUserExercise('u1', 'Bench');
    expect(list).toContain('Bench');
    const stored = JSON.parse(global.localStorage.getItem('exercises_u1'));
    expect(stored).toContain('Bench');
  });

  test('loadUserExercises returns stored names', () => {
    global.localStorage.setItem('exercises_u1', JSON.stringify(['Squat']));
    const list = loadUserExercises('u1');
    expect(list).toEqual(['Squat']);
  });
});
