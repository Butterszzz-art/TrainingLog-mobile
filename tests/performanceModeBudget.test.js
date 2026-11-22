// The time-budget pod in performance mode, run against the real markup
// from index.html in jsdom (src/js/performance-mode.js + time-budget-core.js).
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { getMuscleGroup } = require('../exerciseMuscleMap');

function slice(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`markup not found: ${startMarker}`);
  return html.slice(start, end + endMarker.length);
}

describe('performance mode time budget', () => {
  let dom;
  let win;
  const S = (n) => Array.from({ length: n }, () => ({ reps: 10, weight: 40 }));
  const day = { name: 'Full body A', exercises: [
    { name: 'Hack Squat', sets: S(3) }, { name: 'Incline DB Press', sets: S(3) },
    { name: 'Chest Supported Row', sets: S(3) }, { name: 'Seated Leg Curl', sets: S(3) },
    { name: 'Overhead Cable Triceps Extension', sets: S(3) }, { name: 'Lateral Raise', sets: S(4) },
  ] };

  beforeEach(() => {
    const html = fs.readFileSync('index.html', 'utf8');
    const budget = slice(html, '<div id="pmTimeBudget"', '<p id="pmBudgetApplied" class="pm-budget-applied" hidden></p>\n      </div>');
    const rest = slice(html, '<div id="pmRestPresets"', '</button>\n          </div>\n        </div>');
    dom = new JSDOM(`<!DOCTYPE html><body>${budget}${rest}<input id="exercise"></body>`, { runScripts: 'outside-only', url: 'http://localhost/' });
    win = dom.window;
    win.localStorage.setItem('fitnessAppUser', 'demo');
    win.localStorage.setItem('tl_workout_timer_v1', JSON.stringify({ startTimeMs: Date.now() - 5 * 60000 }));
    win.getTodaysPlannedDay = () => day;
    win.getMuscleGroup = getMuscleGroup;
    win.startQuickLogFor = jest.fn();
    win.scrollTo = () => {};
    vm.runInContext(fs.readFileSync('src/js/time-budget-core.js', 'utf8'), dom.getInternalVMContext());
    vm.runInContext(fs.readFileSync('src/js/performance-mode.js', 'utf8'), dom.getInternalVMContext());
  });

  afterEach(() => {
    win.exitPerformanceMode();
    win.close();
  });

  const $ = (id) => win.document.getElementById(id);

  test('picking a budget switches rest to Auto and shows pace + fixes', () => {
    win.startPerformanceMode({ restore: true });
    win.setPerformanceBudget(30);

    const active = [...win.document.querySelectorAll('.active-preset')].map((b) => b.textContent);
    expect(active).toEqual(['30 min', 'Auto']);
    expect($('pmRestHint').textContent).toBe('fits each exercise');
    expect($('pmBudgetPace').textContent).toMatch(/^5 of 30 min · 0\/19 sets · ~\d+ min behind$/);
    expect($('pmBudgetBar').hidden).toBe(false);
    const tips = [...win.document.querySelectorAll('.pm-budget-tip-text')].map((e) => e.textContent);
    expect(tips[0]).toMatch(/^Superset Incline DB Press with Chest Supported Row/);
    expect(tips.length).toBeLessThanOrEqual(3);
  });

  test('applying a fix records it and shrinks the projection; dismissing hides it', () => {
    win.startPerformanceMode({ restore: true });
    win.setPerformanceBudget(30);
    const before = Number(/~(\d+) min behind/.exec($('pmBudgetPace').textContent)[1]);

    win.applyPerformanceBudgetTip(0);
    expect($('pmBudgetApplied').hidden).toBe(false);
    expect($('pmBudgetApplied').textContent).toMatch(/Superset Incline DB Press \+ Chest Supported Row/);
    const after = /~(\d+) min behind/.exec($('pmBudgetPace').textContent);
    expect(after ? Number(after[1]) : 0).toBeLessThan(before);

    const first = win.document.querySelector('.pm-budget-tip-text').textContent;
    win.dismissPerformanceBudgetTip(0);
    const remaining = [...win.document.querySelectorAll('.pm-budget-tip-text')].map((e) => e.textContent);
    expect(remaining).not.toContain(first);
  });

  test('No limit hides the bar and offers no fixes', () => {
    win.startPerformanceMode({ restore: true });
    win.setPerformanceBudget(null);
    expect($('pmBudgetBar').hidden).toBe(true);
    expect($('pmBudgetTips').hidden).toBe(true);
    expect($('pmBudgetPace').textContent).toMatch(/finish in ~\d+ min/);
  });

  test('a new session clears the previous session’s accepted fixes', () => {
    win.startPerformanceMode({ restore: true });
    win.setPerformanceBudget(30);
    win.applyPerformanceBudgetTip(0);
    win.exitPerformanceMode();
    win.startPerformanceMode();
    expect($('pmBudgetApplied').hidden).toBe(true);
  });

  test('logging half of a superset arms the partner and uses the short Auto rest', async () => {
    win.startPerformanceMode({ restore: true });
    win.setPerformanceBudget(30);
    win.applyPerformanceBudgetTip(0); // Incline DB Press + Chest Supported Row
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    win.localStorage.setItem('workouts_demo', JSON.stringify([{ date: today, log: [
      { exercise: 'Hack Squat', repsArray: [8, 8, 8] }, { exercise: 'Incline DB Press', repsArray: [10] },
    ] }]));

    win.document.dispatchEvent(new win.CustomEvent('tl:set-logged', { detail: { exercise: 'Incline DB Press' } }));
    await new Promise((r) => setTimeout(r, 5));

    expect(win.startQuickLogFor).toHaveBeenCalledWith('Chest Supported Row', { weight: 40, reps: 10 });
    expect(JSON.parse(win.localStorage.getItem('tl_rest_timer_v1')).totalSeconds).toBe(60);

    win.document.dispatchEvent(new win.CustomEvent('tl:set-logged', { detail: { exercise: 'Hack Squat' } }));
    await new Promise((r) => setTimeout(r, 5));
    expect(JSON.parse(win.localStorage.getItem('tl_rest_timer_v1')).totalSeconds).toBe(120);
  });
});
