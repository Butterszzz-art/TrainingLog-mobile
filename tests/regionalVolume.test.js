const {
  MUSCLE_REGIONS,
  REGION_RULES,
  getExerciseRegions,
  countWorkingSets,
  computeRegionalVolume
} = require('../regionalVolume');

const ALL_REGION_IDS = new Set(MUSCLE_REGIONS.flatMap((m) => m.regions.map((r) => r.id)));

function topRegion(name) {
  const { regions } = getExerciseRegions(name);
  return Object.entries(regions).sort((a, b) => b[1] - a[1])[0]?.[0];
}

describe('region rules', () => {
  test('every rule only credits known regions with credits in (0, 1]', () => {
    REGION_RULES.forEach((rule) => {
      Object.entries(rule.regions).forEach(([id, credit]) => {
        expect(ALL_REGION_IDS.has(id)).toBe(true);
        expect(credit).toBeGreaterThan(0);
        expect(credit).toBeLessThanOrEqual(1);
      });
    });
  });

  test.each([
    ['Incline Dumbbell Press', 'chest_upper'],
    ['DB incline press', 'chest_upper'],
    ['Low-to-High Cable Fly', 'chest_upper'],
    ['Bench Press', 'chest_mid'],
    ['Dips', 'chest_lower'],
    ['Close-Grip Bench Press', 'triceps_lateral'],
    ['Lateral Raise', 'delt_side'],
    ['Reverse Pec Deck', 'delt_rear'],
    ['Face Pull', 'delt_rear'],
    ['OHP', 'delt_front'],
    ['Lat Pulldown', 'lats'],
    ['Chest Supported Row', 'upper_back'],
    ['Overhead Cable Triceps Extension', 'triceps_long'],
    ['Cable Triceps Pushdown', 'triceps_lateral'],
    ['Bayesian Curl', 'biceps_long'],
    ['Preacher Curl', 'biceps_short'],
    ['Hammer Curl', 'brachialis'],
    ['Leg Extension', 'rectus_femoris'],
    ['Hack Squat', 'vasti'],
    ['Nordic Curl', 'hams_semis'],
    ['Hip Thrust', 'glute_lower'],
    ['Hip Abduction', 'glute_upper'],
    ['Seated Calf Raise', 'soleus'],
    ['Leg Press Calf Raise', 'gastrocs'],
    ['Cable Crunch', 'abs_rectus']
  ])('%s leads with %s', (name, region) => {
    expect(topRegion(name)).toBe(region);
  });

  test('squats barely credit the rectus femoris; leg extensions fully do', () => {
    expect(getExerciseRegions('Back Squat').regions.rectus_femoris).toBeLessThan(0.5);
    expect(getExerciseRegions('Leg Extension').regions.rectus_femoris).toBe(1);
  });

  test('broad words do not misfire', () => {
    expect(getExerciseRegions('Seated Dumbbell Curl').ruleId).toBe('curl');
    expect(getExerciseRegions('Dumbbell Squat To A Bench').ruleId).toBe('squat');
    expect(getExerciseRegions('Incline Bench Row').ruleId).toBe('row');
    expect(getExerciseRegions('Glute Kickback').ruleId).toBe('glute_kickback');
    expect(getExerciseRegions('Sledgehammer Swings').ruleId).not.toBe('hammer_curl');
  });

  test('stretches count toward nothing', () => {
    expect(getExerciseRegions('Hamstring Stretch').regions).toEqual({});
  });

  test('falls back to the whole-muscle group, marked estimated', () => {
    const m = getExerciseRegions('Mystery Machine', 'chest');
    expect(m.source).toBe('muscle');
    expect(m.estimated).toBe(true);
    expect(m.regions.chest_mid).toBe(1);
  });
});

describe('countWorkingSets', () => {
  test('counts sets with reps and skips warm-ups', () => {
    expect(countWorkingSets({ repsArray: [10, 8, 0, 8], setTypeArray: ['warmup', null, null, 'top-set'] })).toBe(2);
  });

  test('falls back to a plain set count', () => {
    expect(countWorkingSets({ sets: 3 })).toBe(3);
  });
});

describe('computeRegionalVolume', () => {
  const workouts = [
    {
      date: '2026-10-19',
      log: [{ exercise: 'Bench Press', repsArray: [8, 8, 8] }]
    },
    {
      date: '2026-10-26',
      log: [
        { exercise: 'Bench Press', repsArray: [8, 8, 8, 8] },
        { exercise: 'Incline Dumbbell Press', repsArray: [10] },
        { exercise: 'Lateral Raise', repsArray: [15, 15, 15] },
        { exercise: 'Hamstring Stretch', sets: 2 },
        { exercise: 'Zorblax Thing', repsArray: [10] }
      ]
    },
    {
      date: '2026-10-28',
      log: [{ exercise: 'Overhead Press', repsArray: [6, 6] }]
    }
  ];

  const result = computeRegionalVolume(workouts);

  test('groups by ISO week, oldest first', () => {
    expect(result.weeks.map((w) => w.weekStart)).toEqual(['2026-10-19', '2026-10-26']);
    expect(result.weeks[0].regions.chest_mid).toBe(3);
  });

  test('credits regions fractionally', () => {
    const week = result.weeks[1];
    // 4 bench sets × 0.6 + 1 incline set × 1 + 2 OHP sets × 0.3
    expect(week.regions.chest_upper).toBeCloseTo(4);
    // 4 bench × 1 + 1 incline × 0.7
    expect(week.regions.chest_mid).toBeCloseTo(4.7);
  });

  test('a muscle counts its best-trained region per set, never more sets than done', () => {
    // 4 bench + 1 incline fully train a chest region; 2 OHP sets add 0.3 upper chest each
    expect(result.weeks[1].muscles.chest).toBe(5.6);
    // 3 lateral raises + 2 OHP (1 each) + 4 bench (0.5 front delt) + 1 incline (0.7)
    expect(result.weeks[1].muscles.delts).toBe(7.7);
  });

  test('latest week lists muscles with region breakdowns', () => {
    const chest = result.latest.muscles.find((m) => m.muscle === 'chest');
    expect(chest.sets).toBe(5.6);
    expect(chest.regions.map((r) => r.id)).toEqual(['chest_upper', 'chest_mid', 'chest_lower']);
  });

  test('flags lagging regions within a trained muscle', () => {
    const rear = result.gaps.find((g) => g.regionId === 'delt_rear');
    expect(rear).toBeTruthy();
    expect(rear.tip).toMatch(/reverse fl/i);
    // upper chest got 4 vs mid 4.7 — balanced enough, not a gap
    expect(result.gaps.find((g) => g.regionId === 'chest_upper')).toBeFalsy();
  });

  test('reports unknown exercises but not stretches', () => {
    expect(result.unmapped).toEqual(['Zorblax Thing']);
  });

  test('handles empty input', () => {
    expect(computeRegionalVolume([])).toEqual({ weeks: [], latest: null, gaps: [], exercises: [], unmapped: [] });
  });
});
