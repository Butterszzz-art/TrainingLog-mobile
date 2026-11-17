/* =============================================================
   MEAL TIMING CORE — pure helpers for meal times, spacing and fasting
   No DOM, no storage: meal-timing.js (the UI) and the jest tests
   (tests/mealTiming.test.js) both use these.

   A food log entry (food-core.js) can carry `eatenAt`: when it was
   eaten, in epoch ms. It's set when food is logged for today (the meal's
   time if the meal already has one, else now) and the user can change a
   meal's time by tapping it. `t` stays "when it was logged".

   Coach meal plan foods that aren't ticked off yet (coach && !confirmed)
   are planned, not eaten, so they never count as a meal here, and neither
   does anything with a time still in the future.

   The fasting plan (fastingPlan_<user>, synced):
     { on: bool, hours: 16, startedAt?: ms }
   startedAt is "I stopped eating now" (closing the window early); a meal
   eaten after it simply takes over.
   ============================================================= */

(function (root) {
  'use strict';

  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const FAST_PRESETS = [12, 14, 16, 18, 20];
  const DEFAULT_HOURS = 16;
  // A gap at least this long between meals is a fast (an overnight one, or a
  // planned one), not just the space between two meals.
  const FAST_MIN_HOURS = 8;
  const STALE_HOURS = 36;

  const isNum = v => typeof v === 'number' && Number.isFinite(v);

  // ── Clock times ─────────────────────────────────────────────────────
  // "08:05" from epoch ms, in the phone's local time.
  function hhmm(ms) {
    if (!isNum(ms)) return '';
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // "4h 05m", "45m", "16h".
  function duration(ms) {
    if (!isNum(ms) || ms < 0) return '';
    const m = Math.round(ms / MIN);
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (!h) return `${r}m`;
    return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
  }

  // Epoch ms for "HH:MM" on a food log day. Food log dates are UTC calendar
  // days (getTodayDateString), so the time is put on whichever local day
  // makes the moment fall on that UTC date: in the Netherlands 00:30 on
  // "2026-11-17" is the night after the 17th, in New York 21:00 on the 17th
  // is the evening of the 16th. Falls back to the local day itself.
  function timeOnDay(date, time) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
    if (!dm || !tm) return null;
    const h = Number(tm[1]);
    const mi = Number(tm[2]);
    if (h > 23 || mi > 59) return null;
    const at = off => new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]) + off, h, mi).getTime();
    for (const off of [0, 1, -1]) {
      const ms = at(off);
      if (new Date(ms).toISOString().slice(0, 10) === date) return ms;
    }
    return at(0);
  }

  // ── Entries → meals ─────────────────────────────────────────────────
  function isPlannedOnly(e) {
    return !!(e && e.coach && !e.confirmed);
  }

  // Entries that count as eaten at a known time (by `now`).
  function eatenEntries(entries, now) {
    return (entries || []).filter(e => e && isNum(e.eatenAt) && !isPlannedOnly(e) && (!isNum(now) || e.eatenAt <= now));
  }

  // The time a meal on a day was eaten: its earliest food's eatenAt.
  function mealTime(entries, date, meal) {
    const ts = (entries || []).filter(e => e && e.date === date && e.meal === meal && isNum(e.eatenAt)).map(e => e.eatenAt);
    return ts.length ? Math.min(...ts) : null;
  }

  // One event per meal eaten (date + meal), oldest first: { date, meal, at }.
  function mealEvents(entries, now) {
    const by = new Map();
    eatenEntries(entries, now).forEach(e => {
      const k = `${e.date}|${e.meal}`;
      const cur = by.get(k);
      if (!cur || e.eatenAt < cur.at) by.set(k, { date: e.date, meal: e.meal, at: e.eatenAt });
    });
    return [...by.values()].sort((a, b) => a.at - b.at);
  }

  // When a new entry was eaten: the meal's time when it already has one that
  // day, else now when it's being logged for today, else unknown (an earlier
  // day being filled in — the user can set the meal's time).
  // → the entry, with eatenAt when there is one.
  function stampEntry(entry, dayEntries, { today, now } = {}) {
    if (!entry || isPlannedOnly(entry) || isNum(entry.eatenAt)) return entry;
    const others = (dayEntries || []).filter(e => e && e !== entry && e.id !== entry.id);
    const t = mealTime(others, entry.date, entry.meal);
    if (t !== null) return { ...entry, eatenAt: t };
    if (entry.date === today && isNum(now)) return { ...entry, eatenAt: now };
    return entry;
  }

  // ── A day's spacing ────────────────────────────────────────────────
  // → null without timed meals, else
  //   { meals, first, last, window, gaps: [ms], avgGap, longestGap }
  function daySummary(dayEntries, now) {
    const ev = mealEvents(dayEntries, now);
    if (!ev.length) return null;
    const gaps = ev.slice(1).map((x, i) => x.at - ev[i].at);
    return {
      meals: ev.length,
      first: ev[0].at,
      last: ev[ev.length - 1].at,
      window: ev[ev.length - 1].at - ev[0].at,
      gaps,
      avgGap: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
      longestGap: gaps.length ? Math.max(...gaps) : null,
    };
  }

  // ── Fasting ────────────────────────────────────────────────────────
  function normalizePlan(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const h = Math.round(Number(r.hours));
    const hours = Number.isFinite(h) && h >= 10 && h <= 23 ? h : DEFAULT_HOURS;
    const out = { on: !!r.on, hours };
    if (isNum(r.startedAt) && r.startedAt > 0) out.startedAt = r.startedAt;
    return out;
  }

  // Finished fasts: gaps of FAST_MIN_HOURS or more between meals, oldest
  // first, ending in the last `days` days. → [{ start, end, length }]
  function pastFasts(entries, now, { days = 7 } = {}) {
    const ev = mealEvents(entries, now);
    const from = now - days * DAY;
    const out = [];
    for (let i = 1; i < ev.length; i++) {
      const length = ev[i].at - ev[i - 1].at;
      if (length >= FAST_MIN_HOURS * HOUR && ev[i].at >= from) out.push({ start: ev[i - 1].at, end: ev[i].at, length });
    }
    return out;
  }

  /**
   * Where the user is right now.
   *   { state: 'none' }                       nothing timed to go on
   *   { state: 'eating', windowStart, windowEnd, left, lastMeal }
   *       the plan is on and the eating window (24 − hours, from the first
   *       meal after the last fast) is still open
   *   { state: 'fasting', start, elapsed, goal, goalAt, done, progress, manual }
   *       since the last meal (or since "start fast now")
   * goal/goalAt/done/progress only when the plan is on.
   */
  function fastStatus(entries, plan, now) {
    const p = normalizePlan(plan);
    const ev = mealEvents(entries, now);
    const last = ev.length ? ev[ev.length - 1].at : null;
    const manual = isNum(p.startedAt) && p.startedAt <= now && (last === null || p.startedAt > last) ? p.startedAt : null;

    if (p.on && !manual && last !== null) {
      // The eating window opened at the first meal after the last fast.
      let i = ev.length - 1;
      while (i > 0 && ev[i].at - ev[i - 1].at < FAST_MIN_HOURS * HOUR) i--;
      const windowStart = ev[i].at;
      const windowEnd = windowStart + (24 - p.hours) * HOUR;
      if (now < windowEnd && now - last < FAST_MIN_HOURS * HOUR) {
        return { state: 'eating', windowStart, windowEnd, left: windowEnd - now, lastMeal: last };
      }
    }

    const start = manual ?? last;
    // Nothing logged for a day and a half is a gap in logging, not a fast.
    if (start === null || (!manual && now - start > STALE_HOURS * HOUR)) return { state: 'none' };
    const elapsed = Math.max(0, now - start);
    const out = { state: 'fasting', start, elapsed, manual: manual !== null };
    if (p.on) {
      const goal = p.hours * HOUR;
      Object.assign(out, { goal, goalAt: start + goal, done: elapsed >= goal, progress: Math.min(1, elapsed / goal) });
    }
    return out;
  }

  // Averages over the last `days` days, for the timing sheet:
  //   { days (with timed meals), avgFirst, avgLast (minutes after local
  //     midnight), avgWindow, avgGap, avgMeals, fasts, avgFast, longestFast,
  //     goalHit (fasts at least plan.hours long, when the plan is on) }
  function weekStats(entries, plan, now, { days = 7 } = {}) {
    const p = normalizePlan(plan);
    const from = now - days * DAY;
    const byDay = new Map();
    eatenEntries(entries, now).filter(e => e.eatenAt >= from).forEach(e => {
      (byDay.get(e.date) || byDay.set(e.date, []).get(e.date)).push(e);
    });
    const sums = [...byDay.values()].map(list => daySummary(list, now)).filter(Boolean);
    const avg = list => (list.length ? Math.round(list.reduce((s, x) => s + x, 0) / list.length) : null);
    // Minutes after local midnight; before 04:00 counts as late the night
    // before, so 23:30 and 00:30 average to midnight, not noon.
    const clock = ms => { const d = new Date(ms); const m = d.getHours() * 60 + d.getMinutes(); return m < 240 ? m + 1440 : m; };
    const gaps = sums.flatMap(s => s.gaps);
    const fasts = pastFasts(entries, now, { days });
    return {
      days: sums.length,
      avgFirst: avg(sums.map(s => clock(s.first))),
      avgLast: avg(sums.map(s => clock(s.last))),
      avgWindow: avg(sums.filter(s => s.meals > 1).map(s => s.window)),
      avgGap: avg(gaps),
      avgMeals: sums.length ? Math.round((sums.reduce((s, x) => s + x.meals, 0) / sums.length) * 10) / 10 : null,
      fasts: fasts.length,
      avgFast: avg(fasts.map(f => f.length)),
      longestFast: fasts.length ? Math.max(...fasts.map(f => f.length)) : null,
      ...(p.on ? { goalHit: fasts.filter(f => f.length >= p.hours * HOUR).length } : {}),
    };
  }

  // "08:05" from minutes after midnight.
  function clockLabel(min) {
    if (!isNum(min)) return '';
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  const api = {
    MIN, HOUR, DAY, FAST_PRESETS, DEFAULT_HOURS, FAST_MIN_HOURS,
    hhmm, duration, timeOnDay, clockLabel,
    isPlannedOnly, eatenEntries, mealTime, mealEvents, stampEntry,
    daySummary, normalizePlan, pastFasts, fastStatus, weekStats,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MealTimingCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
