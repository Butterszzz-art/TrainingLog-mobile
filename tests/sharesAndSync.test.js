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
  const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const today = day(0);
  const old = day(40);
  const set = (name, kg) => [{ name, repsArray: [5], weightsArray: [kg] }];
  const workouts = [
    { id: 'w1', date: today, title: 'Push', log: set('Bench', 80) },
    { id: 'w2', date: today, title: 'Empty', log: [] },
    { date: today, title: 'No id', log: set('Squat', 100) },
  ];
  const history = [
    { id: 'w3', date: old, title: 'Old', log: set('Row', 60) },
    { id: 'w1', date: today, title: 'Push (dupe)', log: set('Bench', 80) },
  ];

  // Behaves like the backend's /workouts routes (stores the workout as-is).
  function fakeWorkoutServer() {
    const saved = new Map();
    const handler = async (method, p, body) => {
      if (method === 'POST' && p === '/workouts') {
        saved.set(String(body.workout.id), { ...body.workout });
        return { status: 200, body: { success: true, recordId: body.workout.id } };
      }
      if (method === 'DELETE' && p.startsWith('/workouts/')) {
        const id = decodeURIComponent(p.slice('/workouts/'.length));
        return { status: 200, body: { success: true, deleted: saved.delete(id) } };
      }
      if (method === 'GET' && p.startsWith('/workouts?')) {
        const since = new URLSearchParams(p.split('?')[1]).get('since') || '';
        const items = [...saved.values()]
          .filter(w => String(w.date).slice(0, 10) >= since)
          .map(w => ({ id: w.id, date: w.date, title: w.title, workout: w }));
        return { status: 200, body: { success: true, items, nextCursor: null } };
      }
      return { status: 404, body: { success: false } };
    };
    return { saved, handler };
  }

  function setup(server = fakeWorkoutServer()) {
    const env = page(['src/js/workout-sync.js'], server.handler);
    env.w.localStorage.setItem('workouts_me_user', JSON.stringify(workouts));
    env.w.localStorage.setItem('workoutHistory_me_user', JSON.stringify(history));
    return { ...env, server };
  }
  const posts = calls => calls.filter(c => c.method === 'POST');
  const local = (w, key = 'workouts_me_user') => JSON.parse(w.localStorage.getItem(key));

  test('posts only recent workouts with an id and sets, once until they change', async () => {
    const { w, calls } = setup();
    expect(await w.syncRecentWorkouts()).toBe(1);
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0]).toMatchObject({ path: '/workouts', body: { title: 'Push', workout: { id: 'w1' } } });

    expect(await w.syncRecentWorkouts()).toBe(0);
    expect(posts(calls)).toHaveLength(1);

    const edited = [{ ...workouts[0], log: [{ name: 'Bench', repsArray: [5, 5], weightsArray: [80, 82.5] }] }];
    w.localStorage.setItem('workouts_me_user', JSON.stringify(edited));
    expect(await w.syncRecentWorkouts()).toBe(1);
    expect(posts(calls)[1].body.workout.log[0].repsArray).toEqual([5, 5]);
  });

  test('does nothing when signed out', async () => {
    const { w, calls } = setup();
    w.localStorage.removeItem('token');
    expect(await w.syncRecentWorkouts()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('a new device gets recent workouts into the right local store', async () => {
    const server = fakeWorkoutServer();
    server.saved.set('a', { id: 'a', date: day(1), title: 'Legs', log: set('Squat', 120) });
    server.saved.set('b', { id: 'b', date: day(12), title: 'Pull', log: set('Row', 70) });
    const env = page(['src/js/workout-sync.js'], server.handler);
    await env.w.syncRecentWorkouts();
    expect(local(env.w).map(x => x.id)).toEqual(['a']);
    expect(local(env.w, 'workoutHistory_me_user').map(x => x.id)).toEqual(['b']);
    expect(posts(env.calls)).toHaveLength(0); // nothing echoed back
  });

  test('deleting on one device deletes on the server and the other device', async () => {
    const server = fakeWorkoutServer();
    const phone = setup(server);
    await phone.w.syncRecentWorkouts();
    const laptop = page(['src/js/workout-sync.js'], server.handler);
    await laptop.w.syncRecentWorkouts();
    expect(local(laptop.w).map(x => x.id)).toEqual(['w1']);

    phone.w.localStorage.setItem('workouts_me_user', JSON.stringify([]));
    phone.w.localStorage.setItem('workoutHistory_me_user', JSON.stringify([history[0]]));
    await phone.w.syncRecentWorkouts();
    expect(phone.calls.some(c => c.method === 'DELETE' && c.path === '/workouts/w1')).toBe(true);
    expect(server.saved.has('w1')).toBe(false);

    await laptop.w.syncRecentWorkouts();
    expect(local(laptop.w)).toEqual([]);
  });

  test('an edit on one device replaces the copy on the other', async () => {
    const server = fakeWorkoutServer();
    const phone = setup(server);
    await phone.w.syncRecentWorkouts();
    const laptop = page(['src/js/workout-sync.js'], server.handler);
    await laptop.w.syncRecentWorkouts();

    const edited = { ...local(laptop.w)[0], title: 'Push (heavy)' };
    laptop.w.localStorage.setItem('workouts_me_user', JSON.stringify([edited]));
    await laptop.w.syncRecentWorkouts();
    await phone.w.syncRecentWorkouts();
    expect(local(phone.w).find(x => x.id === 'w1').title).toBe('Push (heavy)');
  });

  test('a workout archived off the device is not deleted from the server', async () => {
    const server = fakeWorkoutServer();
    const env = setup(server);
    await env.w.syncRecentWorkouts();
    // Pretend w1 synced long ago and the archiver removed it locally.
    const fp = JSON.parse(env.w.localStorage.getItem('workoutSyncFp_me_user'));
    fp.w1.d = day(27);
    env.w.localStorage.setItem('workoutSyncFp_me_user', JSON.stringify(fp));
    env.w.localStorage.setItem('workouts_me_user', JSON.stringify([]));
    env.w.localStorage.setItem('workoutHistory_me_user', JSON.stringify([]));
    await env.w.syncRecentWorkouts({ pull: false });
    expect(env.calls.some(c => c.method === 'DELETE')).toBe(false);
  });

  test('reads fingerprints saved by the previous version', async () => {
    const { w, calls } = setup();
    w.localStorage.setItem('workoutSyncFp_me_user', JSON.stringify({ w1: 'stale:1' }));
    expect(await w.syncRecentWorkouts()).toBe(1);
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
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
