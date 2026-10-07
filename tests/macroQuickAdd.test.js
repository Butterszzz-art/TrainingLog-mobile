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

const TODAY = new Date().toISOString().slice(0, 10);

function setup(initial, extraStore = {}) {
  const store = { ...extraStore };
  if (initial) {
    store.dailyMacroDate = store.dailyMacroDate || TODAY;
    store.dailyMacroProgress = JSON.stringify(initial);
  }
  const inputs = { qaCals: { value: '' }, qaProtein: { value: '' }, qaCarbs: { value: '' }, qaFat: { value: '' } };
  const toasts = [];
  const ctx = {
    currentUser: 'alice',
    window: { showToast: (msg, type) => toasts.push({ msg, type }) },
    document: { getElementById: id => inputs[id] || null },
    localStorage: {
      setItem: (k, v) => { store[k] = String(v); },
      getItem: k => store[k] ?? null,
      removeItem: k => { delete store[k]; },
    },
    confirm: jest.fn(() => true),
    updateMacroUI: jest.fn(),
    saveDailyMacroLog: jest.fn(),
    getCardioMinutesForDate: () => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(`
    ${extract('function getQuickAddStep(type)', 'function getMacroProgressColor(')}
    ${extract('function getTodayDateString() {', 'function getTodayCardioCalories()')}
    ${extract('function saveDailyMacroProgress(', 'function renderDailyMacroProgress()')}
    ${extract('// When the date changes: archive the day that just ended', 'function checkMacroReset()')}
    ${extract('// One entry per date:', 'function renderMacroHistory()')}
    this.addMacro = addMacro;
    this.subtractMacro = subtractMacro;
    this.loadDailyMacroProgress = loadDailyMacroProgress;
    this.copyPreviousMacroDay = copyPreviousMacroDay;
    this.toggleMacroDayComplete = toggleMacroDayComplete;
    this.isMacroDayComplete = isMacroDayComplete;
  `, ctx);
  const quickAdd = (type, amount) => {
    const map = { cal: 'qaCals', protein: 'qaProtein', carbs: 'qaCarbs', fat: 'qaFat' };
    inputs[map[type]].value = String(Math.abs(amount));
    if (amount < 0) ctx.subtractMacro(type); else ctx.addMacro(type);
  };
  return { ctx, store, quickAdd, toasts };
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

describe('Mark day complete', () => {
  test('a completed day refuses quick-add until reopened', () => {
    const { ctx, quickAdd, toasts } = setup({ protein: 100, carbs: 0, fats: 0 });
    ctx.toggleMacroDayComplete();
    expect(ctx.isMacroDayComplete()).toBe(true);

    quickAdd('protein', 25);
    expect(ctx.loadDailyMacroProgress().protein).toBe(100);
    expect(toasts.pop().msg).toMatch(/marked complete/);

    ctx.toggleMacroDayComplete(); // reopen (confirm stubbed to yes)
    quickAdd('protein', 25);
    expect(ctx.loadDailyMacroProgress().protein).toBe(125);
  });

  test("yesterday's completion doesn't lock today", () => {
    const { ctx, quickAdd } = setup({ protein: 0, carbs: 0, fats: 0 }, { macroDayComplete_alice: '2000-01-01' });
    quickAdd('protein', 10);
    expect(ctx.loadDailyMacroProgress().protein).toBe(10);
  });
});

describe('Copy previous day', () => {
  const history = [
    { date: '2000-01-01', meals: [], totals: { protein: 50, carbs: 50, fats: 10 } },
    { date: '2000-01-02', meals: [{ protein: 150, carbs: 200, fats: 60 }], totals: { protein: 150, carbs: 200, fats: 60, cals: 100 } },
  ];

  test("fills today with the most recent earlier day's log", () => {
    const { ctx, store } = setup(null, { macroHistory_alice: JSON.stringify(history) });
    ctx.copyPreviousMacroDay();
    expect(ctx.loadDailyMacroProgress()).toMatchObject({ protein: 150, carbs: 200, fats: 60, cals: 100, calories: 150 * 4 + 200 * 4 + 60 * 9 + 100 });
    expect(JSON.parse(store.dailyMacroMeals)).toEqual(history[1].meals);
    expect(ctx.confirm).not.toHaveBeenCalled();
  });

  test('asks before replacing a day that already has entries', () => {
    const { ctx } = setup({ protein: 20, carbs: 0, fats: 0 }, { macroHistory_alice: JSON.stringify(history) });
    ctx.confirm.mockReturnValueOnce(false);
    ctx.copyPreviousMacroDay();
    expect(ctx.loadDailyMacroProgress().protein).toBe(20);
  });
});

describe('Day rollover', () => {
  test("archives the previous day's log under its own date before starting today", () => {
    const { ctx, store } = setup(
      { protein: 120, carbs: 180, fats: 50, cals: 0 },
      { dailyMacroDate: '2000-01-05', dailyMacroMeals: JSON.stringify([{ protein: 120 }]) }
    );
    expect(ctx.loadDailyMacroProgress().calories).toBe(0);

    const archived = JSON.parse(store.macroHistory_alice);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ date: '2000-01-05', meals: [{ protein: 120 }] });
    expect(archived[0].totals.calories).toBe(120 * 4 + 180 * 4 + 50 * 9);
    expect(store.dailyMacroDate).toBe(TODAY);
    expect(ctx.saveDailyMacroLog).toHaveBeenCalledTimes(1);
  });
});
