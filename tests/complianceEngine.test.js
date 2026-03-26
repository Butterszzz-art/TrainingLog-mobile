const missionEngine = require('../dailyMissionEngine');
const complianceEngine = require('../complianceEngine');

describe('complianceEngine', () => {
  const userId = 'compliance-engine-user';

  function seedDay(date, state) {
    missionEngine.saveDailyMissionState(userId, date, {
      date,
      requiredItems: ['workoutComplete', 'cardioComplete', 'macrosComplete', 'bodyweightLogged', 'posingComplete', 'recoveryLogged'],
      ...state
    });
  }

  test('calculates daily, weekly, and rolling 7-day compliance with status buckets', () => {
    seedDay('2026-03-20', { workoutComplete: true, cardioComplete: true, macrosComplete: true, bodyweightLogged: true, posingComplete: true, recoveryLogged: true }); //100
    seedDay('2026-03-21', { workoutComplete: true, cardioComplete: true, macrosComplete: true, bodyweightLogged: true, posingComplete: false, recoveryLogged: true }); //83
    seedDay('2026-03-22', { workoutComplete: true, cardioComplete: false, macrosComplete: true, bodyweightLogged: false, posingComplete: false, recoveryLogged: true }); //50
    seedDay('2026-03-23', { workoutComplete: true, cardioComplete: false, macrosComplete: false, bodyweightLogged: false, posingComplete: false, recoveryLogged: false }); //17
    seedDay('2026-03-24', { workoutComplete: true, cardioComplete: true, macrosComplete: true, bodyweightLogged: true, posingComplete: true, recoveryLogged: false }); //83
    seedDay('2026-03-25', { workoutComplete: true, cardioComplete: false, macrosComplete: true, bodyweightLogged: true, posingComplete: false, recoveryLogged: true }); //67
    seedDay('2026-03-26', { workoutComplete: true, cardioComplete: false, macrosComplete: true, bodyweightLogged: true, posingComplete: false, recoveryLogged: true }); //67

    const dayState = missionEngine.getDailyMissionState(userId, '2026-03-26');
    expect(complianceEngine.calculateDailyCompliancePercent(dayState)).toBe(67);
    expect(complianceEngine.getComplianceStatus(95)).toBe('on_track');
    expect(complianceEngine.getComplianceStatus(80)).toBe('slightly_behind');
    expect(complianceEngine.getComplianceStatus(50)).toBe('at_risk');
    expect(complianceEngine.getComplianceStatus(49)).toBe('off_track');

    const weekly = complianceEngine.calculateWeeklyCompliance(userId, '2026-03-26');
    expect(weekly.averagePercent).toBe(67);
    expect(weekly.status).toBe('at_risk');

    const rolling = complianceEngine.calculateRolling7DayCompliance(userId, '2026-03-26');
    expect(rolling.percent).toBe(67);
    expect(rolling.status).toBe('at_risk');
  });

  test('analyzes missed tasks and provides insight cues', () => {
    global.posingEngine = {
      getOverdueStatus: () => ({ overdue: true, daysSinceLastSession: 4 })
    };
    const missed = complianceEngine.analyzeMissedTasks(userId, '2026-03-26', 7);
    expect(missed.totalMissed).toBeGreaterThan(0);
    expect(missed.byTask.cardioComplete).toBeGreaterThan(0);
    expect(missed.byTask.posingComplete).toBeGreaterThan(0);

    const insights = complianceEngine.getComplianceInsights(userId, '2026-03-26');
    expect(Array.isArray(insights.insights)).toBe(true);
    expect(insights.insights.join(' ').toLowerCase()).toContain('cardio consistency slipping');
    expect(insights.insights.join(' ').toLowerCase()).toContain('posing overdue warning');
  });
});
