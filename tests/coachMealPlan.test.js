// Coach meal plans: the client's food log (src/js/coach-meals.js) and the
// dashboard planner (coach/meal-planner.js).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const food = (name, per100, servings = []) => ({ id: name.toLowerCase(), source: 'coach', name, brand: '', basis: 'g', per100, servings });
const oats = food('Oats', { kcal: 370, protein: 13, carbs: 60, fat: 7 });
const whey = food('Whey', { kcal: 370, protein: 90, carbs: 2, fat: 1 });
const eggs = food('Eggs', { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 });
const rice = food('Rice', { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 });
const meal = (id, name, items) => ({ id, name, note: '', items: items.map(([f, g]) => ({ food: f, grams: g, amount: g, unit: 'g' })) });
const mealPlan = {
  key: 'meals:abc', note: 'Swap breakfast if you prefer eggs.', sentAt: '2026-11-02T08:00:00Z',
  days: {
    training: { breakfast: [meal('m1', 'Oats & whey', [[oats, 80], [whey, 30]]), meal('m2', 'Eggs', [[eggs, 150]])], lunch: [meal('m3', 'Rice bowl', [[rice, 250]])] },
    rest: { breakfast: [meal('m2', 'Eggs', [[eggs, 150]])] },
  },
};

describe('coach meals: pure', () => {
  const CM = require('../src/js/coach-meals.js');
  require('../src/js/food-core.js');

  test('day type: published plan first, then the macro weekly pattern, else training', () => {
    expect(CM.dayTypeFor('2026-11-04', { macroSchedule: { wed: 'rest' } })).toBe('rest');
    expect(CM.dayTypeFor('2026-11-04', { macroSchedule: { wed: 'high' } })).toBe('training');
    expect(CM.dayTypeFor('2026-11-04', {})).toBe('training');
    require('../src/js/plan-preview');
    require('../src/js/plan-today');
    const plan = require('./fixtures/plan-v2-published.json'); // Mon/Tue/Thu/Fri from 2026-11-09
    expect(CM.dayTypeFor('2026-11-11', { plan, macroSchedule: { wed: 'training' } })).toBe('rest');
    expect(CM.dayTypeFor('2026-11-12', { plan })).toBe('training');
  });

  test('a day: the main meal of each slot, tagged and counted', () => {
    const e = CM.entriesForDay(mealPlan, 'training', { date: '2026-11-02', now: 1 });
    expect(e.map(x => [x.meal, x.name, x.grams, x.kcal])).toEqual([['breakfast', 'Oats', 80, 296], ['breakfast', 'Whey', 30, 111], ['lunch', 'Rice', 250, 325]]);
    expect(e[0].coach).toMatchObject({ key: 'meals:abc', slot: 'breakfast', option: 0, dayType: 'training', mealName: 'Oats & whey', grams: 80 });
    expect(e.every(x => x.confirmed === false && x.date === '2026-11-02')).toBe(true);
    expect(CM.entriesForDay(mealPlan, 'rest', { date: 'd', now: 1 }).map(x => x.name)).toEqual(['Eggs']);
  });

  test('slot state: alternatives, edited when an amount changed or a food was removed', () => {
    const e = CM.entriesForDay(mealPlan, 'training', { date: 'd', now: 1 });
    let s = CM.slotState(e, 'd', 'breakfast', mealPlan);
    expect(s).toMatchObject({ meal: 'Oats & whey', option: 0, confirmed: false, edited: false, alternatives: [{ i: 1, name: 'Eggs' }] });
    expect(CM.slotState([{ ...e[0], grams: 100 }, e[1]], 'd', 'breakfast', mealPlan).edited).toBe(true);
    expect(CM.slotState([e[0]], 'd', 'breakfast', mealPlan).edited).toBe(true);
    expect(CM.slotState(e, 'd', 'dinner', mealPlan)).toBeNull();
  });
});

describe('coach meals: in the food log', () => {
  function app({ complete = false, schedule = null } = {}) {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
    const w = dom.window;
    w.localStorage.setItem('fitnessAppUser', 'alice');
    w.eval(read('src/js/food-core.js'));
    w.eval(read('src/js/coach-meals.js'));
    let log = [];
    const totals = [];
    w.FoodLog = { load: () => log.slice(), save: l => { log = l.slice(); }, today: () => '2026-11-02', add: e => { log.push(e); }, remove: id => { log = log.filter(e => e.id !== id); } };
    w.applyFoodLogChanges = changes => changes.forEach(({ before, after }) => {
      if (before) { log = log.filter(e => e.id !== before.id); totals.push(-before.kcal); }
      if (after) { log.push(after); totals.push(after.kcal); }
    });
    w.renderFoodLog = jest.fn();
    w.isMacroDayComplete = () => complete;
    w.guardMacroDayLocked = () => complete;
    w.getAssignedNutritionPlan = () => (schedule ? { schedule } : null);
    w.showToast = jest.fn();
    return { w, log: () => log, totals };
  }

  test('fills today once, counted; a completed day is left alone', () => {
    const a = app();
    a.w.CoachMeals.sync(mealPlan);
    expect(a.log().map(e => e.name)).toEqual(['Oats', 'Whey', 'Rice']);
    expect(a.totals.reduce((n, x) => n + x, 0)).toBe(732);
    expect(a.w.CoachMeals.ensureToday()).toBe(false);
    a.w.localStorage.removeItem('coachMealsFilled_alice'); // another device already filled it
    expect(a.w.CoachMeals.ensureToday()).toBe(false);
    expect(a.log()).toHaveLength(3);
    const b = app({ complete: true });
    b.w.CoachMeals.sync(mealPlan);
    expect(b.log()).toHaveLength(0);
  });

  test('rest day by the weekly pattern', () => {
    const a = app({ schedule: { mon: 'rest' } }); // 2026-11-02 is a Monday
    a.w.CoachMeals.sync(mealPlan);
    expect(a.log().map(e => e.name)).toEqual(['Eggs']);
  });

  test('✓ Ate this, Swap, switch day type while untouched, Complete day confirms the rest', () => {
    const a = app();
    a.w.CoachMeals.sync(mealPlan);
    const C = a.w.CoachMeals;
    expect(C.slotBar('breakfast')).toContain('From your coach: <b>Oats &amp; whey</b>');
    expect(C.slotBar('breakfast')).toContain('<option value="1">Eggs</option>');
    expect(C.headerHtml()).toContain('Use rest-day meals');
    expect(C.headerHtml()).toContain('“Swap breakfast if you prefer eggs.”');

    C.switchDay('rest');
    expect(a.log().map(e => e.name)).toEqual(['Eggs']);
    C.switchDay('training');
    C.confirmSlot('lunch');
    expect(a.log().filter(e => e.meal === 'lunch').every(e => e.confirmed)).toBe(true);
    expect(C.slotBar('lunch')).toContain('✓ Eaten');
    expect(C.headerHtml()).not.toContain('Use rest-day meals');

    C.swap('breakfast', 1);
    expect(a.log().filter(e => e.meal === 'breakfast').map(e => e.name)).toEqual(['Eggs']);
    expect(C.slotBar('breakfast')).toContain('<option value="0">Oats &amp; whey</option>');

    C.confirmAll();
    expect(a.log().every(e => e.confirmed)).toBe(true);
  });

  test('a new plan from the coach fills again; no plan → nothing', () => {
    const a = app();
    a.w.CoachMeals.sync(mealPlan);
    a.w.CoachMeals.sync({ ...mealPlan, key: 'meals:new' });
    expect(a.log().filter(e => e.coach.key === 'meals:new')).toHaveLength(3);
    const b = app();
    b.w.CoachMeals.sync(null);
    expect(b.log()).toHaveLength(0);
  });
});

describe('dashboard meal planner', () => {
  function planner(extra = {}) {
    const dom = new JSDOM('<!doctype html><body><div id="area"></div></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.confirm = () => true;
    w.alert = jest.fn();
    w.eval(read('coach/meal-planner.js'));
    const sent = [];
    const saved = [];
    const api = {
      meals: async () => [meal('lib1', 'Rice bowl', [[rice, 250]])],
      coachFoods: async () => [oats],
      search: async () => [whey],
      saveMeal: async m => { saved.push(m); return m; },
      send: async (p, msg) => { sent.push({ p, msg }); },
      clear: async () => {},
    };
    const area = w.document.getElementById('area');
    w.MealPlanner.mount(area, { clientName: 'Client A', api, targets: { training: { kcal: 2350, protein: 165, carbs: 275, fat: 65 }, rest: { kcal: 2000, protein: 165, carbs: 190, fat: 65 } }, ...extra });
    const q = s => area.querySelector(s);
    const qa = s => [...area.querySelectorAll(s)];
    const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const flush = () => new Promise(r => setTimeout(r, 0));
    return { w, area, q, qa, click, flush, sent, saved };
  }

  test('totals: meal and day (main meals only)', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(read('coach/meal-planner.js'));
    const MP = dom.window.MealPlanner;
    expect(MP.mealTotals(mealPlan.days.training.breakfast[0])).toEqual({ kcal: 407, protein: 37, carbs: 49, fat: 6 });
    expect(MP.dayTotals(mealPlan.days.training)).toEqual({ kcal: 732, protein: 44, carbs: 119, fat: 7 });
  });

  test('build a meal from search, change grams, save to the library and the plan; add an alternative; send', async () => {
    const t = planner();
    await t.flush();
    t.click(t.q('[data-mp="new"][data-slot="breakfast"]'));
    const name = t.q('[data-mp-name]');
    name.value = 'Oats & whey';
    name.dispatchEvent(new t.w.Event('input', { bubbles: true }));
    const search = t.q('[data-mp-search]');
    search.value = 'oat';
    search.dispatchEvent(new t.w.Event('input', { bubbles: true }));
    t.click(t.q('[data-mp="search"]'));
    await t.flush(); await t.flush();
    expect(t.qa('.mp2-result').map(b => b.querySelector('b').textContent)).toEqual(['Oats', 'Whey']);
    t.click(t.q('[data-mp="pick"][data-i="0"]'));
    const g = t.q('[data-mp-grams="0"]');
    g.value = '80';
    g.dispatchEvent(new t.w.Event('change', { bubbles: true }));
    expect(t.q('.mp2-editor-top .mp2-macros').textContent).toBe('296 kcal · P 10 · C 48 · F 6');
    t.click(t.q('[data-mp="save-meal"]'));
    await t.flush();
    expect(t.saved[0]).toMatchObject({ name: 'Oats & whey', items: [{ grams: 80 }] });
    expect(t.q('.mp2-meal b').textContent).toBe('Oats & whey');
    expect(t.q('.mp2-total').textContent).toMatch(/296 kcal/);
    expect(t.q('.mp2-total').textContent).toMatch(/difference -2054 kcal/);

    const lib = t.q('[data-mp-lib="breakfast"]');
    lib.value = 'lib1';
    lib.dispatchEvent(new t.w.Event('change', { bubbles: true }));
    expect(t.qa('.mp2-slot')[0].querySelectorAll('.mp2-meal')).toHaveLength(2);
    t.click(t.q('[data-mp="default"][data-slot="breakfast"][data-i="1"]'));
    expect(t.q('.mp2-meal.is-default b').textContent).toBe('Rice bowl');

    t.click(t.q('[data-mp="copy-day"]'));
    const note = t.q('[data-mp-plan-note]');
    note.value = 'Start Monday';
    note.dispatchEvent(new t.w.Event('input', { bubbles: true }));
    t.click(t.q('[data-mp="send"]'));
    await t.flush();
    expect(t.sent[0].msg).toBe('Start Monday');
    expect(t.sent[0].p.days.training.breakfast.map(m => m.name)).toEqual(['Rice bowl', 'Oats & whey']);
    expect(t.sent[0].p.days.rest.breakfast.map(m => m.name)).toEqual(['Rice bowl', 'Oats & whey']);
    expect(t.q('.pb-msg').textContent).toMatch(/Sent/);
  });

  test('an existing plan opens for editing; rest day tab shows its own totals and target', async () => {
    const t = planner({ plan: mealPlan });
    await t.flush();
    expect(t.q('.mp2-total').textContent).toMatch(/732 kcal/);
    t.click(t.q('[data-mp-day="rest"]'));
    expect(t.q('.mp2-total').textContent).toMatch(/^Rest day: 215 kcal/);
    expect(t.q('.mp2-total').textContent).toMatch(/Target 2000 kcal/);
    expect(t.q('[data-mp="clear"]')).not.toBeNull();
  });
});
