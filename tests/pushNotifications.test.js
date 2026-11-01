// Runs in Jest's node environment: the module uses globalThis as `window`.
const window = globalThis;
const memory = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: k => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: k => memory.delete(k),
    clear: () => memory.clear(),
  },
});

function fakePlugin({ permission = 'prompt', afterRequest = 'granted' }) {
  const listeners = {};
  const plugin = {
    state: permission,
    checkPermissions: jest.fn(async () => ({ receive: plugin.state })),
    requestPermissions: jest.fn(async () => { plugin.state = afterRequest; return { receive: afterRequest }; }),
    register: jest.fn(async () => { listeners.registration && listeners.registration({ value: 'ab'.repeat(32) }); }),
    addListener: jest.fn((name, fn) => { listeners[name] = fn; return { remove() {} }; }),
    fire: (name, arg) => listeners[name] && listeners[name](arg),
  };
  return plugin;
}

function load({ platform = 'ios', permission, afterRequest } = {}) {
  const plugin = fakePlugin({ permission, afterRequest });
  jest.resetModules();
  localStorage.clear();
  window.Capacitor = {
    getPlatform: () => platform,
    isPluginAvailable: name => name === 'PushNotifications',
    Plugins: { PushNotifications: plugin },
  };
  localStorage.setItem('fitnessAppUser', 'sam');
  localStorage.setItem('token', 'tok');
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
  return { push: require('../src/js/push-notifications.js'), plugin };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('pure helpers', () => {
  const { push } = load();

  test('matchItem picks the newest inbox item of the pushed type', () => {
    const items = [{ id: '3', type: 'coach_note' }, { id: '2', type: 'friend_request' }, { id: '1', type: 'friend_request' }];
    expect(push.matchItem(items, { type: 'friend_request' }).id).toBe('2');
    expect(push.matchItem(items, { type: 'group_post' })).toBeNull();
    expect(push.matchItem(items, {})).toBeNull();
    expect(push.matchItem(null, { type: 'x' })).toBeNull();
  });

  test('shouldAskOnLaunch: second signed-in launch, never asked, still undecided', () => {
    const base = { permission: 'prompt', asked: false, launches: 2, signedIn: true };
    expect(push.shouldAskOnLaunch(base)).toBe(true);
    expect(push.shouldAskOnLaunch({ ...base, launches: 1 })).toBe(false);
    expect(push.shouldAskOnLaunch({ ...base, asked: true })).toBe(false);
    expect(push.shouldAskOnLaunch({ ...base, signedIn: false })).toBe(false);
    expect(push.shouldAskOnLaunch({ ...base, permission: 'denied' })).toBe(false);
    expect(push.shouldAskOnLaunch({ ...base, permission: 'granted' })).toBe(false);
  });
});

describe('outside iOS', () => {
  test('does nothing on Android or the web', async () => {
    const { push, plugin } = load({ platform: 'android' });
    expect(push.isAvailable()).toBe(false);
    expect(await push.enable()).toBe('unavailable');
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    delete window.Capacitor;
    expect(push.isAvailable()).toBe(false);
  });
});

describe('on iOS', () => {
  test('enable asks once, registers and sends the token to the server', async () => {
    const { push, plugin } = load();
    expect(await push.enable()).toBe('granted');
    await flush();
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugin.register).toHaveBeenCalled();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/notifications\/push-token$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ token: 'ab'.repeat(32), platform: 'ios' });
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(localStorage.getItem('tl_push_token'))).toEqual({ token: 'ab'.repeat(32), user: 'sam' });
  });

  test('askOnce does not prompt a second time', async () => {
    const { push, plugin } = load({ afterRequest: 'denied' });
    expect(await push.askOnce()).toBe('denied');
    expect(await push.askOnce()).toBe('denied');
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugin.register).not.toHaveBeenCalled();
  });

  test('registerIfAllowed never prompts', async () => {
    const { push, plugin } = load({ permission: 'prompt' });
    expect(await push.registerIfAllowed()).toBe(false);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  test('start: registers silently when already allowed', async () => {
    const { push, plugin } = load({ permission: 'granted' });
    await push.start();
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.register).toHaveBeenCalled();
  });

  test('start: no prompt on the first launch', async () => {
    jest.useFakeTimers();
    const { push, plugin } = load();
    await push.start();
    jest.advanceTimersByTime(10000);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('unregister deletes the token on the server and forgets it', async () => {
    const { push } = load();
    await push.enable();
    await flush();
    fetch.mockClear();
    push.unregister();
    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('DELETE');
    expect(opts.keepalive).toBe(true);
    expect(JSON.parse(opts.body)).toEqual({ token: 'ab'.repeat(32) });
    expect(localStorage.getItem('tl_push_token')).toBeNull();
  });

  test('tapping a push opens the matching inbox item', async () => {
    const { push, plugin } = load({ permission: 'granted' });
    const item = { id: 'n1', type: 'coach_note' };
    window.Notifications = { refresh: jest.fn(async () => {}), getItems: () => [item], open: jest.fn(), openSheet: jest.fn() };
    await push.start();
    plugin.fire('pushNotificationActionPerformed', { notification: { data: { type: 'coach_note' } } });
    await flush();
    expect(window.Notifications.open).toHaveBeenCalledWith(item);

    plugin.fire('pushNotificationActionPerformed', { notification: { data: { type: 'unknown' } } });
    await flush();
    expect(window.Notifications.openSheet).toHaveBeenCalled();
  });

  test('a push while the app is open refreshes the bell', async () => {
    const { push, plugin } = load({ permission: 'granted' });
    window.Notifications = { refresh: jest.fn(async () => {}) };
    await push.start();
    plugin.fire('pushNotificationReceived', {});
    expect(window.Notifications.refresh).toHaveBeenCalled();
  });
});
