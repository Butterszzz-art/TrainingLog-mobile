const {
  POSE_GUIDES,
  normalizeCaptureSettings,
  buildCaptureSchedule,
  createScheduleRunner,
  localDateKey
} = require('../posingCapture');

describe('posingCapture settings', () => {
  test('clamps out-of-range values and falls back to defaults', () => {
    const s = normalizeCaptureSettings({ shots: 99, interval: 1, startDelay: 7, cues: 'loud', facing: 'side' });
    expect(s).toMatchObject({ guide: 'free', shots: 30, interval: 3, startDelay: 10, cues: 'voice', facing: 'user' });
    expect(normalizeCaptureSettings({}).shots).toBe(10);
  });

  test('a pose guide fixes the shot count but remembers the free count', () => {
    const s = normalizeCaptureSettings({ guide: 'mandatories', shots: 20 });
    expect(s.shots).toBe(POSE_GUIDES.mandatories.poses.length);
    expect(s.freeShots).toBe(20);
    expect(normalizeCaptureSettings({ ...s, guide: 'free', shots: s.freeShots }).shots).toBe(20);
  });
});

describe('buildCaptureSchedule', () => {
  test('shots land after the start delay, one interval apart, with a 3-2-1 before each', () => {
    const steps = buildCaptureSchedule({ shots: 3, interval: 5, startDelay: 10 });
    const shots = steps.filter(s => s.type === 'shot');
    expect(shots.map(s => s.at)).toEqual([10000, 15000, 20000]);
    for (const shot of shots) {
      const ticks = steps.filter(s => s.type === 'tick' && s.index === shot.index);
      expect(ticks.map(t => [t.count, t.at])).toEqual([[3, shot.at - 3000], [2, shot.at - 2000], [1, shot.at - 1000]]);
    }
    expect(steps[0]).toMatchObject({ type: 'announce', at: 0, text: 'Get in position' });
    expect(steps[steps.length - 1]).toEqual({ type: 'done', at: 20600 });
  });

  test('steps are in time order', () => {
    const steps = buildCaptureSchedule({ guide: 'quarter', interval: 4, startDelay: 3 });
    const times = steps.map(s => s.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('a pose guide announces each pose and skips ticks that would talk over it', () => {
    const steps = buildCaptureSchedule({ guide: 'quarter', interval: 3, startDelay: 3 });
    const announces = steps.filter(s => s.type === 'announce');
    expect(announces.map(a => a.text)).toEqual([
      'First pose: Front relaxed',
      'Next: Left side',
      'Next: Back relaxed',
      'Next: Right side'
    ]);
    // Second shot at 6000; its announcement is at 3700 and holds the floor until
    // 5200, so every tick (3000, 4000, 5000) is dropped. A 5s interval keeps "2, 1".
    const ticks = steps.filter(s => s.type === 'tick' && s.index === 1);
    expect(ticks).toEqual([]);
    const roomy = buildCaptureSchedule({ guide: "quarter", interval: 5, startDelay: 3 });
    expect(roomy.filter(s => s.type === "tick" && s.index === 1).map(t => t.count)).toEqual([2, 1]);
    expect(steps.filter(s => s.type === 'shot').map(s => s.pose)).toEqual(POSE_GUIDES.quarter.poses);
  });
});

describe('createScheduleRunner', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('fires each step once, in order, then stops after done', () => {
    let clock = 0;
    const fired = [];
    const runner = createScheduleRunner(buildCaptureSchedule({ shots: 2, interval: 3, startDelay: 3 }), {
      now: () => clock,
      onStep: step => fired.push(step.type)
    });
    runner.start();
    for (let i = 0; i < 200; i += 1) {
      clock += 50;
      jest.advanceTimersByTime(50);
    }
    // 3s gaps leave no room for a full 3-2-1: the first shot keeps "1" after the
    // spoken intro, the second keeps "2, 1".
    expect(fired).toEqual(['announce', 'tick', 'shot', 'tick', 'tick', 'shot', 'done']);
    expect(runner.isRunning()).toBe(false);
  });

  test('stop() halts further steps and reports the next shot while running', () => {
    let clock = 0;
    const fired = [];
    const frames = [];
    const runner = createScheduleRunner(buildCaptureSchedule({ shots: 5, interval: 5, startDelay: 5 }), {
      now: () => clock,
      onStep: step => fired.push(step),
      onFrame: frame => frames.push(frame)
    });
    runner.start();
    clock = 5000;
    jest.advanceTimersByTime(50);
    runner.stop();
    clock = 60000;
    jest.advanceTimersByTime(5000);
    expect(fired.filter(s => s.type === 'shot')).toHaveLength(1);
    expect(frames[0].nextShot).toMatchObject({ index: 0, at: 5000 });
    expect(frames[frames.length - 1].nextShot).toMatchObject({ index: 1, at: 10000 });
  });
});

test('localDateKey uses the local calendar day', () => {
  expect(localDateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
});
