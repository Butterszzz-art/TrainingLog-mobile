/**
 * program-schedule.js
 * Which program day falls on which calendar date, shared by the Home
 * "Up today" card (today-program.js) and the Log tab plan (session-queue.js).
 *
 *  - Days follow training days done since the start date, so a missed week
 *    doesn't skip ahead; multi-week library programs pick that week's sets.
 *  - "Do it today" swaps are kept per program as date → training index
 *    overrides (null = rest) in programDayOverrides_<user>.
 *  - A coach program can carry `timeline` (the coach's repeat / pause weeks
 *    for this client, src/js/program-timeline.js): each round of training
 *    days follows its slot, so a repeated week comes round again and a
 *    pause week has no sessions.
 *  - dayProgress() tallies today's log against the plan: sets in a planned
 *    workout (loaded from a program day or a template, see today-session.js)
 *    count once ticked Done, sets logged any other way count as soon as
 *    they're logged.
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

  /**
   * The active-program record, always as { programId, programName, startDate }.
   * Older restores from the backend stored the whole program object here
   * (it has `id`, not `programId`), which left the schedule without a
   * program: today's session fell back to "your usual next".
   */
  function normalizeActiveRecord(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const programId = rec.programId || rec.id || null;
    if (!programId) return null;
    if (rec.programId && !Array.isArray(rec.days)) return rec;
    return { programId, programName: rec.programName || rec.name || rec.title || '', startDate: rec.startDate || null };
  }

  function readActiveRecord(user) {
    if (!user) return null;
    return normalizeActiveRecord(_readJSON(`activeProgram_${user}`, null) || _readJSON('activeProgram', null));
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

  // ── Cadence (synchronous weekdays vs. asynchronous days on / off) ───────

  /** Whole local days from `from` to `to` (DST-safe). */
  function daysBetween(from, to) {
    const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / DAY_MS);
  }

  /**
   * The program's rolling on/off cycle, or null for a weekday (synchronous)
   * split. An asynchronous split (schedule.mode 'async') trains `onDays` in a
   * row, rests `offDays`, and repeats from the start date.
   */
  function cadenceOf(program) {
    const s = program && program.schedule;
    if (!s || s.mode !== 'async') return null;
    const clamp = v => Math.min(7, Math.max(0, Math.floor(Number(v)) || 0));
    const onDays = clamp(s.onDays);
    const offDays = clamp(s.offDays);
    return onDays >= 1 ? { onDays, offDays } : null;
  }

  /** 0-based position of `date` in the cycle that began on `startDate`. */
  function cycleDay(startDate, date, cycle) {
    const len = cycle.onDays + cycle.offDays;
    return ((daysBetween(startDate, date) % len) + len) % len;
  }

  /** "Mon, Wed, Fri" or "3 on / 1 off" — how a program's split is scheduled. */
  function cadenceLabel(program) {
    const cycle = cadenceOf(program);
    if (cycle) return `${cycle.onDays} on / ${cycle.offDays} off`;
    const iso = program && program.schedule && Array.isArray(program.schedule.weekdays) ? program.schedule.weekdays : [];
    const names = iso.length ? iso.slice().sort((a, b) => a - b).map(n => WEEKDAY_ABBR[n % 7]) : (program && program.frequency) || [];
    return Array.isArray(names) ? names.join(', ') : '';
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
    const cycle = cadenceOf(program);
    // Builder programs keep their weekdays in schedule.weekdays (ISO 1–7, Mon = 1).
    const scheduleWeekdays = (program.schedule && Array.isArray(program.schedule.weekdays) ? program.schedule.weekdays : [])
      .map(n => WEEKDAY_ABBR[n % 7]);
    const nonEmpty = a => (Array.isArray(a) && a.length ? a : null);
    const rawFreq = nonEmpty(program.frequency) || nonEmpty(scheduleWeekdays)
      || program.frequency || program.weekdays || ['Mon', 'Wed', 'Fri'];
    const trainingNums = cycle ? [] : (Array.isArray(rawFreq) ? rawFreq : [])
      .map(d => WEEKDAY_MAP[d])
      .filter(n => n !== undefined);
    if (!cycle && !trainingNums.length) return null;

    const startDate = parseLocalDate((active && active.startDate) || program.startDate);
    if (!startDate) return null;

    /** Whether `date` (local midnight, on/after the start) is a training day of the split. */
    function isTrainingDate(date) {
      if (!cycle) return trainingNums.includes(date.getDay());
      return cycleDay(startDate, date, cycle) < cycle.onDays;
    }

    /** Training days from the start date up to but not including `until`. */
    function trainingDaysBefore(until) {
      if (!cycle) return countTrainingDaysBetween(startDate, until, trainingNums);
      const n = Math.max(0, daysBetween(startDate, until));
      const len = cycle.onDays + cycle.offDays;
      return Math.floor(n / len) * cycle.onDays + Math.min(n % len, cycle.onDays);
    }

    const core = options.core || global.programBuilderV2Core || null;
    const overrides = options.overrides || {};
    const nDays = program.days.length;
    const weekCount = core && typeof core.getWeekCount === 'function' ? core.getWeekCount(program) : 1;

    // The coach's repeat / pause weeks (not for a master plan, which has its own calendar).
    const PT = global.ProgramTimeline || (typeof require === 'function' ? (() => { try { return require('./program-timeline'); } catch { return null; } })() : null);
    const timeline = !program.planId && program.timeline && PT ? PT.slots(weekCount, program.timeline) : null;

    /** The timeline slot for a training index: { week (null = pause), kind, note }. Past the end the program weeks go round again. */
    function slotAt(trainingIndex) {
      const i = Math.floor(trainingIndex / nDays);
      if (i < timeline.length) return timeline[i];
      return { week: ((i - timeline.length) % weekCount) + 1, kind: 'week', note: '' };
    }

    /** The program week a pause belongs to (the one before it), for labels. */
    function weekBefore(trainingIndex) {
      for (let i = Math.floor(trainingIndex / nDays); i >= 0; i--) {
        const s = slotAt(i * nDays);
        if (s.week !== null) return s.week;
      }
      return 1;
    }

    function dayAt(trainingIndex) {
      if (timeline) {
        const slot = slotAt(trainingIndex);
        if (slot.week === null) return null;
        const list = core && typeof core.getWeekDays === 'function' ? core.getWeekDays(program, slot.week) : program.days;
        const day = (list && list[trainingIndex % nDays]) || program.days[trainingIndex % nDays];
        // A busy week: the same day at maintenance volume (ProgramTimeline.maintenanceDay).
        return slot.kind === 'busy' && PT && typeof PT.maintenanceDay === 'function' ? PT.maintenanceDay(day) : day;
      }
      const week = Math.floor(trainingIndex / nDays) + 1;
      const list = core && typeof core.getWeekDays === 'function' ? core.getWeekDays(program, week) : program.days;
      return (list && list[trainingIndex % nDays]) || program.days[trainingIndex % nDays];
    }

    // A coach's master plan (program.planId, see plan-today.js composeProgram)
    // runs on calendar weeks from the plan's start Monday: a rest day after
    // the week's last session still belongs to that week.
    function weekNumFor(trainingIndex, date) {
      if (program.planId) return Math.min(weekCount, Math.max(1, Math.floor((date - startDate) / (7 * DAY_MS)) + 1));
      if (timeline) return slotAt(trainingIndex).week || weekBefore(trainingIndex);
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
      const naturalTraining = !before && isTrainingDate(date);
      const naturalIndex = trainingDaysBefore(date);
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
      // A rest day belongs to the week of the session before it, so the days
      // after a week's last session stay in that calendar week until the
      // next week's first training day (ProgramTimeline.slotIndexAt agrees).
      const weekIndex = isTraining || trainingIndex === 0 ? trainingIndex : trainingIndex - 1;
      const weekNum = weekNumFor(weekIndex, date);
      // A pause week (timeline): no session, even on a training weekday.
      const pauseSlot = timeline && !before ? slotAt(weekIndex) : null;
      const pause = !!(pauseSlot && pauseSlot.week === null);
      if (pause) isTraining = false;
      return {
        date,
        key,
        abbr: WEEKDAY_ABBR[date.getDay()],
        isTraining,
        trainingIndex,
        swapped,
        day: isTraining ? dayAt(trainingIndex) : null,
        weekNum,
        cycleDay: cycle && !before ? cycleDay(startDate, date, cycle) + 1 : null,
        phase: pause ? 'Pause week' : pauseSlot && pauseSlot.kind === 'busy' ? 'Busy week · maintenance' : weekCount > 1 ? phaseFor(weekNum) : '',
        pause,
        pauseNote: pause ? pauseSlot.note || '' : '',
        repeat: !!(pauseSlot && pauseSlot.kind === 'repeat'),
        busy: !!(pauseSlot && pauseSlot.kind === 'busy'),
        busyNote: pauseSlot && pauseSlot.kind === 'busy' ? pauseSlot.note || '' : '',
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

    return { program, startDate, trainingNums, cycle, nDays, weekCount, timeline, dayFor, weekOf, nextTrainingAfter };
  }

  /** Schedule for the signed-in user's active program, or null. */
  function getActiveSchedule(user) {
    const u = user || currentUser();
    const active = readActiveRecord(u);
    if (!active || !active.programId) return null;
    const program = readPrograms(u).find(p => p && (p.id || p.programId) === active.programId);
    if (!program) return null;
    return createSchedule(program, active, { overrides: readOverrides(u, program.id || program.programId) });
  }

  /**
   * The first day of the program week `now` falls in (local midnight), or
   * null when there's no running program. A program week is one pass through
   * the program's days: it starts on the session with training index
   * k·nDays and runs until the next week's first session, so rest days after
   * a week's last session still belong to it (dayFor's weekNum agrees).
   * Weekly volume counts from here instead of a rolling 7 days, so a week's
   * totals line up with the program's own week.
   */
  function programWeekStart(scheduleOrUser, now) {
    const sched = scheduleOrUser && typeof scheduleOrUser.dayFor === 'function'
      ? scheduleOrUser
      : getActiveSchedule(scheduleOrUser);
    if (!sched) return null;
    const today = _midnight(now || new Date());
    if (today < sched.startDate) return null;
    const info = sched.dayFor(today);
    const weekIndex = info.isTraining || info.trainingIndex === 0 ? info.trainingIndex : info.trainingIndex - 1;
    const firstIndex = Math.floor(weekIndex / sched.nDays) * sched.nDays;
    // Walk back to the session that opened this week (swaps included).
    for (let i = 0; i <= 31; i++) {
      const d = _addDays(today, -i);
      if (d < sched.startDate) break;
      const di = sched.dayFor(d);
      if (di.isTraining && di.trainingIndex === firstIndex) return _midnight(d);
      if (di.isTraining && di.trainingIndex < firstIndex) return _addDays(_midnight(d), 1);
    }
    // Fallback: 7-day blocks from the program's start date.
    const days = Math.floor((today - sched.startDate) / DAY_MS);
    return _addDays(sched.startDate, Math.floor(days / 7) * 7);
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

  /** Loaded with its sets laid out ahead (program day or template, marked by
   * today-session.js): those sets count once ticked Done. */
  function isPlannedWorkout(w) {
    const meta = w && w.metadata;
    return !!(meta && (meta.planned === true || meta.source === 'program'));
  }

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
      const fromProgram = isPlannedWorkout(w);
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
    cadenceOf,
    cadenceLabel,
    currentUser,
    readActiveRecord,
    normalizeActiveRecord,
    readPrograms,
    readOverrides,
    createSchedule,
    getActiveSchedule,
    programWeekStart,
    swapIntoToday,
    dayProgress,
    isPlannedWorkout,
    workoutsOn,
  };

  global.programSchedule = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
