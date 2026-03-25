const missionEngine = require('../dailyMissionEngine');

describe('dailyMissionEngine', () => {
  const userId = 'daily-mission-test-user';
  const date = '2026-03-25';

  test('generates contest prep mission with all prep tasks', () => {
    const state = missionEngine.generateDefaultMissionFromPhase(userId, { mode: 'contest prep' }, date);
    expect(state.requiredItems).toEqual([
      'trainingComplete',
      'cardioComplete',
      'macrosComplete',
      'bodyweightLogged',
      'posingComplete',
      'recoveryLogged'
    ]);
  });

  test('generates improvement season mission with focused tasks', () => {
    const state = missionEngine.generateDefaultMissionFromPhase(userId, { mode: 'improvement season' }, '2026-03-24');
    expect(state.requiredItems).toEqual([
      'trainingComplete',
      'macrosComplete',
      'bodyweightLogged',
      'recoveryLogged'
    ]);
  });

  test('marks mission complete and calculates compliance', () => {
    missionEngine.generateDefaultMissionFromPhase(userId, { mode: 'mini cut' }, '2026-03-23');
    missionEngine.markMissionItemComplete(userId, '2026-03-23', 'trainingComplete');
    missionEngine.markMissionItemComplete(userId, '2026-03-23', 'cardioComplete');
    const state = missionEngine.getDailyMissionState(userId, '2026-03-23');
    const compliance = missionEngine.calculateDailyCompliance(state);

    expect(compliance.completed).toBe(2);
    expect(compliance.total).toBe(4);
    expect(compliance.percent).toBe(50);
  });

  test('sync helpers mark training/cardio/bodyweight from app events', () => {
    missionEngine.syncMissionFromWorkoutCompletion({ date: '2026-03-22' }, userId);
    missionEngine.syncMissionFromCardioEntry({ date: '2026-03-22', type: 'Run', duration: 30 }, userId);
    missionEngine.syncMissionFromBodyweightEntry({ date: '2026-03-22', weightKg: 88 }, userId);
    const state = missionEngine.getDailyMissionState(userId, '2026-03-22');

    expect(state.trainingComplete).toBe(true);
    expect(state.cardioComplete).toBe(true);
    expect(state.bodyweightLogged).toBe(true);
  });

  test('macro sync marks complete only when values are within thresholds', () => {
    missionEngine.syncMissionFromMacroProgress({
      date: '2026-03-21',
      value: { calories: 2200, protein: 180, carbs: 230, fat: 65 },
      targets: { calories: 2200, protein: 180, carbs: 230, fat: 65 }
    }, userId);
    let state = missionEngine.getDailyMissionState(userId, '2026-03-21');
    expect(state.macrosComplete).toBe(true);

    missionEngine.syncMissionFromMacroProgress({
      date: '2026-03-21',
      value: { calories: 1500, protein: 100, carbs: 100, fat: 40 },
      targets: { calories: 2200, protein: 180, carbs: 230, fat: 65 }
    }, userId);
    state = missionEngine.getDailyMissionState(userId, '2026-03-21');
    expect(state.macrosComplete).toBe(false);
  });
});
