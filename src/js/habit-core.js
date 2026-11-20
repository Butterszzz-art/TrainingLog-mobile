/* =============================================================
   HABIT — core (pure, tested: tests/habitCore.test.js)
   The rules behind the "get new users into the habit" features:

   - Weekly goal: N training days a week instead of a daily streak.
     Missing a day doesn't break anything; the streak counts WEEKS in
     a row the goal was hit (weeklyProgress).
   - Starter mode: the first 14 days after sign-up show a smaller app
     (Home, Train, Body, Insights) so it doesn't look like homework.
     Off for people who imported history (they're not new to training)
     or who turned it off (isStarterMode).
   - First-session card: what the first few sessions already tell you
     (summarizeSession; first-session-card.js shows it).
   - Early-days notifications: "session 2 is ready", the first-week
     recap and a comeback nudge after 5 quiet days in the first month
     (planLifecycle; reminders.js schedules them next to the coach
     pings).

   State, per user (habit_<user>, written by habit.js and onboarding):
   { startedAt: 'YYYY-MM-DD', weeklyGoal: 1-7, trainingDays: [0-6],
     reminderTime: 'HH:MM', starterOff: bool, cardsShown: { date: n } }
   ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HabitCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STARTER_DAYS = 14;
  const EARLY_SESSIONS = 3;          // first-session card shows for sessions 1-3
  const COMEBACK_AFTER_DAYS = 5;
  const LIFECYCLE_WINDOW_DAYS = 30;
  // Coach nudges use 7300-7366, meal reminders 7100-7179.
  const LIFECYCLE_ID_BASE = 7400;
  const LIFECYCLE = { nextSession: 0, weekOne: 1, comeback: 2 };
  const DAY_MS = 864e5;

  /* ── Dates (local YYYY-MM-DD keys) ──────────────────────── */

  const pad = n => String(n).padStart(2, '0');
  function dateKey(t) {
    const d = t instanceof Date ? t : new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseKey(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
  }
  function addDays(key, n) {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }
  function daysBetween(a, b) {
    return Math.round((parseKey(b) - parseKey(a)) / DAY_MS);
  }
  /** Monday of the week `key` is in. */
  function weekStart(key) {
    const d = parseKey(key);
    const dow = (d.getDay() + 6) % 7; // Mon = 0
    d.setDate(d.getDate() - dow);
    return dateKey(d);
  }

  /* ── Sessions ───────────────────────────────────────────── */

  function hasSets(w) {
    return !!(w && Array.isArray(w.log) && w.log.some(e => e && (
      (Array.isArray(e.repsArray) && e.repsArray.some(v => Number(v) > 0))
      || (Array.isArray(e.weightsArray) && e.weightsArray.some(v => Number(v) > 0)))));
  }

  /**
   * Training days from a workout list.
   * → { all: [dates], own: [dates logged in this app], imported: n }
   */
  function sessionDays(workouts) {
    const all = new Set();
    const own = new Set();
    let imported = 0;
    (Array.isArray(workouts) ? workouts : []).forEach(w => {
      if (!hasSets(w)) return;
      const day = String(w.date || '').slice(0, 10);
      if (!parseKey(day)) return;
      all.add(day);
      if (w.imported) imported++;
      else own.add(day);
    });
    return { all: [...all].sort(), own: [...own].sort(), imported };
  }

  /* ── Weekly goal ────────────────────────────────────────── */

  function clampGoal(n) {
    const g = Math.round(Number(n));
    return g >= 1 && g <= 7 ? g : 3;
  }

  /**
   * days: training day keys; goal: sessions a week; today: key.
   * → { goal, done, left, hit, week: [{ date, trained, isToday, future }] x7,
   *     streakWeeks, bestWeeks }
   * streakWeeks: weeks in a row the goal was hit, ending last week, plus
   * this week once it's hit (so an unfinished week never breaks it).
   */
  function weeklyProgress(days, goal, today) {
    const g = clampGoal(goal);
    const set = new Set(days || []);
    const start = weekStart(today);
    const week = [];
    let done = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const trained = set.has(date);
      if (trained) done++;
      week.push({ date, trained, isToday: date === today, future: date > today });
    }
    const perWeek = new Map();
    set.forEach(d => {
      const ws = weekStart(d);
      perWeek.set(ws, (perWeek.get(ws) || 0) + 1);
    });
    let streak = 0;
    let ws = addDays(start, -7);
    while ((perWeek.get(ws) || 0) >= g) { streak++; ws = addDays(ws, -7); }
    if (done >= g) streak++;

    let best = 0;
    let run = 0;
    const weeks = [...perWeek.keys()].sort();
    if (weeks.length) {
      for (let w = weeks[0]; w <= start; w = addDays(w, 7)) {
        if ((perWeek.get(w) || 0) >= g) { run++; best = Math.max(best, run); } else if (w !== start) run = 0;
      }
    }
    return { goal: g, done, left: Math.max(0, g - done), hit: done >= g, week, streakWeeks: streak, bestWeeks: Math.max(best, streak) };
  }

  /** A sensible goal from picked training days (or experience). */
  function suggestGoal(trainingDays, experience) {
    const n = Array.isArray(trainingDays) ? new Set(trainingDays).size : 0;
    if (n) return Math.min(6, Math.max(1, n));
    return experience === 'beginner' ? 2 : experience === 'advanced' ? 4 : 3;
  }

  /* ── Starter mode ───────────────────────────────────────── */

  /** state: habit state; ctx: { today, importedSessions } */
  function isStarterMode(state, ctx) {
    const s = state || {};
    const c = ctx || {};
    if (s.starterOff || !s.startedAt || !parseKey(s.startedAt)) return false;
    if ((c.importedSessions || 0) > 0) return false;
    const age = daysBetween(s.startedAt, c.today || dateKey(Date.now()));
    return age >= 0 && age < STARTER_DAYS;
  }

  function starterDaysLeft(state, today) {
    if (!state || !state.startedAt) return 0;
    return Math.max(0, STARTER_DAYS - daysBetween(state.startedAt, today));
  }

  /* ── First-session card ─────────────────────────────────── */

  function e1rm(weight, reps) {
    const w = Number(weight) || 0;
    const r = Number(reps) || 0;
    if (!w || !r) return 0;
    if (r === 1) return w;
    return Math.round(w * (1 + Math.min(r, 12) / 30) * 10) / 10;
  }

  /**
   * workout: the session just finished. muscleOf(name) → muscle group.
   * → { sets, volume, unit, exercises: [{ name, sets, best: { weight, reps }, e1rm }],
   *     muscles: [{ muscle, sets }] }
   */
  function summarizeSession(workout, muscleOf) {
    const byName = new Map();
    let sets = 0;
    let volume = 0;
    let unit = 'kg';
    (workout && Array.isArray(workout.log) ? workout.log : []).forEach(e => {
      if (!e || !e.exercise) return;
      const reps = Array.isArray(e.repsArray) ? e.repsArray : [];
      const weights = Array.isArray(e.weightsArray) ? e.weightsArray : [];
      const types = Array.isArray(e.setTypeArray) ? e.setTypeArray : [];
      if (e.unit) unit = e.unit;
      const k = String(e.exercise).trim().toLowerCase();
      let x = byName.get(k);
      if (!x) { x = { name: String(e.exercise).trim(), sets: 0, best: null, e1rm: 0 }; byName.set(k, x); }
      reps.forEach((r, i) => {
        const rr = Number(r) || 0;
        const ww = Number(weights[i]) || 0;
        if (!(rr > 0 || ww > 0)) return;
        const warm = types[i] === 'warmup' || types[i] === 'warm-up';
        if (!warm) { x.sets++; sets++; }
        volume += rr * ww;
        const est = e1rm(ww, rr);
        if (!warm && (!x.best || est > x.e1rm || (est === x.e1rm && ww > x.best.weight))) {
          x.best = { weight: ww, reps: rr };
          x.e1rm = est;
        }
      });
    });
    const exercises = [...byName.values()].filter(x => x.sets > 0);
    const muscles = new Map();
    exercises.forEach(x => {
      const m = (typeof muscleOf === 'function' && muscleOf(x.name)) || 'other';
      muscles.set(m, (muscles.get(m) || 0) + x.sets);
    });
    return {
      sets,
      volume: Math.round(volume),
      unit,
      exercises,
      muscles: [...muscles.entries()].filter(([m]) => m !== 'other').map(([muscle, n]) => ({ muscle, sets: n })).sort((a, b) => b.sets - a.sets),
    };
  }

  /** Which own session this is (1-based) and whether the card should show. */
  function earlySessionNumber(ownDays, date) {
    const idx = (ownDays || []).indexOf(date);
    const n = idx === -1 ? (ownDays || []).length + 1 : idx + 1;
    return { n, show: n <= EARLY_SESSIONS };
  }

  /* ── Early-days notifications ───────────────────────────── */

  function atTime(day, time) {
    const [h, m] = (/^\d{2}:\d{2}$/.test(time || '') ? time : '17:00').split(':').map(Number);
    const d = parseKey(day);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  /** Next training day on/after `from` (any day if none picked). */
  function nextTrainingDay(from, trainingDays) {
    const days = Array.isArray(trainingDays) && trainingDays.length ? trainingDays : null;
    for (let i = 0; i < 8; i++) {
      const k = addDays(from, i);
      if (!days || days.includes(parseKey(k).getDay())) return k;
    }
    return from;
  }

  /**
   * ctx: { state, now, ownDays, nextHint, weekOne: { sessions, sets } }
   *   nextHint: 'Bench Press 100 kg × 6' (what to beat next time), optional.
   * → [{ id, kind, at, date, title, body, tab }]
   */
  function planLifecycle(ctx) {
    const c = ctx || {};
    const s = c.state || {};
    const now = Number(c.now) || Date.now();
    const today = dateKey(now);
    const own = Array.isArray(c.ownDays) ? c.ownDays : [];
    if (!s.startedAt || !parseKey(s.startedAt)) return [];
    const age = daysBetween(s.startedAt, today);
    if (age < 0 || age > LIFECYCLE_WINDOW_DAYS) return [];
    const time = s.reminderTime || '17:00';
    const out = [];
    const push = (kind, day, at, title, body, tab) => {
      if (at <= now) return;
      out.push({ id: LIFECYCLE_ID_BASE + LIFECYCLE[kind], kind, at, date: day, title, body, tab });
    };

    // 1. Session 2 is ready: the next training day after the first session.
    if (own.length === 1) {
      const day = nextTrainingDay(addDays(own[0], 1), s.trainingDays);
      push('nextSession', day, atTime(day, time), 'Session 2 is ready',
        c.nextHint ? `Last time set the bar. Today: ${c.nextHint}.` : 'Your numbers from last time are filled in. Beat one of them today.', 'logTab');
    }

    // 2. First-week recap, evening of day 7.
    const day7 = addDays(s.startedAt, 7);
    if (today <= day7) {
      const w = c.weekOne || {};
      push('weekOne', day7, atTime(day7, '18:30'), 'Your first week',
        w.sessions ? `${w.sessions} session${w.sessions === 1 ? '' : 's'} and ${w.sets || 0} sets logged. See how the week went.` : 'See how your first week went and set up the next one.', 'homeTab');
    }

    // 3. Comeback: 5 quiet days after the last session (first month only).
    const last = own.length ? own[own.length - 1] : s.startedAt;
    const quiet = addDays(last, COMEBACK_AFTER_DAYS);
    if (daysBetween(s.startedAt, quiet) <= LIFECYCLE_WINDOW_DAYS) {
      push('comeback', quiet, atTime(quiet, time), 'Keep the habit alive',
        'A short session counts. Even 20 minutes keeps your week on track.', 'logTab');
    }
    return out.sort((a, b) => a.at - b.at);
  }

  function lifecycleIds() {
    return Object.values(LIFECYCLE).map(i => LIFECYCLE_ID_BASE + i);
  }

  return {
    STARTER_DAYS, EARLY_SESSIONS, LIFECYCLE_ID_BASE,
    dateKey, addDays, daysBetween, weekStart, sessionDays, clampGoal, weeklyProgress, suggestGoal,
    isStarterMode, starterDaysLeft, e1rm, summarizeSession, earlySessionNumber,
    nextTrainingDay, planLifecycle, lifecycleIds,
  };
});
