// src/js/program-import.js (the athlete app's Import sheet) on top of the
// shared upload core: pick a file → preview with every week and warnings.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const CORE = fs.readFileSync(path.join(__dirname, '../src/js/program-import-core.js'), 'utf8');
const SHEET = fs.readFileSync(path.join(__dirname, '../src/js/program-import.js'), 'utf8');

function setup(fetchImpl) {
  const dom = new JSDOM(
    '<!doctype html><body><div id="progImportBackdrop"></div><div id="progImportPanel"><div id="progImportStatus"></div><div id="progImportBody"></div></div></body>',
    { runScripts: 'outside-only', url: 'https://app.test/' }
  );
  const w = dom.window;
  w.requestAnimationFrame = cb => cb();
  w.fetch = fetchImpl;
  w.SERVER_URL = 'https://api.test';
  w.getAuthHeaders = () => ({ Authorization: 'Bearer t' });
  // FileReader → data URL without touching disk.
  w.FileReader = class { readAsDataURL() { this.result = 'data:application/octet-stream;base64,QUJD'; setTimeout(() => this.onload(), 0); } };
  w.eval(CORE);
  w.eval(SHEET);
  return w;
}

async function pick(w, file) {
  w.openProgImport();
  const input = w.document.getElementById('progImportFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

const program = {
  kind: 'program', title: 'Block', goal: 'general',
  weeks: [
    { week: 1, label: 'Week 1', days: [{ name: 'Lower A', exercises: [{ name: 'Hack squat', sets: [{ reps: 6, repsMax: 10, rir: 3 }, { reps: 6, repsMax: 10, rir: 3 }] }] }] },
    { week: 2, label: 'Week 2', days: [{ name: 'Lower A', exercises: [{ name: 'Hack squat', sets: [{ reps: 6, repsMax: 10, rir: 2 }, { reps: 6, repsMax: 10, rir: 1 }] }] }] },
  ],
};

test('upload → preview with weeks, sets and warnings', async () => {
  let sent;
  const w = setup(async (url, init) => { sent = { url, body: JSON.parse(init.body), headers: init.headers }; return { ok: true, status: 200, json: async () => ({ program, warnings: ['Week 3 is missing'], source: 'table' }) }; });
  await pick(w, { name: 'block.xlsx', size: 100 });
  expect(sent.url).toBe('https://api.test/api/ai/coach/import-program');
  expect(sent.body).toEqual({ fileName: 'block.xlsx', data: 'QUJD' });
  expect(sent.headers.Authorization).toBe('Bearer t');
  const body = w.document.getElementById('progImportBody').textContent;
  expect(body).toMatch(/Block/);
  expect(body).toMatch(/Week 3 is missing/);
  expect(body).toMatch(/2 × 6 RIR 3/);
  w.document.querySelector('[data-week="2"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(w.document.getElementById('progImportBody').textContent).toMatch(/1 × 6 RIR 2, 1 × 6 RIR 1/);
});

test('a server error goes back to the picker with the message', async () => {
  const w = setup(async () => ({ ok: false, status: 422, json: async () => ({ message: 'No training program was found in this file.' }) }));
  await pick(w, { name: 'x.pdf', size: 100 });
  expect(w.document.getElementById('progImportBody').textContent).toMatch(/No training program was found/);
  expect(w.document.querySelector('[data-act="choose"]')).not.toBeNull();
});

test('a file over 8 MB never uploads', async () => {
  let called = false;
  const w = setup(async () => { called = true; });
  await pick(w, { name: 'big.pdf', size: 9 * 1024 * 1024 });
  expect(called).toBe(false);
  expect(w.document.getElementById('progImportBody').textContent).toMatch(/over 8 MB/);
});
