/* =============================================================
   TIME BUDGET — core (pure, tested: tests/timeBudgetCore.test.js)
   Performance mode's "Time budget" (src/js/performance-mode.js), built
   on Butters University's "Time-efficient training" module:

     protect load and effort; cut rest, warm-up length and set
     structure first; cut volume last.

   - restSecondsFor(): rest by exercise type. Heavy compounds get full
     rest; isolations get less; the first half of a superset pair only
     ~45 s, so each muscle still rests 90 s+ while the clock barely runs.
   - estimateRemainingSeconds() / paceStatus(): where the session will
     land against the lifter's minutes.
   - suggestCuts(): when behind, the cheapest fixes first:
       1. pair non-competing exercises (time saved, growth kept),
       2. turn an isolation's remaining sets into one myo-rep set,
       3. last resort, drop an accessory set.
     The session's first heavy compound ("anchor") and its warm-up ramp
     are never touched.

   Day shape (getTodaysPlannedDay()): { exercises: [{ name, sets: [
   { reps, weight, restSec?, setType? }], supersetGroup? }] }.
   `done` maps an exercise key (exerciseKey()) to working sets logged.
   `changes` is what the lifter accepted this session:
     { pairs: [[keyA, keyB]], myo: [key], cuts: { key: setsRemoved } }
   ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TimeBudgetCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const BUDGETS = [30, 45, 60];

  const REST = { compound: 120, isolation: 75, pairFirst: 45, pairHeavy: 60 };
  const WORK = { compound: 45, isolation: 35 };
  const CHANGEOVER_SEC = 60;   // walking to / setting up the next exercise
  const RAMP_SEC = 180;        // ramp sets before the first heavy lift
  const MYO_SET_SEC = 90;      // activation set + 3 mini-sets
  const ON_PACE_SLACK_MIN = 1; // projected this far over still reads "on pace"
  const AHEAD_MIN = 3;

  const ISOLATION_RE = /(pressdown|push-?down|kickback|\bfly\b|flye|flies|pec[- ]?deck|raise|curl|extension|pullover|shrug|calf|calves|adduct|abduct|face ?pull|crunch|wrist)/i;
  const COMPOUND_OVERRIDE_RE = /\b(squat|deadlift|bench|press|row|hip thrust|good ?morning|lunge)\b/i;
  const LOWER = new Set(['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors', 'legs']);
  const PUSH = new Set(['chest', 'shoulders', 'triceps']);
  const PULL = new Set(['back', 'biceps', 'traps', 'forearms']);
  const ANTAGONISTS = [['chest', 'back'], ['quads', 'hamstrings'], ['biceps', 'triceps'], ['shoulders', 'back']];

  function exerciseKey(name) {
    return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function isCompound(name) {
    const n = String(name || '');
    if (/\bleg (curl|extension)s?\b/i.test(n)) return false;
    if (/\b(back|hip|hyper) ?extensions?\b/i.test(n)) return true;
    if (!ISOLATION_RE.test(n)) return true;
    return COMPOUND_OVERRIDE_RE.test(n) && !/\b(curl|raise|fly|flye)\b/i.test(n);
  }

  function normaliseBudget(value) {
    const n = Number(value);
    return BUDGETS.includes(n) ? n : null;
  }

  function region(muscle) {
    if (LOWER.has(muscle)) return 'lower';
    if (PUSH.has(muscle)) return 'push';
    if (PULL.has(muscle)) return 'pull';
    if (muscle === 'abs') return 'core';
    return 'other';
  }

  /** How well two exercises superset: 0 = they compete for the same
   * muscles (don't pair), 4 = antagonists, 3 = push/pull, 2 = upper/lower. */
  function pairScore(a, b, muscleOf) {
    const ma = muscleOf(a);
    const mb = muscleOf(b);
    if (!ma || !mb || ma === 'other' || mb === 'other' || ma === mb) return 0;
    const antagonist = ANTAGONISTS.some(([x, y]) => (ma === x && mb === y) || (ma === y && mb === x));
    const ra = region(ma);
    const rb = region(mb);
    // Two heavy leg compounds back to back is a fatigue problem, not a time saver.
    if (ra === 'lower' && rb === 'lower') return antagonist && !(isCompound(a) && isCompound(b)) ? 4 : 0;
    if (antagonist) return 4;
    if (ra === rb) return 0;
    if ((ra === 'push' && rb === 'pull') || (ra === 'pull' && rb === 'push')) return 3;
    return 2;
  }

  // ── The planned session, with this session's changes applied ─────

  function _changes(changes) {
    const c = changes || {};
    return {
      pairs: Array.isArray(c.pairs) ? c.pairs.filter(p => Array.isArray(p) && p.length === 2) : [],
      myo: Array.isArray(c.myo) ? c.myo : [],
      cuts: c.cuts && typeof c.cuts === 'object' ? c.cuts : {},
    };
  }

  /** The session's first compound: its sets keep full rest and never get cut. */
  function anchorKey(day) {
    const exs = (day && Array.isArray(day.exercises)) ? day.exercises : [];
    const first = exs.find(ex => isCompound(ex.name)) || exs[0];
    return first ? exerciseKey(first.name) : null;
  }

  /** Partner key for `key` from planned supersets or accepted pairs, else null. */
  function partnerOf(day, key, changes) {
    const c = _changes(changes);
    const pair = c.pairs.find(p => p[0] === key || p[1] === key);
    if (pair) return pair[0] === key ? pair[1] : pair[0];
    const exs = (day && Array.isArray(day.exercises)) ? day.exercises : [];
    const me = exs.find(ex => exerciseKey(ex.name) === key);
    if (!me || !me.supersetGroup) return null;
    const mate = exs.find(ex => ex !== me && ex.supersetGroup === me.supersetGroup);
    return mate ? exerciseKey(mate.name) : null;
  }

  /** [{ key, name, compound, planned, done, remaining, myo, partner, anchor, restSec }] */
  function planItems(day, done, changes) {
    const c = _changes(changes);
    const anchor = anchorKey(day);
    const exs = (day && Array.isArray(day.exercises)) ? day.exercises : [];
    const d = done || {};
    return exs.filter(ex => ex && ex.name).map((ex) => {
      const key = exerciseKey(ex.name);
      const sets = Array.isArray(ex.sets) ? ex.sets.filter(s => !s || s.setType !== 'warmup') : [];
      const cut = Math.max(0, Math.round(Number(c.cuts[key]) || 0));
      const planned = Math.max(1, sets.length - cut);
      const doneSets = Math.max(0, Number(d[key]) || 0);
      const restSec = Number(sets[0] && sets[0].restSec) > 0 ? Number(sets[0].restSec) : null;
      return {
        key, name: ex.name, compound: isCompound(ex.name), planned, done: doneSets,
        remaining: Math.max(0, planned - doneSets), myo: c.myo.includes(key),
        partner: partnerOf(day, key, c), anchor: key === anchor, restSec,
      };
    });
  }

  // ── Rest ─────────────────────────────────────────────────────────

  /**
   * Seconds to rest after a set of `exerciseName`.
   * - Partner still has sets left → short rest, walk straight to it
   *   (each muscle still gets its full rest across the round).
   * - The coach's planned rest wins otherwise.
   * - Else compound 2 min, isolation 75 s.
   */
  function restSecondsFor(exerciseName, day, done, changes) {
    const key = exerciseKey(exerciseName);
    const items = planItems(day, done, changes);
    const me = items.find(i => i.key === key);
    const compound = isCompound(exerciseName);
    if (me && me.partner) {
      const mate = items.find(i => i.key === me.partner);
      if (mate && mate.remaining > 0) return compound && mate.compound ? REST.pairHeavy : REST.pairFirst;
    }
    if (me && me.restSec) return me.restSec;
    return compound ? REST.compound : REST.isolation;
  }

  // ── Time estimates ───────────────────────────────────────────────

  function _itemSeconds(item, sets, items) {
    if (sets <= 0) return 0;
    const work = item.compound ? WORK.compound : WORK.isolation;
    if (item.myo) return MYO_SET_SEC + CHANGEOVER_SEC / 2;
    const mate = item.partner ? items.find(i => i.key === item.partner) : null;
    let rest;
    if (mate) rest = item.compound && mate.compound ? REST.pairHeavy : REST.pairFirst;
    else rest = item.restSec || (item.compound ? REST.compound : REST.isolation);
    return sets * (work + rest);
  }

  /** Seconds the remaining planned sets will take. A not-yet-started
   * exercise adds a changeover (a pair shares one); the anchor adds its
   * warm-up ramp when it hasn't been started. */
  function estimateRemainingSeconds(day, done, changes) {
    const items = planItems(day, done, changes);
    const counted = new Set();
    let total = 0;
    items.forEach((item) => {
      total += _itemSeconds(item, item.remaining, items);
      if (item.done === 0 && item.remaining > 0) {
        if (item.anchor && item.compound) total += RAMP_SEC;
        const shared = item.partner && counted.has(item.partner);
        if (!shared) total += CHANGEOVER_SEC;
        counted.add(item.key);
      }
    });
    return total;
  }

  /** Whole-session estimate from scratch (nothing logged yet). */
  function estimateSessionMinutes(day, changes) {
    return Math.round(estimateRemainingSeconds(day, {}, changes) / 60);
  }

  /**
   * { budgetMin, elapsedMin, projectedMin, overMin, status, doneSets,
   *   plannedSets } — status 'ahead' | 'on' | 'behind' | 'over' | 'done'.
   * overMin is how far the projected finish runs past the budget (≥ 0).
   */
  function paceStatus({ day, done, changes, elapsedMs, budgetMin }) {
    const items = planItems(day, done, changes);
    const plannedSets = items.reduce((n, i) => n + i.planned, 0);
    const doneSets = items.reduce((n, i) => n + Math.min(i.done, i.planned), 0);
    const elapsedMin = Math.max(0, (Number(elapsedMs) || 0) / 60000);
    const remainingMin = estimateRemainingSeconds(day, done, changes) / 60;
    const projectedMin = elapsedMin + remainingMin;
    const budget = normaliseBudget(budgetMin);
    const overMin = budget ? Math.max(0, projectedMin - budget) : 0;
    let status = 'on';
    if (plannedSets > 0 && doneSets >= plannedSets) status = 'done';
    else if (budget && elapsedMin >= budget) status = 'over';
    else if (budget && overMin > ON_PACE_SLACK_MIN) status = 'behind';
    else if (budget && projectedMin <= budget - AHEAD_MIN) status = 'ahead';
    return {
      budgetMin: budget, elapsedMin: Math.round(elapsedMin), projectedMin: Math.round(projectedMin),
      overMin: Math.round(overMin), status, doneSets, plannedSets,
    };
  }

  // ── Suggestions when behind ──────────────────────────────────────

  function _minutes(sec) { return Math.max(1, Math.round(sec / 60)); }

  /**
   * Ordered fixes until the projected overrun is covered:
   *   { type: 'pair', keys: [a, b], names: [A, B], savesMin, text }
   *   { type: 'myo',  key, name, savesMin, text }
   *   { type: 'cut',  key, name, sets: 1, savesMin, text }
   * Pairs and myo-reps cost nothing measurable in growth; cuts do, so
   * they come last and only from accessories (never the anchor), and
   * never below one set per exercise.
   */
  function suggestCuts({ day, done, changes, overMin, muscleOf, limit = 3 }) {
    const need = Math.max(0, Number(overMin) || 0) * 60;
    if (need <= 0) return [];
    const mOf = typeof muscleOf === 'function' ? muscleOf : () => 'other';
    const c = _changes(changes);
    const items = planItems(day, done, c);
    const out = [];
    let saved = 0;
    const enough = () => saved >= need || out.length >= limit;

    // 1. Pair two not-yet-started, unpaired, non-competing exercises.
    const free = items.filter(i => i.done === 0 && i.remaining > 0 && !i.partner && !i.anchor && !i.myo);
    const pairs = [];
    for (let x = 0; x < free.length; x++) {
      for (let y = x + 1; y < free.length; y++) {
        const score = pairScore(free[x].name, free[y].name, mOf);
        if (score > 0) pairs.push({ a: free[x], b: free[y], score, gap: y - x });
      }
    }
    pairs.sort((p, q) => q.score - p.score || p.gap - q.gap);
    const used = new Set();
    for (const p of pairs) {
      if (enough()) break;
      if (used.has(p.a.key) || used.has(p.b.key)) continue;
      const before = estimateRemainingSeconds(day, done, c);
      const trial = { ...c, pairs: [...c.pairs, [p.a.key, p.b.key]] };
      const sec = before - estimateRemainingSeconds(day, done, trial);
      if (sec < 60) continue;
      used.add(p.a.key); used.add(p.b.key);
      c.pairs = trial.pairs;
      saved += sec;
      out.push({ type: 'pair', keys: [p.a.key, p.b.key], names: [p.a.name, p.b.name], savesMin: _minutes(sec),
        text: `Superset ${p.a.name} with ${p.b.name}` });
    }

    // 2. Myo-reps: an isolation's 3+ remaining sets become one myo-rep set.
    const myoable = planItems(day, done, c).filter(i => !i.compound && !i.myo && !i.anchor && !i.partner && i.remaining >= 3);
    for (const i of myoable) {
      if (enough()) break;
      const before = estimateRemainingSeconds(day, done, c);
      const trial = { ...c, myo: [...c.myo, i.key] };
      const sec = before - estimateRemainingSeconds(day, done, trial);
      if (sec < 60) continue;
      c.myo = trial.myo;
      saved += sec;
      out.push({ type: 'myo', key: i.key, name: i.name, savesMin: _minutes(sec),
        text: `Turn your last ${i.remaining} sets of ${i.name} into one myo-rep set` });
    }

    // 3. Last resort: drop one set from an accessory, isolations first.
    const cuttable = planItems(day, done, c)
      .filter(i => !i.anchor && !i.myo && i.remaining >= 1 && i.planned >= 2)
      .sort((p, q) => Number(p.compound) - Number(q.compound) || q.remaining - p.remaining);
    for (const i of cuttable) {
      if (enough()) break;
      const before = estimateRemainingSeconds(day, done, c);
      const trial = { ...c, cuts: { ...c.cuts, [i.key]: (Number(c.cuts[i.key]) || 0) + 1 } };
      const sec = before - estimateRemainingSeconds(day, done, trial);
      if (sec <= 0) continue;
      c.cuts = trial.cuts;
      saved += sec;
      out.push({ type: 'cut', key: i.key, name: i.name, sets: 1, savesMin: _minutes(sec),
        text: `Drop 1 set of ${i.name}` });
    }
    return out;
  }

  /** Fold an accepted suggestion into this session's changes. */
  function applySuggestion(changes, suggestion) {
    const c = _changes(changes);
    const next = { pairs: [...c.pairs], myo: [...c.myo], cuts: { ...c.cuts } };
    if (!suggestion) return next;
    if (suggestion.type === 'pair' && Array.isArray(suggestion.keys)) next.pairs.push(suggestion.keys.slice(0, 2));
    if (suggestion.type === 'myo' && suggestion.key && !next.myo.includes(suggestion.key)) next.myo.push(suggestion.key);
    if (suggestion.type === 'cut' && suggestion.key) next.cuts[suggestion.key] = (Number(next.cuts[suggestion.key]) || 0) + (suggestion.sets || 1);
    return next;
  }

  /** Name of the exercise to arm after a set of `exerciseName`: its
   * superset partner while that still has sets left, else null. */
  function nextInPair(exerciseName, day, done, changes) {
    const key = exerciseKey(exerciseName);
    const items = planItems(day, done, changes);
    const me = items.find(i => i.key === key);
    if (!me || !me.partner) return null;
    const mate = items.find(i => i.key === me.partner);
    return mate && mate.remaining > 0 ? mate.name : null;
  }

  /** Working sets per exercise key from today's stored log entries
   * (workouts_<user>[today].log); warm-up sets don't count. */
  function countDoneSets(logEntries) {
    const out = {};
    (Array.isArray(logEntries) ? logEntries : []).forEach((e) => {
      if (!e || !e.exercise) return;
      const key = exerciseKey(e.exercise);
      const reps = Array.isArray(e.repsArray) ? e.repsArray : null;
      const types = Array.isArray(e.setTypeArray) ? e.setTypeArray : [];
      const n = reps ? reps.length : (Number(e.sets) || 0);
      let working = 0;
      for (let i = 0; i < n; i++) if (types[i] !== 'warmup') working++;
      out[key] = (out[key] || 0) + working;
    });
    return out;
  }

  /**
   * Phase 2: how a finished session used its minutes, saved on the
   * workout as `efficiency` (session-efficiency.js) and shared with the
   * coach. `restBreaks` are the rest-timer lengths that ran out (minutes,
   * index.html logRestBreak); `log` is the workout's stored entries.
   *   { durationMin, workingSets, minPerSet, workMin, restMin, otherMin,
   *     budgetMin?, plannedMin? }
   * otherMin is time that was neither a set nor a timed rest: walking,
   * setting up, the phone, skipped or overrun rests. Null when the session
   * has no duration or no working sets.
   */
  function sessionEfficiency({ log, durationMin, restBreaks, budgetMin, plannedMin }) {
    const duration = Math.round(Number(durationMin) || 0);
    const entries = Array.isArray(log) ? log : [];
    if (duration <= 0) return null;
    let workSec = 0;
    let sets = 0;
    entries.forEach((e) => {
      if (!e || !e.exercise) return;
      const reps = Array.isArray(e.repsArray) ? e.repsArray : null;
      const types = Array.isArray(e.setTypeArray) ? e.setTypeArray : [];
      const n = reps ? reps.length : (Number(e.sets) || 0);
      const per = isCompound(e.exercise) ? WORK.compound : WORK.isolation;
      for (let i = 0; i < n; i++) {
        if (types[i] === 'warmup') continue;
        sets++;
        workSec += per;
      }
    });
    if (!sets) return null;
    const restMin = (Array.isArray(restBreaks) ? restBreaks : [])
      .reduce((n, m) => n + Math.max(0, Number(m) || 0), 0);
    const workMin = workSec / 60;
    const r1 = (x) => Math.round(x * 10) / 10;
    const out = {
      durationMin: duration,
      workingSets: sets,
      minPerSet: r1(duration / sets),
      workMin: Math.round(workMin),
      restMin: Math.round(Math.min(restMin, duration)),
      otherMin: Math.max(0, Math.round(duration - workMin - restMin)),
    };
    const budget = normaliseBudget(budgetMin);
    if (budget) out.budgetMin = budget;
    const planned = Math.round(Number(plannedMin) || 0);
    if (planned > 0) out.plannedMin = planned;
    return out;
  }

  /** "42 min · 16 sets · 2.6 min/set" + what the lifter can act on. */
  function describeEfficiency(e) {
    if (!e) return null;
    const head = `${e.durationMin} min · ${e.workingSets} set${e.workingSets === 1 ? '' : 's'} · ${e.minPerSet} min/set`;
    const target = e.budgetMin || e.plannedMin || null;
    let verdict = '';
    if (target) {
      const diff = e.durationMin - target;
      if (diff > 2) verdict = `${diff} min over your ${e.budgetMin ? 'budget' : 'plan'}`;
      else if (diff < -2) verdict = `${-diff} min under your ${e.budgetMin ? 'budget' : 'plan'}`;
      else verdict = `on your ${e.budgetMin ? 'budget' : 'plan'}`;
    }
    // Worth pointing at only when it's a real share of the session.
    const share = e.durationMin ? e.otherMin / e.durationMin : 0;
    const tip = e.otherMin >= 8 && share >= 0.25
      ? `About ${e.otherMin} min went on neither sets nor timed rest. Supersets and setting up the next exercise during rest win most of it back.`
      : '';
    return { head, verdict, tip };
  }

  /** "18 of 30 min · 9/14 sets · 4 min behind" */
  function formatPace(p) {
    if (!p) return '';
    const head = p.budgetMin ? `${p.elapsedMin} of ${p.budgetMin} min` : `${p.elapsedMin} min`;
    const sets = p.plannedSets ? ` · ${p.doneSets}/${p.plannedSets} sets` : '';
    const tail = {
      done: 'plan done',
      over: 'over time: finish your top sets',
      behind: `~${p.overMin} min behind`,
      ahead: 'ahead of pace',
      on: p.budgetMin ? 'on pace' : `finish in ~${Math.max(0, p.projectedMin - p.elapsedMin)} min`,
    }[p.status];
    return `${head}${sets} · ${tail}`;
  }

  return {
    BUDGETS, REST, WORK, CHANGEOVER_SEC, RAMP_SEC, MYO_SET_SEC,
    exerciseKey, isCompound, normaliseBudget, pairScore, anchorKey, partnerOf, planItems,
    restSecondsFor, estimateRemainingSeconds, estimateSessionMinutes, paceStatus,
    suggestCuts, applySuggestion, nextInPair, countDoneSets, formatPace,
    sessionEfficiency, describeEfficiency,
  };
});
