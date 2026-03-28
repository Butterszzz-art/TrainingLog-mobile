const {
  saveCheckIn,
  loadCheckIns,
  getNextCheckInDate,
  getWeekLabelForCheckIn,
  groupCheckInsForTimeline,
  buildSeasonMilestones,
  getPhotoProgressHooks,
  getComparisonPlaceholders,
  buildSeasonArchive,
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
    expect(checkIns[0].coachNotes).toBe('');
    expect(checkIns[0].adjustments).toEqual({
      macrosChanged: false,
      macrosNotes: '',
      cardioChanged: false,
      cardioNotes: '',
      stepsChanged: false,
      stepsNotes: '',
      refeedAdded: false,
      refeedNotes: ''
    });
    expect(checkIns[0].review.status).toBe('pending');
    expect(checkIns[0].archetype).toBe('recreational');
    expect(checkIns[0].archetypeMetrics).toEqual({
      energy: 7,
      sleep: 8,
      stress: 4
    });
    expect(global.localStorage.getItem(getStorageKey('athleteA'))).toBeTruthy();
  });

  test('normalizeCheckIn keeps archetype metrics and legacy fallbacks', () => {
    saveCheckIn('athleteA', {
      date: '2026-03-26',
      archetype: 'bodybuilder',
      hunger: 8,
      archetypeMetrics: {
        cardioAdherence: 9
      }
    });

    const checkIns = loadCheckIns('athleteA');
    expect(checkIns[0].archetype).toBe('bodybuilder');
    expect(checkIns[0].archetypeMetrics.cardioAdherence).toBe(9);
    expect(checkIns[0].archetypeMetrics.hunger).toBe(8);
  });

  test('saveCheckIn preserves adjustment log and coach review metadata', () => {
    saveCheckIn('athleteA', {
      date: '2026-03-25',
      phase: 'contest_prep',
      coachNotes: 'Keep sodium and water stable for another week.',
      adjustments: {
        macrosChanged: true,
        macrosNotes: 'Dropped carbs by 20g',
        cardioChanged: true,
        cardioNotes: '+1 LISS session',
        stepsChanged: true,
        stepsNotes: '12k to 14k',
        refeedAdded: true,
        refeedNotes: 'Saturday high-carb refeed'
      },
      review: {
        status: 'reviewed',
        coachActionItems: 'Hold training volume, monitor recovery.',
        athleteSubmittedAt: '2026-03-25T10:00:00.000Z',
        coachReviewedAt: '2026-03-25T19:00:00.000Z'
      }
    });

    const checkIns = loadCheckIns('athleteA');
    expect(checkIns[0].coachNotes).toMatch(/sodium/i);
    expect(checkIns[0].adjustments.cardioChanged).toBe(true);
    expect(checkIns[0].adjustments.refeedNotes).toMatch(/high-carb/i);
    expect(checkIns[0].review.status).toBe('reviewed');
    expect(checkIns[0].review.coachReviewedAt).toBe('2026-03-25T19:00:00.000Z');
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

  test('buildSeasonMilestones returns prep to post-show waypoints', () => {
    const milestones = buildSeasonMilestones({
      startDate: '2026-01-01',
      showDate: '2026-06-20'
    });

    expect(milestones.map(item => item.key)).toEqual([
      'prep_start',
      'weeks_out_16',
      'weeks_out_12',
      'weeks_out_8',
      'peak_week',
      'show_day',
      'post_show_week_1'
    ]);
  });

  test('getPhotoProgressHooks builds front/side/back storage hooks', () => {
    const hooks = getPhotoProgressHooks({ sidePhoto: 'blob:side-1' }, 'peak_week');
    expect(hooks).toHaveLength(3);
    expect(hooks[0]).toEqual(expect.objectContaining({ view: 'front', hasPhoto: false }));
    expect(hooks[1]).toEqual(expect.objectContaining({ view: 'side', hasPhoto: true }));
    expect(hooks[2]).toEqual(expect.objectContaining({ view: 'back', hasPhoto: false }));
  });

  test('buildSeasonArchive links nearest check-ins and exposes comparison placeholders', () => {
    const archive = buildSeasonArchive(
      { startDate: '2026-02-01', showDate: '2026-06-20' },
      [
        { date: '2026-06-20', frontPhoto: 'blob:show-front' },
        { date: '2026-06-14', sidePhoto: 'blob:peak-side' },
        { date: '2026-04-26', backPhoto: 'blob:8week-back' }
      ]
    );

    const showDay = archive.timeline.find(entry => entry.key === 'show_day');
    const peakWeek = archive.timeline.find(entry => entry.key === 'peak_week');
    expect(showDay.hasLinkedCheckIn).toBe(true);
    expect(showDay.linkedCheckInDate).toBe('2026-06-20');
    expect(peakWeek.hasLinkedCheckIn).toBe(true);
    expect(Array.isArray(getComparisonPlaceholders())).toBe(true);
    expect(archive.comparisons[0].status).toBe('placeholder');
  });
});
