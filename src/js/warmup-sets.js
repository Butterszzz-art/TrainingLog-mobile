/* =============================================================
   WARM-UP SETS
   Suggests warm-up sets for the exercise being logged, ramping up to
   the weight the lifter is about to use (from their history).

   Source: Butters University, module "Warm-up" (rule train.warmup.ramp
   in the backend rule registry):
   - 1-3 progressively heavier submaximal sets of the exercise itself
     before the working sets; no static stretching or activation drills.
   - Only for the first exercise that trains a muscle group in a session.
   - Worked example (squat 5x5): bar, ~50%, ~70%, ~85%, then work sets.
     The app keeps the 85% set for work of 5 reps or fewer; lighter,
     higher-rep work stops at 70% (still within BU's 1-3 sets).

   Rep counts are not in BU; they drop as the load rises (8/5/3/1) so
   the warm-up stays easy and doesn't eat into the work sets.

   Warm-ups are saved on the workout as `workout.warmups` (never in
   `log`), so PRs, volume, e1RM and progression never count them.
   ============================================================= */
(function (global) {
  'use strict';

  const BAR = { kg: 20, lbs: 45 };
  const STEP = { kg: 2.5, lbs: 5 };

  const ISOLATION_RE = /\b(curls?|extensions?|raises?|fl(y|ies|yes)|kickbacks?|push-?downs?|crunch(es)?|calf|calves|shrugs?|pullovers?|face ?pulls?|adduct|abduct|leg curl|pec deck|wrist)\b/i;
  const NO_BAR_RE = /\b(dumbbells?|db|machine|cable|smith|hammer strength|leg press|kettlebell|kb|band|bodyweight|pull-?ups?|chin-?ups?|dips?|push-?ups?|lat pull|pulldown|seated row|hack squat|pendulum|selectorized)\b/i;
  const BARBELL_RE = /\b(barbell|bb|squat|deadlift|bench press|bench|overhead press|ohp|military press|rdl|romanian|good ?morning|hip thrust|pendlay|clean|snatch|jerk|ez[- ]?bar)\b/i;

  /** 'barbell' | 'other', and whether it's a compound lift, from the name. */
  function classifyExercise(name) {
    const n = String(name || '');
    const isolation = ISOLATION_RE.test(n) && !/\b(squat|deadlift|press)\b/i.test(n);
    const barbell = !NO_BAR_RE.test(n) && BARBELL_RE.test(n);
    return { equipment: barbell ? 'barbell' : 'other', compound: !isolation };
  }

  function _unit(u) { return u === 'lbs' || u === 'lb' ? 'lbs' : 'kg'; }

  function roundToLoadable(weight, unit) {
    const step = STEP[_unit(unit)];
    return Math.round(weight / step) * step;
  }

  function _repsFor(pct) {
    if (pct <= 0.55) return 5;
    if (pct <= 0.8) return 3;
    return 1;
  }

  /**
   * Warm-up sets leading up to `workWeight`.
   * Returns { sets: [{weight, reps, pct, isBar}], reason } where reason is
   * 'ramp' (sets given), 'warm' (muscle already trained today),
   * 'light' (work weight too light to need a ramp) or 'none' (no data).
   */
  function buildWarmupSets({ exercise, workWeight, workReps, unit = 'kg', alreadyWarm = false } = {}) {
    const w = Number(workWeight) || 0;
    const u = _unit(unit);
    if (w <= 0) return { sets: [], reason: 'none' };
    if (alreadyWarm) return { sets: [], reason: 'warm' };

    const { equipment, compound } = classifyExercise(exercise);
    const bar = BAR[u];
    const step = STEP[u];
    const heavy = Number(workReps) > 0 && Number(workReps) <= 5;

    if (equipment === 'barbell' && w <= bar) return { sets: [], reason: 'light' };
    let plan;
    if (!compound) {
      // Isolation lifts use light loads: one set at about half (the low end of BU's 1-3).
      plan = [{ pct: 0.5 }];
    } else if (equipment === 'barbell') {
      // Bar, 50%, 70% (BU worked example); 85% added for heavy (<=5 rep) work, as in that squat 5x5 example.
      plan = [{ pct: bar / w, isBar: true }, { pct: 0.5 }, { pct: 0.7 }];
      if (heavy) plan.push({ pct: 0.85 });
    } else {
      plan = [{ pct: 0.5 }, { pct: 0.7 }];
      if (heavy) plan.push({ pct: 0.85 });
    }

    const sets = [];
    let prev = 0;
    plan.forEach((p) => {
      const weight = p.isBar ? bar : roundToLoadable(w * p.pct, u);
      const floor = equipment === 'barbell' ? bar : step;
      // Skip rungs below the bar, at the work weight, or too close to the
      // previous one to be worth a set (under ~10% of the work weight).
      const minGap = Math.max(step, w * 0.1) - 1e-9;
      if (weight < floor || weight >= w || (prev && weight - prev < minGap)) return;
      prev = weight;
      const pct = weight / w;
      sets.push({ weight, reps: p.isBar ? 8 : _repsFor(pct), pct: Math.round(pct * 100), isBar: !!p.isBar });
    });

    return sets.length ? { sets, reason: 'ramp' } : { sets: [], reason: 'light' };
  }

  /**
   * The weight the lifter is about to work up to, from their history:
   * the heaviest set in the progression suggestion, else in their last session.
   */
  function pickWorkTarget(recommendation, lastSession) {
    const pick = (sets) => (Array.isArray(sets) ? sets : [])
      .map(s => ({ weight: Number(s && s.weight) || 0, reps: Number(s && s.reps) || 0 }))
      .filter(s => s.weight > 0)
      .sort((a, b) => b.weight - a.weight)[0] || null;
    const fromRec = recommendation && pick(recommendation.sets);
    if (fromRec) return { ...fromRec, unit: recommendation.unit || (lastSession && lastSession.unit) || 'kg', source: 'suggestion' };
    const fromLast = lastSession && pick(lastSession.sets);
    if (fromLast) return { ...fromLast, unit: lastSession.unit || 'kg', source: 'last' };
    return null;
  }

  const _norm = s => String(s || '').trim().toLowerCase();

  /**
   * Has today's session already trained this muscle (through another
   * exercise or its warm-ups)? Returns the exercise name that did, or null.
   */
  function findWarmingExercise(exercise, todayWorkout, getMuscleGroup) {
    if (!todayWorkout || typeof getMuscleGroup !== 'function') return null;
    const me = _norm(exercise);
    const muscle = getMuscleGroup(exercise);
    if (!muscle || muscle === 'other' || muscle === 'unknown') return null;
    const names = [
      ...(Array.isArray(todayWorkout.log) ? todayWorkout.log.map(e => e && (e.exercise || e.name)) : []),
      ...(Array.isArray(todayWorkout.warmups) ? todayWorkout.warmups.map(x => x && x.exercise) : []),
    ];
    return names.find(n => n && _norm(n) !== me && getMuscleGroup(n) === muscle) || null;
  }

  /** Has this exercise already got a working set logged today? */
  function hasWorkSetToday(exercise, todayWorkout) {
    const me = _norm(exercise);
    return !!(todayWorkout && Array.isArray(todayWorkout.log) &&
      todayWorkout.log.some(e => e && _norm(e.exercise || e.name) === me && Array.isArray(e.repsArray) && e.repsArray.length));
  }

  function warmupsDoneFor(exercise, todayWorkout) {
    const me = _norm(exercise);
    return (todayWorkout && Array.isArray(todayWorkout.warmups) ? todayWorkout.warmups : [])
      .filter(x => x && _norm(x.exercise) === me);
  }

  /* ── DOM ──────────────────────────────────────────────────── */

  function _esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _fmt(n) { return String(Math.round((Number(n) || 0) * 100) / 100); }

  function _user() {
    return global.coachLoggingClient ||
      (typeof global.getActiveUsername === 'function' && global.getActiveUsername()) ||
      global.currentUser ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser')) || null;
  }
  function _key(u) { return `workouts_${u}`; }
  function _load(u) {
    try { return JSON.parse(localStorage.getItem(_key(u))) || []; } catch { return []; }
  }
  function _date() {
    const input = document.getElementById('entryDate');
    if (typeof global.resolveEntryDate === 'function') return global.resolveEntryDate(input);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function _on() {
    try { return localStorage.getItem('autoIncrementEnabled') !== 'false'; } catch { return true; }
  }

  let _shown = null; // { exercise, unit, sets }

  function renderWarmupHint() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('warmupHint');
    const input = document.getElementById('exercise');
    if (!el) return;
    const clear = () => { el.innerHTML = ''; el.hidden = true; _shown = null; };
    const exercise = ((input && input.value) || '').trim();
    const u = _user();
    if (exercise.length < 3 || !u || !_on()) return clear();

    const workouts = _load(u);
    const today = workouts.find(w => w && w.date === _date()) || null;
    if (hasWorkSetToday(exercise, today)) return clear(); // already into the work sets

    const last = typeof global.getLastExerciseSession === 'function' ? global.getLastExerciseSession(exercise, u) : null;
    const rec = typeof global.suggestNextSession === 'function' ? global.suggestNextSession(exercise, workouts) : null;
    const target = pickWorkTarget(rec, last);
    if (!target) return clear();

    const warmBy = findWarmingExercise(exercise, today, global.getMuscleGroup);
    const plan = buildWarmupSets({ exercise, workWeight: target.weight, workReps: target.reps, unit: target.unit, alreadyWarm: !!warmBy });
    const unit = _unit(target.unit);
    const work = `${_fmt(target.weight)} ${unit}${target.reps ? ' × ' + target.reps : ''}`;

    if (plan.reason === 'warm') {
      el.innerHTML = `<div class="wu-card is-quiet"><span class="wu-eyebrow">Warm-up</span>
        <p class="wu-msg">Already warm from ${_esc(warmBy)} — go straight to ${_esc(work)}.</p></div>`;
      el.hidden = false; _shown = null;
      return;
    }
    if (plan.reason !== 'ramp') return clear();

    const done = warmupsDoneFor(exercise, today);
    const isDone = s => done.some(d => Number(d.weight) === s.weight && Number(d.reps) === s.reps);
    _shown = { exercise, unit, sets: plan.sets };
    const chips = plan.sets.map((s, i) => {
      const on = isDone(s);
      const label = `${s.isBar ? 'Bar' : _fmt(s.weight) + ' ' + unit} × ${s.reps}`;
      return `<button type="button" class="wu-chip${on ? ' is-done' : ''}" aria-pressed="${on}" onclick="toggleWarmupSet(${i})"
        aria-label="Warm-up ${_esc(label)}${on ? ', done' : ''}" title="${on ? 'Done — tap to undo' : 'Tap when done'}"><span class="wu-chip-w">${s.isBar ? 'Bar' : _fmt(s.weight)}</span><span class="wu-chip-r">× ${s.reps}</span></button>`;
    }).join('<span class="wu-arrow" aria-hidden="true">›</span>');

    el.innerHTML = `
      <div class="wu-card">
        <div class="wu-top">
          <span class="wu-eyebrow">Warm-up</span>
          <span class="wu-target">then ${_esc(work)}</span>
        </div>
        <div class="wu-chips">${chips}</div>
        <p class="wu-note">Tap each set when done. Warm-ups don't count toward PRs or volume. No stretching needed.</p>
      </div>`;
    el.hidden = false;
  }

  /** Tap a chip: mark that warm-up set done (saved on today's workout), or undo it. */
  function toggleWarmupSet(i) {
    if (!_shown || !_shown.sets[i]) return;
    const u = _user();
    if (!u) return;
    const set = _shown.sets[i];
    const date = _date();
    const workouts = _load(u);
    let today = workouts.find(w => w && w.date === date);
    if (!today) {
      const id = typeof global.newWorkoutId === 'function' ? global.newWorkoutId() : `w-${Date.now()}`;
      today = { id, title: `Workout on ${date}`, date, log: [], restBreaks: [] };
      workouts.push(today);
    }
    if (!Array.isArray(today.warmups)) today.warmups = [];
    const me = _norm(_shown.exercise);
    const at = today.warmups.findIndex(x => x && _norm(x.exercise) === me && Number(x.weight) === set.weight && Number(x.reps) === set.reps);
    if (at >= 0) {
      today.warmups.splice(at, 1);
    } else {
      today.warmups.push({ exercise: _shown.exercise, weight: set.weight, reps: set.reps, unit: _shown.unit, at: new Date().toISOString() });
      if (typeof global.startWorkoutTimer === 'function') {
        try { global.startWorkoutTimer(); } catch (err) { /* timer is optional */ }
      }
    }
    try { localStorage.setItem(_key(u), JSON.stringify(workouts)); } catch (err) { console.warn('Could not save warm-up', err); }
    renderWarmupHint();
    if (typeof global.renderSessionSoFar === 'function') global.renderSessionSoFar();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        const input = document.getElementById('exercise');
        let t = null;
        const later = () => { clearTimeout(t); t = setTimeout(renderWarmupHint, 350); };
        if (input) input.addEventListener('input', later);
        document.addEventListener('tl:gym-changed', later);
      }, 800);
    });
  }

  const api = { classifyExercise, roundToLoadable, buildWarmupSets, pickWorkTarget, findWarmingExercise, hasWorkSetToday, warmupsDoneFor, renderWarmupHint, toggleWarmupSet };
  global.renderWarmupHint = renderWarmupHint;
  global.toggleWarmupSet = toggleWarmupSet;
  global.WarmupSets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
