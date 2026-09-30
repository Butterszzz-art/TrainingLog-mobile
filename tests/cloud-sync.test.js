/**
 * @jest-environment node
 */
const {
  STORES, splitStore, applyToStore, diffStore, chunkItems, laggedCursor,
  insertByDate, createEngine, installScopedKeys,
} = require('../src/js/cloud-sync.js');

const store = name => STORES.find(s => s.name === name);

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

// Same rules as the backend's src/routes/sync.js: last write wins by
// updatedAt, tombstones, and a seq cursor.
function fakeServer() {
  const docs = new Map(); // user -> Map(store\nid -> doc)
  let seq = 1000;
  let disabled = false;
  const table = user => { if (!docs.has(user)) docs.set(user, new Map()); return docs.get(user); };
  const ok = body => ({ ok: true, status: 200, json: async () => ({ success: true, ...body }) });
  const fail = (status, code) => ({ ok: false, status, json: async () => ({ success: false, error: { code, message: code } }) });
  const out = d => ({ store: d.store, id: d.itemId, data: d.deleted ? null : JSON.parse(d.data), deleted: d.deleted, updatedAt: d.updatedAt });
  const fetchFor = user => async (url, { method, body }) => {
    if (disabled) return fail(503, 'sync.disabled');
    const t = table(user);
    if (method === 'POST') {
      const newer = [];
      let applied = 0;
      JSON.parse(body).items.forEach(it => {
        const k = `${it.store}\n${it.id}`;
        const prev = t.get(k);
        if (prev && prev.updatedAt > it.updatedAt) { newer.push(out(prev)); return; }
        t.set(k, { store: it.store, itemId: String(it.id), data: it.deleted ? null : JSON.stringify(it.data), deleted: !!it.deleted, updatedAt: it.updatedAt, seq: ++seq, key: k });
        applied++;
      });
      return ok({ applied, rejected: [], newer });
    }
    const m = /cursor=([^&]+)/.exec(url);
    const after = m ? Number(decodeURIComponent(m[1]).split('_')[0]) : -1;
    const items = [...t.values()].filter(d => d.seq > after).sort((a, b) => a.seq - b.seq);
    const last = items[items.length - 1];
    return ok({ items: items.map(out), cursor: last ? `${last.seq}_${'a'.repeat(40)}` : null, hasMore: false });
  };
  return { fetchFor, docs, setDisabled: v => { disabled = v; } };
}

function device(server, user, { clock } = {}) {
  const storage = new MemStorage();
  const applied = [];
  const engine = createEngine({
    storage,
    fetchFn: server.fetchFor(user),
    serverUrl: () => 'https://api.test',
    getUser: () => user,
    getToken: () => 'tok',
    now: clock || (() => Date.now()),
    onApplied: stores => applied.push(...stores),
  });
  const get = key => JSON.parse(storage.getItem(key));
  const set = (key, v) => storage.setItem(key, JSON.stringify(v));
  return { storage, engine, applied, get, set, sync: () => engine.syncOnce() };
}

describe('splitStore', () => {
  test('uses the id field, falls back to content for duplicates and missing ids', () => {
    const raw = JSON.stringify([{ date: '2026-09-01', w: 80 }, { date: '2026-09-01', w: 81 }, { w: 82 }]);
    const ids = [...splitStore(store('bodyweightLog'), raw).keys()];
    expect(ids[0]).toBe('date:2026-09-01');
    expect(ids[1]).toMatch(/^h:/);
    expect(ids[2]).toMatch(/^h:/);
  });

  test('identical entries without ids stay distinct', () => {
    const e = { date: '2026-09-01', type: 'run', duration: 30 };
    const items = splitStore(store('cardioLog'), JSON.stringify([e, e]));
    expect(items.size).toBe(2);
  });

  test('missing or unreadable key is skipped, not treated as empty', () => {
    expect(splitStore(store('cardioLog'), null)).toBeNull();
    expect(splitStore(store('cardioLog'), '{oops')).toBeNull();
    expect(splitStore(store('macroTargets'), null)).toBeNull();
  });

  test('value stores are one item holding the raw string', () => {
    const items = splitStore(store('dailyMacroDate'), '2026-09-30');
    expect([...items.entries()]).toEqual([['value', expect.objectContaining({ data: '2026-09-30' })]]);
  });
});

describe('applyToStore', () => {
  test('replaces, deletes and inserts keeping date order', () => {
    const s = store('bodyweightLog');
    const raw = JSON.stringify([{ date: '2026-09-01', w: 80 }, { date: '2026-09-03', w: 79 }]);
    const next = JSON.parse(applyToStore(s, raw, [
      { id: 'date:2026-09-01', data: { date: '2026-09-01', w: 80.5 } },
      { id: 'date:2026-09-02', data: { date: '2026-09-02', w: 79.5 } },
      { id: 'date:2026-09-03', deleted: true },
    ]));
    expect(next).toEqual([{ date: '2026-09-01', w: 80.5 }, { date: '2026-09-02', w: 79.5 }]);
  });

  test('newest-first lists stay newest-first', () => {
    const list = [{ date: '2026-09-03' }, { date: '2026-09-01' }];
    insertByDate(list, { date: '2026-09-02' });
    expect(list.map(e => e.date)).toEqual(['2026-09-03', '2026-09-02', '2026-09-01']);
  });

  test('deleted value store removes the key', () => {
    expect(applyToStore(store('macroTargets'), '{}', [{ id: 'value', deleted: true }])).toBeNull();
  });
});

describe('diffStore', () => {
  test('holds back deleting most of a store at once', () => {
    const s = store('cardioLog');
    const shadow = {};
    for (let i = 0; i < 30; i++) shadow[`h:${i}`] = { h: 'x', u: 1 };
    const { items, heldBack } = diffStore(s, new Map(), shadow, 5);
    expect(heldBack).toBe(true);
    expect(items).toEqual([]);
  });

  test('small deletes go through', () => {
    const s = store('cardioLog');
    const { items } = diffStore(s, new Map(), { 'h:a': { h: 'x', u: 1 } }, 5);
    expect(items).toEqual([{ store: 'cardioLog', id: 'h:a', deleted: true, updatedAt: 5 }]);
  });
});

test('chunkItems respects count and size limits', () => {
  const small = Array.from({ length: 250 }, (_, i) => ({ id: i }));
  expect(chunkItems(small).map(c => c.length)).toEqual([100, 100, 50]);
  const big = Array.from({ length: 3 }, (_, i) => ({ id: i, data: 'x'.repeat(90 * 1024) }));
  expect(chunkItems(big).map(c => c.length)).toEqual([2, 1]);
});

test('laggedCursor reads a little behind the stored cursor', () => {
  expect(laggedCursor(`500000_${'b'.repeat(40)}`)).toBe(`380000_${'0'.repeat(40)}`);
  expect(laggedCursor(null)).toBeNull();
});

describe('two devices', () => {
  let server; let phone; let laptop;
  beforeEach(() => {
    server = fakeServer();
    phone = device(server, 'bob');
    laptop = device(server, 'bob');
  });

  test('a fresh install gets existing data and its defaults do not overwrite it', async () => {
    phone.set('bodyweightLog_bob', [{ date: '2026-09-01', weight: 80 }]);
    phone.set('macroTargets_bob', { protein: 180 });
    await phone.sync();

    laptop.set('macroTargets_bob', { protein: 0 }); // fresh-install default
    await laptop.sync();
    expect(laptop.get('bodyweightLog_bob')).toEqual([{ date: '2026-09-01', weight: 80 }]);
    expect(laptop.get('macroTargets_bob')).toEqual({ protein: 180 });
    expect(laptop.applied).toEqual(expect.arrayContaining(['bodyweightLog', 'macroTargets']));
  });

  test('entries added on each device end up on both', async () => {
    phone.set('cardioLog_bob', [{ date: '2026-09-01', type: 'run' }]);
    await phone.sync();
    await laptop.sync();
    laptop.set('cardioLog_bob', [...laptop.get('cardioLog_bob'), { date: '2026-09-02', type: 'bike' }]);
    phone.set('cardioLog_bob', [...phone.get('cardioLog_bob'), { date: '2026-09-02', type: 'swim' }]);
    await laptop.sync();
    await phone.sync();
    await laptop.sync();
    const types = l => l.map(e => e.type).sort();
    expect(types(phone.get('cardioLog_bob'))).toEqual(['bike', 'run', 'swim']);
    expect(types(laptop.get('cardioLog_bob'))).toEqual(['bike', 'run', 'swim']);
  });

  test('a delete on one device removes the entry on the other', async () => {
    phone.set('bodyMeasurements_bob', [{ date: '2026-09-01', waist: 80 }, { date: '2026-09-08', waist: 79 }]);
    await phone.sync();
    await laptop.sync();
    phone.set('bodyMeasurements_bob', [{ date: '2026-09-08', waist: 79 }]);
    await phone.sync();
    await laptop.sync();
    expect(laptop.get('bodyMeasurements_bob')).toEqual([{ date: '2026-09-08', waist: 79 }]);
  });

  test('an edit replaces the entry instead of duplicating it', async () => {
    phone.set('programs_bob', [{ id: 'p1', name: 'PPL' }]);
    await phone.sync();
    await laptop.sync();
    laptop.set('programs_bob', [{ id: 'p1', name: 'PPL v2' }]);
    await laptop.sync();
    await phone.sync();
    expect(phone.get('programs_bob')).toEqual([{ id: 'p1', name: 'PPL v2' }]);
  });

  test('the same value edited on both: the later edit wins everywhere', async () => {
    let t = 1000;
    phone = device(server, 'bob', { clock: () => t });
    laptop = device(server, 'bob', { clock: () => t });
    phone.set('macroTargets_bob', { protein: 150 });
    await phone.sync();
    await laptop.sync();
    t = 2000; laptop.set('macroTargets_bob', { protein: 170 }); await laptop.sync();
    t = 1500; phone.set('macroTargets_bob', { protein: 160 }); await phone.sync(); // older edit, synced later
    await laptop.sync();
    expect(phone.get('macroTargets_bob')).toEqual({ protein: 170 });
    expect(laptop.get('macroTargets_bob')).toEqual({ protein: 170 });
  });

  test('a store missing from the device is skipped, then restored from the server', async () => {
    phone.set('hyroxLog_bob', [{ ts: 1, total: 4000 }]);
    await phone.sync();
    phone.storage.removeItem('hyroxLog_bob');
    await phone.sync();
    expect(server.docs.get('bob').get('hyroxLog\nts:1').deleted).toBe(false);
    expect(phone.get('hyroxLog_bob')).toEqual([{ ts: 1, total: 4000 }]);
  });

  test('other accounts never see the data', async () => {
    phone.set('cardioLog_bob', [{ date: '2026-09-01', type: 'run' }]);
    await phone.sync();
    const other = device(server, 'alice');
    await other.sync();
    expect(other.storage.getItem('cardioLog_alice')).toBeNull();
    expect(other.storage.getItem('cardioLog_bob')).toBeNull();
  });

  test('the server switch stops syncing for the session', async () => {
    server.setDisabled(true);
    phone.set('cardioLog_bob', [{ date: '2026-09-01' }]);
    await phone.sync();
    expect(phone.engine.isDisabled()).toBe(true);
    server.setDisabled(false);
    await phone.sync();
    expect(server.docs.get('bob')).toBeUndefined();
  });
});

describe('installScopedKeys', () => {
  function setup() {
    const proto = {
      getItem(k) { return this.m.has(k) ? this.m.get(k) : null; },
      setItem(k, v) { this.m.set(k, String(v)); },
      removeItem(k) { this.m.delete(k); },
    };
    const ls = Object.create(proto);
    ls.m = new Map();
    let user = null;
    installScopedKeys(proto, () => ls, () => user);
    return { ls, setUser: u => { user = u; } };
  }

  test('scopes the listed keys to the signed-in account and moves the old shared value once', () => {
    const { ls, setUser } = setup();
    ls.setItem('dailyMacroMeals', '[1]'); // before sign-in: shared key
    setUser('bob');
    expect(ls.getItem('dailyMacroMeals')).toBe('[1]');
    expect(ls.m.has('dailyMacroMeals')).toBe(false);
    ls.setItem('dailyMacroMeals', '[2]');
    expect(ls.m.get('dailyMacroMeals_bob')).toBe('[2]');

    setUser('alice');
    expect(ls.getItem('dailyMacroMeals')).toBeNull();
    ls.setItem('dailyMacroMeals', '[3]');
    setUser('bob');
    expect(ls.getItem('dailyMacroMeals')).toBe('[2]');
  });

  test('leaves other keys alone', () => {
    const { ls, setUser } = setup();
    setUser('bob');
    ls.setItem('theme', 'dark');
    expect(ls.m.get('theme')).toBe('dark');
  });
});

describe('store registry', () => {
  test('names are unique and accepted by the server', () => {
    const names = STORES.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
    names.forEach(n => expect(n).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,63}$/));
  });

  test('keys are unique per account and include the account name', () => {
    const keys = STORES.map(s => s.key('bob'));
    expect(new Set(keys).size).toBe(keys.length);
    keys.forEach(k => expect(k).toContain('bob'));
  });

  test('never syncs device-only bookkeeping', () => {
    const keys = STORES.map(s => s.key('bob'));
    ['workoutSyncFp_bob', 'cloudSync_bob', 'token', 'fitnessAppUser', 'aiProfile_bob', 'friends_bob']
      .forEach(k => expect(keys).not.toContain(k));
  });
});

describe('map stores', () => {
  test('split per key and merge per key', () => {
    const s = store('prs');
    const items = splitStore(s, JSON.stringify({ Bench: 100, Squat: 140 }));
    expect([...items.keys()]).toEqual(['k:Bench', 'k:Squat']);
    const next = JSON.parse(applyToStore(s, JSON.stringify({ Bench: 100, Squat: 140 }), [
      { id: 'k:Bench', data: 105 },
      { id: 'k:Squat', deleted: true },
      { id: 'k:Deadlift', data: 180 },
    ]));
    expect(next).toEqual({ Bench: 105, Deadlift: 180 });
  });

  test('an array stored where a map is expected is skipped', () => {
    expect(splitStore(store('settings'), '[1,2]')).toBeNull();
  });

  test('different settings changed on two devices both survive', async () => {
    const server = fakeServer();
    const phone = device(server, 'bob');
    const laptop = device(server, 'bob');
    phone.set('settings_bob', { units: 'kg', theme: 'dark' });
    await phone.sync();
    await laptop.sync();
    phone.set('settings_bob', { units: 'lbs', theme: 'dark' });
    laptop.set('settings_bob', { units: 'kg', theme: 'light' });
    await phone.sync();
    await laptop.sync();
    await phone.sync();
    expect(phone.get('settings_bob')).toEqual({ units: 'lbs', theme: 'light' });
    expect(laptop.get('settings_bob')).toEqual({ units: 'lbs', theme: 'light' });
  });

  test('sleep entries logged on each device end up on both, newest first', async () => {
    const server = fakeServer();
    const phone = device(server, 'bob');
    const laptop = device(server, 'bob');
    phone.set('sleepLog_bob', [{ date: '2026-09-02', duration: 7 }, { date: '2026-09-01', duration: 8 }]);
    await phone.sync();
    await laptop.sync();
    laptop.set('sleepLog_bob', [{ date: '2026-09-03', duration: 6 }, ...laptop.get('sleepLog_bob')]);
    await laptop.sync();
    await phone.sync();
    expect(phone.get('sleepLog_bob').map(e => e.date)).toEqual(['2026-09-03', '2026-09-02', '2026-09-01']);
  });
});
