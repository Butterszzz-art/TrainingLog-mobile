// Importing the coach's own master plan file: the dashboard review
// (coach/plan-import.js), suggested values in the editor, the client's PDF
// button and opening it (src/js/my-plan.js), and the upload path.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const d = (kcal, proteinG, carbG, fatG) => ({ kcal, proteinG, carbG, fatG });
const importResult = (isPdf = true) => ({
  isPdf,
  warnings: ['Maintenance gives one kcal figure for every day.'],
  plan: {
    name: '16-week plan', startDate: null, notes: 'Protein high every day.', suggested: 8,
    phases: [
      { type: 'cut', weeks: 12, goalText: 'Lose fat', trainingDay: d(2350, 165, 275, 65), restDay: d(2000, 165, 190, 65), suggested: [] },
      { type: 'maintain', weeks: 3, goalText: 'Break', trainingDay: d(2700, 165, 364, 65), restDay: d(2700, 165, 364, 65),
        suggested: ['trainingDay.kcal', 'trainingDay.proteinG', 'trainingDay.carbG', 'trainingDay.fatG', 'restDay.kcal', 'restDay.proteinG', 'restDay.carbG', 'restDay.fatG'] },
    ],
  },
});

function win() {
  const dom = new JSDOM('<!doctype html><body><div id="area"></div></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
  dom.window.confirm = () => true;
  return dom.window;
}

describe('dashboard review', () => {
  const w = win();
  w.eval(read('coach/plan-import.js'));

  test('lists phases with weeks, marks suggested values, offers the PDF to the client', () => {
    const html = w.PlanImport.reviewHtml(importResult(), { fileName: 'plan.pdf', clientName: 'Client A' });
    const area = w.document.getElementById('area');
    area.innerHTML = html;
    const rows = [...area.querySelectorAll('.pi-table tbody tr')].map(tr => tr.textContent);
    expect(rows[0]).toMatch(/Cut\s*wk 1–12\s*Lose fat/);
    expect(rows[1]).toMatch(/Maintain\s*wk 13–15/);
    expect(area.querySelectorAll('.pi-table tbody tr:first-child mark').length).toBe(0);
    expect(area.querySelectorAll('.pi-table tbody tr:nth-child(2) mark').length).toBe(8);
    expect(area.textContent).toMatch(/8 values weren’t in the file/);
    expect(area.textContent).toMatch(/Maintenance gives one kcal figure/);
    expect(area.querySelector('#planImportAttach').checked).toBe(true);
    expect(area.textContent).toMatch(/Show this PDF to Client A/);
    expect(w.PlanImport.reviewHtml(importResult(false), {})).not.toContain('planImportAttach');
  });

  test('draft body carries the reviewed plan, and the PDF only when chosen', () => {
    const base = { result: importResult(), fileName: 'plan.pdf', data: 'JVBERi0=', clientUid: 'u1', startDate: '2026-11-09', tier: 'medium' };
    expect(w.PlanImport.draftBody({ ...base, attach: true })).toEqual({ clientUid: 'u1', imported: base.result.plan, fileName: 'plan.pdf', startDate: '2026-11-09', tier: 'medium', attachment: { fileName: 'plan.pdf', data: 'JVBERi0=' } });
    expect(w.PlanImport.draftBody({ ...base, attach: false }).attachment).toBeUndefined();
    expect(w.PlanImport.draftBody({ ...base, result: importResult(false), attach: true }).attachment).toBeUndefined();
  });
});

test('editor marks imported suggestions until they are changed', () => {
  const w = win();
  w.eval(read('src/js/program-model.js'));
  w.eval(read('coach/plan-editor.js'));
  const plan = {
    schema: 'pocketcoach.plan/2', planId: 'p', status: 'draft', startDate: '2026-11-09',
    phases: [{ phaseId: 'ph1', type: 'maintain', weeks: 3, startWeek: 1, endCriteria: { any: [] }, training: { programRef: null },
      nutrition: { trainingDay: d(2700, 165, 364, 65), restDay: d(2700, 165, 364, 65), suggested: ['restDay.carbG'] } }],
  };
  const area = w.document.getElementById('area');
  w.PlanEditor.mount(area, plan, { programs: [], onSave: async () => {} });
  const carbs = () => area.querySelector('[data-dt="restDay"][data-k="carbG"]');
  expect(carbs().classList.contains('is-suggested')).toBe(true);
  expect(area.querySelector('[data-dt="trainingDay"][data-k="carbG"]').classList.contains('is-suggested')).toBe(false);
  carbs().value = '350';
  carbs().dispatchEvent(new w.Event('input', { bubbles: true }));
  expect(carbs().classList.contains('is-suggested')).toBe(false);
});

describe('client: plan document', () => {
  const pp = require('../src/js/plan-preview');
  const plan = {
    schema: 'pocketcoach.plan/2', status: 'published', startDate: '2026-11-09', package: { name: 'Plan' }, notes: 'Protein high every day.',
    attachment: { fileId: 'pf_1', fileName: 'plan.pdf', mime: 'application/pdf', size: 10 },
    phases: [{ phaseId: 'ph1', type: 'cut', weeks: 1, startWeek: 1, plannedStart: '2026-11-09', plannedEnd: '2026-11-15', endCriteria: { any: [] }, nutrition: { trainingDay: d(2350, 165, 275, 65), restDay: d(2000, 165, 190, 65) }, training: {} }],
  };

  test('My Plan shows the coach notes and an Open button; the coach sees the attachment name', () => {
    const client = pp.render(plan, { today: '2026-11-10' });
    expect(client).toContain('data-plan-file="pf_1"');
    expect(client).toContain('From your coach:</strong> Protein high every day.');
    const coach = pp.render(plan, { coachView: true, today: '2026-11-10' });
    expect(coach).toContain('Attached for the client: <strong>plan.pdf</strong>');
    expect(coach).not.toContain('data-plan-file');
  });

  function appWindow({ native = false } = {}) {
    const w = win();
    w.localStorage.setItem('token', 't');
    w.SERVER_URL = 'https://api.test';
    w.showToast = jest.fn();
    w.URL.createObjectURL = () => 'blob:pdf';
    if (native) {
      w.Capacitor = { isNativePlatform: () => true };
      Object.defineProperty(w.navigator, 'share', { value: jest.fn(async () => {}), configurable: true });
      Object.defineProperty(w.navigator, 'canShare', { value: () => true, configurable: true });
    }
    w.eval(read('src/js/my-plan.js'));
    return w;
  }
  const pdfReply = async (url, init) => ({ ok: true, json: async () => ({ file: { fileName: 'plan.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.7').toString('base64') }, url, auth: init.headers.Authorization }) });

  test('browser: opens the PDF in a new tab', async () => {
    const w = appWindow();
    const tab = { location: { href: '' }, close: jest.fn() };
    w.open = jest.fn(() => tab);
    let asked;
    await w.MyPlan.openPlanFile('pf_1', { fetchFn: async (url, init) => { asked = [url, init.headers.Authorization]; return pdfReply(url, init); } });
    expect(asked).toEqual(['https://api.test/api/client/plan/file/pf_1', 'Bearer t']);
    expect(tab.location.href).toBe('blob:pdf');
  });

  test('in the app: the share sheet with the PDF file', async () => {
    const w = appWindow({ native: true });
    await w.MyPlan.openPlanFile('pf_1', { fetchFn: pdfReply });
    const arg = w.navigator.share.mock.calls[0][0];
    expect(arg.files[0].name).toBe('plan.pdf');
    expect(arg.files[0].type).toBe('application/pdf');
  });

  test('a failure shows a message and closes the empty tab', async () => {
    const w = appWindow();
    const tab = { location: { href: '' }, close: jest.fn() };
    w.open = () => tab;
    await w.MyPlan.openPlanFile('pf_1', { fetchFn: async () => ({ ok: false, json: async () => ({ error: { message: 'File not found.' } }) }) });
    expect(tab.close).toHaveBeenCalled();
    expect(w.showToast).toHaveBeenCalledWith('File not found.', 'warn');
  });
});

test('upload core: plan import path and plan response', async () => {
  const IC = require('../src/js/program-import-core');
  let url;
  const out = await IC.upload({ name: 'plan.pdf', size: 10 }, { serverUrl: 'https://api.test', data: 'AA', path: '/api/ai/coach/import-plan', fetchFn: async u => { url = u; return { ok: true, status: 200, json: async () => ({ plan: { phases: [] } }) }; } });
  expect(url).toBe('https://api.test/api/ai/coach/import-plan');
  expect(out.plan).toBeTruthy();
});
