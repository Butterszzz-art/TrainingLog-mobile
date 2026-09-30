const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// Loads the given scripts into a fresh page with a fake server.
function page(scripts, handler, { user = 'me_user', html = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  w.localStorage.setItem('token', 'tok');
  w.localStorage.setItem('fitnessAppUser', user);
  w.SERVER_URL = 'https://api.test';
  w.__SHARES_NO_POLL = true;
  w.__WORKOUT_SYNC_NO_TIMER = true;
  const toasts = [];
  w.showToast = (msg, type) => toasts.push({ msg, type });
  const calls = [];
  w.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method: opts.method || 'GET', path: url.replace('https://api.test', ''), body });
    const out = await handler(opts.method || 'GET', url.replace('https://api.test', ''), body);
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  };
  scripts.forEach(f => w.eval(read(f)));
  return { w, calls, toasts };
}

describe('Shares (friend inbox)', () => {
  const inbox = [{ id: 's1', from: 'Alice', type: 'template', name: 'Leg day', data: { title: 'Leg day', exercises: [{ name: 'Squat' }] }, note: 'try it', sentAt: '2026-09-29T10:00:00Z' }];

  test('send posts to /api/shares and records it as sent', async () => {
    const { w, calls } = page(['src/js/shares.js'], async () => ({ status: 201, body: { success: true, share: { id: 's9', to: 'Alice', type: 'program', name: 'PPL' } } }));
    await w.Shares.send('alice', { type: 'program', name: 'PPL', data: { days: [] } }, 'hi');
    expect(calls).toEqual([{ method: 'POST', path: '/api/shares', body: { to: 'alice', type: 'program', name: 'PPL', data: { days: [] }, note: 'hi' } }]);
    expect(w.Shares.getSent().map(s => s.id)).toEqual(['s9']);
  });

  test('send surfaces the server error (e.g. not friends)', async () => {
    const { w } = page(['src/js/shares.js'], async () => ({ status: 422, body: { success: false, error: { message: 'You can only share with friends.' } } }));
    await expect(w.Shares.send('carl', { type: 'program', name: 'x', data: {} })).rejects.toThrow('You can only share with friends.');
  });

  test('accept saves a template into managedTemplates and removes it from the inbox', async () => {
    const { w, calls } = page(['src/js/shares.js'], async method => (method === 'GET'
      ? { status: 200, body: { success: true, inbox, sent: [] } }
      : { status: 200, body: { success: true, deleted: true } }),
    { html: '<span id="commShareBadge" style="display:none"></span>' });
    await w.Shares.refresh();
    expect(w.document.getElementById('commShareBadge').textContent).toBe('1');
    await w.Shares.accept('s1');
    const saved = JSON.parse(w.localStorage.getItem('managedTemplates_me_user'));
    expect(saved[0]).toMatchObject({ name: 'Leg day (from @Alice)', data: { title: 'Leg day' }, source: 'community' });
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual(['GET /api/shares', 'DELETE /api/shares/s1']);
    expect(w.Shares.getInbox()).toEqual([]);
    expect(w.document.getElementById('commShareBadge').style.display).toBe('none');
  });

  test('saveToLibrary stores programs in programs_{user}', () => {
    const { w } = page(['src/js/shares.js'], async () => ({ status: 200, body: { success: true } }));
    w.Shares.saveToLibrary({ type: 'program', name: 'PPL', data: { days: [1, 2] } }, 'bob');
    const saved = JSON.parse(w.localStorage.getItem('programs_me_user'));
    expect(saved[0]).toMatchObject({ name: 'PPL (from @bob)', days: [1, 2], _sharedBy: 'bob' });
  });
});

describe('recent workout sync', () => {
  const today = new Date().toISOString().slice(0, 10);
  const old = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  const workouts = [
    { id: 'w1', date: today, title: 'Push', log: [{ name: 'Bench', repsArray: [5], weightsArray: [80] }] },
    { id: 'w2', date: today, title: 'Empty', log: [] },
    { date: today, title: 'No id', log: [{ name: 'Squat', repsArray: [5], weightsArray: [100] }] },
  ];
  const history = [
    { id: 'w3', date: old, title: 'Old', log: [{ name: 'Row', repsArray: [5], weightsArray: [60] }] },
    { id: 'w1', date: today, title: 'Push (dupe)', log: [{ name: 'Bench', repsArray: [5], weightsArray: [80] }] },
  ];

  function setup() {
    const env = page(['src/js/workout-sync.js'], async () => ({ status: 200, body: { success: true, recordId: 'x' } }));
    env.w.localStorage.setItem('workouts_me_user', JSON.stringify(workouts));
    env.w.localStorage.setItem('workoutHistory_me_user', JSON.stringify(history));
    return env;
  }

  test('posts only recent workouts with an id and sets, once until they change', async () => {
    const { w, calls } = setup();
    expect(await w.syncRecentWorkouts()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/workouts', body: { title: 'Push', workout: { id: 'w1' } } });

    expect(await w.syncRecentWorkouts()).toBe(0);
    expect(calls).toHaveLength(1);

    const edited = [{ ...workouts[0], log: [{ name: 'Bench', repsArray: [5, 5], weightsArray: [80, 82.5] }] }];
    w.localStorage.setItem('workouts_me_user', JSON.stringify(edited));
    expect(await w.syncRecentWorkouts()).toBe(1);
    expect(calls[1].body.workout.log[0].repsArray).toEqual([5, 5]);
  });

  test('does nothing when signed out', async () => {
    const { w, calls } = setup();
    w.localStorage.removeItem('token');
    expect(await w.syncRecentWorkouts()).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('community feed', () => {
  const FEED_HTML = `
    <div id="activityFeed"></div>
    <span id="feedComposerAvatar"></span>
    <button id="feedComposerToggle" aria-expanded="false"></button>
    <div id="feedComposerBody"><div><div class="pod"><textarea id="feedPostText"></textarea>
      <div class="sx-composer-row"><div id="feedTagSeg">
        <button class="feed-tag-btn active" data-tag="workout"></button>
        <button class="feed-tag-btn" data-tag="pr"></button>
        <button class="feed-tag-btn" data-tag="update"></button>
      </div></div></div></div></div>`;
  const posts = [
    { id: 'p1', author: 'Alice', type: 'pr', text: 'Squat <b>140</b>!', date: new Date().toISOString(), mine: false, canDelete: false },
  ];

  function setup() {
    const env = page(['src/js/community-feed.js'], async (method, p, body) => {
      if (method === 'GET' && p === '/api/feed') return { status: 200, body: { success: true, posts } };
      if (method === 'POST' && p === '/api/feed') {
        return { status: 201, body: { success: true, post: { id: 'p2', author: 'me_user', ...body, date: new Date().toISOString(), mine: true, canDelete: true } } };
      }
      return { status: 404, body: { success: false } };
    }, { html: FEED_HTML });
    env.w.getAllWorkoutsForUser = () => [];
    return env;
  }

  const flush = () => new Promise(r => setTimeout(r, 0));

  test('shows friends’ posts from the server, escaped', async () => {
    const { w } = setup();
    w.renderActivityFeed();
    await flush(); await flush();
    const feed = w.document.getElementById('activityFeed');
    expect(feed.textContent).toContain('Alice');
    expect(feed.textContent).toContain('Squat <b>140</b>!');
    expect(feed.querySelector('p b')).toBeNull();
  });

  test('posting sends to /api/feed and adds the post', async () => {
    const { w, calls } = setup();
    w.renderActivityFeed();
    await flush(); await flush();
    w.document.querySelector('[data-tag="update"]').click();
    w.document.getElementById('feedPostText').value = 'Rest day';
    await w.submitCommunityPost();
    expect(calls.find(c => c.method === 'POST')).toMatchObject({ path: '/api/feed', body: { type: 'update', text: 'Rest day' } });
    expect(w.document.getElementById('activityFeed').textContent).toContain('Rest day');
  });
});
