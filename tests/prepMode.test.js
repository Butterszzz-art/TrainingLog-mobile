const {
  getCurrentPhaseState,
  saveCurrentPhaseState,
  initializeDefaultPhaseState,
  getDaysUntilShow,
  getWeeksOut,
  getCurrentPhaseLabel,
  getPhaseContext,
  getStorageKey
} = require('../prepMode');

describe('prepMode', () => {
  beforeEach(() => {
    const store = {};
    global.localStorage = {
      getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: key => { delete store[key]; }
    };
  });

  test('initializeDefaultPhaseState creates per-user state', () => {
    const userId = 'test-athlete';
    const state = initializeDefaultPhaseState(userId);

    expect(state.mode).toBe('improvement');
    expect(getCurrentPhaseState(userId).mode).toBe('improvement');
    expect(global.localStorage.getItem(getStorageKey(userId))).toBeTruthy();
  });

  test('saveCurrentPhaseState sanitizes and persists supported fields', () => {
    const saved = saveCurrentPhaseState('abc', {
      mode: 'contest_prep',
      showDate: '2026-08-12',
      targetStageWeight: '182.5',
      currentWeight: '191.3',
      division: 'Classic Physique',
      notes: 'Push posing volume',
      checkInDay: 'Saturday'
    });

    expect(saved.mode).toBe('contest_prep');
    expect(saved.targetStageWeight).toBe(182.5);
    expect(saved.currentWeight).toBe(191.3);
    expect(getCurrentPhaseState('abc').division).toBe('Classic Physique');
    expect(getCurrentPhaseState('abc').checkInDay).toBe('Saturday');
  });

  test('phase helpers calculate phase label and context', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    expect(getDaysUntilShow(tomorrow)).toBe(1);
    expect(getWeeksOut(tomorrow)).toBe(1);

    const label = getCurrentPhaseLabel({ mode: 'improvement', showDate: tomorrow });
    expect(label).toBe('Peak Week');

    const context = getPhaseContext({ mode: 'contest_prep', showDate: tomorrow, checkInDay: 'Friday' });
    expect(context.isPeakWeek).toBe(true);
    expect(context.checkInDay).toBe('Friday');
  });
});
