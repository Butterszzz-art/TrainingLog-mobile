const {
  saveCheckIn,
  loadCheckIns,
  getNextCheckInDate,
  getWeekLabelForCheckIn,
  groupCheckInsForTimeline,
  getCheckInInsights,
  getCheckInInsightTimeline,
  getStorageKey
} = require('../checkinEngine');

describe('checkinEngine', () => {
  beforeEach(() => {
    const store = {};
    global.localStorage = {
      getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: key => { delete store[key]; }
    };
  });

  test('saveCheckIn stores normalized check-in payload fields', () => {
    saveCheckIn('athleteA', {
      date: '2026-03-24',
      phase: 'contest_prep',
      bodyweight: 192.4,
      waist: 31.4,
      energy: 7,
      hunger: 5,
      sleep: 8,
      stress: 4,
      digestion: 8,
      trainingPerformance: 7,
      notes: 'Waist tighter this week'
    }, {
      mode: 'contest_prep',
      showDate: '2026-06-16'
    });

    const checkIns = loadCheckIns('athleteA');
    expect(checkIns).toHaveLength(1);
    expect(checkIns[0].frontPhoto).toBe('');
    expect(checkIns[0].sidePhoto).toBe('');
    expect(checkIns[0].backPhoto).toBe('');
    expect(checkIns[0].weekLabel).toMatch(/Weeks Out|Peak Week/);
    expect(checkIns[0].phaseWeekLabel).toBe(checkIns[0].weekLabel);
    expect(checkIns[0].recoveryRatings).toEqual({
      energy: 7,
      sleep: 8,
      stress: 4
    });
    expect(global.localStorage.getItem(getStorageKey('athleteA'))).toBeTruthy();
  });

  test('getWeekLabelForCheckIn supports contest prep and improvement labels', () => {
    const contestLabel = getWeekLabelForCheckIn(
      { date: '2026-03-25', phase: 'contest_prep' },
      { showDate: '2026-06-17', mode: 'contest_prep' }
    );
    expect(contestLabel).toBe('12 Weeks Out');

    const improvementLabel = getWeekLabelForCheckIn(
      { date: '2026-03-25', phase: 'improvement' },
      { startDate: '2026-03-04', mode: 'improvement' }
    );
    expect(improvementLabel).toBe('Improvement Season Week 4');
  });

  test('getNextCheckInDate uses configured check-in day', () => {
    const next = getNextCheckInDate({ checkInDay: 'Sunday' });
    expect(next).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const parsed = new Date(`${next}T00:00:00Z`);
    expect(parsed.getUTCDay()).toBe(0);
  });

  test('groupCheckInsForTimeline nests entries by weeks out then phase week', () => {
    const grouped = groupCheckInsForTimeline([
      {
        date: '2026-03-25',
        weeksOutLabel: '12 Weeks Out',
        phaseWeekLabel: '12 Weeks Out'
      },
      {
        date: '2026-03-18',
        weeksOutLabel: '13 Weeks Out',
        phaseWeekLabel: '13 Weeks Out'
      }
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].weeksOutLabel).toBe('12 Weeks Out');
    expect(grouped[0].phaseWeeks[0].phaseWeekLabel).toBe('12 Weeks Out');
    expect(grouped[0].phaseWeeks[0].entries).toHaveLength(1);
  });

  test('getCheckInInsights returns prep-style trend feedback', () => {
    const insights = getCheckInInsights([
      { date: '2026-03-20', bodyweight: 190.2, energy: 8, sleep: 8, stress: 3, trainingPerformance: 8, hunger: 7 },
      { date: '2026-03-13', bodyweight: 190.2, energy: 7, sleep: 7, stress: 4, trainingPerformance: 8, hunger: 6 },
      { date: '2026-03-06', bodyweight: 191.4, energy: 8, sleep: 7, stress: 3, trainingPerformance: 8, hunger: 5 },
      { date: '2026-02-27', bodyweight: 191.6, energy: 8, sleep: 8, stress: 3, trainingPerformance: 9, hunger: 4 }
    ]);

    expect(insights.summaryFull).toHaveLength(5);
    expect(insights.insightMap.rateOfChange).toMatch(/stalled|on target|aggressive|gain/i);
    expect(insights.insightMap.performanceTrend).toMatch(/holding steady|improving|softening/i);
    expect(insights.insightMap.hungerTrend).toMatch(/last 3 check-ins/i);
  });

  test('getCheckInInsightTimeline includes insight payload per entry', () => {
    const timeline = getCheckInInsightTimeline([
      { date: '2026-03-20', bodyweight: 190.2, energy: 8, sleep: 8, stress: 3, trainingPerformance: 8, hunger: 7 },
      { date: '2026-03-13', bodyweight: 190.0, energy: 8, sleep: 8, stress: 3, trainingPerformance: 8, hunger: 6 }
    ]);

    expect(timeline).toHaveLength(2);
    expect(timeline[0].insights).toBeTruthy();
    expect(timeline[0].insights.summaryShort).toMatch(/Weight trend|Recovery|Performance|check-in/i);
  });
});
