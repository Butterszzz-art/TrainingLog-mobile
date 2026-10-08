/**
 * program-schedule.js
 * Which program day falls on which calendar date, shared by the Home
 * "Up today" card (today-program.js) and the Log tab plan (session-queue.js).
 *
 *  - Days follow training days done since the start date, so a missed week
 *    doesn't skip ahead; multi-week library programs pick that week's sets.
 *  - "Do it today" swaps are kept per program as date → training index
 *    overrides (null = rest) in programDayOverrides_<user>.
 *  - dayProgress() tallies today's log against the plan: sets in a workout
 *    loaded from the program count once ticked Done, sets logged any other
 *    way count as soon as they're logged.
 */
(function (global) {
  'use strict';

  const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const DAY_MS = 86400000;

  function localDateKey(d) {
    const date = d || new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** Parse "YYYY-MM-DD" as local midnight (avoids UTC-offset day-off-by-one). */
  function parseLocalDate(str) {
    if (!str || typeof str !== 'string') return null;
    const [y, m, d] = str.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function _midnight(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function _addDays(d, n) {
    const date = new Date(d);
    date.setDate(date.getDate() + n);
    return date;
  }

  /** Count training days from `from` (inclusive) up to but NOT including `until`. */
  function countTrainingDaysBetween(from, until, trainingDayNums) {
    let count = 0;
    const cur = new Date(from);
    while (cur < until) {
      if (trainingDayNums.includes(cur.getDay())) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  function _readJSON(key, fallback) {
    try {
      const raw = global.localStorage && global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function currentUser() {
    return global.currentUser || (global.localStorage && global.localStorage.getItem('fitnessAppUser')) || null;
  }

  function readActiveRecord(user) {
    if (!user) return null;
    return _readJSON(`activeProgram_${user}`, null) || _readJSON('activeProgram', null);
  }

  function readPrograms(user) {
    if (!user) return [];
    const list = _readJSON(`programs_${user}`, null) || _readJSON('programs', []);
    return Array.isArray(list) ? list : [];
  }

  // ── Overrides ("Do it today") ───────────────────────────────────────────

  function readOverrides(user, programId) {
    const rec = user ? _readJSON(`programDayOverrides_${user}`, null) : null;
    if (!rec || rec.programId !== programId || !rec.dates || typeof rec.dates !== 'object') return {};
    return rec.dates;
  }

  function writeOverrides(user, programId, dates, today) {
    if (!user || !global.localStorage) return;
    // Keep two weeks of history so the week strip still shows past swaps.
    const cutoff = localDateKey(_addDays(today || new Date(), -14));
    const kept = {};
    Object.keys(dates).forEach(k => { if (k >= cutoff) kept[k] = dates[k]; });
    global.localStorage.setItem(`programDayOverrides_${user}`, JSON.stringify({ programId, dates: kept }));
  }

  // ── Schedule ────────────────────────────────────────────────────────────

  /**
   * Build a schedule for a program. Returns null when the program can't be
   * scheduled (no days, no training weekdays, no start date).
   * opts: { overrides, core } — core is programBuilderV2Core (getWeekDays/getWeekCount).
   */
  function createSchedule(program, active, opts) {
    if (!program || !Array.isArray(program.days) || !program.days.length) return null;
    const options = opts || {};
    const rawFreq = program.frequency || program.weekdays || ['Mon', 'Wed', 'Fri'];
    const trainingNums = (Array.isArray(rawFreq) ? rawFreq : [])
      .map(d => WEEKDAY_MAP[d])
      .filter(n => n !== undefined);
    if (!trainingNums.length) return null;

    const startDate = parseLocalDate((active && active.startDate) || program.startDate);
    if (!startDate) return null;

    const core = options.core || global.programBuilderV2Core || null;
    const overrides = options.overrides || {};
    const nDays = program.days.length;
    const weekCount = core && typeof core.getWeekCount === 'function' ? core.getWeekCount(program) : 1;

    function dayAt(trainingIndex) {
      const week = Math.floor(trainingIndex / nDays) + 1;
      const list = core && typeof core.getWeekDays === 'function' ? core.getWeekDays(program, week) : program.days;
      return (list && list[trainingIndex % nDays]) || program.days[trainingIndex % nDays];
    }

    function weekNumFor(trainingIndex, date) {
      if (weekCount > 1) return (Math.floor(trainingIndex / nDays) % weekCount) + 1;
      return Math.max(1, Math.floor((date - startDate) / (7 * DAY_MS)) + 1);
    }

    function phaseFor(week) {
      if (!Array.isArray(program.weeks) || !program.weeks.length) return '';
      const w = program.weeks[(week - 1) % program.weeks.length];
      return (w && w.phase) || '';
    }

    /** The plan for one calendar date. */
    function dayFor(dateLike) {
      const date = _midnight(dateLike);
      const key = localDateKey(date);
      const before = date < startDate;
      const naturalTraining = !before && trainingNums.includes(date.getDay());
      const naturalIndex = countTrainingDaysBetween(startDate, date, trainingNums);
      let isTraining = naturalTraining;
      let trainingIndex = naturalIndex;
      let swapped = false;
      if (!before && Object.prototype.hasOwnProperty.call(overrides, key)) {
        const o = overrides[key];
        swapped = true;
        if (o === null) {
          isTraining = false;
        } else if (Number.isInteger(o) && o >= 0) {
          isTraining = true;
          trainingIndex = o;
        }
      }
      const weekNum = weekNumFor(trainingIndex, date);
      return {
        date,
        key,
        abbr: WEEKDAY_ABBR[date.getDay()],
        isTraining,
        trainingIndex,
        swapped,
        day: isTraining ? dayAt(trainingIndex) : null,
        weekNum,
        phase: weekCount > 1 ? phaseFor(weekNum) : '',
      };
    }

    /** Monday-first list of the 7 days in the week containing `dateLike`. */
    function weekOf(dateLike) {
      const date = _midnight(dateLike);
      const dow = date.getDay();
      const monday = _addDays(date, dow === 0 ? -6 : 1 - dow);
      return Array.from({ length: 7 }, (_, i) => dayFor(_addDays(monday, i)));
    }

    /** The first training day strictly after `dateLike` (looks two weeks ahead). */
    function nextTrainingAfter(dateLike) {
      const from = _midnight(dateLike);
      for (let i = 1; i <= 14; i++) {
        const d = dayFor(_addDays(from, i));
        if (d.isTraining) return d;
      }
      return null;
    }

    return { program, startDate, trainingNums, nDays, weekCount, dayFor, weekOf, nextTrainingAfter };
  }

  /** Schedule for the signed-in user's active program, or null. */
  function getActiveSchedule(user) {
    const u = user || currentUser();
    const active = readActiveRecord(u);
    if (!active || !active.programId) return null;
    const program = readPrograms(u).find(p => p && p.id === active.programId);
    if (!program) return null;
    return createSchedule(program, active, { overrides: readOverrides(u, program.id) });
  }

  /**
   * Train `targetDate`'s session today. If today was a training day the two
   * sessions trade places; if today was a rest day the target date becomes rest.
   * Returns true when something changed.
   */
  function swapIntoToday(targetDate, opts) {
    const options = opts || {};
    const u = options.user || currentUser();
    const now = options.now || new Date();
    const schedule = options.schedule || getActiveSchedule(u);
    if (!schedule) return false;
    const today = schedule.dayFor(now);
    const target = schedule.dayFor(typeof targetDate === 'string' ? parseLocalDate(targetDate) : targetDate);
    if (!target || !target.isTraining || target.key === today.key || target.date < today.date) return false;

    const programId = schedule.program.id;
    const dates = { ...readOverrides(u, programId) };
    dates[today.key] = target.trainingIndex;
    dates[target.key] = today.isTraining ? today.trainingIndex : null;
    writeOverrides(u, programId, dates, now);
    return true;
  }

  // ── Progress against today's log ────────────────────────────────────────

  const _norm = s => String(s || '').trim().toLowerCase();

  function _plannedSets(ex) {
    return Array.isArray(ex.sets) ? ex.sets.length : (Number(ex.sets) || 0);
  }

  /**
   * How much of `day` is logged in `workouts` (already filtered to the date).
   * Returns { lifts:[{name, planned, done, complete}], doneKg, doneSets,
   * totalSets, doneLifts, totalLifts, started, complete }.
   */
  function dayProgress(day, workouts) {
    const exercises = day && Array.isArray(day.exercises) ? day.exercises : [];
    const list = Array.isArray(workouts) ? workouts : [];
    const doneByName = new Map();
    const kgByName = new Map();
    list.forEach(w => {
      const fromProgram = !!(w && w.metadata && w.metadata.source === 'program');
      (w && Array.isArray(w.log) ? w.log : []).forEach(entry => {
        const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
        const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
        const completed = Array.isArray(entry.completedArray) ? entry.completedArray : [];
        let count = 0;
        let kg = 0;
        reps.forEach((r, i) => {
          if (fromProgram && !completed[i]) return;
          count++;
          kg += (Number(r) || 0) * (Number(weights[i]) || 0);
        });
        const key = _norm(entry.exercise);
        doneByName.set(key, (doneByName.get(key) || 0) + count);
        kgByName.set(key, (kgByName.get(key) || 0) + kg);
      });
    });

    const lifts = exercises.map(ex => {
      const planned = _plannedSets(ex);
      const done = Math.min(planned || Infinity, doneByName.get(_norm(ex.name)) || 0);
      return { name: ex.name, planned, done, complete: planned > 0 && done >= planned };
    });
    const totalSets = lifts.reduce((n, l) => n + l.planned, 0);
    const doneSets = lifts.reduce((n, l) => n + l.done, 0);
    const doneLifts = lifts.filter(l => l.complete).length;
    const seen = new Set();
    const doneKg = exercises.reduce((sum, ex) => {
      const key = _norm(ex.name);
      if (seen.has(key)) return sum;
      seen.add(key);
      return sum + (kgByName.get(key) || 0);
    }, 0);
    return {
      lifts,
      doneKg,
      doneSets,
      totalSets,
      doneLifts,
      totalLifts: lifts.length,
      started: doneSets > 0,
      complete: lifts.length > 0 && doneLifts === lifts.length,
    };
  }

  /** The user's workouts on a date (live store only — that's where today lives). */
  function workoutsOn(dateKey, user) {
    const u = user || currentUser();
    const all = u ? _readJSON(`workouts_${u}`, []) : [];
    return (Array.isArray(all) ? all : []).filter(w => w && w.date === dateKey);
  }

  const api = {
    WEEKDAY_ABBR,
    localDateKey,
    parseLocalDate,
    countTrainingDaysBetween,
    currentUser,
    readActiveRecord,
    readPrograms,
    readOverrides,
    createSchedule,
    getActiveSchedule,
    swapIntoToday,
    dayProgress,
    workoutsOn,
  };

  global.programSchedule = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
