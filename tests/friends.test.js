const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/friends.js'), 'utf8');

// Loads friends.js into a fresh page with a fake /api/friends backend.
function setup({ user = 'me_user', server = {}, stored = {} } = {}) {
  const dom = new JSDOM(
    '<!doctype html><body><span id="commFriendsBadge" style="display:none">0</span><div id="friendsPanel"></div></body>',
    { runScripts: 'outside-only', url: 'https://app.test/' },
  );
  const w = dom.window;
  w.localStorage.setItem('token', 'tok');
  w.localStorage.setItem('fitnessAppUser', user);
  Object.entries(stored).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
  w.SERVER_URL = 'https://api.test';
  w.__FRIENDS_NO_POLL = true;
  const toasts = [];
  w.nativeToast = (msg, type) => toasts.push({ msg, type });
  const state = { friends: [], incoming: [], outgoing: [], ...server };
  const calls = [];
  w.fetch = async (url, opts) => {
    const p = url.replace('https://api.test/api/friends', '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method: opts.method, path: p, body });
    const ok = data => ({ ok: true, status: 200, json: async () => ({ success: true, ...data }) });
    if (opts.method === 'GET') return ok(JSON.parse(JSON.stringify(state)));
    if (opts.method === 'POST' && p === '/requests') {
      if (body.username === 'ghost') {
        return { ok: false, status: 404, json: async () => ({ success: false, error: { code: 'friends.not_found', message: 'No user found with that username.' } }) };
      }
      state.outgoing.push({ username: body.username, sentAt: null });
      return ok({ status: 'pending', username: body.username });
    }
    const m = /^\/requests\/([^/]+)\/(accept|decline)$/.exec(p);
    if (m) {
      const who = decodeURIComponent(m[1]);
      state.incoming = state.incoming.filter(r => r.username !== who);
      state.outgoing = state.outgoing.filter(r => r.username !== who);
      if (m[2] === 'accept') state.friends.push({ username: who, since: '2026-09-01T00:00:00.000Z' });
      return ok({ status: m[2] === 'accept' ? 'accepted' : 'none', username: who });
    }
    return ok({});
  };
  w.eval(SRC);
  return { w, doc: w.document, calls, state, toasts };
}

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('friend requests', () => {
  test('adding someone sends a request instead of adding them as a friend', async () => {
    const { w, doc, calls, toasts } = setup();
    w.renderFriendsPanel();
    doc.getElementById('addFriendInput').value = 'bob';
    await w.addFriendFromInput();
    expect(calls.find(c => c.method === 'POST')).toEqual({ method: 'POST', path: '/requests', body: { username: 'bob' } });
    expect(w.getFriends()).toEqual([]);
    expect(toasts.pop().msg).toBe('Friend request sent to bob');
    expect(doc.getElementById('friendsPanel').textContent).toContain('waiting for them to accept');
  });

  test('unknown usernames show the server error', async () => {
    const { w, doc, toasts } = setup();
    w.renderFriendsPanel();
    doc.getElementById('addFriendInput').value = 'ghost';
    await w.addFriendFromInput();
    expect(toasts.pop()).toEqual({ msg: 'No user found with that username.', type: 'error' });
  });

  test('incoming requests notify once, show a badge and can be accepted', async () => {
    const { w, doc, toasts } = setup({ server: { incoming: [{ username: 'alice', sentAt: null }] } });
    await w.Friends.sync();
    expect(toasts).toEqual([{ msg: 'alice sent you a friend request', type: 'info' }]);
    const badge = doc.getElementById('commFriendsBadge');
    expect(badge.style.display).toBe('');
    expect(badge.textContent).toBe('1');

    await w.Friends.sync(); // already seen — no second toast
    expect(toasts.length).toBe(1);

    w.renderFriendsPanel();
    expect(doc.querySelector('.friend-accept-btn')).not.toBeNull();
    await w.acceptFriendRequestUI('alice');
    expect(w.getFriends().map(f => f.username)).toEqual(['alice']);
    expect(badge.style.display).toBe('none');
  });

  test('tells the sender when their request is accepted', async () => {
    const { w, state, toasts } = setup({ server: { outgoing: [{ username: 'bob', sentAt: null }] } });
    await w.Friends.sync();
    state.outgoing = [];
    state.friends = [{ username: 'bob', since: null }];
    await w.Friends.sync();
    expect(toasts.pop()).toEqual({ msg: 'bob accepted your friend request', type: 'success' });
  });

  test('one-sided friends from before requests get a request once', async () => {
    const { w, calls } = setup({ stored: { friends_me_user: [{ username: 'carl', addedAt: '2026-01-01' }] } });
    await w.Friends.sync();
    expect(calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', path: '/requests', body: { username: 'carl' } }]);
    expect(w.Friends.getRequests().outgoing.map(r => r.username)).toEqual(['carl']);
    await w.Friends.sync();
    expect(calls.filter(c => c.method === 'POST').length).toBe(1);
  });
});
