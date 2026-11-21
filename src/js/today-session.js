/**
 * today-session.js
 * "What am I training today?" for every lifter, with or without a program.
 *
 * Sources, first match wins:
 *   1. The active program's day for today (program-schedule.js).
 *   2. A session picked for today: loading a template into the log (or
 *      tapping Start on one on Home), or starting "your usual next".
 *   3. With no active program, the lifter's own history (usual-session.js):
 *      once lifting has started, the past session most like today's
 *      ('match'); before that, "your usual next" ('rotation').
 *
 * The answer has the program-day shape the Log hero, plan list, Home card and
 * performance mode already read: { name, exercises: [{ name, sets: [{ reps,
 * weight, ... }] }], source: 'program' | 'template' | 'rotation' | 'match', ... }.
 *
 * "Not today": the lifter can decline today's suggestion (declineToday). For
 * the rest of the day nothing is suggested or preloaded, but the program and
 * history logic are untouched: tomorrow's session comes as usual, and picking
 * a template or undoing brings a session back.
 *
 * Workouts loaded from either source carry metadata.planned = true, so their
 * sets count as done once ticked rather than as soon as they're loaded
 * (program-schedule.js isPlannedWorkout / dayProgress).
 */
(function (global) {
  'use strict';

  const PICK_KEY = 'todaySessionPick_';
  const DECLINE_KEY = 'todaySessionDeclined_';
  // "Usual next" routines turned down with "Not today": rotationKey → date.
  // From the next day on, that routine waits its turn behind the others
  // (usual-session.js inferUsualNext opts.skipped) instead of coming back
  // every morning.
  const SKIP_KEY = 'usualSessionSkips_';
  const SKIP_KEEP_DAYS = 42;

  function _localDateKey(d) {
    const date = d || new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function _user(user) {
    return user || global.currentUser || (global.localStorage && global.localStorage.getItem('fitnessAppUser')) || null;
  }

  function _readJSON(key, fallback) {
    try {
      const raw = global.localStorage && global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function _schedule() {
    if (global.programSchedule) return global.programSchedule;
    try { return typeof require === 'function' ? require('./program-schedule') : null; } catch { return null; }
  }

  function _usual() {
    if (global.usualSession) return global.usualSession;
    try { return typeof require === 'function' ? require('./usual-session') : null; } catch { return null; }
  }

  // ── Templates → session shape ───────────────────────────────────────────

  /** Template data ({ exercises } built in the Templates tab, or { log } saved
   * from a workout) as a session day. Returns null when it has no lifts. */
  function templateToDay(templateData, info) {
    const data = templateData || {};
    const meta = info || {};
    let exercises = [];
    if (Array.isArray(data.exercises) && data.exercises.length) {
      exercises = data.exercises.map(ex => ({
        name: ex.name,
        sets: (Array.isArray(ex.sets) ? ex.sets : []).map(s => ({
          reps: Number(s.targetReps ?? s.reps) || 0,
          weight: Number(s.targetWeight ?? s.weight) || 0,
          setType: s.setType || 'standard',
        })),
        ...(ex.groupId && ex.groupType && ex.groupType !== 'straight' ? { supersetGroup: ex.groupId } : {}),
      }));
    } else if (Array.isArray(data.log)) {
      exercises = data.log.map(entry => {
        const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
        const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
        const types = Array.isArray(entry.setTypeArray) ? entry.setTypeArray : [];
        const count = reps.length || Number(entry.sets) || 0;
        return {
          name: entry.exercise,
          sets: Array.from({ length: count }, (_, i) => ({
            reps: Number(reps[i]) || 0,
            weight: Number(weights[i]) || 0,
            setType: types[i] || 'standard',
          })),
        };
      });
    }
    exercises = exercises.filter(ex => ex.name && ex.sets.length);
    if (!exercises.length) return null;
    return {
      name: meta.name || data.title || 'Template',
      exercises,
      source: 'template',
      templateId: meta.templateId || null,
    };
  }

  // ── Today's pick ────────────────────────────────────────────────────────

  /** Make `day` (a template or "usual next" session) today's session. The day
   * itself is stored, so it stays put while history and templates change. */
  function pickSessionForToday(day, opts) {
    const options = opts || {};
    const u = _user(options.user);
    if (!u || !day || !global.localStorage) return null;
    const pick = { date: _localDateKey(options.now), templateId: day.templateId || null, day };
    global.localStorage.setItem(PICK_KEY + u, JSON.stringify(pick));
    // Choosing a session is the opposite of "not today".
    global.localStorage.removeItem(DECLINE_KEY + u);
    return day;
  }

  /** Make a saved template today's session. */
  function pickTemplateForToday(templateRecord, opts) {
    if (!templateRecord) return null;
    const day = templateToDay(templateRecord.data, { name: templateRecord.name, templateId: templateRecord.id });
    return day ? pickSessionForToday(day, opts) : null;
  }

  /** Today's pick as a session day, or null (none, or from another day). */
  function readTemplatePick(user, now) {
    const u = _user(user);
    if (!u) return null;
    const pick = _readJSON(PICK_KEY + u, null);
    if (!pick || pick.date !== _localDateKey(now) || !pick.day) return null;
    const source = pick.day.source || 'template';
    return { ...pick.day, source, templateId: pick.templateId || pick.day.templateId || null };
  }

  function clearTemplatePick(user) {
    const u = _user(user);
    if (u && global.localStorage) global.localStorage.removeItem(PICK_KEY + u);
  }

  // ── "Not today" ─────────────────────────────────────────────────────────

  /** Decline today's suggested session (program day, picked template or
   * "usual next"). Only today is affected; the program keeps its schedule.
   * Returns the declined record, or null when there was nothing to decline. */
  function declineToday(opts) {
    const options = opts || {};
    const u = _user(options.user);
    if (!u || !global.localStorage) return null;
    const day = options.day || _suggestedToday(u, options.now);
    if (!day) return null;
    const record = { date: _localDateKey(options.now), name: day.name || 'Session', source: day.source || null };
    if (day.source === 'rotation' && day.rotationKey) record.rotationKey = day.rotationKey;
    global.localStorage.setItem(DECLINE_KEY + u, JSON.stringify(record));
    if (record.rotationKey) _writeSkip(u, record.rotationKey, record.date, options.now);
    return record;
  }

  /** Routines turned down lately: { rotationKey: 'YYYY-MM-DD' }. */
  function readSkips(user) {
    const u = _user(user);
    const raw = u ? _readJSON(SKIP_KEY + u, null) : null;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  function _writeSkip(u, rotationKey, dateKey, now) {
    const cutoffDate = new Date(now || Date.now());
    cutoffDate.setDate(cutoffDate.getDate() - SKIP_KEEP_DAYS);
    const cutoff = _localDateKey(cutoffDate);
    const kept = {};
    Object.entries(readSkips(u)).forEach(([k, v]) => { if (typeof v === 'string' && v >= cutoff) kept[k] = v; });
    if (dateKey) kept[rotationKey] = dateKey;
    else delete kept[rotationKey];
    try { global.localStorage.setItem(SKIP_KEY + u, JSON.stringify(kept)); } catch { /* storage full */ }
    _memo = null;
  }

  /** Today's decline ({ date, name, source }), or null (none, or another day). */
  function readDecline(user, now) {
    const u = _user(user);
    if (!u) return null;
    const record = _readJSON(DECLINE_KEY + u, null);
    return record && record.date === _localDateKey(now) ? record : null;
  }

  function undoDecline(user) {
    const u = _user(user);
    if (!u || !global.localStorage) return;
    const record = _readJSON(DECLINE_KEY + u, null);
    if (record && record.rotationKey && readSkips(u)[record.rotationKey] === record.date) _writeSkip(u, record.rotationKey, null);
    global.localStorage.removeItem(DECLINE_KEY + u);
  }

  // ── Today's session ─────────────────────────────────────────────────────

  /** The active program's day for today, or null on a rest day / no program. */
  function programDayToday(user, now) {
    const ps = _schedule();
    if (!ps) return null;
    const schedule = ps.getActiveSchedule(_user(user));
    if (!schedule) return null;
    const today = schedule.dayFor(now || new Date());
    if (!today.isTraining || !today.day) return null;
    return {
      ...today.day,
      source: 'program',
      programName: schedule.program.name,
      programId: schedule.program.id,
      weekNum: today.weekNum,
      weekCount: schedule.weekCount,
    };
  }

  // ── From history ────────────────────────────────────────────────────────

  /** Full workout history: live log, archive and backend copy. */
  function _history(u) {
    if (typeof global.getOverloadWorkouts === 'function') {
      try { return global.getOverloadWorkouts(u) || []; } catch { /* fall back */ }
    }
    const active = _readJSON(`workouts_${u}`, []);
    const archived = _readJSON(`workoutHistory_${u}`, []);
    return [...(Array.isArray(archived) ? archived : []), ...(Array.isArray(active) ? active : [])];
  }

  // Every Log/Home render asks; reading years of history each time is wasteful.
  let _memo = null;
  const MEMO_MS = 30000;

  /** "Usual next" or today's match from history, or null. Only for lifters
   * with no active program: a program's rest day stays a rest day. */
  function historySessionToday(user, now) {
    const u = _user(user);
    const usual = _usual();
    if (!u || !usual) return null;
    const ps = _schedule();
    if (ps && ps.getActiveSchedule(u)) return null;
    const todayKey = _localDateKey(now);
    let stamp = '';
    try {
      const ls = global.localStorage;
      stamp = `${(ls.getItem(`workouts_${u}`) || '').length}:${(ls.getItem(`workoutHistory_${u}`) || '').length}`;
    } catch { /* no storage */ }
    const key = `${u}|${todayKey}|${stamp}`;
    const at = Date.now();
    if (_memo && _memo.key === key && at - _memo.at < MEMO_MS) return _memo.day;
    const history = _history(u);
    const opts = { now, muscleOf: typeof global.getMuscleGroup === 'function' ? global.getMuscleGroup : null, skipped: readSkips(u) };
    const day = usual.matchToday(history, opts) || usual.inferUsualNext(history, opts);
    _memo = { key, at, day };
    return day;
  }

  /** What would be suggested today, ignoring a decline. */
  function _suggestedToday(user, now) {
    return programDayToday(user, now) || readTemplatePick(user, now) || historySessionToday(user, now);
  }

  /** Today's session from the first source that has one, or null after
   * "Not today" (picking a session afterwards clears the decline). */
  function getTodaysSession(user, now) {
    if (readDecline(user, now)) return null;
    return _suggestedToday(user, now);
  }

  /** True when `w` is the workout loaded from `day` today (`dateKey`). */
  function isLoadedFrom(w, day, dateKey) {
    if (!w || !day || w.date !== (dateKey || _localDateKey())) return false;
    const meta = w.metadata || {};
    if (day.source === 'template') {
      return meta.source === 'template' && !!day.templateId && meta.templateId === day.templateId;
    }
    if (day.source === 'rotation') {
      return meta.source === 'rotation' && !!day.rotationKey && meta.rotationKey === day.rotationKey;
    }
    if (day.source === 'match') return false; // logged freeform, never loaded
    return meta.source === 'program' && meta.programDay === day.name;
  }

  const api = {
    templateToDay,
    pickSessionForToday,
    pickTemplateForToday,
    readTemplatePick,
    clearTemplatePick,
    programDayToday,
    historySessionToday,
    clearHistoryMemo: () => { _memo = null; },
    getTodaysSession,
    declineToday,
    readDecline,
    undoDecline,
    readSkips,
    isLoadedFrom,
  };

  global.todaySession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
