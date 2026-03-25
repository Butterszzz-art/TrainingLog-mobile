const {
  saveCheckIn,
  loadCheckIns,
  getNextCheckInDate,
  getWeekLabelForCheckIn,
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
});
