const CoachData = require('../src/js/coach-data');

function memoryStore(seed = {}) {
  const data = { ...seed };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

const NOW = new Date('2026-09-23T08:00:00Z');
const u = 'sam';

function seeded() {
  return memoryStore({
    [`settings_${u}`]: JSON.stringify({ unit: 'kg', profile: { athleteName: 'Sam', archetype: 'powerlifter' } }),
    [`workoutHistory_${u}`]: JSON.stringify([
      { id: 'a', date: '2026-09-09', title: 'Legs A', log: [{ exercise: 'Back Squat', repsArray: [5, 5], weightsArray: [120, 105], rpeArray: [9, null] }] },
      { id: 'old', date: '2026-06-01', title: 'Old', log: [] },
    ]),
    [`workouts_${u}`]: JSON.stringify([
      { id: 'a', date: '2026-09-09', title: 'Legs A', log: [] }, // duplicate id — archived copy wins
      { id: 'b', date: '2026-09-20T10:00:00Z', title: 'Push B', log: [{ exercise: 'Bench Press', repsArray: [5], weightsArray: [85] }] },
    ]),
    [`bodyweightLog_${u}`]: JSON.stringify([{ date: '2026-09-20', weight: 180, unit: 'lbs', weightKg: 81.6 }]),
    [`sleepLog_${u}`]: JSON.stringify([{ date: '2026-09-22', duration: 6.1, quality: 3, tags: ['caffeine'] }]),
    [`macroTargets_${u}`]: JSON.stringify({ calories: 2400, protein: 180, fat: 75, carbs: 250 }),
    [`activeProgram_${u}`]: JSON.stringify({ programId: 'p1', programName: 'PPL', startDate: '2026-09-01' }),
    [`programs_${u}`]: JSON.stringify([{
      id: 'p1', name: 'PPL',
      days: [{ name: 'Legs A', exercises: [{ name: 'Back Squat', sets: [{ reps: 5, weight: 120, restSec: 180 }] }, { name: 'Walking Lunge', sets: [] }] }],
      weeks: [{ week: 1, days: [{ name: 'Legs A', exercises: [{ name: 'Back Squat', sets: [] }] }] }, { week: 2, sameAs: 1 }],
    }]),
  });
}

describe('buildCoachDataPack', () => {
  test('merges and trims workouts, converts bodyweight to kg', () => {
    const pack = CoachData.buildCoachDataPack(seeded(), u, undefined, NOW);
    expect(pack.workouts.map(w => w.title)).toEqual(['Legs A', 'Push B']);
    expect(pack.workouts[0].exercises[0].sets).toEqual([{ w: 120, r: 5, rpe: 9 }, { w: 105, r: 5 }]);
    expect(pack.workouts[1].date).toBe('2026-09-20');
    expect(pack.bodyweight).toEqual([{ date: '2026-09-20', kg: 81.6 }]);
    expect(pack.macros.targets).toEqual({ calories: 2400, protein: 180, carbs: 250, fat: 75 });
    expect(pack.program.days[0].exercises[0]).toEqual({ name: 'Back Squat', sets: [{ reps: 5, weight: 120 }] });
    expect(pack.profile).toMatchObject({ name: 'Sam', archetype: 'powerlifter', unit: 'kg' });
  });

  test('switched-off sections are omitted entirely', () => {
    const pack = CoachData.buildCoachDataPack(seeded(), u, { recovery: false, nutrition: false }, NOW);
    expect(pack).not.toHaveProperty('sleep');
    expect(pack).not.toHaveProperty('macros');
    expect(pack).toHaveProperty('workouts');
  });
});

describe('memory and settings', () => {
  test('memory dedupes case-insensitively and can be removed', () => {
    const s = memoryStore();
    CoachData.addMemory(s, u, 'Hates lunges', 'chat', NOW);
    const list = CoachData.addMemory(s, u, 'hates LUNGES', 'chat', NOW);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ text: 'Hates lunges', source: 'chat', date: '2026-09-23' });
    expect(CoachData.removeMemory(s, u, list[0].id)).toEqual([]);
  });

  test('settings fall back to defaults for bad values', () => {
    const s = memoryStore({ [`coachSettings_${u}`]: JSON.stringify({ style: 'shouty', access: { body: false, sleep: 'yes' } }) });
    expect(CoachData.loadCoachSettings(s, u)).toEqual({
      style: 'direct',
      access: { workouts: true, body: false, recovery: true, nutrition: true },
    });
  });
});

describe('applying proposals', () => {
  test('program change edits the day in days and in weeks with their own copy', () => {
    const s = seeded();
    const res = CoachData.applyProgramChange(s, u, {
      programId: 'p1', day: 'legs a',
      changes: [
        { op: 'set_sets', exercise: 'Back Squat', sets: [{ reps: 3, weight: 125 }, { reps: 5, weight: 110 }] },
        { op: 'replace_exercise', exercise: 'Walking Lunge', newExercise: 'Bulgarian Split Squat' },
        { op: 'add_exercise', exercise: 'Leg Curl', sets: [{ reps: 10, repsMax: 12 }] },
      ],
    });
    expect(res).toEqual({ ok: true });
    const program = JSON.parse(s.data[`programs_${u}`])[0];
    const squat = program.days[0].exercises[0];
    expect(squat.sets.map(x => [x.reps, x.weight])).toEqual([[3, 125], [5, 110]]);
    expect(squat.sets[0].restSec).toBe(180); // kept from the old first set
    expect(program.days[0].exercises.map(e => e.name)).toEqual(['Back Squat', 'Bulgarian Split Squat', 'Leg Curl']);
    expect(program.weeks[0].days[0].exercises[0].sets).toHaveLength(2);
    expect(program.weeks[1]).toEqual({ week: 2, sameAs: 1 });
  });

  test('program change on a missing day fails without writing', () => {
    const s = seeded();
    const before = s.data[`programs_${u}`];
    const res = CoachData.applyProgramChange(s, u, { programId: 'p1', day: 'Arms', changes: [] });
    expect(res.ok).toBe(false);
    expect(s.data[`programs_${u}`]).toBe(before);
  });

  test('macro targets are written in the app\'s own shape', () => {
    const s = memoryStore();
    CoachData.applyMacroTargets(s, u, { to: { calories: 2500, protein: 180, carbs: 275, fat: 75 } });
    expect(JSON.parse(s.data[`macroTargets_${u}`])).toEqual({ calories: 2500, protein: 180, carbs: 275, fat: 75 });
  });

  test('describeSets merges identical sets', () => {
    expect(CoachData.describeSets([{ reps: 3, weight: 125 }, { reps: 5, weight: 110 }, { reps: 5, weight: 110 }]))
      .toBe('1×3 @ 125 kg + 2×5 @ 110 kg');
    expect(CoachData.describeSets([{ reps: 8, repsMax: 10 }])).toBe('1×8-10');
  });
});

describe('buildBriefDigest', () => {
  const now = '2026-09-23T07:00:00.000Z';
  const squat = (date, w) => ({ date, title: 'Legs A', exercises: [{ name: 'Back Squat', sets: [{ w, r: 5 }] }] });

  test('flags a flat lift, scores short sleep down, and names the session', () => {
    const pack = {
      generatedAt: now,
      profile: { unit: 'kg', phase: 'Cut' },
      workouts: [squat('2026-08-19', 115), squat('2026-08-26', 120), squat('2026-09-02', 120), squat('2026-09-09', 120), squat('2026-09-16', 120), squat('2026-09-21', 120)],
      sleep: [
        { date: '2026-09-15', hours: 7.5 }, { date: '2026-09-17', hours: 7.4 }, { date: '2026-09-19', hours: 7.3 },
        { date: '2026-09-22', hours: 5.8 },
      ],
      bodyweight: [
        { date: '2026-09-01', kg: 82 }, { date: '2026-09-06', kg: 81.8 }, { date: '2026-09-12', kg: 81.2 }, { date: '2026-09-20', kg: 80.9 },
      ],
    };
    const d = CoachData.buildBriefDigest(pack, { session: 'Push B' });
    expect(d.flag).toMatchObject({ text: 'Back Squat stuck at 120 kg for 3 weeks', question: 'Why has my back squat stalled?' });
    expect(d.readiness.score).toBeLessThan(70);
    expect(d.bullets[0]).toMatchObject({ tone: 'watch' });
    expect(d.bullets[0].text).toMatch(/^Sleep 5.8 h, under your 7.4 h average/);
    expect(d.signals.find(s => s.text.startsWith('Weight trend'))).toMatchObject({ tone: 'good' });
    expect(d.headline).toMatch('Push B');
    expect(d.hasData).toBe(true);
  });

  test('a lift that is still climbing is not a stall', () => {
    const pack = { generatedAt: now, workouts: [squat('2026-09-02', 110), squat('2026-09-09', 115), squat('2026-09-16', 120)] };
    expect(CoachData.buildBriefDigest(pack, {}).flag).toBeNull();
  });

  test('no data → no readiness, a prompt to log, rest day wording', () => {
    const d = CoachData.buildBriefDigest({ generatedAt: now }, {});
    expect(d.readiness).toBeNull();
    expect(d.hasData).toBe(false);
    expect(d.headline).toMatch(/Log a session/);
    expect(CoachData.buildBriefDigest({ generatedAt: now }, { restDay: true }).headline).toMatch(/^Rest day/);
  });
});

test('last night\'s sleep counts all day, whatever the hour', () => {
  const sleep = [{ date: '2026-09-18', hours: 7.5 }, { date: '2026-09-19', hours: 7.5 }, { date: '2026-09-20', hours: 7.5 }, { date: '2026-09-22', hours: 5.9 }];
  // Late evening local time on the 23rd — well over 36h after 22 Sep 00:00 UTC.
  const lateEvening = new Date(2026, 8, 23, 23, 30).toISOString();
  const d = CoachData.buildBriefDigest({ generatedAt: lateEvening, sleep }, {});
  expect(d.signals[0].text).toMatch(/^Sleep 5.9 h/);
});

describe('buildWeeklyReviewFacts', () => {
  const { buildWeeklyRecap } = require('../src/js/weekly-recap');
  const lift = (date, kg, reps = 5) => ({ date, title: 'Legs A', log: [{ exercise: 'Back Squat', repsArray: [reps], weightsArray: [kg] }] });
  // Week under review: Mon 14 Sep – Sun 20 Sep 2026.
  const raw = {
    workouts: [lift('2026-08-24', 120), lift('2026-08-31', 120), lift('2026-09-07', 120), lift('2026-09-10', 120),
      lift('2026-09-14', 120), lift('2026-09-17', 125)],
    bodyweightLog: [{ date: '2026-09-12', weightKg: 81.5 }, { date: '2026-09-16', weightKg: 81.2 }, { date: '2026-09-20', weightKg: 80.9 }],
    macroHistory: ['14', '15', '16', '17', '18'].map(d => ({ date: `2026-09-${d}`, totals: { calories: 2400, protein: 150 } })),
    macroTargets: { calories: 2400, protein: 180 },
  };
  const recap = buildWeeklyRecap(raw, { weekStart: '2026-09-14', today: '2026-09-23', getMuscleGroup: () => 'quads', defaultMuscleTargets: { quads: 10, back: 10 } });
  const pack = {
    generatedAt: '2026-09-23T07:00:00.000Z',
    profile: { phase: 'Cut' },
    workouts: raw.workouts.map(w => ({ date: w.date, title: w.title, exercises: [{ name: 'Back Squat', sets: [{ w: w.log[0].weightsArray[0], r: w.log[0].repsArray[0] }] }] })),
    checkIns: [{ date: '2026-09-19', hunger: 8, energy: 6 }],
    macros: { targets: { calories: 2400, protein: 180, carbs: 250, fat: 75 } },
    program: { id: 'p1', name: 'PPL', days: [{ name: 'Legs A', exercises: [{ name: 'Back Squat', sets: [{ reps: 5, weight: 120 }] }] }] },
  };

  test('wins and watch come from the recap numbers and the pack', () => {
    const { rules, facts, hasData } = CoachData.buildWeeklyReviewFacts(recap, pack);
    expect(hasData).toBe(true);
    expect(rules.wins).toEqual(expect.arrayContaining([
      'New best on Back Squat: 125 kg × 5',
      'Weight -0.6 kg this week, on pace for your cut',
      'Calories on target 5 of 5 logged days',
    ]));
    expect(rules.watch).toEqual(expect.arrayContaining([
      'No sets for chest, back, shoulders and more',
      'Protein averaged 150 g against a 180 g target',
      'Hunger 8/10 at check-in',
    ]));
    expect(rules.summary).toMatch(/^2 sessions and 2 sets this week\. Worth a look: /);
    expect(facts.program.days[0].exercises).toEqual(['Back Squat: 1×5 @ 120 kg']);
    expect(facts.macroTargets.protein).toBe(180);
    expect(facts.week).toEqual({ start: '2026-09-14', end: '2026-09-20', inProgress: false });
  });
});
