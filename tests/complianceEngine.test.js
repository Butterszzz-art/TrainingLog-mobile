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
    expect(complianceEngine.calculateDailyCompliancePercent(dayState, 'hybrid')).toBe(76);
    expect(complianceEngine.getComplianceStatus(95)).toBe('on_track');
    expect(complianceEngine.getComplianceStatus(80)).toBe('slightly_behind');
    expect(complianceEngine.getComplianceStatus(50)).toBe('at_risk');
    expect(complianceEngine.getComplianceStatus(49)).toBe('off_track');

    const weekly = complianceEngine.calculateWeeklyCompliance(userId, '2026-03-26', 'hybrid');
    expect(weekly.averagePercent).toBe(74);
    expect(weekly.status).toBe('at_risk');
    expect(weekly.archetype).toBe('hybrid');

    const rolling = complianceEngine.calculateRolling7DayCompliance(userId, '2026-03-26', 'hybrid');
    expect(rolling.percent).toBe(74);
    expect(rolling.status).toBe('at_risk');
    expect(rolling.archetype).toBe('hybrid');
  });

  test('weights behaviors differently by archetype while keeping same mission items', () => {
    const mixedDay = missionEngine.getDailyMissionState(userId, '2026-03-22');
    expect(complianceEngine.calculateDailyCompliancePercent(mixedDay, 'bodybuilder')).toBe(45);
    expect(complianceEngine.calculateDailyCompliancePercent(mixedDay, 'powerlifter')).toBe(78);
    expect(complianceEngine.calculateDailyCompliancePercent(mixedDay, 'hybrid')).toBe(64);
    expect(complianceEngine.calculateDailyCompliancePercent(mixedDay, 'recreational')).toBe(61);

    const unknownArchetype = complianceEngine.calculateDailyCompliancePercent(mixedDay, 'unknown');
    expect(unknownArchetype).toBe(64);
  });

  test('returns weight tables for known archetypes and safe fallback for unknown', () => {
    const bodybuilder = complianceEngine.getComplianceWeightsForArchetype('bodybuilder');
    const powerlifter = complianceEngine.getComplianceWeightsForArchetype('powerlifter');
    const fallback = complianceEngine.getComplianceWeightsForArchetype('not-real');

    expect(bodybuilder.macrosComplete).toBeGreaterThan(bodybuilder.workoutComplete);
    expect(powerlifter.workoutComplete).toBeGreaterThan(powerlifter.cardioComplete);
    expect(fallback).toEqual(complianceEngine.getComplianceWeightsForArchetype('hybrid'));
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
