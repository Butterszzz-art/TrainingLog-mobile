const {
  roundToIncrement,
  suggestAttempts,
  computeMeetResult,
  buildTaperPlan,
  planWeightCut,
  getCaffeineDose
} = require('../src/js/powerlifting-peak-week.js');

describe('roundToIncrement', () => {
  test('rounds to the nearest plate increment', () => {
    expect(roundToIncrement(101.2, 2.5)).toBe(100);
    expect(roundToIncrement(103.8, 2.5)).toBe(105);
  });
});

describe('suggestAttempts', () => {
  test('returns opener/second/third around a tested 1RM', () => {
    const attempts = suggestAttempts(180, 2.5);
    expect(attempts.opener).toBe(162.5); // 90% of 180 = 162, rounds to 162.5
    expect(attempts.second).toBeGreaterThanOrEqual(attempts.opener + 2.5);
    expect(attempts.second).toBeCloseTo(185, 0); // ~1.025x, rounded up to the nearest 2.5
    expect(attempts.third).toBeGreaterThan(attempts.second);
  });

  test('returns null for invalid input', () => {
    expect(suggestAttempts(0, 2.5)).toBeNull();
    expect(suggestAttempts(NaN, 2.5)).toBeNull();
  });
});

describe('computeMeetResult', () => {
  test('sums the best good attempt per lift', () => {
    const result = computeMeetResult({
      squat: [{ weight: 150, status: 'good' }, { weight: 160, status: 'good' }, { weight: 165, status: 'no-lift' }],
      bench: [{ weight: 100, status: 'good' }, { weight: 105, status: 'pending' }, { weight: 107.5, status: 'pending' }],
      deadlift: [{ weight: 180, status: 'good' }, { weight: 190, status: 'good' }, { weight: 195, status: 'good' }]
    });
    expect(result.bestByLift.squat).toBe(160);
    expect(result.bestByLift.bench).toBe(100);
    expect(result.bestByLift.deadlift).toBe(195);
    expect(result.total).toBe(160 + 100 + 195);
    expect(result.bombedOut).toBe(false);
  });

  test('flags a bombed-out lift (0/3 white lights) and a null total', () => {
    const result = computeMeetResult({
      squat: [{ weight: 150, status: 'no-lift' }, { weight: 150, status: 'no-lift' }, { weight: 150, status: 'no-lift' }],
      bench: [{ weight: 100, status: 'good' }],
      deadlift: [{ weight: 180, status: 'good' }]
    });
    expect(result.bestByLift.squat).toBeNull();
    expect(result.bombedOut).toBe(true);
    expect(result.total).toBeNull();
  });

  test('handles an empty/missing attempts object', () => {
    const result = computeMeetResult({});
    expect(result.total).toBeNull();
    expect(result.anyAttempted).toBe(false);
  });
});

describe('buildTaperPlan', () => {
  test('produces a lead-in card plus daily taper cards for a meet >7 days out', () => {
    const plan = buildTaperPlan('2026-10-15', '2026-09-20'); // 25 days out
    expect(plan[0].phase).toBe('training');
    expect(plan[0].daysOut).toBe(25);
    // Should include one card per day from 7 out through meet day (8 cards)
    const taperCards = plan.filter(d => d.isTaper);
    expect(taperCards.length).toBe(8);
    expect(taperCards[0].daysOut).toBe(7);
    expect(taperCards[taperCards.length - 1].daysOut).toBe(0);
    expect(taperCards[taperCards.length - 1].phase).toBe('meet');
  });

  test('marks deadlift optional starting at 7 days out and skipped at 2 days out', () => {
    const plan = buildTaperPlan('2026-10-15', '2026-10-08'); // exactly 7 out
    const sevenOut = plan.find(d => d.daysOut === 7);
    expect(sevenOut.liftNotes.deadlift).toMatch(/optional/i);
    const twoOut = plan.find(d => d.daysOut === 2);
    expect(twoOut.lifts).not.toContain('deadlift');
  });

  test('returns a "meet complete" card when the reference date is after the meet', () => {
    const plan = buildTaperPlan('2026-10-15', '2026-10-17');
    expect(plan[plan.length - 1].phase).toBe('done');
  });

  test('returns an empty array for an invalid meet date', () => {
    expect(buildTaperPlan('', '2026-10-08')).toEqual([]);
    expect(buildTaperPlan('not-a-date', '2026-10-08')).toEqual([]);
  });
});

describe('planWeightCut', () => {
  test('flags cuts under 2.5% as minimal', () => {
    const plan = planWeightCut({ currentWeight: 82, targetWeight: 81, unit: 'kg' });
    expect(plan.method).toBe('minimal');
  });

  test('builds a 4-day dehydration schedule for cuts up to 5%', () => {
    const plan = planWeightCut({ currentWeight: 84, targetWeight: 80, unit: 'kg' }); // ~4.8%
    expect(plan.method).toBe('dehydration');
    expect(plan.schedule).toHaveLength(4);
    expect(plan.schedule[0].day).toBe(-4);
    expect(plan.schedule[3].label).toMatch(/weigh-in/i);
  });

  test('flags cuts over 5% as needing long-term fat loss', () => {
    const plan = planWeightCut({ currentWeight: 90, targetWeight: 80, unit: 'kg' }); // ~11%
    expect(plan.method).toBe('long-term');
  });

  test('handles lbs input by converting to kg internally', () => {
    const plan = planWeightCut({ currentWeight: 200, targetWeight: 197, unit: 'lbs' }); // 1.5%
    expect(plan.method).toBe('minimal');
  });

  test('returns null for invalid input', () => {
    expect(planWeightCut({ currentWeight: 'x', targetWeight: 80 })).toBeNull();
  });
});

describe('getCaffeineDose', () => {
  test('returns a 3-6 mg/kg range', () => {
    const dose = getCaffeineDose(80);
    expect(dose.minMg).toBe(240);
    expect(dose.maxMg).toBe(480);
  });

  test('returns null for invalid bodyweight', () => {
    expect(getCaffeineDose(0)).toBeNull();
  });
});
