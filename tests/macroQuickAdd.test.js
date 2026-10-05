const fs = require('fs');
const vm = require('vm');

// Regression tests for the Macros tab quick-add: adding protein/carbs/fat
// (chips, ± buttons, food search) used to bump an in-memory counter for that
// one row only, so calories stayed at 0, the pace nudge read 0g protein and
// nothing survived a refresh.
const html = fs.readFileSync('index.html', 'utf8');
function extract(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`could not find ${startMarker}`);
  return html.slice(start, end);
}

function setup(initial) {
  const store = {};
  if (initial) {
    store.dailyMacroDate = new Date().toISOString().slice(0, 10);
    store.dailyMacroProgress = JSON.stringify(initial);
  }
  const inputs = { qaCals: { value: '' }, qaProtein: { value: '' }, qaCarbs: { value: '' }, qaFat: { value: '' } };
  const ctx = {
    window: {},
    document: { getElementById: id => inputs[id] || null },
    localStorage: { setItem: (k, v) => { store[k] = String(v); }, getItem: k => store[k] ?? null },
    updateMacroUI: jest.fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(`
    ${extract('function getQuickAddStep(type)', 'function getMacroProgressColor(')}
    ${extract('function getTodayDateString() {', 'function getTodayCardioCalories()')}
    ${extract('function saveDailyMacroProgress(', 'function renderDailyMacroProgress()')}
    this.addMacro = addMacro;
    this.subtractMacro = subtractMacro;
    this.loadDailyMacroProgress = loadDailyMacroProgress;
  `, ctx);
  const quickAdd = (type, amount) => {
    const map = { cal: 'qaCals', protein: 'qaProtein', carbs: 'qaCarbs', fat: 'qaFat' };
    inputs[map[type]].value = String(Math.abs(amount));
    if (amount < 0) ctx.subtractMacro(type); else ctx.addMacro(type);
  };
  return { ctx, store, quickAdd };
}

describe('Macros tab quick-add', () => {
  test('adding macros adds their calories and saves them for the day', () => {
    const { ctx, store, quickAdd } = setup();
    quickAdd('protein', 170);
    quickAdd('carbs', 170);
    quickAdd('fat', 40);

    const saved = JSON.parse(store.dailyMacroProgress);
    expect(saved).toMatchObject({ protein: 170, carbs: 170, fats: 40 });
    // 170*4 + 170*4 + 40*9
    expect(saved.calories).toBe(1720);
    expect(ctx.loadDailyMacroProgress().calories).toBe(1720);
    expect(ctx.updateMacroUI).toHaveBeenCalledTimes(3);
  });

  test('"+kcal" adds calories on top of the macros', () => {
    const { ctx, quickAdd } = setup({ protein: 10, carbs: 0, fats: 0 });
    quickAdd('cal', 250);
    expect(ctx.loadDailyMacroProgress()).toMatchObject({ protein: 10, cals: 250, calories: 290 });
  });

  test('removing never goes below zero', () => {
    const { ctx, quickAdd } = setup({ protein: 5, carbs: 0, fats: 0, cals: 0 });
    quickAdd('protein', -10);
    quickAdd('cal', -500);
    expect(ctx.loadDailyMacroProgress()).toMatchObject({ protein: 0, calories: 0 });
  });

  test('builds on progress already saved today (e.g. from logged meals)', () => {
    const { ctx, quickAdd } = setup({ protein: 100, carbs: 50, fats: 20 });
    quickAdd('protein', 25);
    expect(ctx.loadDailyMacroProgress()).toMatchObject({ protein: 125, carbs: 50, fats: 20, calories: 880 });
  });
});
