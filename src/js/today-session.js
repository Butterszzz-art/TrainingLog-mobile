/**
 * today-session.js
 * "What am I training today?" for every lifter, with or without a program.
 *
 * Sources, first match wins:
 *   1. The active program's day for today (program-schedule.js).
 *   2. A saved template picked for today: loading a template into the log
 *      (or tapping Start on one on Home) makes it today's session.
 *
 * The answer has the program-day shape the Log hero, plan list, Home card and
 * performance mode already read: { name, exercises: [{ name, sets: [{ reps,
 * weight, ... }] }], source: 'program' | 'template', ... }.
 *
 * Workouts loaded from either source carry metadata.planned = true, so their
 * sets count as done once ticked rather than as soon as they're loaded
 * (program-schedule.js isPlannedWorkout / dayProgress).
 */
(function (global) {
  'use strict';

  const PICK_KEY = 'todaySessionPick_';

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

  // ── Today's template pick ───────────────────────────────────────────────

  /** Make a template today's session. The converted day is stored with the
   * pick, so it works before the template list has loaded from the server. */
  function pickTemplateForToday(templateRecord, opts) {
    const options = opts || {};
    const u = _user(options.user);
    if (!u || !templateRecord || !global.localStorage) return null;
    const day = templateToDay(templateRecord.data, { name: templateRecord.name, templateId: templateRecord.id });
    if (!day) return null;
    const pick = { date: _localDateKey(options.now), templateId: templateRecord.id || null, day };
    global.localStorage.setItem(PICK_KEY + u, JSON.stringify(pick));
    return day;
  }

  /** Today's template pick as a session day, or null (none, or from another day). */
  function readTemplatePick(user, now) {
    const u = _user(user);
    if (!u) return null;
    const pick = _readJSON(PICK_KEY + u, null);
    if (!pick || pick.date !== _localDateKey(now) || !pick.day) return null;
    return { ...pick.day, source: 'template', templateId: pick.templateId || pick.day.templateId || null };
  }

  function clearTemplatePick(user) {
    const u = _user(user);
    if (u && global.localStorage) global.localStorage.removeItem(PICK_KEY + u);
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

  /** Today's session from the first source that has one, or null. */
  function getTodaysSession(user, now) {
    return programDayToday(user, now) || readTemplatePick(user, now);
  }

  /** True when `w` is the workout loaded from `day` today (`dateKey`). */
  function isLoadedFrom(w, day, dateKey) {
    if (!w || !day || w.date !== (dateKey || _localDateKey())) return false;
    const meta = w.metadata || {};
    if (day.source === 'template') {
      return meta.source === 'template' && !!day.templateId && meta.templateId === day.templateId;
    }
    return meta.source === 'program' && meta.programDay === day.name;
  }

  const api = {
    templateToDay,
    pickTemplateForToday,
    readTemplatePick,
    clearTemplatePick,
    programDayToday,
    getTodaysSession,
    isLoadedFrom,
  };

  global.todaySession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
