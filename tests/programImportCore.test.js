// src/js/program-import-core.js — the upload shared by the app's Import
// sheet and the coach dashboard's Import file button.
const IC = require('../src/js/program-import-core.js');

const file = (size = 10) => ({ name: 'block.xlsx', size });
const reply = (status, json) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => json });

describe('program import core', () => {
  test('checkFile', () => {
    expect(IC.checkFile(null)).toMatch(/Choose a file/);
    expect(IC.checkFile(file(9 * 1024 * 1024))).toMatch(/over 8 MB/);
    expect(IC.checkFile(file())).toBeNull();
  });

  test('upload posts the file (and target) and returns the server result', async () => {
    const calls = [];
    const fetchFn = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ program: { name: 'X' }, source: 'table', rowWarnings: [] }) }; };
    const out = await IC.upload(file(), { serverUrl: 'https://api.test/', headers: { Authorization: 'Bearer t' }, target: 'coach', fetchFn, data: 'QUJD' });
    expect(out.source).toBe('table');
    expect(calls[0].url).toBe('https://api.test/api/ai/coach/import-program');
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
    expect(JSON.parse(calls[0].init.body)).toEqual({ fileName: 'block.xlsx', data: 'QUJD', target: 'coach' });
  });

  test('the app upload sends no target', async () => {
    let body;
    await IC.upload(file(), { serverUrl: 'x', data: 'AA', fetchFn: async (_u, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ program: {} }) }; } });
    expect(body.target).toBeUndefined();
  });

  test('errors become messages ready to show', async () => {
    const up = fetchFn => IC.upload(file(), { serverUrl: 'x', data: 'AA', fetchFn });
    await expect(up(reply(401, {}))).rejects.toThrow('Please log in again to import a program.');
    await expect(up(reply(403, {}))).rejects.toThrow('Importing programs is a Pro feature.');
    await expect(up(reply(404, { error: 'AI_NOT_CONFIGURED' }))).rejects.toThrow(/not switched on/);
    await expect(up(reply(422, { error: 'no_program', message: 'No training program was found in this file.' }))).rejects.toThrow('No training program was found in this file.');
    await expect(up(reply(200, {}))).rejects.toThrow(/Couldn't import/);
    expect(IC.friendlyError({ name: 'AbortError' })).toMatch(/took too long/);
    expect(IC.friendlyError(new Error('x'), false)).toBe('You are offline.');
  });

  test('start() aborts after the timeout', async () => {
    const fetchFn = (_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const job = IC.start(file(), { serverUrl: 'x', data: 'AA', fetchFn, timeoutMs: 10 });
    await expect(job.promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('setsSummary groups identical sets and shows the last-set RIR', () => {
    const sets = [{ reps: 10, repsMax: 20, rir: 2 }, { reps: 10, repsMax: 20, rir: 2 }, { reps: 10, repsMax: 20, rir: 2 }, { reps: 10, repsMax: 20, rir: 1 }];
    const fmt = s => (s.repsMax ? s.reps + '-' + s.repsMax : String(s.reps));
    expect(IC.setsSummary(sets, fmt)).toBe('3 × 10-20 RIR 2, 1 × 10-20 RIR 1');
  });
});
