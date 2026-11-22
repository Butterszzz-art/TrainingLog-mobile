// coach/program-builder.js — "Compress" and the superset column (BU Time-efficient training).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function setup(program) {
  const dom = new JSDOM('<!doctype html><body><div id="area"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.confirm = () => true;
  ['src/js/program-model.js', 'exerciseMuscleMap.js', 'src/js/time-budget-core.js', 'coach/time-efficiency.js', 'coach/program-builder.js']
    .forEach(f => w.eval(read(f)));
  const area = w.document.getElementById('area');
  const saved = [];
  const api = w.ProgramBuilder.mount(area, program, { onSave: async p => { saved.push(JSON.parse(JSON.stringify(p))); } });
  const $ = sel => area.querySelector(sel);
  const $$ = sel => [...area.querySelectorAll(sel)];
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const flush = () => new Promise(r => setTimeout(r, 0));
  return { w, api, saved, $, $$, click, flush };
}

const row = (name, sets, type) => Object.assign({ name, sets, repsMin: 8, restSec: 120 }, type ? { type } : {});
const day = () => ({ dayId: 'd1', weekday: 1, label: 'Full A', exercises: [
  row('Hack Squat', 3, 'compound'), row('Incline DB Press', 3), row('Leg Curl', 3),
  row('Chest Supported Row', 3), row('Overhead Cable Triceps Extension', 3), row('Lateral Raise', 4),
] });
const program = { schema: 'pocketcoach.program/2', name: 'Busy block', weeks: [{ week: 1, days: [day()] }, { week: 2, days: [day()] }] };

test('Compress pairs the day into supersets in every week and reports the time saved', async () => {
  const { $, $$, click, flush, saved } = setup(program);
  const btn = $('[data-act="compress-day"]');
  expect(btn.textContent).toMatch(/Compress · ~\d+ min/);
  click(btn);
  expect($('.pb-msg').textContent).toMatch(/Supersets: Incline DB Press \+ Chest Supported Row, Leg Curl \+ Overhead Cable Triceps Extension\. Full A ~\d+ → ~\d+ min, every week/);
  expect($$('.pb-row [data-f="name"]').map(i => i.value)).toEqual(['Hack Squat', 'Incline DB Press', 'Chest Supported Row', 'Leg Curl', 'Overhead Cable Triceps Extension', 'Lateral Raise']);
  expect($$('.pb-row [data-f="superset"]').map(s => s.value)).toEqual(['', 'A', 'A', 'B', 'B', '']);
  click($('[data-act="save"]'));
  await flush();
  const w2 = saved[0].weeks[1].days[0].exercises;
  expect(w2.filter(e => e.superset === 'A').map(e => e.name)).toEqual(['Incline DB Press', 'Chest Supported Row']);
});

test('the SS column sets and clears a superset letter', () => {
  const { w, $$, api } = setup(program);
  const sel = $$('.pb-row [data-f="superset"]')[5];
  sel.value = 'C';
  sel.dispatchEvent(new w.Event('input', { bubbles: true }));
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  expect(api.getProgram().weeks[0].days[0].exercises[5].superset).toBe('C');
  const again = $$('.pb-row [data-f="superset"]')[5];
  again.value = '';
  again.dispatchEvent(new w.Event('change', { bubbles: true }));
  expect(api.getProgram().weeks[0].days[0].exercises[5].superset).toBeUndefined();
});
