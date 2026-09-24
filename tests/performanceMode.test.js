const pm = require('../src/js/performance-mode');

describe('performance-mode rest timer state', () => {
  const NOW = 1_700_000_000_000;

  test('createRestState sets an end time totalSeconds from now', () => {
    const s = pm.createRestState(90, NOW);
    expect(s).toEqual({ endTimeMs: NOW + 90_000, totalSeconds: 90 });
    expect(pm.getRestRemaining(s, NOW + 30_000)).toBe(60);
  });

  test('createRestState falls back to the default for bad input', () => {
    expect(pm.createRestState(undefined, NOW).totalSeconds).toBe(pm.DEFAULT_REST_SECONDS);
  });

  test('getRestRemaining never goes below zero and handles missing state', () => {
    const s = pm.createRestState(60, NOW);
    expect(pm.getRestRemaining(s, NOW + 120_000)).toBe(0);
    expect(pm.getRestRemaining(null, NOW)).toBe(0);
  });

  test('pausing freezes the remaining time; resuming rebuilds the end time', () => {
    const running = pm.createRestState(90, NOW);
    const paused = pm.togglePausedState(running, NOW + 20_000);
    expect(paused.pausedRemaining).toBe(70);
    // Time passing while paused changes nothing
    expect(pm.getRestRemaining(paused, NOW + 500_000)).toBe(70);

    const resumed = pm.togglePausedState(paused, NOW + 500_000);
    expect(resumed.pausedRemaining).toBeUndefined();
    expect(resumed.endTimeMs).toBe(NOW + 500_000 + 70_000);
    expect(pm.getRestRemaining(resumed, NOW + 500_000)).toBe(70);
  });

  test('adjustRestState adds and removes seconds on a running timer', () => {
    const s = pm.createRestState(90, NOW);
    const more = pm.adjustRestState(s, 15, NOW + 10_000);
    expect(pm.getRestRemaining(more, NOW + 10_000)).toBe(95);
    expect(more.totalSeconds).toBe(95); // grows so the ring never overflows

    const less = pm.adjustRestState(s, -15, NOW + 10_000);
    expect(pm.getRestRemaining(less, NOW + 10_000)).toBe(65);
    expect(less.totalSeconds).toBe(90);
  });

  test('adjustRestState keeps at least one second and works while paused', () => {
    const s = pm.createRestState(20, NOW);
    expect(pm.getRestRemaining(pm.adjustRestState(s, -60, NOW), NOW)).toBe(1);

    const paused = pm.togglePausedState(s, NOW + 5_000); // 15 s left
    const adjusted = pm.adjustRestState(paused, 15, NOW + 99_000);
    expect(adjusted.pausedRemaining).toBe(30);
    expect(adjusted.totalSeconds).toBe(30);
  });

  test('isRestUrgent is true only for the last 10 seconds', () => {
    expect(pm.isRestUrgent(11)).toBe(false);
    expect(pm.isRestUrgent(10)).toBe(true);
    expect(pm.isRestUrgent(1)).toBe(true);
    expect(pm.isRestUrgent(0)).toBe(false);
  });
});

describe('performance-mode helpers', () => {
  test('formatNextUp reads the set number from the Log set button label', () => {
    expect(pm.formatNextUp('Bench Press', 'Log set 4')).toBe('Bench Press · Set 4');
    expect(pm.formatNextUp('  Squat ', 'Log 3 sets')).toBe('Squat');
    expect(pm.formatNextUp('', 'Log set 2')).toBe('Set 2');
    expect(pm.formatNextUp('', '')).toBe('');
  });

  test('normaliseRestSeconds only accepts the Rest-tab presets', () => {
    pm.REST_PRESETS.forEach((s) => expect(pm.normaliseRestSeconds(s)).toBe(s));
    expect(pm.normaliseRestSeconds('120')).toBe(120);
    expect(pm.normaliseRestSeconds(45)).toBe(pm.DEFAULT_REST_SECONDS);
    expect(pm.normaliseRestSeconds(null)).toBe(pm.DEFAULT_REST_SECONDS);
  });

  test('getSettings defaults when nothing is stored', () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
    expect(pm.getSettings()).toEqual({ active: false, restSeconds: 90 });
    store.tl_performance_mode_v1 = JSON.stringify({ active: true, restSeconds: 180 });
    expect(pm.getSettings()).toEqual({ active: true, restSeconds: 180 });
    store.tl_performance_mode_v1 = '{not json';
    expect(pm.getSettings()).toEqual({ active: false, restSeconds: 90 });
  });
});
