// API calls get a fresh Firebase token (src/js/firebase-auth.js): the stored
// token goes stale while iOS has the app suspended, so the fetch wrapper swaps
// in a current one and retries once on 401. Runs in Jest's node environment.
const API = 'https://api.example.test/api';
const memory = new Map();

function setup({ tokens = ['fresh-1', 'fresh-2'], responses = [200] } = {}) {
  jest.resetModules();
  memory.clear();
  memory.set('token', 'stale');
  memory.set('authToken', 'stale');

  const queue = [...tokens];
  const user = { getIdToken: jest.fn(async force => (force ? queue.pop() : queue[0])) };
  const auth = {
    currentUser: user,
    onIdTokenChanged: jest.fn(),
    onAuthStateChanged: jest.fn(cb => { cb(user); return () => {}; }),
  };
  const statuses = [...responses];
  const nativeFetch = jest.fn(async () => ({ status: statuses.length > 1 ? statuses.shift() : statuses[0] }));

  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: k => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: k => memory.delete(k),
  };
  globalThis.SERVER_URL = API;
  globalThis.FIREBASE_ENABLED = true;
  globalThis.firebase = { auth: () => auth };
  globalThis.fetch = nativeFetch;
  require('../src/js/firebase-auth.js');
  return { nativeFetch, user };
}

afterEach(() => {
  ['window', 'localStorage', 'SERVER_URL', 'FIREBASE_ENABLED', 'firebase', 'fetch', 'firebaseAuth']
    .forEach(k => { delete globalThis[k]; });
});

const sentAuth = call => call[1].headers.Authorization;

test('swaps the stale stored token for a fresh one on API calls', async () => {
  const { nativeFetch } = setup();
  await fetch(`${API}/templates`, {
    method: 'POST',
    headers: { Authorization: 'Bearer stale', 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(nativeFetch).toHaveBeenCalledTimes(1);
  expect(sentAuth(nativeFetch.mock.calls[0])).toBe('Bearer fresh-1');
  expect(nativeFetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  expect(memory.get('token')).toBe('fresh-1');
});

test('retries once with a force-refreshed token after a 401', async () => {
  const { nativeFetch, user } = setup({ responses: [401, 201] });
  const res = await fetch(`${API}/dailylogs`, { method: 'POST', headers: { Authorization: 'Bearer stale' }, body: '{}' });
  expect(res.status).toBe(201);
  expect(nativeFetch).toHaveBeenCalledTimes(2);
  expect(user.getIdToken).toHaveBeenLastCalledWith(true);
  expect(sentAuth(nativeFetch.mock.calls[1])).toBe('Bearer fresh-2');
});

test('does not loop when the server keeps answering 401', async () => {
  const { nativeFetch } = setup({ responses: [401] });
  const res = await fetch(`${API}/workouts`, { headers: { Authorization: 'Bearer stale' } });
  expect(res.status).toBe(401);
  expect(nativeFetch).toHaveBeenCalledTimes(2);
});

test('leaves other hosts, unauthenticated calls and foreign tokens alone', async () => {
  const { nativeFetch, user } = setup();
  await fetch('https://elsewhere.test/x', { headers: { Authorization: 'Bearer stale' } });
  await fetch(`${API}/config`);
  await fetch(`${API}/x`, { headers: { Authorization: 'Bearer someone-elses' } });
  expect(user.getIdToken).not.toHaveBeenCalled();
  expect(sentAuth(nativeFetch.mock.calls[0])).toBe('Bearer stale');
  expect(nativeFetch.mock.calls[1][1]).toBeUndefined();
  expect(sentAuth(nativeFetch.mock.calls[2])).toBe('Bearer someone-elses');
});

test('handles Headers objects', async () => {
  const { nativeFetch } = setup();
  await fetch(`${API}/workouts`, { headers: new Headers({ Authorization: 'Bearer stale' }) });
  expect(nativeFetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer fresh-1');
});
