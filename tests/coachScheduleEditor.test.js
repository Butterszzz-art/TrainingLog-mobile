// coach/schedule-editor.js — one client's weeks: start date, repeat a week,
// a week off, saved as the client's programSchedule.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SCRIPTS = ['src/js/program-model.js', 'src/js/program-timeline.js', 'coach/schedule-editor.js'].map(read);

const ex = { name: 'Squat', sets: 3, repsMin: 6, rir: 2 };
const program = {
  schema: 'pocketcoach.program/2', name: 'Off-season',
  blocks: [{ id: 'b1', name: 'Accumulation', goal: '' }, { id: 'b2', name: 'Intensification', goal: '' }],
  weeks: [1, 2, 3, 4].map(n => ({ block: n <= 2 ? 'b1' : 'b2', deload: n === 2, days: [{ dayId: 'd1', weekday: 1, exercises: [ex] }, { dayId: 'd2', weekday: 4, exercises: [ex] }] })),
};

function setup(opts) {
  const dom = new JSDOM('<!doctype html><body><div id="el"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.confirm = () => true;
  SCRIPTS.forEach(s => w.eval(s));
  const el = w.document.getElementById('el');
  const saved = [];
  const api = w.ScheduleEditor.mount(el, Object.assign({ clientName: 'Ana', program, onSave: async s => { saved.push(JSON.parse(JSON.stringify(s))); } }, opts));
  const $ = sel => el.querySelector(sel);
  const $$ = sel => [...el.querySelectorAll(sel)];
  const click = node => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const rowAct = (i, act) => click($$('.se-row')[i].querySelector('[data-act="' + act + '"]'));
  const weeks = () => $$('.se-row .se-week .se-chip:first-child').map(c => c.textContent);
  return { w, el, api, saved, $, $$, click, rowAct, weeks, flush: () => new Promise(r => setTimeout(r, 0)) };
}

test('lists every week with its mesocycle and deload', () => {
  const { $$, weeks } = setup({});
  expect(weeks()).toEqual(['W1', 'W2', 'W3', 'W4']);
  expect($$('.se-block').map(td => td.textContent)).toEqual(['Accumulation', 'Accumulation', 'Intensification', 'Intensification']);
  expect($$('.se-chip--deload')).toHaveLength(1);
});

test('repeat a week and put in a week off; notes; save sends the schedule', async () => {
  const { $, $$, rowAct, weeks, click, saved, w, flush } = setup({});
  rowAct(1, 'repeat'); // W2 again right after W2
  expect(weeks()).toEqual(['W1', 'W2', 'W2 again', 'W3', 'W4']);
  rowAct(3, 'pause'); // a week off before W3
  expect(weeks()).toEqual(['W1', 'W2', 'W2 again', 'Week off', 'W3', 'W4']);
  rowAct(2, 'pause'); // and one before the repeat
  expect(weeks()).toEqual(['W1', 'W2', 'Week off', 'W2 again', 'Week off', 'W3', 'W4']);
  rowAct(2, 'remove');
  expect(weeks()).toEqual(['W1', 'W2', 'W2 again', 'Week off', 'W3', 'W4']);
  const note = $$('[data-note]')[1];
  note.value = 'Holiday';
  note.dispatchEvent(new w.Event('input', { bubbles: true }));
  const start = $('[data-start]');
  start.value = '2026-11-02';
  start.dispatchEvent(new w.Event('change', { bubbles: true }));
  expect($$('.se-date')[3].textContent).toMatch(/23 Nov|Nov 23/);
  click($('[data-act="save"]'));
  await flush();
  expect(saved).toHaveLength(1);
  expect(saved[0].startDate).toBe('2026-11-02');
  expect(saved[0].changes.map(c => [c.kind, c.afterWeek, c.note])).toEqual([['repeat', 2, ''], ['pause', 2, 'Holiday']]);
  expect($('.pb-msg').textContent).toMatch(/Saved/);
});

test('the Save button survives a start-date change (so the next click lands)', () => {
  const { $, w } = setup({});
  const save = $('[data-act="save"]');
  const start = $('[data-start]');
  start.value = '2026-11-02';
  start.dispatchEvent(new w.Event('change', { bubbles: true }));
  expect(save.isConnected).toBe(true);
  expect($('[data-start]').value).toBe('2026-11-02');
});

test('uses the client\'s own start date when the coach set none; past weeks can\'t be changed', () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 14); // Monday two weeks ago
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const { $$, $ } = setup({ clientStart: { date: iso, sameProgram: true } });
  expect($('.se-summary').textContent).toMatch(/Ana started on/);
  expect($$('.se-row')[2].className).toContain('is-now');
  expect($$('.se-row')[0].className).toContain('is-past');
  expect($$('.se-row')[0].querySelector('[data-act]')).toBeNull();
  expect($$('.se-row')[2].querySelector('[data-act="pause"]')).not.toBeNull();
});

test('existing schedule loads; Undo all clears it and saves null', async () => {
  const { weeks, click, $, saved, flush } = setup({ schedule: { programId: 'p1', startDate: '', changes: [{ id: 'x', kind: 'pause', afterWeek: 1 }] } });
  expect(weeks()).toEqual(['W1', 'Week off', 'W2', 'W3', 'W4']);
  click($('[data-act="clear"]'));
  expect(weeks()).toEqual(['W1', 'W2', 'W3', 'W4']);
  click($('[data-act="save"]'));
  await flush();
  expect(saved).toEqual([null]);
});
