/**
 * usual-session.js
 * Reads a lifter's own history to plan today when there's no program or
 * template: today-session.js asks it for
 *
 *  - inferUsualNext(): "your usual next" session. Past days are grouped by
 *    the lifts they share (Push / Pull / Legs, Upper / Lower...). Of the
 *    groups trained at least twice lately, the one done longest ago is next,
 *    with last time's sets as targets.
 *  - matchToday(): once freeform lifting has started, the past session most
 *    like what's logged today, so the plan list and hero compare against it.
 *
 * Pure functions over workout lists ({ date, title, log: [...] }); the
 * caller supplies history (index.html getOverloadWorkouts).
 */
(function (global) {
  'use strict';

  const DAY_MS = 86400000;
  const WINDOW_DAYS = 42;   // history looked at
  const RECENT_DAYS = 21;   // a group must have been trained this recently
  const SAME_GROUP = 0.5;   // share of lifts two days need in common
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const _norm = s => String(s || '').trim().toLowerCase();

  function _localDateKey(d) {
    const date = d || new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function _parseKey(key) {
    const [y, m, d] = String(key || '').slice(0, 10).split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  }

  function _daysBetween(fromKey, toKey) {
    const a = _parseKey(fromKey);
    const b = _parseKey(toKey);
    return a && b ? Math.round((b - a) / DAY_MS) : Infinity;
  }

  function _isPlanned(w) {
    const meta = w && w.metadata;
    return !!(meta && (meta.planned === true || meta.source === 'program'));
  }

  /** Default titles ("Workout on 2026-11-03", "Template Workout ...") say nothing. */
  function _meaningfulTitle(title) {
    const t = String(title || '').trim();
    if (!t || /^workout$/i.test(t)) return '';
    if (/^(workout on|template workout|template)\s+\d{4}-\d{2}-\d{2}/i.test(t)) return '';
    return t;
  }

  /** One entry's lifted sets: ticked ones in a planned workout, skipping
   * skipped sets and warm-ups. */
  function _liftedSets(entry, planned) {
    const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
    const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
    const done = Array.isArray(entry.completedArray) ? entry.completedArray : [];
    const skipped = Array.isArray(entry.skippedArray) ? entry.skippedArray : [];
    const types = Array.isArray(entry.setTypeArray) ? entry.setTypeArray : [];
    const sets = [];
    reps.forEach((r, i) => {
      if (planned && !done[i]) return;
      if (skipped[i]) return;
      const type = String(types[i] || 'standard').toLowerCase();
      if (type === 'warmup' || type === 'warm-up') return;
      if (!(Number(r) > 0)) return;
      sets.push({ reps: Number(r), weight: Number(weights[i]) || 0 });
    });
    return sets;
  }

  /**
   * Workouts as one session per calendar day, newest first:
   * [{ date, titles, lifts: [{ name, key, sets }] }]. Days with nothing
   * lifted are dropped. opts.before / opts.on limit the days kept.
   */
  function sessionsByDay(workouts, opts) {
    const options = opts || {};
    const days = new Map();
    (Array.isArray(workouts) ? workouts : []).forEach(w => {
      if (!w || !Array.isArray(w.log)) return;
      const date = String(w.date || '').slice(0, 10);
      if (!date) return;
      if (options.before && date >= options.before) return;
      if (options.on && date !== options.on) return;
      if (options.after && date < options.after) return;
      const planned = _isPlanned(w);
      let day = days.get(date);
      w.log.forEach(entry => {
        const key = _norm(entry && entry.exercise);
        if (!key) return;
        const sets = _liftedSets(entry, planned);
        if (!sets.length) return;
        if (!day) { day = { date, titles: [], lifts: [] }; days.set(date, day); }
        const lift = day.lifts.find(l => l.key === key);
        if (lift) lift.sets.push(...sets);
        else day.lifts.push({ name: String(entry.exercise).trim(), key, sets });
      });
      const title = _meaningfulTitle(w.title || (w.metadata && (w.metadata.templateName || w.metadata.programDay)));
      if (day && title && !day.titles.includes(title)) day.titles.push(title);
    });
    return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  function _keys(session) { return new Set(session.lifts.map(l => l.key)); }

  function _jaccard(a, b) {
    let both = 0;
    a.forEach(k => { if (b.has(k)) both++; });
    const union = a.size + b.size - both;
    return union ? both / union : 0;
  }

  /** Group sessions (newest first) by the lifts they share. Each group is
   * compared through its newest session, so a routine that drifts over the
   * weeks stays one group. */
  function groupSessions(sessions) {
    const groups = [];
    sessions.forEach(s => {
      const keys = _keys(s);
      let best = null;
      let bestScore = SAME_GROUP;
      groups.forEach(g => {
        const score = _jaccard(keys, g.keys);
        if (score >= bestScore) { best = g; bestScore = score; }
      });
      if (best) best.sessions.push(s);
      else groups.push({ keys, sessions: [s] });
    });
    return groups;
  }

  function _title(text) {
    return String(text).replace(/\b\w/g, c => c.toUpperCase());
  }

  /** A group's name: its most used title, else its main muscle groups. */
  function _groupName(group, muscleOf) {
    const counts = new Map();
    group.sessions.forEach(s => s.titles.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    const titled = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (titled) return titled[0];
    if (typeof muscleOf === 'function') {
      const muscles = new Map();
      group.sessions[0].lifts.forEach(l => {
        let m = null;
        try { m = muscleOf(l.name); } catch { m = null; }
        if (m) muscles.set(m, (muscles.get(m) || 0) + l.sets.length);
      });
      // The first lift's muscle leads ("Chest & Shoulders"), then the most worked other one.
      let lead = null;
      try { lead = muscleOf(group.sessions[0].lifts[0].name) || null; } catch { lead = null; }
      const rest = [...muscles.entries()].filter(e => e[0] !== lead).sort((a, b) => b[1] - a[1]).map(e => e[0]);
      const top = (lead ? [lead, ...rest] : rest).slice(0, 2).map(m => _title(m));
      if (top.length) return top.join(' & ');
    }
    return `${group.sessions[0].lifts[0].name} day`;
  }

  /** Stable id for a group: its newest session's lifts, sorted. */
  function _groupKey(group) {
    return [...group.keys].sort().join('|');
  }

  /** Lifts in at least half of a group's sessions, in the newest session's
   * order, each with its most recent sets as targets. */
  function _groupExercises(group) {
    const n = group.sessions.length;
    const seen = new Map();
    group.sessions.forEach(s => s.lifts.forEach(l => seen.set(l.key, (seen.get(l.key) || 0) + 1)));
    const order = [];
    group.sessions.forEach(s => s.lifts.forEach(l => { if (!order.includes(l.key)) order.push(l.key); }));
    return order
      .filter(k => seen.get(k) >= Math.max(1, Math.ceil(n / 2)))
      .map(k => {
        const latest = group.sessions.map(s => s.lifts.find(l => l.key === k)).find(Boolean);
        return { name: latest.name, sets: latest.sets.map(s => ({ reps: s.reps, weight: s.weight })) };
      });
  }

  /** "Thu" within the last week, else "12 days ago". */
  function lastDoneLabel(dateKey, todayKey) {
    const days = _daysBetween(dateKey, todayKey);
    if (days === 1) return 'yesterday';
    if (days < 7) { const d = _parseKey(dateKey); return d ? WEEKDAYS[d.getDay()] : dateKey; }
    return `${days} days ago`;
  }

  /**
   * The lifter's usual next session, or null when history shows no routine
   * (no group trained twice in the last six weeks and once in the last three).
   * opts: { now, muscleOf } — muscleOf names a lift's muscle group.
   */
  function inferUsualNext(workouts, opts) {
    const options = opts || {};
    const todayKey = _localDateKey(options.now);
    const from = _localDateKey(new Date((_parseKey(todayKey) || new Date()).getTime() - WINDOW_DAYS * DAY_MS));
    const sessions = sessionsByDay(workouts, { before: todayKey, after: from });
    const groups = groupSessions(sessions)
      .filter(g => g.sessions.length >= 2 && _daysBetween(g.sessions[0].date, todayKey) <= RECENT_DAYS);
    if (!groups.length) return null;
    // The routine done longest ago comes round next; ties go to the bigger group.
    groups.sort((a, b) => a.sessions[0].date.localeCompare(b.sessions[0].date) || b.sessions.length - a.sessions.length);
    const next = groups[0];
    const exercises = _groupExercises(next);
    if (!exercises.length) return null;
    const lastDone = next.sessions[0].date;
    return {
      name: _groupName(next, options.muscleOf),
      exercises,
      source: 'rotation',
      rotationKey: _groupKey(next),
      lastDone,
      lastDoneLabel: lastDoneLabel(lastDone, todayKey),
      timesDone: next.sessions.length,
    };
  }

  /**
   * The past session most like what's been logged today (freeform), as a
   * plan to compare against, or null when nothing is logged yet or nothing
   * in the last six weeks shares a lift with it.
   */
  function matchToday(workouts, opts) {
    const options = opts || {};
    const todayKey = _localDateKey(options.now);
    const today = sessionsByDay(workouts, { on: todayKey })[0];
    if (!today) return null;
    const todayKeys = _keys(today);
    const from = _localDateKey(new Date((_parseKey(todayKey) || new Date()).getTime() - WINDOW_DAYS * DAY_MS));
    const past = sessionsByDay(workouts, { before: todayKey, after: from });
    let best = null;
    past.forEach(s => {
      const keys = _keys(s);
      let both = 0;
      todayKeys.forEach(k => { if (keys.has(k)) both++; });
      if (!both) return;
      // Share of today's lifts it covers first, then overall likeness;
      // newest wins ties (past is newest first).
      const cover = both / todayKeys.size;
      const like = _jaccard(todayKeys, keys);
      if (!best || cover > best.cover || (cover === best.cover && like > best.like)) best = { s, cover, like };
    });
    if (!best || best.cover < 0.5) return null;
    const group = { keys: _keys(best.s), sessions: [best.s] };
    return {
      name: _groupName(group, options.muscleOf),
      exercises: best.s.lifts.map(l => ({ name: l.name, sets: l.sets.map(s => ({ reps: s.reps, weight: s.weight })) })),
      source: 'match',
      matchedDate: best.s.date,
      lastDoneLabel: lastDoneLabel(best.s.date, todayKey),
    };
  }

  const api = { sessionsByDay, groupSessions, inferUsualNext, matchToday, lastDoneLabel };

  global.usualSession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
