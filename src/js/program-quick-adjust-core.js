/* Program quick adjust: the phone's way to change a program.
 *
 * On a phone the full builders (the 5-step wizard in ProgramTabV2.js, the
 * coach's 7-day grid in coaching-enhanced.js) don't fit. What people
 * actually do there is small: "add 2 sets to bench", "drop a set of curls",
 * "more chest this week". This module plans those changes.
 *
 * It works on a flat list of "rows", one per exercise per training day:
 *   { id, day, name, sets }   (sets = a count)
 * Each screen turns its own program shape into rows and applies the planned
 * changes back (see the adapters at the bottom: the lifter's programs with
 * days[].exercises[].sets[], and the coach library with days.Mon[].sets).
 *
 * A plan is { changes: [{ id, day, name, from, to }], delta, note }. Nothing
 * here touches storage or the DOM. Loaded by index.html; exported for tests.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProgramQuickAdjustCore = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const MIN_SETS = 1;   // removing never deletes an exercise
  const MAX_SETS = 12;  // per exercise per session
  const MAX_STEP = 10;  // the most one tap can add or remove

  const MUSCLE_LABELS = {
    chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps',
    quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', abs: 'Abs',
    forearms: 'Forearms', traps: 'Traps', abductors: 'Abductors', adductors: 'Adductors', legs: 'Legs',
  };

  function key(name) { return String(name || '').trim().toLowerCase(); }
  function clampStep(n) { return Math.max(1, Math.min(MAX_STEP, Math.floor(Number(n)) || 1)); }
  function count(n) { return Math.max(0, Math.floor(Number(n)) || 0); }
  function muscleLabel(m) { return MUSCLE_LABELS[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Other'); }

  function cleanRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter(r => r && r.id != null && key(r.name))
      .map(r => ({ id: String(r.id), day: String(r.day || ''), name: String(r.name).trim(), sets: count(r.sets) }));
  }

  // Exercises in the program, once each, in first-seen order:
  // [{ name, sessions, weeklySets }]
  function exercises(rows) {
    const out = new Map();
    cleanRows(rows).forEach(r => {
      const k = key(r.name);
      const e = out.get(k) || { name: r.name, sessions: 0, weeklySets: 0 };
      e.sessions += 1;
      e.weeklySets += r.sets;
      out.set(k, e);
    });
    return [...out.values()];
  }

  // Weekly sets per muscle, biggest first: [{ muscle, label, sets, exercises }]
  // muscleOf(name) → 'chest' | ... | 'other' (window.getMuscleGroup in the app).
  function weeklyVolume(rows, muscleOf) {
    const of = typeof muscleOf === 'function' ? muscleOf : () => 'other';
    const out = new Map();
    cleanRows(rows).forEach(r => {
      const m = of(r.name) || 'other';
      const v = out.get(m) || { muscle: m, label: muscleLabel(m), sets: 0, exercises: new Set() };
      v.sets += r.sets;
      v.exercises.add(r.name);
      out.set(m, v);
    });
    return [...out.values()]
      .map(v => ({ ...v, exercises: [...v.exercises] }))
      .sort((a, b) => (a.muscle === 'other') - (b.muscle === 'other') || b.sets - a.sets);
  }

  function change(r, to) { return { id: r.id, day: r.day, name: r.name, from: r.sets, to }; }

  function finish(changes, note) {
    const real = changes.filter(c => c.to !== c.from);
    return { changes: real, delta: real.reduce((n, c) => n + c.to - c.from, 0), note: real.length ? '' : note };
  }

  // +n sets on every session of one exercise.
  function addSets(rows, name, n) {
    const step = clampStep(n);
    const hits = cleanRows(rows).filter(r => key(r.name) === key(name));
    if (!hits.length) return finish([], 'That exercise is not in this program.');
    return finish(hits.map(r => change(r, Math.min(MAX_SETS, r.sets + step))), `Already at ${MAX_SETS} sets.`);
  }

  // −n sets on every session of one exercise, never below one set.
  function removeSets(rows, name, n) {
    const step = clampStep(n);
    const hits = cleanRows(rows).filter(r => key(r.name) === key(name));
    if (!hits.length) return finish([], 'That exercise is not in this program.');
    return finish(hits.map(r => change(r, Math.max(MIN_SETS, r.sets - step))), 'Already at 1 set. Remove the exercise in the full builder.');
  }

  // Change a muscle's weekly sets by ±n in total, one set at a time: an added
  // set goes to the exercise of that muscle with the fewest sets (spreads the
  // work across days), a removed one comes off the one with the most.
  function changeMuscleVolume(rows, muscle, n, muscleOf) {
    const of = typeof muscleOf === 'function' ? muscleOf : () => 'other';
    const raw = Math.floor(Number(n)) || 0;
    const step = Math.sign(raw) * clampStep(Math.abs(raw) || 1);
    const hits = cleanRows(rows).filter(r => (of(r.name) || 'other') === muscle);
    if (!hits.length) return finish([], `No ${muscleLabel(muscle).toLowerCase()} exercises in this program yet.`);
    const now = new Map(hits.map(r => [r.id, r.sets]));
    for (let i = 0; i < Math.abs(step); i++) {
      const open = hits.filter(r => step > 0 ? now.get(r.id) < MAX_SETS : now.get(r.id) > MIN_SETS);
      if (!open.length) break;
      // Ties go to the earlier row, so the plan is the same every time.
      const pick = open.reduce((best, r) =>
        (step > 0 ? now.get(r.id) < now.get(best.id) : now.get(r.id) > now.get(best.id)) ? r : best);
      now.set(pick.id, now.get(pick.id) + Math.sign(step));
    }
    return finish(hits.map(r => change(r, now.get(r.id))),
      step > 0 ? `Every ${muscleLabel(muscle).toLowerCase()} exercise is at ${MAX_SETS} sets.` : `Every ${muscleLabel(muscle).toLowerCase()} exercise is down to 1 set.`);
  }

  // One entry point for a whole action, so a screen can re-run it on
  // another copy of the program (e.g. each week of a multi-week program):
  //   { mode: 'add' | 'remove', exercise, n }  or  { mode: 'volume', muscle, n: ±sets }
  function plan(rows, action, muscleOf) {
    const a = action || {};
    if (a.mode === 'volume') return changeMuscleVolume(rows, a.muscle, a.n, muscleOf);
    if (a.mode === 'remove') return removeSets(rows, a.exercise, a.n);
    return addSets(rows, a.exercise, a.n);
  }

  // "Bench Press · Mon 3→5 · Thu 3→5"
  function describe(plan) {
    if (!plan || !plan.changes.length) return plan && plan.note ? plan.note : '';
    const byName = new Map();
    plan.changes.forEach(c => {
      const g = byName.get(key(c.name)) || { name: c.name, parts: [] };
      g.parts.push((c.day ? c.day + ' ' : '') + c.from + '→' + c.to);
      byName.set(key(c.name), g);
    });
    return [...byName.values()].map(g => g.name + ' · ' + g.parts.join(' · ')).join('\n');
  }

  /* ── Adapters ─────────────────────────────────────────────── */

  // The lifter's programs (programBuilderV2Core): days[].exercises[].sets[].
  // Row ids are "dayIndex:exerciseIndex".
  function rowsFromDays(days) {
    const rows = [];
    (Array.isArray(days) ? days : []).forEach((d, di) => {
      (d && Array.isArray(d.exercises) ? d.exercises : []).forEach((ex, ei) => {
        if (!ex) return;
        rows.push({ id: di + ':' + ei, day: (d.name || 'Day ' + (di + 1)), name: ex.name, sets: Array.isArray(ex.sets) ? ex.sets.length : 0 });
      });
    });
    return cleanRows(rows);
  }

  // Returns new days with the plan applied. Added sets copy the exercise's
  // last set (same reps, load, rest); removed ones come off the end.
  function applyToDays(days, plan) {
    const out = JSON.parse(JSON.stringify(Array.isArray(days) ? days : []));
    (plan && plan.changes || []).forEach(c => {
      const [di, ei] = c.id.split(':').map(Number);
      const ex = out[di] && out[di].exercises && out[di].exercises[ei];
      if (!ex) return;
      const sets = Array.isArray(ex.sets) ? ex.sets : (ex.sets = []);
      while (sets.length < c.to) {
        const last = sets[sets.length - 1];
        sets.push(last ? { ...last } : { setType: 'straight', reps: 8, weight: null, rpe: null, rir: null, restSec: 120 });
      }
      if (sets.length > c.to) sets.length = Math.max(MIN_SETS, c.to);
    });
    return out;
  }

  // The days a lifter program trains in a normal week: its `days`, or for a
  // program that only carries weeks, the first week that has its own days.
  function baseDays(program) {
    const p = program || {};
    if (Array.isArray(p.days) && p.days.length) return p.days;
    const week = (Array.isArray(p.weeks) ? p.weeks : []).find(w => w && Array.isArray(w.days));
    return week ? week.days : [];
  }

  // A whole lifter program with the change made. `days` mirrors the first
  // real week (programBuilderV2Core.normalizeDraft), so that week gets the
  // same days; every other week re-runs the action on its own days, and
  // deload weeks are left alone.
  function applyToProgram(program, p, action, muscleOf) {
    const out = JSON.parse(JSON.stringify(program || {}));
    const base = applyToDays(baseDays(program), p);
    const hasDays = Array.isArray(out.days) && out.days.length > 0;
    if (hasDays) out.days = base;
    const weeks = Array.isArray(out.weeks) ? out.weeks : [];
    const first = weeks.findIndex(w => w && Array.isArray(w.days));
    weeks.forEach((w, i) => {
      if (!w || !Array.isArray(w.days)) return;
      if (i === first) { w.days = JSON.parse(JSON.stringify(base)); return; }
      if (w.deload) return;
      w.days = applyToDays(w.days, plan(rowsFromDays(w.days), action, muscleOf));
    });
    return out;
  }

  // The coach library (coaching-enhanced.js): days.Mon = [{ name, sets, reps }].
  // Row ids are "Mon:index".
  function rowsFromWeek(week, dayOrder) {
    const order = Array.isArray(dayOrder) ? dayOrder : Object.keys(week || {});
    const rows = [];
    order.forEach(day => {
      ((week && week[day]) || []).forEach((ex, i) => {
        if (ex) rows.push({ id: day + ':' + i, day, name: ex.name, sets: ex.sets });
      });
    });
    return cleanRows(rows);
  }

  function applyToWeek(week, plan) {
    const out = JSON.parse(JSON.stringify(week || {}));
    (plan && plan.changes || []).forEach(c => {
      const at = c.id.lastIndexOf(':');
      const ex = (out[c.id.slice(0, at)] || [])[Number(c.id.slice(at + 1))];
      if (ex) ex.sets = c.to;
    });
    return out;
  }

  return {
    MIN_SETS, MAX_SETS, MAX_STEP, muscleLabel,
    exercises, weeklyVolume, addSets, removeSets, changeMuscleVolume, plan, describe,
    rowsFromDays, applyToDays, baseDays, applyToProgram, rowsFromWeek, applyToWeek,
  };
});
