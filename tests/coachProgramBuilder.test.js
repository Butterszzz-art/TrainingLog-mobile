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

const fourDays = {
  schema: 'pocketcoach.program/2', name: 'Block test',
  weeks: [{ days: [{ dayId: 'd1', weekday: 1, label: 'Lower', exercises: [
    { name: 'Squat', type: 'compound', sets: 3, repsMin: 6, repsMax: 8, rir: 3, loadPct: 70 },
  ] }] }],
};

test('+ Mesocycle turns a one-week program into a block, then Progression fills it', async () => {
  const { $, $$, click, type, flush, saved } = setup(fourDays);
  click($('[data-act="meso-open"]'));
  type($('[data-pp="name"]'), 'Accumulation');
  type($('[data-pp="weeks"]'), '4');
  type($('[data-pp="goal"]'), 'Volume up', false);
  click($('[data-act="meso-create"]'));
  expect($$('.pb-tab')).toHaveLength(4);
  expect($('.pb-run-head').textContent).toBe('Accumulation W1–4');
  expect($('.pb-tab.is-active').textContent).toBe('W1');
  expect($$('.pb-tab')[3].classList.contains('is-deload')).toBe(true);
  // The progression panel opens for the new block.
  expect($('[data-panel="progress"]')).not.toBeNull();
  // First block: volume held at MEV, reps go up each week up to the coach's rep limit.
  expect($('[data-pp="volume"]').value).toBe('mev');
  expect($('[data-pp="repsPerWeek"]').value).toBe('1');
  type($('[data-pp="limitCompound"]'), '4-9');
  const apply = $('[data-act="progress-apply"]');
  type($('[data-pp="pctPerWeek"]'), '2.5'); // commit, then click the same button
  expect(apply.isConnected).toBe(true);
  click(apply);
  // A second block is appended after the first.
  click($('[data-act="meso-open"]'));
  type($('[data-pp="name"]'), 'Intensification');
  type($('[data-pp="weeks"]'), '2');
  // It starts from the first week of the block before, load a step up.
  expect($('[data-pp="from"]').selectedOptions[0].textContent).toBe('Copy of W1');
  expect($('[data-pp="pctUp"]').value).toBe('2.5');
  click($('[data-act="meso-create"]'));
  expect($$('.pb-tab')).toHaveLength(6);
  // …and its progression steps the volume up from the block before.
  expect($('[data-pp="volume"]').value).toBe('step');
  expect($('[data-pp="setsStep"]').value).toBe('2');
  expect($('[data-pp="limitCompound"]').value).toBe('4-9'); // the limit carries over
  type($('[data-pp="limitIsolation"]'), '12');
  click($('[data-act="progress-apply"]'));
  expect($('.pb-msg').textContent).toBe('Write the isolation rep limit as low-high, e.g. 4-8.');
  type($('[data-pp="limitIsolation"]'), '');
  click($('[data-act="save"]'));
  await flush();
  const p = saved[0];
  expect(p.blocks.map(b => b.name)).toEqual(['Accumulation', 'Intensification']);
  expect(p.blocks[0].goal).toBe('Volume up');
  expect(p.weeks.map(w => w.block)).toEqual(['b1', 'b1', 'b1', 'b1', 'b2', 'b2']);
  const sq = n => p.weeks[n - 1].days[0].exercises[0];
  expect([1, 2, 3].map(n => sq(n).sets)).toEqual([3, 3, 3]); // held within the block
  expect([1, 2, 3].map(n => [sq(n).repsMin, sq(n).repsMax])).toEqual([[6, 8], [7, 9], [7, 9]]); // held at the 4-9 limit
  expect([1, 2, 3].map(n => sq(n).rir)).toEqual([3, 2, 1]);
  expect([1, 2, 3].map(n => sq(n).loadPct)).toEqual([70, 72.5, 75]);
  expect(p.weeks[3].deload).toBe(true);
  expect(sq(4)).toMatchObject({ sets: 2, rir: 5, loadPct: 62.5 });
  // The next block starts over at W1's reps with the load a step up.
  expect(sq(5)).toMatchObject({ sets: 3, repsMin: 6, repsMax: 8, loadPct: 72.5 });
});

test('Sheet view edits a week cell in place and adds an exercise to every week', async () => {
  const { $, $$, click, type, enter, flush, saved } = setup(fourDays);
  click($('[data-act="copy-week"]'));
  click($('[data-act="view-sheet"]'));
  const cells = $$('.pb-cell');
  expect(cells.map(c => c.value)).toEqual(['3×6-8 @3 70%', '3×6-8 @3 70%']);
  type(cells[1], '4x5 @1 80%');
  expect(cells[1].value).toBe('4×5 @1 80%');
  expect($('.pb-sheet-total').textContent).toBe('Total sets34');
  const add = $('[data-sadd="d1"]');
  add.value = 'Leg curl 2x12 @2';
  enter(add);
  expect($$('.pb-sheet [data-sn]').map(i => i.value)).toEqual(['Squat', 'Leg curl']);
  type($$('.pb-cell')[2], ''); // drop leg curl from week 1
  click($('[data-act="save"]'));
  await flush();
  const p = saved[0];
  expect(p.weeks[1].days[0].exercises[0]).toMatchObject({ sets: 4, repsMin: 5, repsMax: null, rir: 1, loadPct: 80 });
  expect(p.weeks[0].days[0].exercises.map(e => e.name)).toEqual(['Squat']);
  expect(p.weeks[1].days[0].exercises.map(e => e.name)).toEqual(['Squat', 'Leg curl']);
});

test('week settings: deload toggle; CSV export lists every week', () => {
  const { w, $, click, api } = setup(fourDays);
  click($('[data-act="copy-week"]'));
  const box = $('[data-wf="deload"]');
  box.checked = true;
  box.dispatchEvent(new w.Event('change', { bubbles: true }));
  expect(api.getProgram().weeks[1].deload).toBe(true);
  const csv = w.ProgramBuilder.toCsv(api.getProgram());
  const lines = csv.trim().split('\r\n');
  expect(lines[0]).toBe('Block,Week,Day,Exercise,Sets,Reps,RIR,Load,Rest,Notes');
  expect(lines[2]).toBe(',Week 2 (deload),Mon - Lower,Squat,3,6-8,3,70%,,');
});

const MUSCLE_MAP = fs.readFileSync(path.join(__dirname, '../exerciseMuscleMap.js'), 'utf8');

test('Volume: chips per muscle, Muscle column, editable MEV/MAV/MRV; MEV block, then a block 2 sets up', async () => {
  const t = setup({
    schema: 'pocketcoach.program/2', name: 'Legs',
    weeks: [{ days: [{ dayId: 'd1', weekday: 1, label: 'Lower', exercises: [
      { name: 'Back squat', sets: 4, repsMin: 6, repsMax: 8, rir: 3 },
      { name: 'Lying leg curl', sets: 3, repsMin: 10, repsMax: 12, rir: 2 },
      { name: 'Farmer walk', sets: 2, repsMin: 1, rir: null, type: 'core' },
    ] }] }, { sameAs: 1 }, { sameAs: 1 }, { sameAs: 1 }],
  });
  const { w, $, $$, click, type, flush, saved, api } = t;
  w.eval(MUSCLE_MAP);
  api.refresh();
  const chips = () => $$('.pb-volchip').map(c => c.textContent);
  expect(chips()).toContain('Quads 4/20');
  expect(chips()).toContain('Hamstrings 3/20');
  // The Muscle column shows the guess and can override it.
  const farmer = $$('.pb-row')[2].querySelector('[data-f="muscle"]');
  expect(farmer.options[0].textContent).toMatch(/^Auto · /);
  type(farmer, 'traps');
  expect(chips()).toContain('Traps 2/26');

  // Volume view: edit landmarks; cells take the zone colour.
  click($('[data-act="view-volume"]'));
  expect($$('.pb-vol tbody tr').map(r => r.cells[0].textContent.trim())).toEqual(['Traps', 'Quads', 'Hamstrings']);
  const quadsMev = $('[data-lm="quads"][data-lk="mev"]');
  type(quadsMev, '6');
  expect($('[data-vcell="quads|1"] .pb-vz').className).toContain('pb-vz--below');
  type(quadsMev, '4');
  expect($('[data-vcell="quads|1"] .pb-vz').className).toContain('pb-vz--productive');

  click($('[data-act="view-week"]'));
  click($('[data-act="progress-open"]'));
  // No block before W1: the only choices are MEV and keeping W1's sets.
  expect(Array.from($('[data-pp="volume"]').options).map(o => o.value)).toEqual(['mev', 'keep']);
  click($('[data-act="progress-apply"]'));
  expect($('.pb-msg').textContent).toBe('Filled W1–W4.');
  // A second mesocycle: +2 sets per muscle, held; a one-row muscle past the cap stops short.
  click($('[data-act="meso-open"]'));
  type($('[data-pp="weeks"]'), '3');
  click($('[data-act="meso-create"]'));
  type($('[data-pp="setsMax"]'), '7');
  click($('[data-act="progress-apply"]'));
  expect($('.pb-msg').textContent).toMatch(/Hamstrings 7\/8 stop short of the block's sets/);
  click($('[data-act="save"]'));
  await flush();
  const p = saved[0];
  expect(p.volume).toEqual({ quads: { mev: 4, mav: 15, mrv: 20 } });
  expect(p.weeks[0].days[0].exercises[2].muscle).toBe('traps');
  const sets = n => p.weeks[n - 1].days[0].exercises.map(e => e.sets);
  // Block 1 at MEV every week (quads 4, hamstrings 6, traps 4), deload halves it.
  expect([1, 2, 3].map(sets)).toEqual([[4, 6, 4], [4, 6, 4], [4, 6, 4]]);
  expect(p.weeks[3].deload).toBe(true);
  expect(sets(4)).toEqual([2, 3, 2]);
  // Block 2 = block 1 + 2 a muscle, the same every week; reps start over.
  expect([5, 6].map(sets)).toEqual([[6, 7, 6], [6, 7, 6]]);
  expect(p.weeks[6].deload).toBe(true);
  expect([1, 2, 3, 5, 6].map(n => p.weeks[n - 1].days[0].exercises[0].repsMin)).toEqual([6, 7, 8, 6, 7]);
});
