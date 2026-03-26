const {
  getCurrentPhaseState,
  saveCurrentPhaseState,
  initializeDefaultPhaseState,
  getDaysUntilShow,
  getWeeksOut,
  getPrepWeekLabel,
  getPostShowLabel,
  getImprovementSeasonLabel,
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
      mode: 'contest prep',
      athleteName: 'Kai',
      showDate: '2026-08-12',
      targetStageWeight: '182.5',
      currentWeight: '191.3',
      division: 'Classic Physique',
      notes: 'Push posing volume',
      checkInDay: 'Saturday',
      cardioBaseline: '4x25 min LISS',
      posingFrequency: '5 sessions'
    });

    expect(saved.mode).toBe('contest_prep');
    expect(saved.athleteName).toBe('Kai');
    expect(saved.targetStageWeight).toBe(182.5);
    expect(saved.currentWeight).toBe(191.3);
    expect(getCurrentPhaseState('abc').division).toBe('Classic Physique');
    expect(getCurrentPhaseState('abc').checkInDay).toBe('Saturday');
    expect(getCurrentPhaseState('abc').cardioBaseline).toBe('4x25 min LISS');
  });

  test('phase helpers calculate phase label and context', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    expect(getDaysUntilShow(tomorrow)).toBe(1);
    expect(getWeeksOut(tomorrow)).toBe(1);

    const label = getCurrentPhaseLabel({ mode: 'contest_prep', showDate: tomorrow });
    expect(label).toBe('Peak Week');

    const improvementLabel = getCurrentPhaseLabel({ mode: 'improvement', showDate: tomorrow });
    expect(improvementLabel).toBe('Improvement Season');

    const context = getPhaseContext({ mode: 'contest_prep', showDate: tomorrow, checkInDay: 'Friday' });
    expect(context.isPeakWeek).toBe(true);
    expect(context.mode).toBe('peak_week');
    expect(context.configuredMode).toBe('contest_prep');
    expect(context.checkInDay).toBe('Friday');
  });

  test('timeline labels support prep, post-show, and improvement season states', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(getPrepWeekLabel({ showDate: '2026-06-17', referenceDate: '2026-03-25' })).toBe('12 Weeks Out');
    expect(getPrepWeekLabel({ showDate: today, referenceDate: today })).toBe('Show Day');
    expect(getPostShowLabel({ showDate: '2026-03-01', referenceDate: '2026-03-10' })).toBe('Post-Show Week 2');
    expect(getImprovementSeasonLabel({ startDate: '2026-02-18', referenceDate: '2026-03-25' })).toBe('Improvement Season Week 6');
    expect(getPrepWeekLabel({ showDate: null, startDate: '2026-03-18', referenceDate: '2026-03-25' })).toBe('Contest Prep Week 2');
  });

  test('mini cut and improvement-specific setup fields persist safely', () => {
    const miniCut = saveCurrentPhaseState('mini-athlete', {
      mode: 'mini_cut',
      startDate: '2026-03-01',
      targetRateOfLoss: '0.7'
    });

    expect(miniCut.mode).toBe('mini_cut');
    expect(miniCut.targetRateOfLoss).toBe(0.7);

    const improvement = saveCurrentPhaseState('mini-athlete', {
      ...miniCut,
      mode: 'improvement',
      weightGoalDirection: 'gain',
      targetRateOfLoss: null
    });

    expect(improvement.mode).toBe('improvement');
    expect(improvement.weightGoalDirection).toBe('gain');
    expect(improvement.targetRateOfLoss).toBeNull();
  });
});
