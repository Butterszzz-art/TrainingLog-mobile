const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { usageLabel } = require('../src/js/ai-usage');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/ai-usage.js'), 'utf8');

describe('usageLabel', () => {
  test('free accounts always see what is left', () => {
    expect(usageLabel({ used: 2, limit: 5 }, false)).toBe('3 of 5 free AI uses left this month');
    expect(usageLabel({ used: 9, limit: 5 }, false)).toBe('0 of 5 free AI uses left this month');
  });

  test('paid accounts see nothing until 80% used', () => {
    expect(usageLabel({ used: 119, limit: 150 }, true)).toBe('');
    expect(usageLabel({ used: 120, limit: 150 }, true)).toBe('120 of 150 AI uses this month');
  });

  test('no usage data, no label', () => {
    expect(usageLabel(null, false)).toBe('');
    expect(usageLabel({ used: 0, limit: 0 }, false)).toBe('');
  });
});

describe('counter elements', () => {
  function load(paid = false) {
    const dom = new JSDOM('<!doctype html><body><p data-ai-usage hidden></p><p data-ai-usage hidden></p></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.hasPaidAccess = () => paid;
    w.eval(SRC);
    return w;
  }

  test('set() fills every counter; the header event updates it', () => {
    const w = load();
    w.PocketCoachAiUsage.set({ used: 1, limit: 5, resetsAt: '2026-11-01T00:00:00Z' });
    const els = w.document.querySelectorAll('[data-ai-usage]');
    expect([...els].map(e => e.textContent)).toEqual(['4 of 5 free AI uses left this month', '4 of 5 free AI uses left this month']);
    expect(els[0].hidden).toBe(false);

    w.document.dispatchEvent(new w.CustomEvent('pc:ai-remaining', { detail: { remaining: 2 } }));
    expect(els[0].textContent).toBe('2 of 5 free AI uses left this month');
    expect(w.PocketCoachAiUsage.remaining()).toBe(2);
  });

  test('paid under 80% hides the counter; null usage clears it', () => {
    const w = load(true);
    w.PocketCoachAiUsage.set({ used: 10, limit: 150 });
    expect(w.document.querySelector('[data-ai-usage]').hidden).toBe(true);
    w.PocketCoachAiUsage.set(null);
    expect(w.PocketCoachAiUsage.remaining()).toBe(null);
  });
});
