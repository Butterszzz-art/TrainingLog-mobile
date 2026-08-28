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

  const api = { getTodaysPlannedDay, renderSessionQueue };
  global.getTodaysPlannedDay = getTodaysPlannedDay;
  global.renderSessionQueue = renderSessionQueue;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
