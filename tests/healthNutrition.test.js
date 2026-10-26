const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const hn = require('../src/js/health-nutrition.js');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/health-nutrition.js'), 'utf8');
const TODAY = '2026-10-26';

describe('health-nutrition helpers', () => {
  test('toProgressShape keeps the food app calorie total', () => {
    const shape = hn.toProgressShape({ energyKcal: 2105.4, protein: 150.04, carbs: 200.06, fat: 70 });
    expect(shape).toEqual({ protein: 150, carbs: 200.1, fats: 70, cals: 75 });
    // 4/4/9 from macros plus cals must equal the food app's total.
    expect(Math.round(shape.protein * 4 + shape.carbs * 4 + shape.fats * 9 + shape.cals)).toBe(2105);
  });

  test('toProgressShape adds nothing extra when calories are missing', () => {
    expect(hn.toProgressShape({ protein: 20 })).toEqual({ protein: 20, carbs: 0, fats: 0, cals: 0 });
    expect(hn.toProgressShape(null)).toEqual({ protein: 0, carbs: 0, fats: 0, cals: 0 });
  });

  test('importDelta only adds what is new today', () => {
    const prev = { date: TODAY, protein: 50, carbs: 60, fats: 20, cals: 10 };
    const next = { protein: 80, carbs: 60, fats: 25.5, cals: 5 };
    expect(hn.importDelta(prev, next, TODAY)).toEqual({ protein: 30, carbs: 0, fats: 5.5, cals: -5 });
  });

  test('importDelta ignores an import from an earlier day', () => {
    const prev = { date: '2026-10-25', protein: 50, carbs: 60, fats: 20, cals: 10 };
    const next = { protein: 10, carbs: 0, fats: 0, cals: 0 };
    expect(hn.importDelta(prev, next, TODAY)).toEqual({ protein: 10, carbs: 0, fats: 0, cals: 0 });
    expect(hn.importDelta(null, next, TODAY)).toEqual({ protein: 10, carbs: 0, fats: 0, cals: 0 });
  });

  test('importDelta removes food deleted in the food app', () => {
    const prev = { date: TODAY, protein: 40, carbs: 0, fats: 0, cals: 0 };
    expect(hn.importDelta(prev, { protein: 15, carbs: 0, fats: 0, cals: 0 }, TODAY).protein).toBe(-25);
  });

  test('dayRange covers the app day (UTC date)', () => {
    const r = hn.dayRange(TODAY);
    expect(new Date(r.start).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(r.end - r.start).toBe(24 * 60 * 60 * 1000);
  });

  test('describeSources names known apps', () => {
    expect(hn.describeSources(['com.cronometer.android', 'com.cronometer.android', 'org.other.app']))
      .toBe('Cronometer, org.other.app');
    expect(hn.describeSources([])).toBe('');
  });
});

describe('health-nutrition sync in the app', () => {
  let window;
  let document;
  let localStorage;

  function setup(pluginImpl) {
    const dom = new JSDOM(`
      <div id="healthNutritionCard" hidden>
        <small id="healthNutritionStatus"></small>
        <button id="healthNutritionOff" hidden></button>
        <button id="healthNutritionBtn"><span data-label></span></button>
      </div>`, { url: 'https://localhost/', runScripts: 'outside-only' });
    window = dom.window;
    document = window.document;
    localStorage = window.localStorage;
    const logged = [];
    window.currentUser = 'sam';
    window.getTodayDateString = () => TODAY;
    window.isMacroDayComplete = () => false;
    window.showToast = jest.fn();
    window.logMacroAmounts = (d) => logged.push(d);
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: { HealthConnect: pluginImpl },
    };
    window.eval(SRC);
    return { logged, api: window.HealthNutrition };
  }

  function plugin(totals) {
    return {
      getStatus: jest.fn(async () => ({ status: 'available', granted: true })),
      requestPermission: jest.fn(async () => ({ granted: true })),
      getNutritionTotals: jest.fn(async () => totals()),
      openHealthConnect: jest.fn(async () => {}),
    };
  }

  test('connect asks for access, imports, and re-syncs without double counting', async () => {
    let totals = { energyKcal: 500, protein: 40, carbs: 50, fat: 10, sources: ['com.cronometer.android'], hasData: true };
    const hc = plugin(() => totals);
    const { logged, api } = setup(hc);
    await api.refresh();
    expect(document.getElementById('healthNutritionCard').hidden).toBe(false);
    expect(document.querySelector('#healthNutritionBtn [data-label]').textContent).toBe('Connect');

    await api.onButton();
    expect(hc.requestPermission).toHaveBeenCalled();
    expect(hc.getNutritionTotals).toHaveBeenCalledWith(hn.dayRange(TODAY));
    expect(logged).toEqual([{ protein: 40, carbs: 50, fats: 10, cals: 50 }]);
    expect(document.getElementById('healthNutritionStatus').textContent).toContain('from Cronometer');

    // Same totals again: nothing new to log.
    await api.sync({ manual: true });
    expect(logged).toHaveLength(1);

    // A snack added in Cronometer: only the snack is logged.
    totals = { ...totals, energyKcal: 700, protein: 60 };
    await api.sync();
    expect(logged[1]).toEqual({ protein: 20, carbs: 0, fats: 0, cals: 120 });
  });

  test('does nothing on a day marked complete', async () => {
    const hc = plugin(() => ({ energyKcal: 100, protein: 25, carbs: 0, fat: 0 }));
    const { logged, api } = setup(hc);
    localStorage.setItem('healthNutritionEnabled_sam', '1');
    window.isMacroDayComplete = () => true;
    await api.refresh();
    expect(hc.getNutritionTotals).not.toHaveBeenCalled();
    expect(logged).toHaveLength(0);
  });

  test('stays hidden outside the Android app', async () => {
    const { api } = setup(plugin(() => ({})));
    window.Capacitor.getPlatform = () => 'ios';
    await api.refresh();
    expect(document.getElementById('healthNutritionCard').hidden).toBe(true);
  });
});
