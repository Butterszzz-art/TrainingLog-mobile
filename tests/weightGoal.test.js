const {
  weightGoalDirection,
  weightTrendTone,
  weightGoalProgress,
  weeksToGoal,
} = require('../weightTab.js');

describe('weight goal helpers', () => {
  test('direction from start to target', () => {
    expect(weightGoalDirection(85, 78)).toBe('lose');
    expect(weightGoalDirection(70, 76)).toBe('gain');
    expect(weightGoalDirection(80, 80.3)).toBe('maintain');
  });

  test('trend tone follows the goal', () => {
    expect(weightTrendTone(-0.4, 'lose')).toBe('good');
    expect(weightTrendTone(0.4, 'lose')).toBe('bad');
    expect(weightTrendTone(0.4, 'gain')).toBe('good');
    expect(weightTrendTone(-0.4, 'gain')).toBe('bad');
    expect(weightTrendTone(0.01, 'lose')).toBe('flat');
    expect(weightTrendTone(0.1, 'maintain', { holdKg: 0.15 })).toBe('good');
    expect(weightTrendTone(-0.5, 'maintain', { holdKg: 0.15 })).toBe('bad');
  });

  test('progress percent and reached', () => {
    const half = weightGoalProgress({ startKg: 90, currentKg: 85, targetKg: 80 });
    expect(half.percent).toBeCloseTo(50);
    expect(half.remainingKg).toBeCloseTo(-5);
    expect(half.reached).toBe(false);

    const wrongWay = weightGoalProgress({ startKg: 90, currentKg: 92, targetKg: 80 });
    expect(wrongWay.percent).toBe(0);

    const done = weightGoalProgress({ startKg: 70, currentKg: 76.2, targetKg: 76 });
    expect(done.reached).toBe(true);
    expect(done.percent).toBe(100);
  });

  test('weeks to goal only when heading the right way', () => {
    expect(weeksToGoal({ currentKg: 84, targetKg: 80, kgPerWeek: -0.5 })).toBeCloseTo(8);
    expect(weeksToGoal({ currentKg: 84, targetKg: 80, kgPerWeek: 0.3 })).toBeNull();
    expect(weeksToGoal({ currentKg: 84, targetKg: 80, kgPerWeek: 0 })).toBeNull();
  });
});

describe('trend colours fall back to the macro goal', () => {
  const { JSDOM } = require('jsdom');
  const fs = require('fs');
  const path = require('path');
  const WT = fs.readFileSync(path.join(__dirname, '../weightTab.js'), 'utf8');
  const WG = fs.readFileSync(path.join(__dirname, '../src/js/weight-goal.js'), 'utf8');

  function setup({ preset = '', stored = {} } = {}) {
    const dom = new JSDOM(`<!doctype html><body><select id="macroPreset"><option value=""></option>
      <option value="cut-moderate"></option><option value="bulk-slow"></option><option value="maintain"></option></select></body>`,
      { runScripts: 'outside-only', url: 'https://app.test/' });
    const w = dom.window;
    w.currentUser = 'ana';
    Object.entries(stored).forEach(([k, v]) => w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
    w.document.getElementById('macroPreset').value = preset;
    w.eval(WT);
    w.eval(WG);
    return w;
  }

  test('no weight goal and no macro goal keeps the old colours', () => {
    const w = setup();
    expect(w.macroGoalDirection()).toBeNull();
    expect(w.weightGoalTone(-0.5)).toBeNull();
  });

  test('picked bulk preset makes losing weight read red', () => {
    const w = setup({ preset: 'bulk-slow' });
    expect(w.macroGoalDirection()).toBe('gain');
    expect(w.weightGoalTone(-0.5)).toBe('bad');
    expect(w.weightGoalTone(0.5)).toBe('good');
  });

  test('falls back to the last calculated preset, then onboarding', () => {
    expect(setup({ stored: { trainingPreset: 'cut-moderate' } }).macroGoalDirection()).toBe('lose');
    expect(setup({ stored: { macroSettings_ana: { macroGoal: 'recomp' } } }).macroGoalDirection()).toBe('maintain');
  });

  test('a weight goal wins over the macro goal', () => {
    const w = setup({
      preset: 'bulk-slow',
      stored: { weightGoal_ana: { targetKg: 78, startKg: 85, startDate: '2026-10-01', dueDate: null } },
    });
    expect(w.weightGoalTone(-0.5)).toBe('good');
  });
});
