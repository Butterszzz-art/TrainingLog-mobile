/**
 * @jest-environment node
 */
const limits = require('../src/js/plan-limits.js');

describe('custom program limit', () => {
  const custom = (id) => ({ programId: id, name: id });
  const library = (id) => ({ programId: id, source: { type: 'library', id } });

  test('free accounts can save one custom program', () => {
    expect(limits.canSaveProgram([], custom('a'), false)).toBe(true);
    expect(limits.canSaveProgram([custom('a')], custom('b'), false)).toBe(false);
  });

  test('updating the saved program is always allowed', () => {
    expect(limits.canSaveProgram([custom('a')], custom('a'), false)).toBe(true);
  });

  test('programs with a source do not count and are not limited', () => {
    expect(limits.customProgramCount([library('x'), library('y'), custom('a')])).toBe(1);
    expect(limits.canSaveProgram([library('x')], custom('a'), false)).toBe(true);
    expect(limits.canSaveProgram([custom('a')], library('x'), false)).toBe(true);
  });

  test('paid accounts have no limit', () => {
    expect(limits.canSaveProgram([custom('a'), custom('b')], custom('c'), true)).toBe(true);
  });
});

describe('history window', () => {
  const now = new Date(2026, 10, 3, 9, 0, 0); // 3 Nov 2026, local

  test('free cutoff is today plus the 27 days before', () => {
    expect(limits.historyCutoff(now, false)).toBe('2026-10-07');
    expect(limits.historyCutoff(now, true)).toBeNull();
  });

  test('clipHistory drops older items and counts them', () => {
    const items = [
      { date: '2026-09-01' },
      { date: '2026-10-06' },
      { date: '2026-10-07' },
      { date: '2026-11-03T08:00:00Z' },
      { date: null },
    ];
    const out = limits.clipHistory(items, (x) => x.date, { now, paid: false });
    expect(out.items.map((x) => x.date)).toEqual(['2026-10-07', '2026-11-03T08:00:00Z', null]);
    expect(out.hidden).toBe(2);
  });

  test('paid accounts keep everything', () => {
    const items = [{ date: '2020-01-01' }];
    expect(limits.clipHistory(items, null, { now, paid: true })).toEqual({ items, hidden: 0 });
  });

  test('note only shows when something was hidden', () => {
    expect(limits.historyNoteHtml(0)).toBe('');
    expect(limits.historyNoteHtml(3)).toMatch(/last 4 weeks/);
  });
});
