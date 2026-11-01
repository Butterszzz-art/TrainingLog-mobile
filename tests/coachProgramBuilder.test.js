// coach/program-builder.js — the dashboard's week-tab program builder.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const MODEL = fs.readFileSync(path.join(__dirname, '../src/js/program-model.js'), 'utf8');
const BUILDER = fs.readFileSync(path.join(__dirname, '../coach/program-builder.js'), 'utf8');

function setup(program) {
  const dom = new JSDOM('<!doctype html><body><div id="area"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.confirm = () => true;
  w.eval(MODEL);
  w.eval(BUILDER);
  const area = w.document.getElementById('area');
  const saved = [];
  const api = w.ProgramBuilder.mount(area, program, { onSave: async p => { saved.push(JSON.parse(JSON.stringify(p))); } });
  const $ = sel => area.querySelector(sel);
  const $$ = sel => [...area.querySelectorAll(sel)];
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const type = (el, value, commit = true) => {
    el.value = value;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    if (commit) el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const enter = el => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const flush = () => new Promise(r => setTimeout(r, 0));
  return { w, area, api, saved, $, $$, click, type, enter, flush };
}

const v1 = { id: 'p1', name: 'Old split', days: { Mon: [{ name: 'Squat', sets: 4, reps: 6, repsMax: 8 }], Thu: ['Bench'] } };

test('an old single-week program opens as week 1 with its rows', () => {
  const { $$ } = setup(v1);
  expect($$('.pb-tab')).toHaveLength(1);
  expect($$('.pb-day')).toHaveLength(2);
  expect($$('.pb-day')[0].querySelector('[data-f="weekday"]').value).toBe('1');
  expect($$('.pb-row [data-f="name"]').map(i => i.value)).toEqual(['Squat', 'Bench']);
});

test('quick entry fills a row; copy week → next; RIR per week; save sends program/2', async () => {
  const { $, $$, click, type, enter, flush, saved, api } = setup(v1);
  const quick = $('[data-quick="0"]');
  quick.value = 'Cable lateral raise 4x10-20 @3 1-2min';
  enter(quick);
  const rows = $$('.pb-day')[0].querySelectorAll('.pb-row');
  expect(rows).toHaveLength(2);
  const r = rows[1];
  expect(r.querySelector('[data-f="name"]').value).toBe('Cable lateral raise');
  expect(r.querySelector('[data-f="type"]').value).toBe('isolation');
  expect(r.querySelector('[data-f="sets"]').value).toBe('4');
  expect(r.querySelector('[data-f="rir"]').value).toBe('3');
  expect(r.querySelector('[data-f="rest"]').value).toBe('1–2 min');

  click($('[data-act="copy-week"]'));
  expect($$('.pb-tab')).toHaveLength(2);
  expect($('.pb-tab.is-active').textContent).toBe('W2');
  const w2row = $$('.pb-day')[0].querySelectorAll('.pb-row')[1];
  type(w2row.querySelector('[data-f="rir"]'), '2');
  type(w2row.querySelector('[data-f="lastSetRir"]'), '1');
  type(w2row.querySelector('[data-f="rest"]'), '90s');

  click($('[data-act="save"]'));
  await flush();
  expect(saved).toHaveLength(1);
  const p = saved[0];
  expect(p.schema).toBe('pocketcoach.program/2');
  expect(p.weeks).toHaveLength(2);
  expect(p.weeks[0].days[0].exercises[1]).toMatchObject({ rir: 3, lastSetRir: null, restSec: 60, restSecMax: 120 });
  expect(p.weeks[1].days[0].exercises[1]).toMatchObject({ rir: 2, lastSetRir: 1, restSec: 90, restSecMax: null });
  expect(api.getProgram().weeks).toHaveLength(2);
});

test('typing a row does not re-render (focus stays); warnings update in place', () => {
  const { $, $$, type, w } = setup(v1);
  const name = $$('.pb-row [data-f="name"]')[0];
  name.focus();
  const rir = $$('.pb-row [data-f="rir"]')[0];
  type(rir, '2');
  expect($$('.pb-row [data-f="name"]')[0]).toBe(name); // same node
  // Bench has no RIR → warned; Squat now has one.
  expect($$('.pb-row')[0].classList.contains('is-warned')).toBe(false);
  expect($$('.pb-row')[1].classList.contains('is-warned')).toBe(true);
  expect($('.pb-warn').textContent).toMatch(/Bench: no target RIR/);
  expect(w.document.activeElement).toBe(name);
});

test('weekday change re-sorts days; delete week renumbers; reorder rows', () => {
  const { $, $$, click, type } = setup(v1);
  type($$('.pb-day')[0].querySelector('[data-f="weekday"]'), '6'); // Squat day → Sat
  expect($$('.pb-day').map(d => d.querySelector('[data-f="weekday"]').value)).toEqual(['4', '6']);
  click($('[data-act="add-week"]'));
  click($('[data-act="add-week"]'));
  expect($$('.pb-tab').map(t => t.textContent)).toEqual(['W1', 'W2', 'W3']);
  click($$('.pb-tab')[1]);
  click($('[data-act="del-week"]'));
  expect($$('.pb-tab').map(t => t.textContent)).toEqual(['W1', 'W2']);
  click($$('.pb-tab')[0]);
  const quick = $('[data-quick="0"]');
  quick.value = 'Dips 3x8';
  quick.dispatchEvent(new quick.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  click($$('.pb-day')[0].querySelectorAll('[data-act="up"]')[1]);
  expect([...$$('.pb-day')[0].querySelectorAll('[data-f="name"]')].map(i => i.value)).toEqual(['Dips', 'Bench']);
});

test('save refuses an empty program', async () => {
  const { $, click, flush, saved } = setup({ schema: 'pocketcoach.program/2', name: 'Empty', weeks: [{ days: [] }] });
  click($('[data-act="save"]'));
  await flush();
  expect(saved).toHaveLength(0);
  expect($('.pb-msg').textContent).toMatch(/at least one exercise/);
});
