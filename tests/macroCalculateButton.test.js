const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// The "Calculate targets" button on Adjust → Macro Preset (and "Save &
// calculate targets" on Profile). Picking a goal used to calculate only when
// the choice changed, so new body stats with the same goal never applied.
describe('calculateTargetsNow', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const code = html.slice(html.indexOf('function calculateTargetsNow()'), html.indexOf('function getMacroTargetValues()'));
  const presetStart = html.indexOf('const presetMap = {');
  const presetCode = html.slice(presetStart, html.indexOf('};', presetStart) + 2);

  let ctx;
  let doc;
  let storage;
  let calls;
  let toasts;
  let typed;

  beforeEach(() => {
    const dom = new JSDOM(`<!DOCTYPE html>
      <button data-macro-subtab="personal">Profile</button>
      <input id="weight"><select id="macroPreset"><option value="maintain">m</option><option value="cut-moderate">c</option></select>
      <input type="checkbox" id="trainingDayToggle">
      <button id="macroCalcBtn" class="is-ready"></button>
      <p id="macroCalcResult" hidden></p><p id="profileCalcResult" hidden></p>`);
    doc = dom.window.document;
    storage = {};
    calls = [];
    toasts = [];
    typed = { weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male', activityFactor: 1.55 };
    ctx = {
      document: doc,
      localStorage: {
        getItem: k => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
      },
      window: { showToast: (m, t) => toasts.push([m, t]), currentMacroPresetKey: () => 'cut-moderate' },
      readPersonalDetailsFromDOM: () => typed,
      isValidPersonalDetails: d => !!(d && d.weightKg && d.heightCm && d.ageYears && d.sex && d.activityFactor),
      applyPersonalDetailsToMacroForm: () => {},
      calculateMacroTargets: (goal, rate) => {
        calls.push([goal, rate]);
        return { targets: { calories: 2300, protein: 160, fat: 64, carbs: 266 }, synced: Promise.resolve(true) };
      },
    };
    vm.createContext(ctx);
    vm.runInContext(`${presetCode}\n${code}`, ctx);
  });

  test('saves the typed body stats, calculates with the picked goal and shows the result', async () => {
    const t = ctx.calculateTargetsNow();
    expect(calls).toEqual([['cut', 'moderate']]);
    expect(t.calories).toBe(2300);
    expect(JSON.parse(storage.personalDetails).weightKg).toBe(80);
    expect(storage.restPreset).toBe('cut-moderate');
    expect(doc.getElementById('macroPreset').value).toBe('cut-moderate');
    const line = doc.getElementById('macroCalcResult');
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe('Cut – Moderate: 2300 kcal · 160 g protein · 64 g fat · 266 g carbs');
    expect(doc.getElementById('profileCalcResult').textContent).toBe(line.textContent);
    expect(doc.getElementById('macroCalcBtn').classList.contains('is-ready')).toBe(false);
    await Promise.resolve();
    expect(toasts).toContainEqual(['Targets calculated and saved', 'success']);
  });

  test('runs again every time, even with the same goal (new body stats apply)', () => {
    ctx.calculateTargetsNow();
    typed = { ...typed, weightKg: 76 };
    ctx.calculateTargetsNow();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(storage.personalDetails).weightKg).toBe(76);
  });

  test('missing body stats: nothing is calculated and Profile opens', () => {
    typed = { sex: 'male', activityFactor: 1.2 };
    let opened = false;
    doc.querySelector('[data-macro-subtab="personal"]').addEventListener('click', () => { opened = true; });
    expect(ctx.calculateTargetsNow()).toBeNull();
    expect(calls).toHaveLength(0);
    expect(opened).toBe(true);
    expect(toasts[0][1]).toBe('warn');
  });

  test('stats saved earlier still count when the Profile fields are empty', () => {
    storage.personalDetails = JSON.stringify({ weightKg: 70, heightCm: 170, ageYears: 40, sex: 'female', activityFactor: 1.375 });
    typed = {};
    ctx.window.currentMacroPresetKey = () => 'maintain';
    ctx.calculateTargetsNow();
    expect(calls).toEqual([['maintain', 'moderate']]);
    expect(doc.getElementById('macroCalcResult').textContent.startsWith('Maintain: ')).toBe(true);
  });

  test('a failed sync says so', async () => {
    ctx.calculateMacroTargets = () => ({ targets: { calories: 1, protein: 1, fat: 1, carbs: 1 }, synced: Promise.resolve(false) });
    ctx.calculateTargetsNow();
    await Promise.resolve();
    await Promise.resolve();
    expect(toasts.some(([, type]) => type === 'error')).toBe(true);
  });
});

describe('goal / rate pills', () => {
  test('picking a goal chooses it but does not calculate', () => {
    const dom = new JSDOM(`<!DOCTYPE html>
      <div id="macroGoalSegRow"><button class="macro-seg-btn" data-val="cut"></button><button class="macro-seg-btn" data-val="maintain"></button></div>
      <p id="macroRateLabel"></p>
      <div id="macroRateSegRow"><button class="macro-seg-btn" data-val="slow"></button><button class="macro-seg-btn" data-val="moderate"></button></div>
      <select id="macroPreset"><option value=""></option><option value="cut-moderate"></option><option value="maintain"></option></select>
      <button id="macroCalcBtn"></button>`, { runScripts: 'outside-only' });
    const win = dom.window;
    win.eval(fs.readFileSync(path.join('src', 'js', 'macro-pill-controls.js'), 'utf8'));
    let changes = 0;
    win.document.getElementById('macroPreset').addEventListener('change', () => { changes++; });
    win.selectMacroGoal(win.document.querySelector('#macroGoalSegRow [data-val="cut"]'));
    expect(win.document.getElementById('macroPreset').value).toBe('cut-moderate');
    expect(changes).toBe(0);
    expect(win.document.getElementById('macroCalcBtn').classList.contains('is-ready')).toBe(true);
    expect(win.currentMacroPresetKey()).toBe('cut-moderate');
  });
});
