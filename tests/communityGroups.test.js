const { JSDOM } = require('jsdom');

// community.js reads window/document/localStorage as globals, like the app.
function setup(fetchImpl) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.test/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  localStorage.setItem('token', 'tok');
  localStorage.setItem('fitnessAppUser', 'Me_User');
  window.SERVER_URL = 'https://api.test';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers.Authorization });
    return fetchImpl(url, opts);
  };
  jest.resetModules();
  return { mod: require('../community'), calls };
}

const ok = data => ({ ok: true, status: 200, json: async () => ({ success: true, ...data }) });

afterEach(() => {
  delete global.window; delete global.document; delete global.localStorage; delete global.fetch;
});

describe('community groups (server-backed)', () => {
  test('createGroup sends the picked friends to /api/groups and keeps the server group', async () => {
    const { mod, calls } = setup(async () => ok({
      group: { id: 'g1', name: 'Lifters', members: [{ userId: 'Me_User' }, { userId: 'alice' }], isMember: true, isOwner: true, recentPostTimes: [] },
    }));
    const g = await mod.createGroup('Lifters', 'Bench 100', ['strength'], ['alice']);
    expect(calls).toEqual([{
      url: 'https://api.test/api/groups', method: 'POST', auth: 'Bearer tok',
      body: { name: 'Lifters', goal: 'Bench 100', tags: ['strength'], members: ['alice'] },
    }]);
    expect(g.id).toBe('g1');
    expect(mod.getGroups().map(x => x.id)).toEqual(['g1']);
  });

  test('createGroup surfaces the server error instead of saving locally', async () => {
    const { mod } = setup(async () => ({
      ok: false, status: 422,
      json: async () => ({ success: false, error: { code: 'groups.objectionable', message: 'That name isn’t allowed.' } }),
    }));
    await expect(mod.createGroup('bad', '', [], [])).rejects.toThrow('That name isn’t allowed.');
    expect(mod.getGroups()).toEqual([]);
  });

  test('fetchGroups exposes recent post times as posts for activity bars', async () => {
    const { mod } = setup(async () => ok({
      groups: [{ id: 'g2', name: 'Runners', members: [{ userId: 'bob' }], isMember: false, recentPostTimes: ['2026-09-29T10:00:00Z'] }],
    }));
    const list = await mod.fetchGroups();
    expect(list[0].posts).toEqual([{ date: '2026-09-29T10:00:00Z' }]);
    expect(JSON.parse(localStorage.getItem('communityGroups_v2_Me_User'))[0].id).toBe('g2');
  });

  test('isMemberOf is case-insensitive and trusts the server flag for you', () => {
    const { mod } = setup(async () => ok({}));
    expect(mod.isMemberOf({ members: [{ userId: 'Alice' }] }, 'alice')).toBe(true);
    expect(mod.isMemberOf({ members: [], isMember: true }, 'Me_User')).toBe(true);
    expect(mod.isMemberOf({ members: [{ userId: 'me_user' }], isMember: false }, 'Me_User')).toBe(false);
  });

  test('signed out: no request is made', async () => {
    const { mod, calls } = setup(async () => ok({}));
    localStorage.removeItem('token');
    await expect(mod.fetchGroups()).rejects.toThrow('Sign in to use groups.');
    expect(calls).toHaveLength(0);
  });
});
