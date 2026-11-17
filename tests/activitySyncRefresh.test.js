// When the Activity Sync bridge (src/js/activity-sync-bridge.js) refetches:
// on returning to the app, on a timer while Home/Macros is open, and with
// shorter throttles when Apple Health answers on the phone.
// Runs in Jest's node environment with a tiny fake `document`.

function makeEnv({ appleHealth = false } = {}) {
  jest.resetModules();
  const listeners = {};
  const store = new Map();
  const calls = [];
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: () => true,
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  const emit = (type, detail) => (listeners[type] || []).forEach(fn => fn({ detail }));
  const ok = (body) => ({ ok: true, status: 200, json: async () => ({ success: true, ...body }) });

  Object.assign(globalThis, {
    document,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    getAuthHeaders: () => ({ Authorization: 'Bearer t' }),
    ensureServerUrl: () => 'https://api.test',
    fetchWithTimeout: jest.fn(async (url) => {
      calls.push(url);
      return ok({ activity: { steps: 1000 }, exercises: [], days: [], weighIns: [] });
    }),
    AppleHealth: appleHealth
      ? { isConnected: () => true, handles: () => false }
      : undefined,
  });
  require('../src/js/activity-sync-bridge.js');
  const activityCalls = () => calls.filter(u => u.includes('/activity?')).length;
  const historyCalls = () => calls.filter(u => u.includes('/daily?')).length;
  return { emit, document, bridge: globalThis.activitySyncBridge, activityCalls, historyCalls };
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('activity sync refresh timing', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('returning to the app refetches today\'s activity, not just sleep', async () => {
    const env = makeEnv();
    await env.bridge.fetchAndApplyTodayActivity();
    expect(env.activityCalls()).toBe(1);

    jest.setSystemTime(Date.now() + 61 * 1000);
    env.document.visibilityState = 'hidden';
    env.emit('visibilitychange');
    env.document.visibilityState = 'visible';
    env.emit('visibilitychange');
    await flush();
    expect(env.activityCalls()).toBe(2);
  });

  test('Home keeps refreshing every minute while visible, and stops when hidden', async () => {
    const env = makeEnv();
    await env.bridge.fetchAndApplyTodayActivity(); // connects + starts the timer
    expect(env.activityCalls()).toBe(1);

    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(env.activityCalls()).toBe(2);

    env.document.visibilityState = 'hidden';
    env.emit('visibilitychange');
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(env.activityCalls()).toBe(2);
  });

  test('no timer on tabs that do not show steps', async () => {
    const env = makeEnv();
    await env.bridge.fetchAndApplyTodayActivity();
    env.emit('traininglog:tab-changed', { tab: 'logTab' });
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(env.activityCalls()).toBe(1);
  });

  test('Google Health keeps a 1-minute today throttle and 30-minute history throttle', async () => {
    const env = makeEnv();
    await env.bridge.fetchAndApplyTodayActivity();
    await env.bridge.fetchAndApplyHistory();
    jest.setSystemTime(Date.now() + 30 * 1000);
    await env.bridge.fetchAndApplyTodayActivity();
    jest.setSystemTime(Date.now() + 5 * 60 * 1000);
    await env.bridge.fetchAndApplyHistory();
    expect(env.activityCalls()).toBe(1);
    expect(env.historyCalls()).toBe(1);
  });

  test('Apple Health (read on the phone) refreshes after 15s / 1 min', async () => {
    const env = makeEnv({ appleHealth: true });
    await env.bridge.fetchAndApplyTodayActivity();
    await env.bridge.fetchAndApplyHistory();
    jest.setSystemTime(Date.now() + 16 * 1000);
    await env.bridge.fetchAndApplyTodayActivity();
    jest.setSystemTime(Date.now() + 61 * 1000);
    await env.bridge.fetchAndApplyHistory();
    expect(env.activityCalls()).toBe(2);
    expect(env.historyCalls()).toBe(2);
  });
});
