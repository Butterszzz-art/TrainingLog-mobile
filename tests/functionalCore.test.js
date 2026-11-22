const F = require('../src/js/functional-core');

describe('parseTime / fmtTime', () => {
  test('parses mm:ss, h:mm:ss and phone-pad digits', () => {
    expect(F.parseTime('4:12')).toBe(252);
    expect(F.parseTime('1:05:30')).toBe(3930);
    expect(F.parseTime('412')).toBe(252);
    expect(F.parseTime('1230')).toBe(750);
    expect(F.parseTime('45')).toBe(45);
    expect(F.parseTime('12500')).toBe(5100);
    expect(F.parseTime('1.5')).toBe(90);
    expect(F.parseTime('')).toBe(0);
    expect(F.parseTime('abc')).toBe(0);
  });
  test('formats with hours only when needed', () => {
    expect(F.fmtTime(252)).toBe('04:12');
    expect(F.fmtTime(3930)).toBe('1:05:30');
    expect(F.fmtTime(-5)).toBe('00:00');
    expect(F.fmtDelta(-10)).toBe('\u221210s');
    expect(F.fmtDelta(65)).toBe('+1:05');
    expect(F.fmtDelta(0)).toBe('=');
  });
});

describe('benchmarks and scores', () => {
  test('finds benchmarks by key or loose name', () => {
    expect(F.findBenchmark('fran').name).toBe('Fran');
    expect(F.findBenchmark('  FRAN ').key).toBe('fran');
    expect(F.findBenchmark('Clean & Jerk 1RM').key).toBe('cj1rm');
    expect(F.findBenchmark('My Monday WOD')).toBeNull();
  });

  test('infers score type for legacy entries', () => {
    expect(F.inferScoreType({ name: 'Fran', minutes: 4 })).toBe('time');
    expect(F.inferScoreType({ name: 'Cindy', rounds: 20 })).toBe('amrap');
    expect(F.inferScoreType({ name: 'Custom', minutes: 12 })).toBe('time');
    expect(F.inferScoreType({ name: 'Custom', rounds: 5 })).toBe('amrap');
    expect(F.inferScoreType({ name: 'Custom' })).toBe('none');
  });

  test('scoreValue ranks faster times, more rounds and heavier loads higher', () => {
    const fast = { name: 'Fran', minutes: 3, seconds: 59 };
    const slow = { name: 'Fran', minutes: 5, seconds: 0 };
    const capped = { name: 'Fran', minutes: 10, capped: true, scoreReps: 60 };
    expect(F.scoreValue(fast)).toBeGreaterThan(F.scoreValue(slow));
    expect(F.scoreValue(slow)).toBeGreaterThan(F.scoreValue(capped));
    expect(F.scoreValue({ name: 'Cindy', rounds: 20, scoreReps: 3 })).toBeGreaterThan(F.scoreValue({ name: 'Cindy', rounds: 19, scoreReps: 29 }));
    expect(F.scoreValue({ name: 'Snatch 1RM', scoreLoad: 80 })).toBe(80);
  });

  test('formatScore', () => {
    expect(F.formatScore({ name: 'Fran', minutes: 4, seconds: 12 })).toBe('04:12');
    expect(F.formatScore({ name: 'Cindy', rounds: 18, scoreReps: 7 })).toBe('18 + 7');
    expect(F.formatScore({ name: 'Cindy', rounds: 18 })).toBe('18 rds');
    expect(F.formatScore({ name: 'Snatch 1RM', scoreLoad: 80 }, 'kg')).toBe('80 kg');
    expect(F.formatScore({ name: 'Fran', minutes: 10, capped: true, scoreReps: 12 })).toBe('Capped +12');
    expect(F.formatScore({ name: 'Circuit', durationMin: 18, source: 'circuit' })).toBe('18 min');
  });
});

describe('PRs', () => {
  const log = [
    { id: 'a', date: '2026-09-01', name: 'Fran', minutes: 5, seconds: 0 },
    { id: 'b', date: '2026-09-15', name: 'Fran', minutes: 4, seconds: 30 },
    { id: 'c', date: '2026-10-01', name: 'Fran', minutes: 4, seconds: 50 },
    { id: 'd', date: '2026-10-05', name: 'Fran', minutes: 6, seconds: 0, rx: false },
  ];

  test('previousBest ignores the entry itself and the other Rx bucket', () => {
    expect(F.previousBest(log, log[2]).id).toBe('b');
    expect(F.previousBest(log, log[3])).toBeNull();
  });

  test('isPR only when beating an earlier attempt', () => {
    expect(F.isPR(log, log[0])).toBe(false); // first attempt: baseline, not PR
    expect(F.isPR(log, log[1])).toBe(true);
    expect(F.isPR(log, log[2])).toBe(false);
  });

  test('workoutBoard groups attempts and finds the best', () => {
    const board = F.workoutBoard([...log, { date: '2026-10-02', name: 'Leg Day Chipper', minutes: 20 }, { date: '2026-10-03', name: 'Blitz', source: 'circuit', durationMin: 12 }]);
    const fran = board.find(r => r.key === 'fran');
    expect(fran.count).toBe(4);
    expect(fran.best.id).toBe('b');
    expect(fran.last.id).toBe('d');
    expect(board.find(r => r.key === 'custom:legdaychipper').count).toBe(1);
    expect(board.some(r => r.name === 'Blitz')).toBe(false); // circuits stay off the PR board
  });
});

describe('weekStats', () => {
  test('counts this week, PRs in 30 days, and the weekly streak', () => {
    const wods = [
      { date: '2026-11-03', name: 'Fran', minutes: 5 },
      { date: '2026-11-10', name: 'Fran', minutes: 4, seconds: 40 },
      { date: '2026-11-17', name: 'Cindy', rounds: 18, durationMin: 20 },
      { date: '2026-11-18', name: 'Blitz', source: 'circuit', durationMin: 15 },
    ];
    const sims = [{ date: '2026-11-19', total: 5400, stations: {} }];
    const s = F.weekStats(wods, sims, '2026-11-20');
    expect(s.sessions).toBe(3);
    expect(s.wods).toBe(1);
    expect(s.circuits).toBe(1);
    expect(s.hyrox).toBe(1);
    expect(s.minutes).toBe(20 + 15 + 90);
    expect(s.prs30).toBe(1);
    expect(s.streakWeeks).toBe(3);
  });

  test('streak counts back from last week when this week is still empty', () => {
    const s = F.weekStats([{ date: '2026-11-12', name: 'x', minutes: 10 }], [], '2026-11-17');
    expect(s.sessions).toBe(0);
    expect(s.streakWeeks).toBe(1);
  });
});

describe('HYROX', () => {
  const full = (scale, extra) => {
    const st = {};
    F.HYROX_STATIONS.forEach(s => { st[s.field] = Math.round(F.HYROX_REFERENCE[s.field] * scale); });
    return { date: '2026-10-01', ts: scale * 1000, stations: { ...st, ...extra }, total: F.simTotal({ ...st, ...extra }) };
  };

  test('hyroxBests takes the fastest split per station and best full total', () => {
    const a = full(1);
    const b = full(0.95);
    const partial = { date: '2026-10-05', ts: 5, stations: { skierg: 200 }, total: 200 };
    const { splits, bestTotal } = F.hyroxBests([a, b, partial]);
    expect(splits.skierg).toBe(200);
    expect(splits.run1).toBe(b.stations.run1);
    expect(bestTotal.sim).toBe(b); // the partial never counts as a best finish
  });

  test('pacePlan sums exactly to the goal and uses the athlete\'s own shape', () => {
    const ref = F.pacePlan(5400, []);
    const fields = [...F.HYROX_STATIONS.map(s => s.field), 'roxzone'];
    expect(fields.reduce((s, f) => s + ref.splits[f], 0)).toBe(5400);
    expect(ref.source).toBe('reference');

    const mine = F.pacePlan(5000, [full(1, { roxzone: 400 })]);
    expect(mine.source).toBe('yours');
    expect(fields.reduce((s, f) => s + mine.splits[f], 0)).toBe(5000);
    expect(mine.avgRun).toBeGreaterThan(0);
    expect(F.pacePlan(0, [])).toBeNull();
  });

  test('race countdown phases', () => {
    expect(F.daysUntil('2026-12-01', '2026-11-22')).toBe(9);
    expect(F.racePhase(80).key).toBe('base');
    expect(F.racePhase(40).key).toBe('specific');
    expect(F.racePhase(14).key).toBe('peak');
    expect(F.racePhase(3).key).toBe('taper');
    expect(F.racePhase(-1).key).toBe('done');
  });
});

describe('timerState', () => {
  test('AMRAP counts down and finishes', () => {
    expect(F.timerState('amrap', { duration: 600 }, 0).clock).toBe(600);
    expect(F.timerState('amrap', { duration: 600 }, 598).beep).toBe('tick');
    const end = F.timerState('amrap', { duration: 600 }, 600);
    expect(end.done).toBe(true);
    expect(end.clock).toBe(0);
  });

  test('For Time counts up at real speed and stops at the cap', () => {
    expect(F.timerState('fortime', {}, 90).clock).toBe(90);
    expect(F.timerState('fortime', { cap: 600 }, 599).done).toBe(false);
    expect(F.timerState('fortime', { cap: 600 }, 600).done).toBe(true);
  });

  test('EMOM rounds and interval', () => {
    const s = F.timerState('emom', { rounds: 10, interval: 60 }, 65);
    expect(s.round).toBe(2);
    expect(s.clock).toBe(55);
    expect(F.timerState('emom', { rounds: 10, interval: 60 }, 120).beep).toBe('start');
    expect(F.timerState('emom', { rounds: 10, interval: 60 }, 600).done).toBe(true);
  });

  test('Tabata alternates work and rest', () => {
    const cfg = { rounds: 8, work: 20, rest: 10 };
    expect(F.timerState('tabata', cfg, 5).phase).toMatch(/^Work · 1/);
    expect(F.timerState('tabata', cfg, 25).phase).toMatch(/^Rest · 1/);
    expect(F.timerState('tabata', cfg, 30).phase).toMatch(/^Work · 2/);
    expect(F.timerState('tabata', cfg, 240).done).toBe(true);
  });
});

describe('circuits', () => {
  const c = { rounds: 2, work: 40, rest: 20, exercises: ['Burpee', 'Row'] };
  test('steps skip the final rest', () => {
    const steps = F.circuitSteps(c);
    expect(steps.length).toBe(7);
    expect(steps[steps.length - 1].phase).toBe('work');
    expect(F.circuitTotalSeconds(c)).toBe(4 * 40 + 3 * 20);
  });
  test('circuitAt finds the current step', () => {
    const steps = F.circuitSteps(c);
    expect(F.circuitAt(steps, 0).step.exercise).toBe('Burpee');
    expect(F.circuitAt(steps, 45).step.phase).toBe('rest');
    expect(F.circuitAt(steps, 61).step.exercise).toBe('Row');
    expect(F.circuitAt(steps, 999).done).toBe(true);
  });
});

describe('migrateTemplates', () => {
  test('moves legacy templates in once, skipping names already present', () => {
    const legacy = [
      { name: 'Chipper', workout: [{ exercise: 'Burpee', sets: 1, reps: 50, weight: 0 }] },
      { name: 'Existing', workout: [] },
    ];
    const out = F.migrateTemplates(legacy, [{ id: 't1', name: 'existing', exercises: [] }]);
    expect(out.length).toBe(2);
    const chip = out.find(t => t.name === 'Chipper');
    expect(chip.id).toBeTruthy();
    expect(chip.exercises[0]).toEqual({ exerciseName: 'Burpee', sets: 1, reps: 50, weight: 0 });
  });
});
