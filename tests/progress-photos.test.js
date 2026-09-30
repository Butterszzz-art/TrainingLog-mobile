/**
 * Progress photos (src/js/progress-photos.js) in a jsdom page: no canvas and
 * no IndexedDB there, so the shrinker is stubbed and the in-memory store is
 * used.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/js/progress-photos.js'), 'utf8');

function page({ user = 'bob', server = new Map() } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  w.__PROGRESS_PHOTOS_NO_AUTO = true;
  w.SERVER_URL = 'https://api.test';
  w.localStorage.setItem('token', 'tok');
  w.localStorage.setItem('fitnessAppUser', user);
  let online = true;
  const calls = [];
  w.fetch = async (url, opts = {}) => {
    const id = decodeURIComponent(url.split('/api/photos/')[1]);
    calls.push({ method: opts.method, id });
    if (!online) throw new Error('offline');
    const key = `${user}/${id}`;
    if (opts.method === 'PUT') server.set(key, { id, ...JSON.parse(opts.body) });
    const hit = server.get(key);
    const status = opts.method === 'GET' && !hit ? 404 : 200;
    return { ok: status === 200, status, json: async () => ({ success: status === 200, photo: hit }) };
  };
  w.eval(SRC);
  w.ProgressPhotos.compressImage = async src => `data:image/jpeg;base64,small(${String(src).length})`;
  return { w, calls, server, setOnline: v => { online = v; } };
}
const flush = () => new Promise(r => setTimeout(r, 0));

test('saving stores a reference, lists the photo and uploads it', async () => {
  const { w, server } = page();
  const { ref, data } = await w.ProgressPhotos.savePhoto('front', 'data:image/png;base64,BIG', '2026-09-30');
  await flush();
  expect(ref).toMatch(/^photo:ph_/);
  expect(data).toMatch(/^data:image\/jpeg/);
  expect(w.localStorage.getItem('progressPhoto_bob_front')).toBe(ref);
  expect(JSON.parse(w.localStorage.getItem('progressPhotos_bob'))).toEqual([{ id: ref.slice(6), slot: 'front', date: '2026-09-30' }]);
  expect(server.get(`bob/${ref.slice(6)}`)).toMatchObject({ slot: 'front', date: '2026-09-30', data });
  expect(await w.ProgressPhotos.resolve(ref)).toBe(data);
});

test('another device downloads the photo from a synced reference', async () => {
  const server = new Map();
  const phone = page({ server });
  const { ref, data } = await phone.w.ProgressPhotos.savePhoto('side', 'data:image/png;base64,X');
  await flush();
  const laptop = page({ server });
  expect(await laptop.w.ProgressPhotos.resolve(ref)).toBe(data);
  // cached: a second look doesn't hit the server again
  const gets = () => laptop.calls.filter(c => c.method === 'GET').length;
  const before = gets();
  await laptop.w.ProgressPhotos.resolve(ref);
  expect(gets()).toBe(before);
});

test('old data URLs still display, and missing photos resolve to empty', async () => {
  const { w } = page();
  expect(await w.ProgressPhotos.resolve('data:image/png;base64,OLD')).toBe('data:image/png;base64,OLD');
  expect(await w.ProgressPhotos.resolve('photo:ph_missing1')).toBe('');
  expect(await w.ProgressPhotos.resolve('')).toBe('');
});

test('photos taken offline upload later', async () => {
  const { w, server, setOnline } = page();
  setOnline(false);
  const { ref } = await w.ProgressPhotos.savePhoto('back', 'data:image/png;base64,Y');
  await flush();
  expect(server.size).toBe(0);
  setOnline(true);
  expect(await w.ProgressPhotos.uploadPending()).toBe(1);
  expect(server.has(`bob/${ref.slice(6)}`)).toBe(true);
  expect(await w.ProgressPhotos.uploadPending()).toBe(0);
});

test('migrates full-size photos out of slots and check-ins, once per image', async () => {
  const { w, server } = page();
  const big = 'data:image/png;base64,' + 'Q'.repeat(5000);
  w.localStorage.setItem('progressPhoto_bob_front', big);
  w.localStorage.setItem('tl_checkins_v1_bob', JSON.stringify([
    { date: '2026-09-01', frontPhoto: big, sidePhoto: '', backPhoto: '' },
    { date: '2026-08-25', frontPhoto: '', sidePhoto: 'data:image/png;base64,S', backPhoto: '' },
  ]));
  expect(await w.ProgressPhotos.migrateLegacy()).toBe(2);
  await flush();
  const checkIns = JSON.parse(w.localStorage.getItem('tl_checkins_v1_bob'));
  expect(checkIns[0].frontPhoto).toMatch(/^photo:/);
  expect(checkIns[1].sidePhoto).toMatch(/^photo:/);
  expect(w.localStorage.getItem('progressPhoto_bob_front')).toBe(checkIns[0].frontPhoto);
  expect(server.size).toBe(2);
  expect(await w.ProgressPhotos.migrateLegacy()).toBe(0);
});

test('forgetLocal drops the account’s cached photos', async () => {
  const server = new Map();
  const { w, setOnline } = page({ server });
  const { ref } = await w.ProgressPhotos.savePhoto('front', 'data:image/png;base64,Z');
  await flush();
  await w.ProgressPhotos.forgetLocal('bob');
  setOnline(false);
  expect(await w.ProgressPhotos.resolve(ref)).toBe('');
});
