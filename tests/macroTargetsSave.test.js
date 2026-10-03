const fs = require('fs');
const vm = require('vm');

// Regression tests for macro targets that "saved" but never stuck:
// - the server returns Airtable-shaped keys (Calories/Protein/...), which were
//   written straight into localStorage over the user's lowercase targets;
// - "Macro targets saved!" was shown even when the request failed.
const html = fs.readFileSync('index.html', 'utf8');
function extract(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`could not find ${startMarker}`);
  return html.slice(start, end);
}

describe('normalizeMacroTargets', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extract('function normalizeMacroTargets(', 'async function fetchUserMacroTargets'), ctx);

  test('maps server (Airtable-shaped) fields to lowercase keys', () => {
    expect(ctx.normalizeMacroTargets({ id: 'x', Calories: 2500, Protein: 180, Fat: 70, Carbs: 250 }))
      .toEqual({ calories: 2500, protein: 180, fat: 70, carbs: 250 });
  });

  test('keeps already-normalized targets as they are', () => {
    expect(ctx.normalizeMacroTargets({ calories: 2000, protein: 150, fat: 60, carbs: 200 }))
      .toEqual({ calories: 2000, protein: 150, fat: 60, carbs: 200 });
  });

  test('returns null for empty or calorie-less records', () => {
    expect(ctx.normalizeMacroTargets(null)).toBeNull();
    expect(ctx.normalizeMacroTargets({ Calories: null, Protein: null })).toBeNull();
  });
});

describe('saveSliderMacros', () => {
  function setup(fetchImpl) {
    const store = {};
    const toasts = [];
    const sliders = { proteinSlider: 150, fatSlider: 60, carbSlider: 200 };
    const ctx = {
      currentUser: 'alice',
      window: { SERVER_URL: 'http://x', showToast: (msg, type) => toasts.push({ msg, type }) },
      document: { getElementById: id => ({ value: String(sliders[id] ?? ''), textContent: '' }) },
      localStorage: { setItem: (k, v) => { store[k] = v; }, getItem: k => store[k] ?? null },
      fetch: fetchImpl,
      getAuthHeaders: () => ({}),
      updateMacroUI: () => {},
      alert: () => {},
      console: { error: () => {} },
      macroRanges: null,
    };
    vm.createContext(ctx);
    vm.runInContext(`
      let macroTargetCalories = 0, macroTargetProtein = 0, macroTargetFat = 0, macroTargetCarbs = 0;
      ${extract('function saveSliderMacros()', 'function updateSliderMacros()')}
      ${extract('// Resolves true only when the server accepted the targets.', 'function saveMacroTargetsToTop(')}
      ${extract('function saveMacroTargetsToTop(', 'function renderMacroSlots()')}
      this.saveSliderMacros = saveSliderMacros;
    `, ctx);
    return { ctx, store, toasts };
  }
  const flush = () => new Promise(r => setTimeout(r, 0));

  test('saves on the device and reports success when the server accepts', async () => {
    const { ctx, store, toasts } = setup(async () => ({ ok: true, json: async () => ({ success: true }) }));
    ctx.saveSliderMacros();
    await flush();
    expect(JSON.parse(store.macroTargets_alice)).toEqual({ calories: 1940, protein: 150, fat: 60, carbs: 200 });
    expect(toasts).toEqual([{ msg: 'Macro targets saved!', type: 'success' }]);
  });

  test('does not claim success when the server rejects the save', async () => {
    const { ctx, store, toasts } = setup(async () => ({ ok: false, json: async () => ({ success: false }) }));
    ctx.saveSliderMacros();
    await flush();
    expect(JSON.parse(store.macroTargets_alice).protein).toBe(150);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
  });
});
