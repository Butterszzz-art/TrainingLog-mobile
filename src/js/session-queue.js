/**
 * session-queue.js
 * Renders the "today's plan" list at the top of the Train tab's Log
 * sub-view. Which day is today comes from program-schedule.js (shared with
 * the Home card). The plan can be loaded into today's log like a template
 * (loadTodayProgramIntoLog), and its rows tick off as sets are logged.
 */
(function (global) {
  'use strict';

  // Local calendar day — workouts are keyed by it (index.html localDateKey()).
  function _localDateKey(d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function _user() {
    return global.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser'));
  }

  function _schedule() {
    if (global.programSchedule) return global.programSchedule;
    try { return typeof require === 'function' ? require('./program-schedule') : null; } catch { return null; }
  }

  /** Resolve today's program day object ({ name, exercises: [...] }), or null.
   * Follows program-schedule.js, so a "Do it today" swap on Home applies here. */
  function getTodaysPlannedDay() {
    const ps = _schedule();
    if (!ps) return null;
    const schedule = ps.getActiveSchedule(_user());
    if (!schedule) return null;
    const today = schedule.dayFor(new Date());
    if (!today.isTraining || !today.day) return null; // rest day
    return { ...today.day, programName: schedule.program.name, programId: schedule.program.id, weekNum: today.weekNum, weekCount: schedule.weekCount };
  }

  function _setSummary(ex) {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    if (!sets.length) return '';
    const first = sets[0];
    const reps = first.reps != null
      ? (first.repsMax > first.reps ? `${first.reps}-${first.repsMax}` : first.reps)
      : '?';
    const weight = first.weight != null ? `${first.weight}` : null;
    return weight ? `${sets.length}×${reps} · ${weight}` : `${sets.length}×${reps}`;
  }

  /** Sum of reps*weight across every planned set, in kg. */
  function _tonnageTarget(exercises) {
    return exercises.reduce((sum, ex) => {
      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      return sum + sets.reduce((s, set) => s + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0);
    }, 0);
  }

  function _totalSets(exercises) {
    return exercises.reduce((n, ex) => n + (Array.isArray(ex.sets) ? ex.sets.length : 0), 0);
  }

  /** Average of any explicit per-set RPE targets in the plan, or null. */
  function _avgTargetRpe(exercises) {
    const rpes = [];
    exercises.forEach(ex => (ex.sets || []).forEach(s => { if (s.rpe != null) rpes.push(Number(s.rpe)); }));
    if (!rpes.length) return null;
    return (rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1);
  }

  function _muscleSummary(exercises) {
    if (typeof global.getMuscleGroup !== 'function') return '';
    const groups = [];
    exercises.forEach(ex => {
      const g = global.getMuscleGroup(ex.name);
      if (g && !groups.includes(g)) groups.push(g);
    });
    return groups.slice(0, 3).join(' · ');
  }

  /** Train tab hero pod: today's session name/muscles/set-target, tonnage-
   * target progress bar, and a start-session CTA. Real data throughout —
   * "vs last"/"fatigue"/"PR shots" have no computed source yet, so those
   * three stat cells are left out rather than fabricated (see the plan's
   * metrics decision — visual-only stats must be clearly non-real, and an
   * unlabeled fake number is worse than a shorter, honest stat row).
   */
  function renderTrainHero() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('trainHeroCard');
    if (!el) return;

    const day = getTodaysPlannedDay();
    if (!day) {
      el.innerHTML = `
        <div class="pod pod--hero train-hero-card">
          <div class="pod-kicker">No session planned today</div>
          <p class="ws-empty-note" style="margin-top:8px;">Rest day, or no active program is assigned — log manually below whenever you're ready.</p>
          <button type="button" class="cta-capsule-outline train-hero-pm-btn" onclick="if(typeof startPerformanceMode==='function') startPerformanceMode();"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>Start in performance mode</button>
        </div>`;
      return;
    }

    const exercises = Array.isArray(day.exercises) ? day.exercises : [];
    const tonnageTargetKg = _tonnageTarget(exercises);
    const totalSets = _totalSets(exercises);
    const rpeTarget = _avgTargetRpe(exercises);
    const muscles = _muscleSummary(exercises);
    const ps = _schedule();
    const progress = ps ? ps.dayProgress(day, ps.workoutsOn(_localDateKey(), _user())) : null;
    const doneSets = progress ? progress.doneSets : 0;
    const doneKg = progress ? progress.doneKg : 0;
    const pct = tonnageTargetKg > 0
      ? Math.min(100, Math.round((doneKg / tonnageTargetKg) * 100))
      : (totalSets ? Math.round((doneSets / totalSets) * 100) : 0);

    el.innerHTML = `
      <div class="pod pod--hero train-hero-card">
        <div class="train-hero-top">
          <div>
            <div class="train-hero-name">${day.name}</div>
            <div class="train-hero-meta">${muscles ? muscles + ' &middot; ' : ''}${exercises.length} lift${exercises.length === 1 ? '' : 's'} &middot; ${totalSets} set${totalSets === 1 ? '' : 's'}</div>
          </div>
          ${rpeTarget ? `<div class="train-hero-rpe"><div class="home-hero-stat-lbl">Target RPE</div><div class="train-hero-rpe-val">${rpeTarget}</div></div>` : ''}
        </div>
        <div class="train-hero-tonnage-row">
          <span>TONNAGE ${(doneKg / 1000).toFixed(1)}t / ${(tonnageTargetKg / 1000).toFixed(1)}t</span>
          <span>${pct}% &middot; ${doneSets} of ${totalSets} sets</span>
        </div>
        <div class="train-hero-tonnage-track"><div class="train-hero-tonnage-fill" style="width:${pct}%"></div></div>
        <button class="cta-capsule train-hero-cta" onclick="if(typeof loadTodayProgramIntoLog==='function') loadTodayProgramIntoLog(); else goToQuickLog();">${doneSets ? 'Continue session' : 'Start session'}</button>
        <button type="button" class="cta-capsule-outline train-hero-pm-btn" onclick="if(typeof startPerformanceMode==='function') startPerformanceMode();"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>Start in performance mode</button>
      </div>`;
  }

  /** Sleep/Energy/Sore/Ready strip — all four values come straight from
   * the daily readiness check-in (src/js/readiness-checkin.js) when the
   * lifter has filled it in today; otherwise each cell shows "—". */
  function renderTrainReadinessStrip() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('trainReadinessStrip');
    if (!el) return;
    const entry = typeof global.getTodayReadinessEntry === 'function' ? global.getTodayReadinessEntry() : null;
    const cell = (label, val) => `<div class="train-strip-cell"><div class="home-hero-stat-lbl">${label}</div><div class="train-strip-val">${val != null ? val : '—'}</div></div>`;
    el.innerHTML = entry
      ? cell('Sleep', entry.sleep + '/5') + cell('Motivation', entry.motivation + '/5') + cell('Soreness', entry.soreness + '/5') + cell('Ready', entry.score)
      : cell('Sleep', null) + cell('Motivation', null) + cell('Soreness', null) + cell('Ready', null);
  }

  /** "Session so far" pod: exercises already logged today, from the same
   * workouts_<user> store renderWorkouts() reads (real data — every
   * exercise/set count shown here is something the user actually logged). */
  function renderSessionSoFar() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('sessionSoFarCard');
    if (!el) return;

    const u = global.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser'));
    const todayStr = _localDateKey();
    let workouts = [];
    try { workouts = u ? JSON.parse(localStorage.getItem('workouts_' + u)) || [] : []; } catch { workouts = []; }
    const today = workouts.find(w => w.date === todayStr);
    const log = today && Array.isArray(today.log) ? today.log : [];

    if (!log.length) { el.innerHTML = ''; return; }

    let totalSets = 0, totalVolumeKg = 0;
    log.forEach(entry => {
      const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
      const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
      totalSets += entry.sets || reps.length;
      reps.forEach((r, i) => { totalVolumeKg += (Number(r) || 0) * (Number(weights[i]) || 0); });
    });

    // Group by exercise name — quick-log calls addLogEntry() once per
    // single set, so the same exercise can appear as several separate
    // log[] entries; show one row per exercise with the combined count.
    const byExercise = new Map();
    log.forEach(entry => {
      const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
      const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
      const existing = byExercise.get(entry.exercise) || { setCount: 0, lastReps: null, lastWeight: null };
      existing.setCount += reps.length;
      if (reps.length) { existing.lastReps = reps[reps.length - 1]; existing.lastWeight = weights[weights.length - 1]; }
      byExercise.set(entry.exercise, existing);
    });

    const rows = Array.from(byExercise.entries()).map(([name, e]) => {
      const summary = e.setCount ? `${e.setCount}×${e.lastReps ?? '?'}${e.lastWeight != null ? ' · ' + e.lastWeight + ' kg' : ''}` : '';
      return `<div class="sq-row"><span class="sq-name">${name}</span><span class="sq-summary">${summary}</span></div>`;
    }).join('');

    el.innerHTML = `
      <div class="pod sq-card">
        <div class="pod-row">
          <span class="pod-kicker">Session so far</span>
          <span class="sq-count">${totalSets} set${totalSets === 1 ? '' : 's'} &middot; ${(totalVolumeKg).toLocaleString()} kg</span>
        </div>
        ${rows}
      </div>`;
  }

  // ── Weekly volume landmarks (MEV/MAV/MRV) ───────────────────────
  // MEV/MAV/MRV are commonly-published weekly-set training guidelines
  // (Renaissance-Periodization-style ballparks), not a per-user
  // prescription this app computes — they're reference thresholds.
  // What IS real: the actual weekly set count per muscle, tallied from
  // the same workout history libraries.js already reads.
  const VOLUME_LANDMARKS = {
    Chest: { mev: 8, mav: 18, mrv: 22 },
    Back: { mev: 10, mav: 20, mrv: 25 },
    Delts: { mev: 8, mav: 20, mrv: 26 },
    Arms: { mev: 8, mav: 18, mrv: 24 },
    Legs: { mev: 10, mav: 20, mrv: 28 },
    Core: { mev: 6, mav: 16, mrv: 20 },
  };

  /** Real weekly (last 7 days) set count per coarse muscle group, from
   * the live + archived workout history. */
  function _weeklySetsByMuscle() {
    const u = _user();
    const counts = {};
    if (!u || typeof localStorage === 'undefined' || typeof global.getCoarseMuscleGroup !== 'function') return counts;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const tally = (name, dateStr, setCount) => {
      if (!dateStr || dateStr < cutoffStr) return;
      const group = global.getCoarseMuscleGroup(name);
      counts[group] = (counts[group] || 0) + setCount;
    };

    try {
      const workouts = JSON.parse(localStorage.getItem('workouts_' + u)) || [];
      workouts.forEach(w => (w.log || []).forEach(entry => {
        tally(entry.exercise, w.date, Array.isArray(entry.repsArray) ? entry.repsArray.length : 0);
      }));
    } catch { /* ignore */ }

    try {
      const archived = JSON.parse(localStorage.getItem('tl_workout_history_v1')) || [];
      archived.filter(w => !w.userId || w.userId === u).forEach(w => (w.exercises || []).forEach(ex => {
        tally(ex.name, (w.date || '').slice(0, 10), Array.isArray(ex.repsArray) ? ex.repsArray.length : 0);
      }));
    } catch { /* ignore */ }

    return counts;
  }

  function renderVolumeLandmarks() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('volumeLandmarksCard');
    if (!el) return;

    const weekly = _weeklySetsByMuscle();
    const groups = Object.keys(VOLUME_LANDMARKS).filter(g => weekly[g] > 0);
    if (!groups.length) { el.innerHTML = ''; return; }

    const rows = groups.map(g => {
      const { mev, mav, mrv } = VOLUME_LANDMARKS[g];
      const actual = weekly[g] || 0;
      const fillPct = Math.min(100, Math.round((actual / mrv) * 100));
      const mevPct = Math.round((mev / mrv) * 100);
      const mavPct = Math.round((mav / mrv) * 100);
      const overMav = actual >= mav;
      const fillColor = overMav
        ? 'var(--fill-meter-brass)'
        : 'var(--fill-meter-b)';
      return `
        <div class="vl-row">
          <span class="vl-muscle">${g}</span>
          <div class="vl-track">
            <div class="vl-fill" style="width:${fillPct}%;background:${fillColor}"></div>
            <div class="vl-tick" style="left:${mevPct}%"></div>
            <div class="vl-tick vl-tick--mav" style="left:${mavPct}%"></div>
          </div>
          <span class="vl-count${overMav ? ' is-high' : ''}">${actual}/${mrv}</span>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="pod vl-card">
        <div class="pod-row">
          <span class="pod-kicker">Weekly volume landmarks</span>
          <span class="sq-count">sets &middot; MEV/MAV/MRV</span>
        </div>
        ${rows}
      </div>`;
  }

  // ── Today's program in the log ──────────────────────────────────
  // The program day loads into today's log the same way a saved template
  // does (index.html loadSelectedResistanceTemplate): one workout whose sets
  // carry the planned reps/weights and get ticked Done as they're lifted.
  // metadata.source === 'program' marks it so it's loaded only once and so
  // program-schedule.js dayProgress() counts its ticked sets.

  function _readWorkouts(u) {
    try { return JSON.parse(localStorage.getItem('workouts_' + u)) || []; } catch { return []; }
  }

  /** Index of today's workout loaded from this program day, or -1. */
  function _loadedProgramWorkoutIndex(day, workouts) {
    const todayStr = _localDateKey();
    return workouts.findIndex(w => w && w.date === todayStr && w.metadata && w.metadata.source === 'program'
      && w.metadata.programDay === day.name);
  }

  function _lastWeightFor(name) {
    if (typeof global.getExerciseStats !== 'function') return null;
    try {
      const stats = global.getExerciseStats(name);
      return stats && stats.lastTopSet && Number(stats.lastTopSet.weight) > 0 ? Number(stats.lastTopSet.weight) : null;
    } catch { return null; }
  }

  /** Build the template-style log entries for a program day. Planned weight
   * wins; otherwise last time's top-set weight; otherwise blank (0). */
  function buildProgramDayLog(day, dateKey, lastWeightFor) {
    const lookup = typeof lastWeightFor === 'function' ? lastWeightFor : () => null;
    return (Array.isArray(day.exercises) ? day.exercises : []).map((ex, exerciseIndex) => {
      const sets = Array.isArray(ex.sets) && ex.sets.length ? ex.sets : [{ reps: 0 }];
      const fallback = lookup(ex.name);
      return {
        exercise: ex.name,
        sets: sets.length,
        repsArray: sets.map(set => Number(set.reps) || 0),
        weightsArray: sets.map(set => (Number(set.weight) > 0 ? Number(set.weight) : (fallback || 0))),
        dropsetArray: sets.map(() => false),
        restPauseArray: sets.map(() => false),
        skippedArray: sets.map(() => false),
        completedArray: sets.map(() => false),
        setTypeArray: sets.map(set => set.setType || 'standard'),
        groupType: ex.supersetGroup ? 'superset' : 'straight',
        groupId: ex.supersetGroup ? `program_${ex.supersetGroup}` : null,
        templateExerciseId: `program_${exerciseIndex}`,
        unit: 'kg',
        date: dateKey,
      };
    });
  }

  function _openAndScrollTo(workoutIndex, entryIndex) {
    if (typeof document === 'undefined') return;
    const details = document.getElementById(`workoutDetails${workoutIndex}`);
    if (details) details.style.display = 'block';
    const strip = entryIndex != null ? document.getElementById(`exProgress_${workoutIndex}_${entryIndex}`) : null;
    const target = (strip && strip.parentElement) || details;
    if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /** Load today's program day into today's log like a template (once), then
   * open it. Returns the workout index, or -1 when there's nothing to load. */
  function loadTodayProgramIntoLog(opts) {
    const options = opts || {};
    const day = getTodaysPlannedDay();
    const u = _user();
    if (!day || !u || !Array.isArray(day.exercises) || !day.exercises.length) {
      if (global.showToast) global.showToast('No program session planned today.', 'warn');
      return -1;
    }
    const workouts = _readWorkouts(u);
    let index = _loadedProgramWorkoutIndex(day, workouts);
    if (index === -1) {
      const dateKey = _localDateKey();
      workouts.push({
        title: day.name,
        date: dateKey,
        metadata: { source: 'program', programId: day.programId || null, programDay: day.name, programName: day.programName || '' },
        log: buildProgramDayLog(day, dateKey, _lastWeightFor),
        restBreaks: [],
      });
      localStorage.setItem('workouts_' + u, JSON.stringify(workouts));
      index = workouts.length - 1;
      if (typeof global.renderWorkouts === 'function') global.renderWorkouts();
      if (global.showToast) global.showToast(`${day.name} loaded from your program`, 'success');
    }
    renderSessionQueue();
    if (options.scroll !== false) setTimeout(() => _openAndScrollTo(index, null), 60);
    return index;
  }

  function _escHTML(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** The "Today's program" row above the template picker in the log form. */
  function renderProgramTemplateRow() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('programTemplateRow');
    if (!el) return;
    const day = getTodaysPlannedDay();
    const exercises = day && Array.isArray(day.exercises) ? day.exercises : [];
    if (!day || !exercises.length) { el.innerHTML = ''; el.hidden = true; return; }
    const loaded = _loadedProgramWorkoutIndex(day, _readWorkouts(_user())) !== -1;
    const week = day.weekCount > 1 ? ` · week ${day.weekNum}` : '';
    el.hidden = false;
    el.innerHTML = `
      <button type="button" class="sq-program-load${loaded ? ' is-loaded' : ''}" onclick="loadTodayProgramIntoLog()">
        <span class="sq-program-load-text">
          <span class="sq-program-load-name">${loaded ? `${_escHTML(day.name)} is in today's log` : `Today's program: ${_escHTML(day.name)}`}</span>
          <span class="sq-program-load-sub">${_escHTML(day.programName || 'Your program')}${week} · ${exercises.length} lift${exercises.length === 1 ? '' : 's'}</span>
        </span>
        <span class="sq-program-load-cta">${loaded ? 'Show' : 'Load'}</span>
      </button>`;
  }

  function renderSessionQueue() {
    if (typeof document === 'undefined') return;
    renderProgramTemplateRow();
    const el = document.getElementById('sessionQueueCard');
    if (!el) return;

    const day = getTodaysPlannedDay();
    const exercises = day && Array.isArray(day.exercises) ? day.exercises : [];
    if (!day || !exercises.length) { el.innerHTML = ''; return; }

    const ps = _schedule();
    const progress = ps ? ps.dayProgress(day, ps.workoutsOn(_localDateKey(), _user())) : null;
    const tracking = !!(progress && progress.started);
    const currentIdx = tracking ? progress.lifts.findIndex(l => !l.complete) : -1;

    const _esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const hasStats = typeof global.getExerciseStats === 'function';
    const rows = exercises.map((ex, i) => {
      const first = (ex.sets && ex.sets[0]) || {};
      const lift = progress ? progress.lifts[i] : null;
      const done = !!(lift && lift.complete);
      let tail;
      if (tracking) {
        tail = `<span class="sq-setcount">${lift ? lift.done : 0}/${lift ? lift.planned : 0}</span>`;
      } else {
        const stats = hasStats ? global.getExerciseStats(ex.name) : null;
        const pctHTML = stats && stats.pctOf1rm != null
          ? `<span class="sq-e1rm">${stats.pctOf1rm}%</span>` : '<span class="sq-e1rm">—</span>';
        const deltaHTML = stats && stats.deltaWeight != null
          ? `<span class="sq-delta ${stats.deltaWeight > 0 ? 'is-up' : stats.deltaWeight < 0 ? 'is-down' : 'is-flat'}">${stats.deltaWeight > 0 ? '+' : ''}${stats.deltaWeight}</span>`
          : '<span class="sq-delta is-flat">=</span>';
        tail = pctHTML + deltaHTML;
      }
      return `
      <div class="sq-row sq-row--tap${done ? ' is-done' : ''}${i === currentIdx ? ' is-current' : ''}" data-ex-name="${_esc(ex.name)}" data-ex-weight="${first.weight ?? ''}" data-ex-reps="${first.reps ?? ''}">
        <span class="sq-index">${done ? '✓' : i + 1}</span>
        <span class="sq-name">${ex.name}</span>
        <span class="sq-summary">${_setSummary(ex)}</span>
        ${tail}
      </div>`;
    }).join('');

    const head = tracking
      ? `<span class="sq-count">${progress.doneLifts} of ${progress.totalLifts} &middot; ${progress.doneSets}/${progress.totalSets} sets</span>`
      : '<span class="sq-count">load &middot; %1RM &middot; &Delta; last</span>';
    const pct = tracking && progress.totalSets ? Math.round((progress.doneSets / progress.totalSets) * 100) : 0;
    const bar = tracking
      ? `<div class="sq-progress" role="progressbar" aria-label="Sets done today" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`
      : '';

    el.innerHTML = `
      <div class="pod sq-card">
        <div class="pod-row">
          <span class="pod-kicker">Today's plan · ${day.name}</span>
          ${head}
        </div>
        ${bar}
        ${rows}
      </div>`;

    if (!el._tapWired) {
      el._tapWired = true;
      el.addEventListener('click', (e) => {
        const row = e.target.closest('.sq-row--tap');
        if (!row) return;
        // Day loaded like a template: jump to that lift's card to tick sets.
        const planned = getTodaysPlannedDay();
        const workouts = _readWorkouts(_user());
        const loadedIdx = planned ? _loadedProgramWorkoutIndex(planned, workouts) : -1;
        if (loadedIdx !== -1) {
          const name = String(row.dataset.exName || '').trim().toLowerCase();
          const log = workouts[loadedIdx].log || [];
          const entryIndex = log.findIndex(entry => String(entry.exercise || '').trim().toLowerCase() === name);
          _openAndScrollTo(loadedIdx, entryIndex === -1 ? null : entryIndex);
          return;
        }
        if (typeof global.startQuickLogFor !== 'function') return;
        global.startQuickLogFor(row.dataset.exName, {
          weight: row.dataset.exWeight ? Number(row.dataset.exWeight) : null,
          reps: row.dataset.exReps ? Number(row.dataset.exReps) : null,
        });
      });
    }
  }

  // ── Quick log — one-tap single-set logging ──────────────────────
  // Drives the existing #exercise/#sets/#reps_0/#weight_0 fields and
  // calls the existing addLogEntry() — no parallel save path, no new
  // data shape. This is purely a faster front door onto the same
  // workouts_<user> store the manual form already writes to.

  let _qlExerciseName = null;
  let _qlWeight = null;
  let _qlReps = null;
  // Last exercise a set was quick-logged for. Once the lifter moves on to a
  // different exercise, the previous one's weight/reps stop being sticky.
  let _qlLoggedName = null;
  const _sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  function _round1(n) { return Math.round(n * 10) / 10; }

  function _syncQuickLogDisplay() {
    if (typeof document === 'undefined') return;
    const w = document.getElementById('qlWeightVal');
    const r = document.getElementById('qlRepsVal');
    if (w) w.textContent = _qlWeight != null ? _qlWeight : '—';
    if (r) r.textContent = _qlReps != null ? _qlReps : '—';
  }

  function _writeQuickLogToForm() {
    if (typeof document === 'undefined') return;
    const weightEl = document.getElementById('weight_0');
    const repsEl = document.getElementById('reps_0');
    if (weightEl && _qlWeight != null) weightEl.value = _qlWeight;
    if (repsEl && _qlReps != null) repsEl.value = _qlReps;

    // Copy the quick-log-native Top/BO/Drop/RP/L-R pills onto the real
    // set-0 checkboxes addLogEntry() reads. Those checkboxes live inside
    // #setInputsContainer and get wiped back to unchecked every time
    // generateSetInputs(1) reruns (every #exercise keystroke while only
    // one row exists, and again inside quickLogSet() right before this
    // runs) — so this has to happen after every regeneration, not just once.
    const topPill = document.getElementById('qlTopSet');
    const boPill = document.getElementById('qlBackoff');
    const dsPill = document.getElementById('qlDropset');
    const rpPill = document.getElementById('qlRestPause');
    const uniPill = document.getElementById('qlUnilateral');
    const topEl = document.getElementById('topSet_0');
    const boEl = document.getElementById('backoff_0');
    const dsEl = document.getElementById('dropset_0');
    const rpEl = document.getElementById('restPause_0');
    const uniEl = document.getElementById('unilateral_0');
    if (topEl) topEl.checked = !!(topPill && topPill.checked);
    if (boEl) boEl.checked = !!(boPill && boPill.checked);
    if (dsEl) dsEl.checked = !!(dsPill && dsPill.checked);
    if (rpEl) rpEl.checked = !!(rpPill && rpPill.checked);
    if (uniEl) uniEl.checked = !!(uniPill && uniPill.checked);

    if (typeof global.updateAddButtonState === 'function') global.updateAddButtonState();
  }

  /** A set can be the Top Set OR a Back-off Set, never both — checking one
   * clears the other, mirroring the per-row toggleSetRole() behavior for
   * rows added via "+ Add another set". */
  function toggleQuickLogSetRole(role) {
    if (typeof document === 'undefined') return;
    const topEl = document.getElementById('qlTopSet');
    const boEl = document.getElementById('qlBackoff');
    if (!topEl || !boEl) return;
    if (role === 'top' && topEl.checked) {
      boEl.checked = false;
    } else if (role === 'backoff' && boEl.checked) {
      topEl.checked = false;
    }
    _writeQuickLogToForm();
  }

  /** Top/BO/Drop/RP/L-R are per-set flags, not sticky like weight/reps —
   * clear them back to unchecked (new exercise, or after a set was just
   * logged). */
  function _resetQuickLogSetOpts() {
    if (typeof document === 'undefined') return;
    ['qlTopSet', 'qlBackoff', 'qlDropset', 'qlRestPause', 'qlUnilateral'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
  }

  /** Sets already logged today for this exact exercise name — real count
   * from the same store renderSessionSoFar() reads. */
  function _todaysSetCount(name) {
    const u = _user();
    if (!u || typeof localStorage === 'undefined') return 0;
    const todayStr = _localDateKey();
    try {
      const workouts = JSON.parse(localStorage.getItem('workouts_' + u)) || [];
      const today = workouts.find(w => w.date === todayStr);
      if (!today) return 0;
      return (today.log || []).filter(e => e.exercise === name)
        .reduce((n, e) => n + (Array.isArray(e.repsArray) ? e.repsArray.length : 0), 0);
    } catch { return 0; }
  }

  /** "Log set N" for the common single-row case; "Log N sets" once more
   * than one row exists (via "+ Add another set", or a multi-set
   * suggestion applied on exercise blur) — same button, label reflects
   * what it's actually about to submit. Also flips #quickLogPanel into
   * "multi" mode: the weight/reps steppers only ever represent row 0, so
   * once other rows exist they're swapped for row 0 itself (shown like
   * every other row) rather than leaving a stepper on screen that doesn't
   * reflect what row 0 will actually submit. */
  function _updateQuickLogButtonLabel(name) {
    if (typeof document === 'undefined') return;
    const panel = document.getElementById('quickLogPanel');
    const labelEl = document.getElementById('qlLogBtnLabel');
    const container = document.getElementById('setInputsContainer');
    const rowCount = container ? container.querySelectorAll('.set-input-row').length : 1;
    if (panel) panel.classList.toggle('ql-multi-mode', rowCount > 1);
    if (!labelEl) return;
    if (rowCount > 1) {
      labelEl.textContent = 'Log ' + rowCount + ' sets';
      return;
    }
    const exerciseName = name != null ? name : (document.getElementById('exercise')?.value.trim() || '');
    labelEl.textContent = 'Log set ' + (_todaysSetCount(exerciseName) + 1);
  }

  /** "e1RM 122 kg · 78% of 1RM" meta line under the exercise title —
   * real numbers from getExerciseStats() (libraries.js), hidden entirely
   * when there's no logged history for the exercise yet rather than
   * showing a zero/placeholder. */
  function _updateExerciseStatsLine(name) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('exerciseStatsLine');
    if (!el) return;
    const stats = typeof global.getExerciseStats === 'function' ? global.getExerciseStats(name) : null;
    if (!stats || !stats.bestE1rm) { el.hidden = true; return; }
    const parts = [`e1RM ${stats.bestE1rm} kg`];
    if (stats.pctOf1rm != null) parts.push(`${stats.pctOf1rm}% of 1RM`);
    el.hidden = false;
    el.textContent = parts.join(' · ');
  }

  function syncQuickLogUnit(unit) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('qlUnitLabel');
    if (el) el.textContent = unit || 'kg';
    const sheetLabel = document.getElementById('qlSheetUnitLabel');
    if (sheetLabel) sheetLabel.textContent = unit || 'kg';
  }

  function _currentQuickLogUnit() {
    if (typeof document === 'undefined') return 'kg';
    const sel = document.getElementById('weightUnit');
    return sel && sel.value === 'lbs' ? 'lbs' : 'kg';
  }

  /** Flips the shared #weightUnit select (same field the manual-entry form
   * and addLogEntry() already read) between kg/lbs, converts the sticky
   * quick-log weight to match, and re-renders — the unit toggle used to
   * only be reachable by expanding manual entry. */
  function toggleQuickLogUnit() {
    if (typeof document === 'undefined') return;
    const unitSel = document.getElementById('weightUnit');
    const currentUnit = _currentQuickLogUnit();
    const currentNorm = currentUnit === 'lbs' ? 'lb' : 'kg';
    const nextNorm = currentNorm === 'kg' ? 'lb' : 'kg';
    const nextUnit = nextNorm === 'lb' ? 'lbs' : 'kg';

    if (_qlWeight != null && typeof global.convertWeightValue === 'function') {
      _qlWeight = global.convertWeightValue(_qlWeight, currentNorm, nextNorm, 2);
    }

    if (unitSel) {
      unitSel.value = nextUnit;
      unitSel.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      syncQuickLogUnit(nextUnit);
    }
    _syncQuickLogDisplay();
    _writeQuickLogToForm();
  }

  // ── Quick-log weight sheet — plate quick-add chips + direct numeric
  // entry, opened by tapping the weight value. Standard plate sets per
  // unit (kg set matches plateCalculator.js's defaults). ─────────────
  const QL_PLATES_LB = [45, 35, 25, 10, 5, 2.5, 1.25];
  const QL_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

  function _renderQuickLogPlateGrid() {
    if (typeof document === 'undefined') return;
    const grid = document.getElementById('qlPlateGrid');
    if (!grid) return;
    const unit = _currentQuickLogUnit();
    const plates = unit === 'lbs' ? QL_PLATES_LB : QL_PLATES_KG;
    grid.innerHTML = plates
      .map((p) => `<button type="button" class="ql-plate-chip" onclick="if(typeof qlPlateAdd==='function') qlPlateAdd(${p});">+${p}</button>`)
      .join('');
  }

  function openQuickLogWeightSheet() {
    if (typeof document === 'undefined') return;
    const sheet = document.getElementById('qlWeightSheet');
    const input = document.getElementById('qlWeightSheetInput');
    if (!sheet) return;
    syncQuickLogUnit(_currentQuickLogUnit());
    if (input) input.value = _qlWeight != null ? _qlWeight : '';
    _renderQuickLogPlateGrid();
    sheet.hidden = false;
    if (input) {
      input.focus();
      input.select();
    }
  }

  function closeQuickLogWeightSheet() {
    if (typeof document === 'undefined') return;
    const sheet = document.getElementById('qlWeightSheet');
    if (sheet) sheet.hidden = true;
  }

  /** Tapping a plate chip adds its face value to whatever is currently in
   * the sheet's number field, so a heavy weight can be built up in a few
   * taps (e.g. +45, +45, +10) instead of dozens of +2.5 steps. */
  function qlPlateAdd(amount) {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('qlWeightSheetInput');
    if (!input) return;
    const current = parseFloat(input.value) || 0;
    input.value = _round1(current + amount);
  }

  function qlWeightSheetClear() {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('qlWeightSheetInput');
    if (input) input.value = '0';
  }

  function confirmQuickLogWeightSheet() {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('qlWeightSheetInput');
    const value = input ? parseFloat(input.value) : NaN;
    if (Number.isFinite(value) && value >= 0) {
      _qlWeight = _round1(value);
      _syncQuickLogDisplay();
      _writeQuickLogToForm();
    }
    closeQuickLogWeightSheet();
  }

  /** Called on every #exercise input. Shows the quick-log panel, ensures
   * #reps_0/#weight_0 exist (via the app's own generateSetInputs(1), so
   * its suggestion engine seeds sensible defaults), and keeps the last
   * tapped weight/reps sticky across sets of the SAME exercise. */
  function initQuickLog(exerciseName) {
    if (typeof document === 'undefined') return;
    const panel = document.getElementById('quickLogPanel');
    if (!panel) return;
    const name = (exerciseName || '').trim();
    if (!name) { panel.hidden = true; return; }
    panel.hidden = false;

    // Only (re)seed a single fresh row here while no extra rows exist yet.
    // Once "+ Add another set" has added rows beyond the first, further
    // #exercise edits (e.g. fixing a typo) must not silently wipe them —
    // generateSetInputs(1) tears the whole container down.
    const container = document.getElementById('setInputsContainer');
    const existingRows = container ? container.querySelectorAll('.set-input-row').length : 0;
    if (existingRows <= 1) {
      const setsInput = document.getElementById('sets');
      if (setsInput && setsInput.value !== '1') setsInput.value = '1';
      if (typeof global.generateSetInputs === 'function') global.generateSetInputs(1);
    }

    const isNewExercise = name !== _qlExerciseName;
    if (isNewExercise) _qlExerciseName = name;

    // The steppers/pills above only ever represent row 0 — while more than
    // one row exists (multi mode, CSS-driven off the row count same as
    // _updateQuickLogButtonLabel below), row 0 shows its own real fields
    // instead, so writing the sticky stepper state back over them here
    // would clobber a suggested/typed value with a stale default.
    if (existingRows <= 1) {
      if (isNewExercise || _qlWeight == null || _qlReps == null) {
        const weightEl = document.getElementById('weight_0');
        const repsEl = document.getElementById('reps_0');

        // Default to this exercise's own last logged top set, not a
        // hardcoded 20kg/8reps guess — getExerciseStats() already computes
        // lastTopSet for the stats line below, it just wasn't being used
        // to seed the stepper too.
        // Sticky values belong to the exercise they were set for: starting
        // a different one after logging used to carry e.g. Bench's reps
        // over to Squat when Squat had no history of its own.
        const movedOn = isNewExercise && _qlLoggedName && !_sameName(name, _qlLoggedName);
        let fallbackWeight = movedOn ? 20 : (_qlWeight ?? 20);
        let fallbackReps = movedOn ? 8 : (_qlReps ?? 8);
        if (isNewExercise && typeof global.getExerciseStats === 'function') {
          const stats = global.getExerciseStats(name);
          if (stats && stats.lastTopSet) {
            if (stats.lastTopSet.weight != null) fallbackWeight = stats.lastTopSet.weight;
            if (stats.lastTopSet.reps != null) fallbackReps = stats.lastTopSet.reps;
          }
        }

        _qlWeight = weightEl && weightEl.value !== '' ? Number(weightEl.value) : fallbackWeight;
        _qlReps = repsEl && repsEl.value !== '' ? Number(repsEl.value) : fallbackReps;
      }
      if (isNewExercise) _resetQuickLogSetOpts();
      _syncQuickLogDisplay();
      _writeQuickLogToForm();
    }

    const unitSel = document.getElementById('weightUnit');
    if (unitSel) syncQuickLogUnit(unitSel.value);
    _updateQuickLogButtonLabel(name);
    _updateExerciseStatsLine(name);
  }

  /** Tapped a session-queue row: jump straight into quick-log for that
   * exercise, pre-filled from the plan's first set (real planned values,
   * falling back to the sticky-default logic above when absent). */
  function startQuickLogFor(name, plannedFirstSet) {
    if (typeof document === 'undefined' || !name) return;
    const exerciseEl = document.getElementById('exercise');
    if (!exerciseEl) return;
    exerciseEl.value = name;
    initQuickLog(name);
    if (plannedFirstSet) {
      if (plannedFirstSet.weight != null) _qlWeight = plannedFirstSet.weight;
      if (plannedFirstSet.reps != null) _qlReps = plannedFirstSet.reps;
      _syncQuickLogDisplay();
      _writeQuickLogToForm();
    }
    document.getElementById('quickLogPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /** Removing rows back down to one hands row 0 back to the steppers; adopt
   * what was typed there, or the next tap on Log would overwrite it with
   * the steppers' older values (quickLogSet() rewrites row 0 from them). */
  function syncQuickLogFromRow0() {
    if (typeof document === 'undefined') return;
    const weightEl = document.getElementById('weight_0');
    const repsEl = document.getElementById('reps_0');
    if (weightEl && weightEl.value !== '' && Number.isFinite(Number(weightEl.value))) _qlWeight = Number(weightEl.value);
    if (repsEl && repsEl.value !== '' && Number.isFinite(Number(repsEl.value))) _qlReps = Number(repsEl.value);
    _syncQuickLogDisplay();
  }

  function quickLogStep(field, delta) {
    if (field === 'weight') {
      const step = (_qlWeight || 0) >= 100 ? 5 : 2.5;
      _qlWeight = Math.max(0, _round1((_qlWeight ?? 20) + delta * step));
    } else {
      _qlReps = Math.max(0, (_qlReps ?? 8) + delta);
    }
    _syncQuickLogDisplay();
    _writeQuickLogToForm();
  }

  /** The one-tap action: log exactly one set for the current exercise/
   * weight/reps via the existing addLogEntry() (same validation, same
   * PR/streak/milestone side effects, same storage shape), then re-arms
   * for the next set of the same exercise. */
  function quickLogSet() {
    if (typeof document === 'undefined') return;
    const exerciseEl = document.getElementById('exercise');
    const name = exerciseEl ? exerciseEl.value.trim() : '';
    if (!name || _qlReps == null || _qlReps <= 0) return;

    const setsInput = document.getElementById('sets');
    if (setsInput) setsInput.value = '1';
    if (typeof global.generateSetInputs === 'function') global.generateSetInputs(1);
    _writeQuickLogToForm();

    if (typeof global.addLogEntry !== 'function') return;
    global.addLogEntry();

    // addLogEntry() clears #exercise on success and leaves it untouched
    // on a validation failure — used here as a success signal rather
    // than duplicating its validation logic.
    const succeeded = exerciseEl && exerciseEl.value === '';
    if (succeeded) {
      _qlLoggedName = name;
      exerciseEl.value = name;
      const liveTitle = document.getElementById('exerciseLiveTitle');
      if (liveTitle) { liveTitle.hidden = false; liveTitle.textContent = name; }
      const setsInput2 = document.getElementById('sets');
      if (setsInput2) setsInput2.value = '1';
      if (typeof global.generateSetInputs === 'function') global.generateSetInputs(1);
      _resetQuickLogSetOpts(); // Drop/RP/L-R applied to the set just logged, not the next one
      _writeQuickLogToForm(); // keep the same weight/reps for the next set
      _updateQuickLogButtonLabel(name);
      _updateExerciseStatsLine(name);
      if (typeof global.renderSessionQueue === 'function') global.renderSessionQueue(); // refresh %1RM/Δ vs the set just logged
    }
  }

  const api = { getTodaysPlannedDay, buildProgramDayLog, loadTodayProgramIntoLog, renderProgramTemplateRow, renderSessionQueue, renderTrainHero, renderTrainReadinessStrip, renderSessionSoFar,
    initQuickLog, quickLogStep, quickLogSet, syncQuickLogFromRow0, startQuickLogFor, syncQuickLogUnit, renderVolumeLandmarks,
    toggleQuickLogUnit, openQuickLogWeightSheet, closeQuickLogWeightSheet, qlPlateAdd, qlWeightSheetClear,
    confirmQuickLogWeightSheet, toggleQuickLogSetRole, refreshLogButtonLabel: _updateQuickLogButtonLabel };
  global.renderVolumeLandmarks = renderVolumeLandmarks;
  global.initQuickLog = initQuickLog;
  global.quickLogStep = quickLogStep;
  global.quickLogSet = quickLogSet;
  global.syncQuickLogFromRow0 = syncQuickLogFromRow0;
  global.startQuickLogFor = startQuickLogFor;
  global.syncQuickLogUnit = syncQuickLogUnit;
  global.toggleQuickLogUnit = toggleQuickLogUnit;
  global.openQuickLogWeightSheet = openQuickLogWeightSheet;
  global.closeQuickLogWeightSheet = closeQuickLogWeightSheet;
  global.qlPlateAdd = qlPlateAdd;
  global.qlWeightSheetClear = qlWeightSheetClear;
  global.confirmQuickLogWeightSheet = confirmQuickLogWeightSheet;
  global.toggleQuickLogSetRole = toggleQuickLogSetRole;
  // addNewSet()/removeSet() (index.html) call this after changing row
  // count so the button label ("Log set N" vs "Log N sets") stays current.
  global.refreshLogButtonLabel = _updateQuickLogButtonLabel;
  global.getTodaysPlannedDay = getTodaysPlannedDay;
  global.renderSessionQueue = renderSessionQueue;
  global.loadTodayProgramIntoLog = loadTodayProgramIntoLog;
  global.renderProgramTemplateRow = renderProgramTemplateRow;
  global.renderTrainHero = renderTrainHero;
  global.renderTrainReadinessStrip = renderTrainReadinessStrip;
  global.renderSessionSoFar = renderSessionSoFar;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
