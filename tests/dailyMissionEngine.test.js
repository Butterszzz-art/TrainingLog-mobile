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
});
