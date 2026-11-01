// coach/plan-editor.js — phases, programs and training/rest-day nutrition,
// turned into one batch of ops for PATCH /api/coach/plans/:id.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const MODEL = fs.readFileSync(path.join(__dirname, '../src/js/program-model.js'), 'utf8');
const EDITOR = fs.readFileSync(path.join(__dirname, '../coach/plan-editor.js'), 'utf8');

const nutr = (kcal, p, c, f) => ({ kcal, proteinG: p, carbG: c, fatG: f });
// A draft generated from an intake with the Cut Cycle package (12/4/12/4), anonymised.
function cutCycleDraft() {
  const phase = (id, type, weeks, startWeek, n) => ({
    phaseId: id, type, weeks, startWeek, goalText: '',
    plannedStart: '', plannedEnd: '',
    endCriteria: { any: type === 'cut' ? [{ kind: 'target', metric: 'bodyweightKg7dAvg', op: '<=', value: null }, { kind: 'timeCap', weeks }] : [{ kind: 'timeCap', weeks }] },
    nutrition: { source: 'generated', trainingDay: n, restDay: n }, training: { programRef: null },
  });
  return {
    schema: 'pocketcoach.plan/2', planId: 'pln_x', status: 'draft', version: 1, startDate: '2026-11-09',
    package: { name: 'Cut Cycle' },
    phases: [phase('ph1', 'cut', 12, 1, nutr(2400, 150, 280, 70)), phase('ph2', 'maintain', 4, 13, nutr(2800, 150, 380, 70)),
      phase('ph3', 'cut', 12, 17, nutr(2400, 150, 280, 70)), phase('ph4', 'maintain', 4, 29, nutr(2800, 150, 380, 70))],
  };
}
const library = [{ id: 'prog_xframe', name: 'X-frame', schema: 'pocketcoach.program/2', weeks: [1, 2, 3, 4].map(() => ({ days: [{ weekday: 1, label: 'Lower A', exercises: [{ name: 'Hack squat', sets: 2, repsMin: 6, repsMax: 10, rir: 3 }] }] })) }];

function load() {
  const dom = new JSDOM('<!doctype html><body><div id="area"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.confirm = () => true;
  w.eval(MODEL);
  w.eval(EDITOR);
  return w;
}

test('suggestCarbs and kcal from grams', () => {
  const { PlanEditor: E } = load();
  expect(E.suggestCarbs({ kcal: 2700, proteinG: 165, fatG: 65 })).toBe(364);
  expect(E.kcalFromGrams(nutr(2350, 165, 275, 65))).toBe(2345);
  expect(E.suggestCarbs({ kcal: 2700, proteinG: null, fatG: 65 })).toBeNull();
});

test('diffOps: Cut Cycle reshaped to 12/3/1 with nutrition and a program per phase', () => {
  const { PlanEditor: E } = load();
  const plan = cutCycleDraft();
  const s = E.stateFrom(plan);
  s.phases.pop(); // ph4
  s.phases[1].weeks = 3;
  s.phases[2].type = 'deload';
  s.phases[2].weeks = 1;
  s.phases[0].nutrition = { trainingDay: nutr(2350, 165, 275, 65), restDay: nutr(2000, 165, 190, 65) };
  s.phases[1].nutrition = { trainingDay: nutr(2700, 165, 364, 65), restDay: nutr(2700, 165, 364, 65) };
  s.phases[2].nutrition = { trainingDay: nutr(2700, 165, 364, 65), restDay: nutr(2700, 165, 364, 65) };
  s.phases[0].programRef = { programId: 'prog_xframe', weekOffset: 0 };
  s.phases[1].programRef = { programId: 'prog_xframe', weekOffset: 12 };
  s.phases[2].programRef = { programId: 'prog_xframe', weekOffset: 15 };
  expect(E.diffOps(plan, s)).toEqual([
    { op: 'removePhase', phaseId: 'ph4' },
    { op: 'setNutrition', phaseId: 'ph1', dayType: 'trainingDay', ...nutr(2350, 165, 275, 65) },
    { op: 'setNutrition', phaseId: 'ph1', dayType: 'restDay', ...nutr(2000, 165, 190, 65) },
    { op: 'linkProgram', phaseId: 'ph1', programId: 'prog_xframe', weekOffset: 0 },
    { op: 'setPhase', phaseId: 'ph2', weeks: 3 },
    { op: 'setNutrition', phaseId: 'ph2', dayType: 'trainingDay', ...nutr(2700, 165, 364, 65) },
    { op: 'setNutrition', phaseId: 'ph2', dayType: 'restDay', ...nutr(2700, 165, 364, 65) },
    { op: 'linkProgram', phaseId: 'ph2', programId: 'prog_xframe', weekOffset: 12 },
    { op: 'setPhase', phaseId: 'ph3', type: 'deload', weeks: 1 },
    { op: 'setNutrition', phaseId: 'ph3', dayType: 'trainingDay', ...nutr(2700, 165, 364, 65) },
    { op: 'setNutrition', phaseId: 'ph3', dayType: 'restDay', ...nutr(2700, 165, 364, 65) },
    { op: 'linkProgram', phaseId: 'ph3', programId: 'prog_xframe', weekOffset: 15 },
  ]);
  expect(E.diffOps(plan, E.stateFrom(plan))).toEqual([]);
});

test('diffOps: added phases are named and moved into place; start date; unlink', () => {
  const { PlanEditor: E } = load();
  const plan = cutCycleDraft();
  plan.phases[0].training.programRef = { programId: 'prog_xframe', weekOffset: 0, name: 'X-frame' };
  const s = E.stateFrom(plan);
  s.startDate = '2026-11-16';
  s.phases.splice(1, 0, { phaseId: 'ph_new', isNew: true, type: 'deload', weeks: 1, goalText: '', nutrition: { trainingDay: nutr(2600, 150, 350, 65), restDay: nutr(2600, 150, 350, 65) }, programRef: null });
  s.phases[0].programRef = null;
  const ops = E.diffOps(plan, s);
  expect(ops[0]).toEqual({ op: 'setStart', startDate: '2026-11-16' });
  expect(ops).toContainEqual({ op: 'addPhase', phaseId: 'ph_new', type: 'deload', weeks: 1, goalText: '' });
  expect(ops).toContainEqual({ op: 'movePhase', phaseId: 'ph_new', toIndex: 1 });
  expect(ops).toContainEqual({ op: 'linkProgram', phaseId: 'ph1', programId: null });
  expect(ops).toContainEqual({ op: 'linkProgram', phaseId: 'ph_new', programId: null });
  expect(ops.filter(o => o.phaseId === 'ph_new' && o.op === 'setNutrition')).toHaveLength(2);
  const add = ops.findIndex(o => o.op === 'addPhase');
  expect(ops.findIndex(o => o.op === 'movePhase')).toBeGreaterThan(add);
});

test('target weight edits become logged path changes on the saved index', () => {
  const { PlanEditor: E } = load();
  const plan = cutCycleDraft();
  const s = E.stateFrom(plan);
  s.phases[2].targetKg = 78.5;
  expect(E.diffChanges(plan, s, 'why')).toEqual([{ path: 'phases[2].endCriteria.any[0].value', value: 78.5, reason: 'why' }]);
});

test('warnings: missing nutrition, grams ≠ kcal, program shorter than the phase', () => {
  const { PlanEditor: E } = load();
  const s = E.stateFrom(cutCycleDraft());
  s.phases[0].nutrition.restDay = nutr(null, null, null, null);
  s.phases[0].nutrition.trainingDay = nutr(2350, 165, 200, 65);
  s.phases[0].programRef = { programId: 'prog_xframe', weekOffset: 0 };
  const w = E.phaseWarnings(s.phases[0], library);
  expect(w).toEqual([
    'Training day: the grams add up to 2045 kcal, not 2350.',
    'Rest day: fill in kcal, protein, carbs and fat before publishing.',
    'X-frame has 4 weeks; this phase runs to program week 12. Until you add weeks, week 4 repeats.',
  ]);
});

test('mounted: edit, suggest carbs, add a phase, reason required, save sends ops', async () => {
  const w = load();
  const area = w.document.getElementById('area');
  const saves = [];
  w.PlanEditor.mount(area, cutCycleDraft(), { programs: library, onSave: async (batch, reason) => { saves.push({ batch, reason }); } });
  const q = s => area.querySelector(s);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const set = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };

  expect(area.querySelectorAll('.pe-phase')).toHaveLength(4);
  expect(q('.pe-phase .pe-dates').textContent).toMatch(/Weeks 1–12/);
  expect(q('[data-act="save"]').disabled).toBe(true);

  set(q('[data-i="1"][data-dt="trainingDay"][data-k="kcal"]'), '2700');
  set(q('[data-i="1"][data-dt="trainingDay"][data-k="proteinG"]'), '165');
  set(q('[data-i="1"][data-dt="trainingDay"][data-k="fatG"]'), '65');
  click(q('[data-act="carbs"][data-i="1"][data-dt="trainingDay"]'));
  expect(q('[data-i="1"][data-dt="trainingDay"][data-k="carbG"]').value).toBe('364');
  click(q('[data-act="same"][data-i="1"]'));
  expect(q('[data-i="1"][data-dt="restDay"][data-k="carbG"]').value).toBe('364');

  set(q('[data-i="0"][data-f="programId"]'), 'prog_xframe');
  expect(q('.pe-phase .pe-warn').textContent).toMatch(/X-frame has 4 weeks/);

  set(q('[data-new="weeks"]'), '1');
  set(q('[data-new="type"]'), 'deload');
  click(q('[data-act="add"]'));
  expect(area.querySelectorAll('.pe-phase')).toHaveLength(5);
  expect(area.querySelectorAll('.pe-phase')[4].querySelector('.pe-dates').textContent).toMatch(/Weeks 33–33/);

  click(q('[data-act="save"]'));
  await new Promise(r => setTimeout(r, 0));
  expect(saves).toHaveLength(0);
  expect(q('.pb-msg').textContent).toMatch(/Give a reason/);

  const reason = q('[data-f="reason"]');
  reason.value = 'Maintenance numbers agreed';
  reason.dispatchEvent(new w.Event('input', { bubbles: true }));
  click(q('[data-act="save"]'));
  await new Promise(r => setTimeout(r, 0));
  expect(saves).toHaveLength(1);
  expect(saves[0].reason).toBe('Maintenance numbers agreed');
  const ops = saves[0].batch.ops;
  expect(ops).toContainEqual({ op: 'setNutrition', phaseId: 'ph2', dayType: 'trainingDay', ...nutr(2700, 165, 364, 65) });
  expect(ops).toContainEqual({ op: 'linkProgram', phaseId: 'ph1', programId: 'prog_xframe', weekOffset: 0 });
  expect(ops.find(o => o.op === 'addPhase')).toMatchObject({ type: 'deload', weeks: 1 });
});

test('a published plan is read-only', () => {
  const w = load();
  const area = w.document.getElementById('area');
  w.PlanEditor.mount(area, { ...cutCycleDraft(), status: 'published' }, { programs: library, onSave: async () => {} });
  expect(area.querySelector('[data-act="save"]')).toBeNull();
  expect(area.querySelector('[data-i="0"][data-f="weeks"]').disabled).toBe(true);
  expect(area.textContent).toMatch(/Make a new version/);
});
