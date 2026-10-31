const fs = require('fs');
const vm = require('vm');

// The quick-add chips under today's calories (src/js/macro-quick-add.js):
// they add to the day through logMacroAmounts, keep a list of today's quick
// adds for the summary line, and can undo the last one.
const src = fs.readFileSync('src/js/macro-quick-add.js', 'utf8');

function setup({ date = '2026-10-31', locked = false, store = {} } = {}) {
  const els = {
    macroQuickToday: { textContent: '' },
    macroQuickUndo: { hidden: true },
    macroQuickAmount: { value: '', focus: () => {} },
  };
  const logged = [];
  const toasts = [];
  const ctx = {
    getTodayDateString: () => ctx.__date,
    logMacroAmounts: jest.fn((delta) => {
      if (ctx.__locked) return null;
      logged.push(delta);
      return { ok: true };
    }),
    showToast: (msg, type) => toasts.push({ msg, type }),
    localStorage: {
      setItem: (k, v) => { store[k] = String(v); },
      getItem: (k) => store[k] ?? null,
      removeItem: (k) => { delete store[k]; },
    },
    document: {
      readyState: 'complete',
      getElementById: (id) => els[id] || null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    setTimeout: () => {},
    __date: date,
    __locked: locked,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, els, logged, toasts, store };
}

describe('Macros quick-add chips', () => {
  test('each chip logs the right macro and shows up in the today line', () => {
    const { ctx, els, logged } = setup();
    ctx.quickAddMacro('protein', 25);
    ctx.quickAddMacro('fat', 10);
    ctx.quickAddMacro('cal', 250);
    ctx.quickAddMacro('protein', 10);

    expect(logged).toEqual([{ protein: 25 }, { fats: 10 }, { cals: 250 }, { protein: 10 }]);
    expect(els.macroQuickToday.textContent).toBe('Quick-added today: +35g P · +10g F · +250 kcal');
    expect(els.macroQuickUndo.hidden).toBe(false);
  });

  test('undo takes back only the last quick add', () => {
    const { ctx, els, logged } = setup();
    ctx.quickAddMacro('carbs', 25);
    ctx.quickAddMacro('cal', 100);
    expect(ctx.undoQuickAdd()).toBe(true);

    expect(logged[logged.length - 1]).toEqual({ cals: -100 });
    expect(ctx.loadQuickAdds()).toEqual([{ type: 'carbs', amount: 25 }]);
    expect(els.macroQuickToday.textContent).toBe('Quick-added today: +25g C');

    ctx.undoQuickAdd();
    expect(els.macroQuickUndo.hidden).toBe(true);
    expect(els.macroQuickToday.textContent).toBe('Counts for the day, not a meal.');
    expect(ctx.undoQuickAdd()).toBe(false);
  });

  test('a completed (locked) day records nothing and undo keeps the list', () => {
    const { ctx } = setup();
    ctx.quickAddMacro('protein', 25);
    ctx.__locked = true;
    expect(ctx.quickAddMacro('protein', 10)).toBe(false);
    expect(ctx.undoQuickAdd()).toBe(false);
    expect(ctx.loadQuickAdds()).toEqual([{ type: 'protein', amount: 25 }]);
  });

  test("yesterday's quick adds don't carry into today", () => {
    const { ctx, els } = setup();
    ctx.quickAddMacro('protein', 25);
    ctx.__date = '2026-11-01';
    ctx.renderQuickAddToday();
    expect(ctx.loadQuickAdds()).toEqual([]);
    expect(els.macroQuickUndo.hidden).toBe(true);
    expect(ctx.undoQuickAdd()).toBe(false);
  });

  test('custom amount adds the picked macro and rejects empty input', () => {
    const { ctx, els, logged, toasts } = setup();
    els.macroQuickAmount.value = '';
    ctx.quickAddCustom();
    expect(logged).toEqual([]);
    expect(toasts.pop().msg).toMatch(/amount/);

    els.macroQuickAmount.value = '42.5';
    ctx.quickAddCustom(); // protein is the default pick
    expect(logged).toEqual([{ protein: 42.5 }]);
    expect(els.macroQuickAmount.value).toBe('');
  });

  test('clearQuickAdds empties the list (used by Copy previous day)', () => {
    const { ctx, els } = setup();
    ctx.quickAddMacro('fat', 5);
    ctx.clearQuickAdds();
    expect(ctx.loadQuickAdds()).toEqual([]);
    expect(els.macroQuickUndo.hidden).toBe(true);
  });

  test('ignores unknown types and zero amounts', () => {
    const { ctx, logged } = setup();
    expect(ctx.quickAddMacro('sugar', 10)).toBe(false);
    expect(ctx.quickAddMacro('protein', 0)).toBe(false);
    expect(logged).toEqual([]);
  });
});
