/**
 * @jest-environment node
 */
const { _countCalTargetDays, _toDateKey } = require('../src/js/weekly-summary');

const WEEK = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];

describe('weekly-summary calorie compliance', () => {
  test('reads the array shape written by addMacroHistoryEntry (totals.calories)', () => {
    const history = [
      { date: '2026-09-21', meals: [], totals: { calories: 2000, protein: 150 } }, // on target
      { date: '2026-09-22', meals: [], totals: { calories: 2250 } },              // 1.125 → hit
      { date: '2026-09-23', meals: [], totals: { calories: 2400 } },              // 1.2 → miss
      { date: '2026-09-20', meals: [], totals: { calories: 2000 } },              // outside week
    ];
    expect(_countCalTargetDays(history, 2000, WEEK)).toBe(2);
  });

  test('last save of a day wins', () => {
    const history = [
      { date: '2026-09-24', totals: { calories: 500 } },
      { date: '2026-09-24', totals: { calories: 1950 } },
      { date: '2026-09-25', totals: { calories: 2000 } },
      { date: '2026-09-25', totals: { calories: 3000 } },
    ];
    expect(_countCalTargetDays(history, 2000, WEEK)).toBe(1);
  });

  test('tolerates the legacy object-keyed-by-date shape', () => {
    const history = {
      '2026-09-21': { calories: 1900 },
      '2026-09-22': { totals: { calories: 2100 } },
      '2026-09-23': { calories: 1000 },
    };
    expect(_countCalTargetDays(history, 2000, WEEK)).toBe(2);
  });

  test('keeps the 0.85–1.15 band inclusive', () => {
    const history = [
      { date: '2026-09-21', totals: { calories: 1700 } }, // 0.85
      { date: '2026-09-22', totals: { calories: 2300 } }, // 1.15
      { date: '2026-09-23', totals: { calories: 1699 } },
      { date: '2026-09-24', totals: { calories: 2301 } },
    ];
    expect(_countCalTargetDays(history, 2000, WEEK)).toBe(2);
  });

  test('returns 0 without a target or history', () => {
    expect(_countCalTargetDays([{ date: '2026-09-21', totals: { calories: 2000 } }], 0, WEEK)).toBe(0);
    expect(_countCalTargetDays(null, 2000, WEEK)).toBe(0);
  });

  test('_toDateKey uses local date parts, not UTC', () => {
    // 00:30 local on Sep 21 — toISOString() would give Sep 20 east of UTC.
    expect(_toDateKey(new Date(2026, 8, 21, 0, 30))).toBe('2026-09-21');
    expect(_toDateKey(new Date(2026, 8, 21, 23, 45))).toBe('2026-09-21');
  });
});
