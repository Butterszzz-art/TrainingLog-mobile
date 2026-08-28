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

    const rows = log.map(entry => {
      const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
      const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
      const lastReps = reps[reps.length - 1];
      const lastWeight = weights[weights.length - 1];
      const summary = reps.length ? `${reps.length}×${lastReps ?? '?'}${lastWeight != null ? ' · ' + lastWeight + ' kg' : ''}` : '';
      return `<div class="sq-row"><span class="sq-name">${entry.exercise}</span><span class="sq-summary">${summary}</span></div>`;
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

  function renderSessionQueue() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('sessionQueueCard');
    if (!el) return;

    const day = getTodaysPlannedDay();
    const exercises = day && Array.isArray(day.exercises) ? day.exercises : [];
    if (!day || !exercises.length) { el.innerHTML = ''; return; }

    const rows = exercises.map((ex, i) => `
      <div class="sq-row">
        <span class="sq-index">${i + 1}</span>
        <span class="sq-name">${ex.name}</span>
        <span class="sq-summary">${_setSummary(ex)}</span>
      </div>`).join('');

    el.innerHTML = `
      <div class="pod sq-card">
        <div class="pod-row">
          <span class="pod-kicker">Today's plan · ${day.name}</span>
          <span class="sq-count">${exercises.length} exercise${exercises.length === 1 ? '' : 's'}</span>
        </div>
        ${rows}
      </div>`;
  }

  const api = { getTodaysPlannedDay, renderSessionQueue, renderTrainHero, renderTrainReadinessStrip, renderSessionSoFar };
  global.getTodaysPlannedDay = getTodaysPlannedDay;
  global.renderSessionQueue = renderSessionQueue;
  global.renderTrainHero = renderTrainHero;
  global.renderTrainReadinessStrip = renderTrainReadinessStrip;
  global.renderSessionSoFar = renderSessionSoFar;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
