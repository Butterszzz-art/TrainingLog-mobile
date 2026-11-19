// The check-in tab's detailed sections (src/js/checkin-detail-form.js),
// run in a jsdom window the way index.html loads them.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function setup(saved) {
  const dom = new JSDOM('<div id="checkInDetailSections"></div>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.localStorage.setItem('activeProgram_ana', JSON.stringify({ programId: 'p1', startDate: '2026-11-01' }));
  w.localStorage.setItem('programs_ana', JSON.stringify([{ id: 'p1', days: [{}, {}, {}, {}] }]));
  w.checkinEngine = { loadCheckIns: () => saved || [] };
  ['src/js/checkin-detail.js', 'src/js/checkin-detail-form.js']
    .forEach(f => w.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
  return w;
}

const tap = (w, sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

test('renders a workload row per planned session and prefills the program week', () => {
  const w = setup();
  w.renderCheckInDetailForm('ana', { date: '2026-11-19', archetypeKeys: [] });
  const days = [...w.document.querySelectorAll('[data-day]')].map(el => el.dataset.day);
  expect(days).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4']);
  expect(w.document.querySelector('[data-detail="training.programWeek"]').value).toBe('Week 3');
  expect(w.document.querySelectorAll('[data-detail-choice^="training.recovery."]')).toHaveLength(10);
});

test('leaves out questions the archetype card already asks', () => {
  const w = setup();
  w.renderCheckInDetailForm('ana', { date: '2026-11-19', archetypeKeys: ['hunger', 'digestion', 'cardioAdherence', 'fatigue'] });
  const q = s => w.document.querySelector(`[data-detail-choice="${s}"]`);
  expect(q('nutrition.ratings.hunger')).toBeNull();
  expect(q('nutrition.ratings.appetite')).not.toBeNull();
  expect(q('training.cardioAdherence')).toBeNull();
  expect(q('lifestyle.physicalFatigue')).toBeNull();
});

test('reads taps and text back as a cleaned detail; a second tap clears', () => {
  const w = setup();
  w.renderCheckInDetailForm('ana', { date: '2026-11-19', archetypeKeys: [] });
  tap(w, '[data-detail-choice="training.recovery.quads"] [data-v="stillSore"]');
  tap(w, '[data-detail-choice="training.workload.Day 2"] [data-v="tooMuch"]');
  tap(w, '[data-detail-choice="training.pump"] [data-v="2"]');
  tap(w, '[data-detail-choice="nutrition.water"] [data-v="most"]');
  tap(w, '[data-detail-choice="nutrition.water"] [data-v="most"]');
  w.document.querySelector('[data-detail="training.jointPain"]').value = 'Left elbow';
  const d = w.readCheckInDetailForm();
  expect(d.training.recovery).toEqual({ quads: 'stillSore' });
  expect(d.training.workload).toEqual([{ day: 'Day 2', rating: 'tooMuch' }]);
  expect(d.training.pump).toBe(2);
  expect(d.training.jointPain).toBe('Left elbow');
  expect(d.nutrition).toBeUndefined();
});

test('fills in answers saved for the date and keeps typing across re-renders', () => {
  const w = setup([{ date: '2026-11-19', detail: { training: { recovery: { chest: 'day' } }, lifestyle: { peds: 'missed' } } }]);
  w.renderCheckInDetailForm('ana', { date: '2026-11-19', archetypeKeys: [] });
  expect(w.document.querySelector('[data-detail-choice="training.recovery.chest"] .on').dataset.v).toBe('day');
  expect(w.document.querySelector('.ci-detail-private').open).toBe(true);
  w.document.querySelector('[data-detail="lifestyle.otherFeedback"]').value = 'typed';
  w.renderCheckInDetailForm('ana', { date: '2026-11-19', archetypeKeys: [] });
  expect(w.document.querySelector('[data-detail="lifestyle.otherFeedback"]').value).toBe('typed');
});
