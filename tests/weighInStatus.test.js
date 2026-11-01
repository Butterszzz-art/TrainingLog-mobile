/**
 * @jest-environment node
 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
const engagement = require('../engagementFeatures.js');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('getWeighInStatus', () => {
  beforeEach(() => localStorage.clear());

  test('uses the newest date even when the log is not in date order', () => {
    localStorage.setItem('bodyweightLog_ana', JSON.stringify([
      { date: daysAgo(2), weight: 80 },
      { date: daysAgo(97), weight: 84 },
    ]));
    const status = engagement.getWeighInStatus('ana', 7);
    expect(status.lastDate).toBe(daysAgo(2));
    expect(status.daysSince).toBe(2);
    expect(status.overdue).toBe(false);
  });

  test('still reports overdue when the newest weigh-in is old', () => {
    localStorage.setItem('bodyweightLog_ana', JSON.stringify([{ date: daysAgo(10), weight: 80 }]));
    const status = engagement.getWeighInStatus('ana', 7);
    expect(status.overdue).toBe(true);
    expect(status.daysUntilDue).toBe(-3);
  });
});
