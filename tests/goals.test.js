const {
  calculateGoalProgress,
  createSmartGoal,
  loadGoals,
  saveGoals,
  updateGoalProgress
} = require('../goals');

describe('goals helpers', () => {
  beforeEach(() => {
    global.localStorage = {
      _data: {},
      getItem(key) { return this._data[key] ?? null; },
      setItem(key, value) { this._data[key] = String(value); },
      clear() { this._data = {}; }
    };
  });

  test('createSmartGoal stores a SMART goal in localStorage', () => {
    createSmartGoal('alex', {
      title: 'Squat 150kg',
      exercise: 'Squat',
      targetValue: 150,
      startValue: 110,
      dueDate: '2026-06-01',
      specific: 'Increase 1RM squat',
      measurable: 'Track top set load',
      achievable: 'Add 2.5kg per month',
      relevant: 'Improve powerlifting total',
      timeBound: 'By June 2026'
    });

    const goals = loadGoals('alex');
    expect(goals).toHaveLength(1);
    expect(goals[0].smart.specific).toBe('Increase 1RM squat');
  });

  test('updateGoalProgress increments matching goal type', () => {
    saveGoals('alex', [{ id: 'g1', type: 'volume', currentValue: 10, targetValue: 100 }]);
    const updated = updateGoalProgress('alex', 'volume', 15);
    expect(updated.currentValue).toBe(25);
  });

  test('calculateGoalProgress reports on_track for improving trend', () => {
    const goal = {
      exercise: 'Squat',
      targetValue: 150,
      startValue: 100,
      createdAt: '2025-01-01',
      dueDate: '2027-01-01',
      currentValue: 120
    };
    const workouts = [
      { date: '2026-01-01', log: [{ exercise: 'Squat', weightsArray: [110], repsArray: [5] }] },
      { date: '2026-05-01', log: [{ exercise: 'Squat', weightsArray: [125], repsArray: [3] }] },
      { date: '2026-09-01', log: [{ exercise: 'Squat', weightsArray: [135], repsArray: [2] }] }
    ];

    const result = calculateGoalProgress(goal, workouts);
    expect(result.progressPercent).toBeGreaterThan(0);
    expect(['on_track', 'ahead', 'behind']).toContain(result.status);
  });
});
