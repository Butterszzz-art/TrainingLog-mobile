/**
 * session-queue.js
 * Renders a read-only "today's planned exercises" list at the top of the
 * Train tab's Log sub-view, so the lifter can see the day's plan before/
 * while logging sets manually below. Reuses the same activeProgram/
 * programs_<user> localStorage read pattern as today-program.js (each
 * home/train card file keeps its own small copy of these helpers rather
 * than sharing a module system — matches the existing codebase pattern).
 */
(function (global) {
  'use strict';

  const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function _user() {
    return global.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser'));
  }

  function _getActiveRecord() {
    const u = _user();
    if (!u) return null;
    try {
      return JSON.parse(
        localStorage.getItem(`activeProgram_${u}`) ||
        localStorage.getItem('activeProgram') ||
        'null'
      );
    } catch { return null; }
  }

  function _getPrograms() {
    const u = _user();
    if (!u) return [];
    try {
      return (
        JSON.parse(localStorage.getItem(`programs_${u}`)) ||
        JSON.parse(localStorage.getItem('programs') || '[]')
      );
    } catch { return []; }
  }

  function _parseLocalDate(str) {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    if (!y) return null;
    return new Date(y, m - 1, d);
  }

  function _countTrainingDaysBetween(from, until, trainingDayNums) {
    let count = 0;
    const cur = new Date(from);
    while (cur < until) {
      if (trainingDayNums.includes(cur.getDay())) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  /** Resolve today's program day object ({ name, exercises: [...] }), or null. */
  function getTodaysPlannedDay() {
    const active = _getActiveRecord();
    if (!active) return null;

    const programs = _getPrograms();
    const program = programs.find(p => p.id === active.programId);
    if (!program || !Array.isArray(program.days) || !program.days.length) return null;

    const rawFreq = program.frequency || program.weekdays || ['Mon', 'Wed', 'Fri'];
    const trainingNums = rawFreq.map(d => WEEKDAY_MAP[d]).filter(n => n !== undefined);
    if (!trainingNums.length) return null;

    const startDate = _parseLocalDate(active.startDate || program.startDate);
    if (!startDate) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!trainingNums.includes(today.getDay()) || today < startDate) return null; // rest day

    const tdBefore = _countTrainingDaysBetween(startDate, today, trainingNums);
    const idx = tdBefore % program.days.length;
    return { ...program.days[idx], programName: program.name };
  }

  function _setSummary(ex) {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    if (!sets.length) return '';
    const first = sets[0];
    const reps = first.reps != null ? first.reps : '?';
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
        </div>`;
      return;
    }

    const exercises = Array.isArray(day.exercises) ? day.exercises : [];
    const tonnageTargetKg = _tonnageTarget(exercises);
    const totalSets = _totalSets(exercises);
    const rpeTarget = _avgTargetRpe(exercises);
    const muscles = _muscleSummary(exercises);

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
          <span>TONNAGE 0.0t / ${(tonnageTargetKg / 1000).toFixed(1)}t</span>
          <span>0% &middot; 0 of ${totalSets} sets</span>
        </div>
        <div class="train-hero-tonnage-track"><div class="train-hero-tonnage-fill" style="width:0%"></div></div>
        <button class="cta-capsule train-hero-cta" onclick="goToQuickLog()">Start session</button>
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
    const todayStr = new Date().toISOString().slice(0, 10);
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

  function renderSessionQueue() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('sessionQueueCard');
    if (!el) return;

    const day = getTodaysPlannedDay();
    const exercises = day && Array.isArray(day.exercises) ? day.exercises : [];
    if (!day || !exercises.length) { el.innerHTML = ''; return; }

    const _esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const hasStats = typeof global.getExerciseStats === 'function';
    const rows = exercises.map((ex, i) => {
      const first = (ex.sets && ex.sets[0]) || {};
      const stats = hasStats ? global.getExerciseStats(ex.name) : null;
      const pctHTML = stats && stats.pctOf1rm != null
        ? `<span class="sq-e1rm">${stats.pctOf1rm}%</span>` : '<span class="sq-e1rm">—</span>';
      const deltaHTML = stats && stats.deltaWeight != null
        ? `<span class="sq-delta ${stats.deltaWeight > 0 ? 'is-up' : stats.deltaWeight < 0 ? 'is-down' : 'is-flat'}">${stats.deltaWeight > 0 ? '+' : ''}${stats.deltaWeight}</span>`
        : '<span class="sq-delta is-flat">=</span>';
      return `
      <div class="sq-row sq-row--tap" data-ex-name="${_esc(ex.name)}" data-ex-weight="${first.weight ?? ''}" data-ex-reps="${first.reps ?? ''}">
        <span class="sq-index">${i + 1}</span>
        <span class="sq-name">${ex.name}</span>
        <span class="sq-summary">${_setSummary(ex)}</span>
        ${pctHTML}
        ${deltaHTML}
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="pod sq-card">
        <div class="pod-row">
          <span class="pod-kicker">Today's plan · ${day.name}</span>
          <span class="sq-count">load &middot; %1RM &middot; &Delta; last</span>
        </div>
        ${rows}
      </div>`;

    if (!el._tapWired) {
      el._tapWired = true;
      el.addEventListener('click', (e) => {
        const row = e.target.closest('.sq-row--tap');
        if (!row || typeof global.startQuickLogFor !== 'function') return;
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
    if (typeof global.updateAddButtonState === 'function') global.updateAddButtonState();
  }

  /** Sets already logged today for this exact exercise name — real count
   * from the same store renderSessionSoFar() reads. */
  function _todaysSetCount(name) {
    const u = _user();
    if (!u || typeof localStorage === 'undefined') return 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    try {
      const workouts = JSON.parse(localStorage.getItem('workouts_' + u)) || [];
      const today = workouts.find(w => w.date === todayStr);
      if (!today) return 0;
      return (today.log || []).filter(e => e.exercise === name)
        .reduce((n, e) => n + (Array.isArray(e.repsArray) ? e.repsArray.length : 0), 0);
    } catch { return 0; }
  }

  function _updateQuickLogButtonLabel(name) {
    if (typeof document === 'undefined') return;
    const labelEl = document.getElementById('qlLogBtnLabel');
    if (labelEl) labelEl.textContent = 'Log set ' + (_todaysSetCount(name) + 1);
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

    const setsInput = document.getElementById('sets');
    if (setsInput && setsInput.value !== '1') setsInput.value = '1';
    if (typeof global.generateSetInputs === 'function') global.generateSetInputs(1);

    const isNewExercise = name !== _qlExerciseName;
    if (isNewExercise || _qlWeight == null || _qlReps == null) {
      const weightEl = document.getElementById('weight_0');
      const repsEl = document.getElementById('reps_0');
      _qlWeight = weightEl && weightEl.value !== '' ? Number(weightEl.value) : (_qlWeight ?? 20);
      _qlReps = repsEl && repsEl.value !== '' ? Number(repsEl.value) : (_qlReps ?? 8);
      _qlExerciseName = name;
    }
    _syncQuickLogDisplay();
    _writeQuickLogToForm();

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
      exerciseEl.value = name;
      const liveTitle = document.getElementById('exerciseLiveTitle');
      if (liveTitle) { liveTitle.hidden = false; liveTitle.textContent = name; }
      const setsInput2 = document.getElementById('sets');
      if (setsInput2) setsInput2.value = '1';
      if (typeof global.generateSetInputs === 'function') global.generateSetInputs(1);
      _writeQuickLogToForm(); // keep the same weight/reps for the next set
      _updateQuickLogButtonLabel(name);
      _updateExerciseStatsLine(name);
      if (typeof global.renderSessionQueue === 'function') global.renderSessionQueue(); // refresh %1RM/Δ vs the set just logged
    }
  }

  const api = { getTodaysPlannedDay, renderSessionQueue, renderTrainHero, renderTrainReadinessStrip, renderSessionSoFar,
    initQuickLog, quickLogStep, quickLogSet, startQuickLogFor, syncQuickLogUnit, renderVolumeLandmarks,
    toggleQuickLogUnit, openQuickLogWeightSheet, closeQuickLogWeightSheet, qlPlateAdd, qlWeightSheetClear,
    confirmQuickLogWeightSheet };
  global.renderVolumeLandmarks = renderVolumeLandmarks;
  global.initQuickLog = initQuickLog;
  global.quickLogStep = quickLogStep;
  global.quickLogSet = quickLogSet;
  global.startQuickLogFor = startQuickLogFor;
  global.syncQuickLogUnit = syncQuickLogUnit;
  global.toggleQuickLogUnit = toggleQuickLogUnit;
  global.openQuickLogWeightSheet = openQuickLogWeightSheet;
  global.closeQuickLogWeightSheet = closeQuickLogWeightSheet;
  global.qlPlateAdd = qlPlateAdd;
  global.qlWeightSheetClear = qlWeightSheetClear;
  global.confirmQuickLogWeightSheet = confirmQuickLogWeightSheet;
  global.getTodaysPlannedDay = getTodaysPlannedDay;
  global.renderSessionQueue = renderSessionQueue;
  global.renderTrainHero = renderTrainHero;
  global.renderTrainReadinessStrip = renderTrainReadinessStrip;
  global.renderSessionSoFar = renderSessionSoFar;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
