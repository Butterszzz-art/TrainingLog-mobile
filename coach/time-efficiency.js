/* Coach dashboard: Butters University "Time-efficient training".
 *
 *   compressDay(day)      the program builder's "Compress": pairs a day's
 *                         non-competing exercises into supersets (rows get
 *                         a `superset` letter, partners sit next to each
 *                         other) and estimates the minutes saved. The first
 *                         heavy compound keeps its full rest and stays
 *                         alone. Uses the same rules as the app's
 *                         performance-mode time budget (time-budget-core.js).
 *   sessionTimeCard(d)    the client overview's "Session time" card: how
 *                         long sessions take vs. their target (the client's
 *                         time budget or the plan's estimate), minutes per
 *                         set, and weekly sets per muscle against BU's
 *                         bands. Data: the client's share (sessionTimes,
 *                         weeklyMuscleSets; backend coachShare.js).
 *
 * Pure (no DOM). Tests: tests/coachTimeEfficiency.test.js. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CoachTimeEfficiency = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (root) {
  'use strict';

  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const MUSCLE_LABEL = {
    chest: 'Chest', back: 'Back', shoulders: 'Shoulders', traps: 'Traps', biceps: 'Biceps', triceps: 'Triceps',
    forearms: 'Forearms', quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves',
    adductors: 'Adductors', abductors: 'Abductors', abs: 'Abs',
  };

  function core() {
    if (root && root.TimeBudgetCore) return root.TimeBudgetCore;
    try { return typeof require === 'function' ? require('../src/js/time-budget-core.js') : null; } catch (_e) { return null; }
  }

  function muscleLookup() {
    if (root && typeof root.getMuscleGroup === 'function') return root.getMuscleGroup;
    try { return typeof require === 'function' ? require('../exerciseMuscleMap.js').getMuscleGroup : null; } catch (_e) { return null; }
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Compress ────────────────────────────────────────────────────────

  /** A v2 day as the app's day shape, for time estimates. */
  function asAppDay(day) {
    return {
      exercises: (day && Array.isArray(day.exercises) ? day.exercises : []).filter(e => e && e.name).map(e => ({
        name: e.name,
        sets: Array.from({ length: Math.max(1, Number(e.sets) || 1) }, () => (e.restSec != null ? { restSec: e.restSec } : {})),
        ...(e.superset ? { supersetGroup: e.superset } : {}),
      })),
    };
  }

  function estimateMinutes(day) {
    const c = core();
    return c ? c.estimateSessionMinutes(asAppDay(day)) : null;
  }

  function isCompoundRow(e, c) {
    if (e.type === 'compound') return true;
    if (e.type === 'isolation' || e.type === 'core') return false;
    return c.isCompound(e.name);
  }

  /**
   * { day, pairs: [[nameA, nameB]], beforeMin, afterMin } — a copy of the
   * v2 day with new superset letters. Rows already in a superset, and the
   * first compound (anchor), are left as they are. Pairs are chosen by
   * pairScore (antagonists and push/pull first, nearer rows first) and the
   * second row moves up to sit right after the first.
   */
  function compressDay(day, opts) {
    const c = core();
    const o = opts || {};
    const muscleOf = o.muscleOf || muscleLookup() || (() => 'other');
    const src = day && Array.isArray(day.exercises) ? day : { exercises: [] };
    const out = JSON.parse(JSON.stringify(src));
    const beforeMin = estimateMinutes(src);
    if (!c || out.exercises.length < 3) return { day: out, pairs: [], beforeMin, afterMin: beforeMin };

    const rows = out.exercises;
    const rowMuscle = e => (e.muscle || muscleOf(e.name));
    const anchor = rows.find(e => e && e.name && isCompoundRow(e, c)) || rows[0];
    const used = new Set(rows.map(e => e.superset).filter(Boolean));
    const free = rows.filter(e => e && e.name && e !== anchor && !e.superset);
    const options = [];
    for (let x = 0; x < free.length; x++) {
      for (let y = x + 1; y < free.length; y++) {
        const score = c.pairScore(free[x].name, free[y].name, n => (n === free[x].name ? rowMuscle(free[x]) : n === free[y].name ? rowMuscle(free[y]) : muscleOf(n)));
        if (score > 0) options.push({ a: free[x], b: free[y], score, gap: rows.indexOf(free[y]) - rows.indexOf(free[x]) });
      }
    }
    options.sort((p, q) => q.score - p.score || p.gap - q.gap);
    const taken = new Set();
    const pairs = [];
    for (const p of options) {
      if (taken.has(p.a) || taken.has(p.b)) continue;
      const letter = LETTERS.find(l => !used.has(l));
      if (!letter) break;
      used.add(letter);
      taken.add(p.a); taken.add(p.b);
      p.a.superset = letter;
      p.b.superset = letter;
      // Partners next to each other.
      rows.splice(rows.indexOf(p.b), 1);
      rows.splice(rows.indexOf(p.a) + 1, 0, p.b);
      pairs.push([p.a.name, p.b.name]);
    }
    // Letters in row order (A first), keeping supersets the coach already set.
    if (pairs.length) {
      const fresh = new Set(rows.filter(e => taken.has(e)).map(e => e.superset));
      const keep = new Set(rows.map(e => e.superset).filter(l => l && !fresh.has(l)));
      const map = {};
      const pool = LETTERS.filter(l => !keep.has(l));
      rows.forEach((e) => { if (taken.has(e) && !map[e.superset]) map[e.superset] = pool.shift(); });
      rows.forEach((e) => { if (taken.has(e)) e.superset = map[e.superset]; });
    }
    return { day: out, pairs, beforeMin, afterMin: estimateMinutes(out) };
  }

  /** Compress one day in every week (matched by dayId), so the block stays consistent. */
  function compressProgramDay(program, dayId, opts) {
    const weeks = program && Array.isArray(program.weeks) ? program.weeks : [];
    let first = null;
    weeks.forEach((w) => {
      (w.days || []).forEach((d, i) => {
        if (d.dayId !== dayId) return;
        const r = compressDay(d, opts);
        w.days[i] = r.day;
        if (!first) first = r;
      });
    });
    return first || { pairs: [], beforeMin: null, afterMin: null };
  }

  // ── Session time card ───────────────────────────────────────────────

  /** { count, avgMin, avgTarget, overCount, minPerSet, otherShare } from shared session times. */
  function summarize(sessionTimes) {
    const list = Array.isArray(sessionTimes) ? sessionTimes.filter(x => x && x.durationMin && x.sets) : [];
    if (!list.length) return null;
    const avg = (xs, k) => xs.reduce((n, x) => n + (Number(x[k]) || 0), 0) / xs.length;
    const withTarget = list.filter(x => x.targetMin);
    const total = list.reduce((n, x) => n + x.durationMin, 0);
    const other = list.reduce((n, x) => n + (Number(x.otherMin) || 0), 0);
    return {
      count: list.length,
      avgMin: Math.round(avg(list, 'durationMin')),
      avgTarget: withTarget.length ? Math.round(avg(withTarget, 'targetMin')) : null,
      overCount: withTarget.filter(x => x.durationMin - x.targetMin > 5).length,
      targetCount: withTarget.length,
      minPerSet: Math.round((total / list.reduce((n, x) => n + x.sets, 0)) * 10) / 10,
      otherShare: total ? Math.round((other / total) * 100) : 0,
    };
  }

  /** BU bands for weekly direct sets: below ~4 is under the growth floor,
   * 4–7 maintenance-ish, 8+ the time-crunched growth band and up. */
  function muscleBand(sets) {
    if (sets < 4) return 'low';
    if (sets < 8) return 'mid';
    return 'ok';
  }

  function sessionTimeCard(d, opts) {
    const o = opts || {};
    const loading = !!o.loading;
    const cardHead = o.cardHead || ((k, v, u) => '<div class="d-card-title">' + k + (v != null ? ' ' + v + (u || '') : '') + '</div>');
    const s = summarize(d && d.sessionTimes);
    const muscles = Object.entries((d && d.weeklyMuscleSets) || {})
      .filter(([m, n]) => MUSCLE_LABEL[m] && n > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!s && !muscles.length) {
      return cardHead('Session time') + '<p class="ws-empty-note">' + (loading ? 'Loading…'
        : 'Appears once the client ends a few workouts in an up-to-date app.') + '</p>';
    }
    let html = cardHead('Session time', s ? s.avgMin : null, s ? 'min avg' : '',
      s && s.avgTarget ? '<span class="ca-chip' + (s.avgMin - s.avgTarget >= 10 ? ' ca-chip--brass' : '') + '">Target ' + s.avgTarget + ' min</span>' : '');
    if (s) {
      const lines = [
        s.count + ' session' + (s.count === 1 ? '' : 's') + ' in 4 weeks · ' + s.minPerSet + ' min per working set',
        s.targetCount ? s.overCount + ' of ' + s.targetCount + ' ran 5+ min over target' : '',
        s.otherShare >= 25 ? 'About ' + s.otherShare + '% of session time was neither sets nor timed rest' : '',
      ].filter(Boolean);
      html += '<ul class="te-lines">' + lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>';
      if (s.avgTarget && s.avgMin - s.avgTarget >= 10) {
        html += '<p class="te-tip">Running long: try <strong>Compress</strong> on a day in the Program tab (supersets save the most time without costing growth), or add a <strong>Busy week</strong> in Weeks.</p>';
      }
    }
    if (muscles.length) {
      html += '<div class="te-cap">Working sets per muscle · weekly</div><div class="te-muscles">'
        + muscles.map(([m, n]) => '<span class="te-mus te-mus--' + muscleBand(n) + '" title="' + (n < 4 ? 'Below BU’s ~4-set growth floor' : n < 8 ? 'Maintenance range' : 'In or above BU’s 8–10 time-crunched band') + '">'
          + esc(MUSCLE_LABEL[m]) + ' <b>' + esc(n) + '</b></span>').join('')
        + '</div>';
    }
    return html;
  }

  return { compressDay, compressProgramDay, estimateMinutes, summarize, muscleBand, sessionTimeCard, asAppDay };
});
