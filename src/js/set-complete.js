/**
 * set-complete.js
 * "Complete set" for a session loaded into the log from a program day or a
 * template (session-queue.js loadTodayProgramIntoLog). Those sets are laid
 * out ahead with planned / last-time numbers and only count once ticked, so
 * ticking one is the moment it's logged. Ticking does what logging a set by
 * hand does (index.html addLogEntry):
 *
 *  - keeps the set's RIR ("reps left") and Top / Back-off tag, chosen on the
 *    row's effort strip before or after ticking;
 *  - in-session advice from progressiveOverload.js suggestNextSet: after a
 *    Top Set, the back-off weight is worked out from its RIR and written onto
 *    the back-off sets still to do (unless the plan prescribed one);
 *  - next-session advice (suggestNextSession), PRs and the streak, judged on
 *    the ticked sets only;
 *  - starts the rest timer: the plan's rest, else the lift's usual rest.
 *
 * Unticked sets are what's still to do, so everything here reads a view of
 * the session with only ticked sets in it (completedView).
 */
(function (global) {
  'use strict';

  const DEFAULT_REST_SECONDS = 120;
  const REST_TIMER_KEY = 'tl_rest_timer_v1';

  // Effort strips the lifter has opened on an already-ticked set, keyed
  // "workout_entry_set" (the current set's strip is always open).
  const openEffort = new Set();

  function _finite(v) {
    const n = Number(v);
    return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? n : null;
  }

  /** Loaded with its sets laid out ahead (program day or template). */
  function isPlannedWorkout(w) {
    if (global.programSchedule && typeof global.programSchedule.isPlannedWorkout === 'function') {
      return global.programSchedule.isPlannedWorkout(w);
    }
    const meta = w && w.metadata;
    return !!(meta && (meta.planned === true || meta.source === 'program'));
  }

  const PER_SET = ['repsArray', 'weightsArray', 'rpeArray', 'rirArray', 'dropsetArray', 'restPauseArray',
    'unilateralArray', 'sideRepsArray', 'skippedArray', 'completedArray', 'setTypeArray', 'advancedArray'];

  /** A copy of `entry` holding only its ticked sets (null when none). */
  function completedEntry(entry) {
    if (!entry || !Array.isArray(entry.repsArray)) return null;
    const done = Array.isArray(entry.completedArray) ? entry.completedArray : [];
    const keep = entry.repsArray.map((_, i) => !!done[i]);
    if (!keep.some(Boolean)) return null;
    const copy = Object.assign({}, entry);
    PER_SET.forEach((key) => {
      if (Array.isArray(entry[key])) copy[key] = entry[key].filter((_, i) => keep[i]);
    });
    copy.sets = copy.repsArray.length;
    return copy;
  }

  /** `workout` with only ticked sets (and exercises with at least one). */
  function completedView(workout) {
    if (!workout) return workout;
    const log = (Array.isArray(workout.log) ? workout.log : []).map(completedEntry).filter(Boolean);
    return Object.assign({}, workout, { log });
  }

  /** `workouts` with the planned ones narrowed to what's been ticked. */
  function completedWorkouts(workouts) {
    return (Array.isArray(workouts) ? workouts : []).map(w => (isPlannedWorkout(w) ? completedView(w) : w));
  }

  function _sameName(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  /** The set to do next in an exercise: [entryIndex, setIndex] of the first
   * set that's neither ticked nor skipped, in block order, or null. */
  function nextOpenSet(log, entryIndexes) {
    for (const ei of entryIndexes) {
      const e = log[ei];
      if (!e || !Array.isArray(e.repsArray)) continue;
      for (let si = 0; si < e.repsArray.length; si++) {
        if (!(e.completedArray && e.completedArray[si]) && !(e.skippedArray && e.skippedArray[si])) return [ei, si];
      }
    }
    return null;
  }

  /** Did the plan itself prescribe a back-off weight for this exercise? */
  function _planSetsBackoffWeight(entry) {
    return !!(entry && entry.plannedBackoffWeight);
  }

  /**
   * After a Top Set, write the advised back-off weight onto the back-off sets
   * of the same exercise that are still to do. Mutates `workout`. Returns how
   * many sets were filled.
   */
  function applyBackoffWeight(workout, exercise, weight) {
    const w = _finite(weight);
    if (!workout || !Array.isArray(workout.log) || w === null || w <= 0) return 0;
    let filled = 0;
    workout.log.forEach((entry) => {
      if (!entry || !_sameName(entry.exercise, exercise) || _planSetsBackoffWeight(entry)) return;
      const types = Array.isArray(entry.setTypeArray) ? entry.setTypeArray : [];
      (entry.repsArray || []).forEach((_, i) => {
        if (types[i] !== 'backoff') return;
        if (entry.completedArray && entry.completedArray[i]) return;
        if (entry.skippedArray && entry.skippedArray[i]) return;
        if (!Array.isArray(entry.weightsArray)) entry.weightsArray = [];
        entry.weightsArray[i] = w;
        filled++;
      });
    });
    return filled;
  }

  /** The rest the plan prescribes after this set, in seconds, or null. */
  function plannedRestSeconds(entry, setIndex) {
    const defs = entry && Array.isArray(entry.setDefinitions) ? entry.setDefinitions : [];
    const def = defs[setIndex] || {};
    const planned = _finite(def.restSec) ?? _finite(def.restSeconds) ?? _finite(entry && entry.restSec);
    return planned && planned > 0 ? Math.round(planned) : null;
  }

  /** Rest after this set: the plan's, else the advice's (by lift type), else 2 min. */
  function restSecondsFor(entry, setIndex, advice) {
    const planned = plannedRestSeconds(entry, setIndex);
    if (planned) return planned;
    const advised = advice && _finite(advice.restSeconds);
    if (advised && advised > 0) return Math.round(advised);
    return DEFAULT_REST_SECONDS;
  }

  function _performanceModeActive() {
    try {
      return !!(global.PerformanceMode && global.PerformanceMode.getSettings().active);
    } catch { return false; }
  }

  function startRest(seconds) {
    const secs = Math.max(1, Math.round(Number(seconds) || DEFAULT_REST_SECONDS));
    if (typeof global.startRestTimerSeconds === 'function') {
      global.startRestTimerSeconds(secs);
      return;
    }
    try {
      localStorage.setItem(REST_TIMER_KEY, JSON.stringify({ endTimeMs: Date.now() + secs * 1000, totalSeconds: secs }));
    } catch { /* storage unavailable */ }
    if (typeof global.resumeRestTimer === 'function') global.resumeRestTimer();
  }

  // ── Storage ─────────────────────────────────────────────────────

  function _logUser() {
    return global.coachLoggingClient || global.currentUser
      || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser'));
  }

  function _read(user) {
    try { return JSON.parse(localStorage.getItem(`workouts_${user}`)) || []; } catch { return []; }
  }

  function _write(user, workouts) {
    localStorage.setItem(`workouts_${user}`, JSON.stringify(workouts));
  }

  function _entryAt(workouts, wi, ei) {
    const entry = workouts[wi] && workouts[wi].log && workouts[wi].log[ei];
    if (!entry) return null;
    if (typeof global.normalizeEntry === 'function') global.normalizeEntry(entry);
    const n = Array.isArray(entry.repsArray) ? entry.repsArray.length : 0;
    ['rirArray', 'completedArray', 'skippedArray', 'setTypeArray', 'weightsArray'].forEach((key) => {
      if (!Array.isArray(entry[key])) entry[key] = [];
      while (entry[key].length < n) entry[key].push(key === 'setTypeArray' ? 'standard' : key === 'rirArray' ? null : key === 'weightsArray' ? 0 : false);
    });
    return entry;
  }

  function _rerender() {
    if (typeof global.renderWorkouts === 'function') global.renderWorkouts();
    if (typeof global.renderSessionQueue === 'function') global.renderSessionQueue();
    if (typeof global.renderSessionSoFar === 'function') global.renderSessionSoFar();
  }

  function _toast(msg, type) {
    if (typeof global.showToast === 'function') global.showToast(msg, type);
  }

  // ── Actions (wired from the set rows in index.html createSetRow) ──

  /** Reps left on a set (null clears). Tapping the chosen chip again clears it. */
  function setSetRir(wi, ei, si, rir) {
    const user = _logUser();
    const workouts = _read(user);
    const entry = _entryAt(workouts, wi, ei);
    if (!entry) return;
    const v = _finite(rir);
    entry.rirArray[si] = entry.rirArray[si] === v ? null : v;
    _write(user, workouts);
    _rerender();
  }

  /** Top Set / Back-off tag on a set; tapping the active one sets it back to standard. */
  function setSetRole(wi, ei, si, role) {
    const user = _logUser();
    const workouts = _read(user);
    const entry = _entryAt(workouts, wi, ei);
    if (!entry) return;
    const type = role === 'top' ? 'top-set' : role === 'backoff' ? 'backoff' : 'standard';
    entry.setTypeArray[si] = entry.setTypeArray[si] === type ? 'standard' : type;
    if (Array.isArray(entry.dropsetArray)) entry.dropsetArray[si] = false;
    if (Array.isArray(entry.restPauseArray)) entry.restPauseArray[si] = false;
    _write(user, workouts);
    _rerender();
  }

  function toggleEffort(wi, ei, si) {
    const key = `${wi}_${ei}_${si}`;
    if (openEffort.has(key)) openEffort.delete(key); else openEffort.add(key);
    _rerender();
  }

  function isEffortOpen(wi, ei, si) { return openEffort.has(`${wi}_${ei}_${si}`); }

  /**
   * Tick (or untick) a set of a planned session. Ticking logs it: next-set
   * and back-off advice, next-session advice, PRs, streak and the rest
   * timer. Returns the in-session advice (or null).
   */
  function completeSet(wi, ei, si, completed = true) {
    const user = _logUser();
    const workouts = _read(user);
    const workout = workouts[wi];
    const entry = _entryAt(workouts, wi, ei);
    if (!entry) return null;

    entry.completedArray[si] = !!completed;
    if (completed) entry.skippedArray[si] = false;
    openEffort.delete(`${wi}_${ei}_${si}`);

    if (!completed) {
      _write(user, workouts);
      _rerender();
      return null;
    }

    const name = entry.exercise;
    const date = workout.date;
    const history = completedWorkouts(workouts);
    const today = history[wi];
    const gymKey = typeof global.entryGymKey === 'function' ? global.entryGymKey(entry) : '';

    // In-session advice, as quick log gives it after each set.
    let advice = null;
    if (typeof global.suggestNextSet === 'function') {
      try {
        // suggestNextSet reads the last workout dated today: hand it this one.
        const others = history.filter((w, i) => i !== wi && !(w && w.date === date));
        advice = global.suggestNextSet(name, others.concat([today]), { date, gymKey });
      } catch { advice = null; }
    }

    let filled = 0;
    if (advice && advice.kind === 'backoff' && entry.setTypeArray[si] === 'top-set') {
      filled = applyBackoffWeight(workout, name, advice.weight);
    }

    // Next-session advice, judged on the ticked sets.
    if (typeof global.suggestNextSession === 'function') {
      try {
        const ticked = completedEntry(entry);
        const pastAndToday = typeof global.getOverloadWorkouts === 'function'
          ? completedWorkouts(global.getOverloadWorkouts(user, workouts))
          : history;
        const rec = ticked ? global.suggestNextSession(ticked, pastAndToday) : null;
        if (rec) entry.nextSessionRecommendation = rec;
      } catch { /* advice is optional */ }
    }

    _write(user, workouts);

    if (typeof global.updatePRs === 'function' && typeof global.calculateWorkoutVolume === 'function') {
      try { global.updatePRs(user, completedView(workout), global.calculateWorkoutVolume); } catch { /* PRs optional */ }
      if (typeof global.renderPRs === 'function') { try { global.renderPRs(); } catch { /* */ } }
    }
    if (typeof global.trackWorkoutDate === 'function') { try { global.trackWorkoutDate(date); } catch { /* */ } }
    if (typeof global.updateStreakCounter === 'function') { try { global.updateStreakCounter(); } catch { /* */ } }
    if (typeof global.startWorkoutTimer === 'function') { try { global.startWorkoutTimer(); } catch { /* */ } }

    _rerender();

    if (advice && advice.message) {
      const extra = filled ? ` Back-off set${filled === 1 ? '' : 's'} updated.` : '';
      _toast(`${name}: ${advice.message}${extra}`, advice.warn ? 'warn' : undefined);
    }

    // Same signal quick log sends (performance mode, next-step chips, ...).
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent('tl:set-logged', { detail: { exercise: name, sets: 1, date, planned: true } }));
    }
    // Performance mode starts its own rest on that event; a rest the plan
    // prescribes wins over its default, so ours is written after it.
    if (!_performanceModeActive() || plannedRestSeconds(entry, si)) {
      const secs = restSecondsFor(entry, si, advice);
      setTimeout(() => startRest(secs), 0);
    }
    return advice;
  }

  const api = {
    DEFAULT_REST_SECONDS,
    isPlannedWorkout, completedEntry, completedView, completedWorkouts, nextOpenSet,
    applyBackoffWeight, plannedRestSeconds, restSecondsFor,
    completeSet, setSetRir, setSetRole, toggleEffort, isEffortOpen, startRest,
  };
  global.SetComplete = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
