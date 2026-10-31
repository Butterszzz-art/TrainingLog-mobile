// =============================================================
// MACRO QUICK ADD
// The chips under today's calories on the Macros tab. They add
// calories or macros to the day without picking a food or a meal.
// Each add is also kept in a small list for today, so the card can
// show what was quick-added and undo the last one.
// Totals still go through logMacroAmounts() (index.html), which
// saves today's progress, respects "Mark complete" and redraws.
// =============================================================

(function (global) {
  const STORE_KEY = 'dailyMacroQuickAdds';
  const TYPES = ['protein', 'carbs', 'fat', 'cal'];

  function today() {
    return typeof global.getTodayDateString === 'function'
      ? global.getTodayDateString()
      : new Date().toISOString().slice(0, 10);
  }

  // Today's quick adds, oldest first. A list from another day reads as empty.
  function loadQuickAdds() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved && saved.date === today() && Array.isArray(saved.items)) return saved.items;
    } catch (_err) { /* bad JSON: start over */ }
    return [];
  }

  function saveQuickAdds(items) {
    localStorage.setItem(STORE_KEY, JSON.stringify({ date: today(), items }));
  }

  function toDelta(type, amount) {
    if (type === 'cal') return { cals: amount };
    if (type === 'fat') return { fats: amount };
    return { [type]: amount };
  }

  function log(delta) {
    return typeof global.logMacroAmounts === 'function' ? global.logMacroAmounts(delta) : null;
  }

  function quickAddMacro(type, amount) {
    const n = Math.round(Number(amount) * 10) / 10;
    if (!TYPES.includes(type) || !Number.isFinite(n) || n === 0) return false;
    // Negative amounts are a plain correction; only adds go in the list.
    if (n < 0) {
      log(toDelta(type, n));
      renderQuickAddToday();
      return true;
    }
    if (!log(toDelta(type, n))) return false; // day locked (or not ready)
    const items = loadQuickAdds();
    items.push({ type, amount: n });
    saveQuickAdds(items);
    renderQuickAddToday();
    return true;
  }

  function undoQuickAdd() {
    const items = loadQuickAdds();
    const last = items[items.length - 1];
    if (!last) return false;
    if (!log(toDelta(last.type, -last.amount))) return false;
    items.pop();
    saveQuickAdds(items);
    renderQuickAddToday();
    return true;
  }

  function clearQuickAdds() {
    localStorage.removeItem(STORE_KEY);
    renderQuickAddToday();
  }

  function summarize(items) {
    const sum = { protein: 0, carbs: 0, fat: 0, cal: 0 };
    items.forEach((i) => { if (sum[i.type] !== undefined) sum[i.type] += Number(i.amount) || 0; });
    const r = (v) => Math.round(v * 10) / 10;
    const parts = [];
    if (sum.protein) parts.push(`+${r(sum.protein)}g P`);
    if (sum.carbs) parts.push(`+${r(sum.carbs)}g C`);
    if (sum.fat) parts.push(`+${r(sum.fat)}g F`);
    if (sum.cal) parts.push(`+${Math.round(sum.cal)} kcal`);
    return parts.join(' · ');
  }

  function renderQuickAddToday() {
    if (typeof document === 'undefined') return;
    const items = loadQuickAdds();
    const line = document.getElementById('macroQuickToday');
    if (line) {
      line.textContent = items.length
        ? `Quick-added today: ${summarize(items)}`
        : 'Counts for the day, not a meal.';
    }
    const undo = document.getElementById('macroQuickUndo');
    if (undo) undo.hidden = !items.length;
  }

  // ── Custom amount row ───────────────────────────────────────
  let customType = 'protein';

  function toggleQuickAddCustom(force) {
    const row = document.getElementById('macroQuickCustom');
    const btn = document.getElementById('macroQuickCustomBtn');
    if (!row) return;
    row.hidden = typeof force === 'boolean' ? !force : !row.hidden;
    btn?.setAttribute('aria-expanded', row.hidden ? 'false' : 'true');
    if (!row.hidden) setTimeout(() => document.getElementById('macroQuickAmount')?.focus(), 30);
  }

  function setQuickAddType(btn) {
    if (!btn?.dataset.qaType) return;
    customType = btn.dataset.qaType;
    document.querySelectorAll('#macroQuickCustom [data-qa-type]').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const input = document.getElementById('macroQuickAmount');
    if (input) input.placeholder = customType === 'cal' ? 'kcal' : 'grams';
  }

  function quickAddCustom() {
    const input = document.getElementById('macroQuickAmount');
    const amount = Number(input?.value);
    if (!(amount > 0)) {
      global.showToast?.('Enter an amount above 0.', 'warn');
      input?.focus();
      return;
    }
    if (quickAddMacro(customType, amount) && input) input.value = '';
  }

  global.quickAddMacro = quickAddMacro;
  global.undoQuickAdd = undoQuickAdd;
  global.clearQuickAdds = clearQuickAdds;
  global.loadQuickAdds = loadQuickAdds;
  global.renderQuickAddToday = renderQuickAddToday;
  global.toggleQuickAddCustom = toggleQuickAddCustom;
  global.setQuickAddType = setQuickAddType;
  global.quickAddCustom = quickAddCustom;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderQuickAddToday);
    else renderQuickAddToday();
  }
})(typeof window !== 'undefined' ? window : globalThis);
