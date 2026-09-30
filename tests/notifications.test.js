const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/notifications.js'), 'utf8');

const n = (id, extra = {}) => ({
  id, type: 'share_received', category: 'shares', actor: 'Alice', text: 'sent you a template: Push Day',
  data: {}, count: 1, read: false, createdAt: '2026-09-30T10:00:00Z', ...extra,
});

// Loads notifications.js into a fresh page with a fake /api/notifications.
function setup({ items = [], stored = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <nav id="bottomNav"><button class="bn-item" data-tab="allTab"><span class="bn-icon"></span></button></nav>
    <button class="nt-bell"><span class="nt-badge" data-notif-badge hidden>0</span></button>
    <span class="nt-badge nt-badge--tile" data-notif-badge hidden>0</span>
    <div id="communityTab"></div></body>`, { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  w.localStorage.setItem('token', 'tok');
  w.localStorage.setItem('fitnessAppUser', 'me_user');
  Object.entries(stored).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
  w.SERVER_URL = 'https://api.test';
  w.__NOTIFICATIONS_NO_POLL = true;
  const toasts = [];
  w.showToast = (msg, type) => toasts.push({ msg, type });
  const state = { items: items.map(i => ({ ...i })) };
  const calls = [];
  w.fetch = async (url, opts) => {
    const p = url.replace('https://api.test/api/notifications', '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method: opts.method, path: p, body });
    const ok = data => ({ ok: true, status: 200, json: async () => ({ success: true, ...data }) });
    if (opts.method === 'GET' && p === '') {
      return ok({ items: JSON.parse(JSON.stringify(state.items)), unread: state.items.filter(i => !i.read).length });
    }
    if (opts.method === 'POST' && p === '/read') {
      state.items.forEach(i => { if (!body.ids || body.ids.includes(i.id)) i.read = true; });
      return ok({ updated: 1 });
    }
    if (opts.method === 'DELETE') {
      state.items = state.items.filter(i => `/${i.id}` !== p);
      return ok({ deleted: true });
    }
    if (p === '/prefs') return ok({ prefs: { friends: true, shares: true, groups: true, feed: true, leaderboard: true } });
    return { ok: false, status: 404, json: async () => ({ success: false }) };
  };
  w.eval(SRC);
  return { w, N: w.Notifications, toasts, calls, state, doc: w.document };
}

const badges = doc => [...doc.querySelectorAll('[data-notif-badge]')].map(b => (b.hidden ? null : b.textContent));

describe('notifications', () => {
  test('describe() bolds the actor and escapes text', () => {
    const { N } = setup();
    expect(N.describe(n('a', { actor: '<x>', text: 'sent you a template: <b>' })))
      .toBe('<b>&lt;x&gt;</b> sent you a template: &lt;b&gt;');
  });

  test('collapsed group posts read as a count', () => {
    const { N } = setup();
    const row = n('g', { type: 'group_post', category: 'groups', count: 3, text: 'posted in Early Birds', data: { name: 'Early Birds' } });
    expect(N.describe(row)).toBe('<b>3 new posts</b> in Early Birds, latest from Alice');
    expect(N.describe({ ...row, count: 1 })).toBe('<b>Alice</b> posted in Early Birds');
  });

  test('ago() is short', () => {
    const { N } = setup();
    const now = Date.parse('2026-09-30T12:00:00Z');
    expect(N.ago('2026-09-30T11:59:30Z', now)).toBe('now');
    expect(N.ago('2026-09-30T11:15:00Z', now)).toBe('45m');
    expect(N.ago('2026-09-30T07:00:00Z', now)).toBe('5h');
    expect(N.ago('2026-09-27T12:00:00Z', now)).toBe('3d');
  });

  test('refresh paints unread badges and the nav dot', async () => {
    const { N, doc } = setup({ items: [n('a'), n('b'), n('c', { read: true })] });
    await N.refresh();
    expect(N.getUnread()).toBe(2);
    expect(badges(doc)).toEqual(['2', '2']);
    expect(doc.querySelector('.bn-item[data-tab="allTab"]').classList.contains('has-notif')).toBe(true);
  });

  test('first load stays quiet; later new items toast once, friend requests never', async () => {
    const ctx = setup({ items: [n('a')] });
    await ctx.N.refresh();
    expect(ctx.toasts).toEqual([]);
    ctx.state.items.unshift(n('b', { actor: 'bob', text: 'sent you a program: 5/3/1' }));
    ctx.state.items.unshift(n('f', { type: 'friend_request', category: 'friends', text: 'sent you a friend request' }));
    await ctx.N.refresh();
    expect(ctx.toasts).toEqual([{ msg: 'bob sent you a program: 5/3/1', type: 'info' }]);
    await ctx.N.refresh();
    expect(ctx.toasts).toHaveLength(1);
    // A collapsed row whose count went up toasts again.
    ctx.state.items.find(i => i.id === 'b').count = 2;
    await ctx.N.refresh();
    expect(ctx.toasts).toHaveLength(2);
  });

  test('markRead() with no ids clears everything', async () => {
    const { N, doc, calls } = setup({ items: [n('a'), n('b')] });
    await N.refresh();
    await N.markRead();
    expect(calls.at(-1)).toEqual({ method: 'POST', path: '/read', body: {} });
    expect(N.getUnread()).toBe(0);
    expect(badges(doc)).toEqual([null, null]);
  });

  test('dismiss() removes the row locally and on the server', async () => {
    const { N, calls } = setup({ items: [n('a'), n('b')] });
    await N.refresh();
    await N.dismiss('a');
    expect(N.getItems().map(i => i.id)).toEqual(['b']);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/a' });
  });

  test('the sheet lists items and opening it marks them read', async () => {
    const { N, doc, calls } = setup({ items: [n('a'), n('b', { read: true })] });
    await N.refresh();
    N.openSheet();
    const sheet = doc.getElementById('ntSheet');
    expect(sheet).not.toBeNull();
    expect(sheet.querySelectorAll('.nt-row')).toHaveLength(2);
    expect(sheet.querySelector('.nt-row.is-unread').dataset.id).toBe('a');
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(calls.some(c => c.method === 'POST' && c.path === '/read')).toBe(true);
    expect(N.getUnread()).toBe(0);
    N.closeSheet();
    expect(doc.getElementById('ntSheet')).toBeNull();
  });

  test('opening a share jumps to Community › Share', async () => {
    const { N, w } = setup();
    const seen = [];
    w.showTab = t => seen.push(t);
    w.showCommunitySection = s => seen.push(s);
    N.open(n('a'));
    expect(seen).toEqual(['communityTab', 'share']);
  });

  test('opening a group post loads groups, then opens that group', async () => {
    const { N, w } = setup();
    const seen = [];
    w.showTab = () => {};
    w.showCommunitySection = s => seen.push(s);
    w.loadGroups = async () => seen.push('loaded');
    w.openGroup = id => seen.push('open:' + id);
    N.open(n('g', { type: 'group_post', category: 'groups', data: { groupId: 'g1' } }));
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual(['groups', 'loaded', 'open:g1']);
  });
});
