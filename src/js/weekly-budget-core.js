/* =============================================================
   WEEKLY MACRO BUDGET — core (pure, tested: tests/weeklyBudget.test.js)
   The week's targets added up (Monday to Sunday), what has been
   eaten so far and what is left, so a lifter can see whether a
   bigger meal still fits the week, or whether the days ahead need
   to come down (or up) to land on the weekly number.

   weekly-budget.js gathers the days from the device and renders the
   card on the Macros tab; this file only does the sums.

   Rules:
   - The week runs Monday to Sunday in the lifter's own calendar.
   - An earlier day that has no food logged is left out of the week
     (its target too): an unlogged day is unknown, not a 0 kcal day,
     and counting it would make the "left" number look huge.
   - Today and the days ahead always count, at their target.
   - "Banked" is what earlier logged days came in under (+) or over
     (−) their targets. Spread over today and the days ahead it gives
     the daily average that still lands on the weekly budget.
   ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WeeklyBudgetCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const KEYS = ['kcal', 'protein', 'carbs', 'fat'];
  // Within this share of the budget (either way) the week reads "on track".
  const ON_TRACK_SHARE = 0.03;

  function parseKey(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function toKey(date) {
    return date.toISOString().slice(0, 10);
  }
  function addDays(key, n) {
    const d = parseKey(key);
    d.setUTCDate(d.getUTCDate() + n);
    return toKey(d);
  }
  /** Monday of the week that holds `key` (YYYY-MM-DD). */
  function weekStart(key) {
    const dow = (parseKey(key).getUTCDay() + 6) % 7; // Monday = 0
    return addDays(key, -dow);
  }
  /** The seven date keys of the week that holds `key`. */
  function weekDays(key) {
    const start = weekStart(key);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  function clean(m) {
    if (!m) return null;
    const out = zero();
    KEYS.forEach(k => { out[k] = Math.max(0, Number(m[k]) || 0); });
    if (!out.kcal) out.kcal = Math.round(out.protein * 4 + out.carbs * 4 + out.fat * 9);
    return out;
  }
  function add(a, b) {
    const out = zero();
    KEYS.forEach(k => { out[k] = (a[k] || 0) + (b[k] || 0); });
    return out;
  }
  function round(m) {
    const out = {};
    KEYS.forEach(k => { out[k] = Math.round(m[k]); });
    return out;
  }

  /**
   * @param {object} input
   * @param {string} input.today         YYYY-MM-DD
   * @param {(date: string) => object|null} input.eatenOn
   *        Totals eaten that day ({ kcal, protein, carbs, fat }), or null
   *        when nothing was logged. Today may return null too (0 so far).
   * @param {(date: string) => object|null} input.targetFor
   *        That day's targets ({ kcal, protein, carbs, fat }).
   */
  function computeWeek({ today, eatenOn, targetFor }) {
    const days = weekDays(today).map(date => {
      const when = date < today ? 'past' : date === today ? 'today' : 'ahead';
      const eatenRaw = clean(eatenOn(date));
      const logged = Boolean(eatenRaw && eatenRaw.kcal > 0);
      const counted = when !== 'past' || logged;
      return {
        date,
        when,
        logged,
        counted,
        eaten: logged ? eatenRaw : zero(),
        target: clean(targetFor(date)) || zero(),
      };
    });

    const counted = days.filter(d => d.counted);
    const budget = counted.reduce((s, d) => add(s, d.target), zero());
    const eaten = counted.reduce((s, d) => add(s, d.eaten), zero());
    const left = {};
    KEYS.forEach(k => { left[k] = budget[k] - eaten[k]; });

    // Earlier logged days: under (+) or over (−) their targets.
    const banked = {};
    KEYS.forEach(k => {
      banked[k] = days.filter(d => d.when === 'past' && d.counted)
        .reduce((s, d) => s + (d.target[k] - d.eaten[k]), 0);
    });

    // Today and the days ahead: the average per day that lands on the
    // weekly budget, next to their usual target.
    const remaining = days.filter(d => d.when !== 'past');
    const remainingTarget = remaining.reduce((s, d) => add(s, d.target), zero());
    const perDay = {};
    const usualPerDay = {};
    KEYS.forEach(k => {
      usualPerDay[k] = remaining.length ? remainingTarget[k] / remaining.length : 0;
      perDay[k] = remaining.length ? Math.max(0, usualPerDay[k] + banked[k] / remaining.length) : 0;
    });

    // Where the week "should" be by the end of today if every day hits its
    // target (the bar's pace marker).
    const paceKcal = counted.filter(d => d.when !== 'ahead').reduce((s, d) => s + d.target.kcal, 0);

    const tolerance = Math.max(50, budget.kcal * ON_TRACK_SHARE);
    let status = 'on_track';
    if (banked.kcal > tolerance) status = 'under';
    else if (banked.kcal < -tolerance) status = 'over';
    if (left.kcal < 0) status = 'over_week';

    return {
      start: days[0].date,
      end: days[6].date,
      days,
      daysLogged: days.filter(d => d.logged).length,
      daysSkipped: days.filter(d => !d.counted).length,
      daysRemaining: remaining.length,
      budget: round(budget),
      eaten: round(eaten),
      left: round(left),
      banked: round(banked),
      perDay: round(perDay),
      usualPerDay: round(usualPerDay),
      paceKcal: Math.round(paceKcal),
      status,
    };
  }

  const fmt = n => Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-GB');

  /** One plain line on what the week leaves room for. */
  function headline(week) {
    const b = week.banked.kcal;
    const n = week.daysRemaining;
    const rest = n === 1 ? 'today' : `the last ${n} days`;
    switch (week.status) {
      case 'over_week':
        return `Over the week's budget by ${fmt(week.left.kcal)} kcal. Stay close to target for ${rest} and pick it up next week.`;
      case 'over':
        return `${fmt(b)} kcal over so far. About ${fmt(week.perDay.kcal)} kcal a day for ${rest} brings the week back on budget.`;
      case 'under':
        return `${fmt(b)} kcal banked from earlier days: room for a bigger meal, or about ${fmt(week.perDay.kcal)} kcal a day for ${rest}.`;
      default:
        return `On track. Keep to about ${fmt(week.perDay.kcal)} kcal a day for ${rest}.`;
    }
  }

  return { KEYS, weekStart, weekDays, addDays, computeWeek, headline };
});
