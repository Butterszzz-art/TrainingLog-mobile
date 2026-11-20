/* =============================================================
   COACH NUDGES — core (pure, tested: tests/coachNudges.test.js)
   Plans the "ping from your coach" phone notifications: train,
   log food, weigh in, check in (plus optional sleep and water).

   reminders.js gathers what the user has already done today and
   when training / check-ins are due, then asks planNudges() for the
   next DAYS days of notifications and hands them to the phone
   (Capacitor LocalNotifications). It re-plans whenever the app is
   opened or sent to the background, so a ping for something already
   done today is cancelled before it fires.

   reminders_<user>: [{ id, enabled, time: 'HH:MM', days: [0-6] }]
   ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CoachNudgesCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DAYS = 7;
  // iOS keeps at most 64 pending local notifications per app, shared with
  // meal reminders, so the soonest MAX are scheduled.
  const MAX = 30;
  // Meal reminders (meal-timing-core.js) use 7100-7179.
  const ID_BASE = 7300;
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  /**
   * The kinds, in settings order.
   * smart: skipped on a day it's already done (today only: the future
   * isn't known yet, the next re-plan catches it).
   * tab: where tapping the ping goes.
   */
  const KINDS = [
    { id: 'workout', label: 'Train', sub: 'On your training days, until the session is logged', time: '17:00', days: [1, 2, 3, 4, 5], enabled: true, tab: 'logTab' },
    { id: 'food', label: 'Log your food', sub: 'If nothing is in the food log yet that day', time: '20:00', days: ALL_DAYS, enabled: true, tab: 'macroTab' },
    { id: 'weighin', label: 'Weigh in', sub: 'Until you log your bodyweight', time: '07:30', days: ALL_DAYS, enabled: true, tab: 'weightTab' },
    { id: 'checkin', label: 'Check in', sub: 'The morning your check-in is due', time: '09:00', days: ALL_DAYS, enabled: true, tab: 'checkInTab' },
    { id: 'sleep', label: 'Log sleep', sub: 'Before bed', time: '22:00', days: ALL_DAYS, enabled: false, tab: 'sleepTab' },
    { id: 'water', label: 'Hydration', sub: 'Midday water check', time: '12:00', days: ALL_DAYS, enabled: false, tab: 'macroTab' },
  ];
  const KIND_IDS = KINDS.map(k => k.id);
  const byId = id => KINDS.find(k => k.id === id);

  // What the coach says. {session} and {coach} are filled in;
  // a line whose placeholder has no value is skipped.
  const LINES = {
    workout: [
      { title: '{session} today', body: 'Your session is waiting. Get it done and log it.' },
      { title: 'Training day', body: "It's a training day. Get in, get it done, log every set." },
      { title: 'Show up today', body: "Today's session is on the plan. Don't skip it — log it when you're done." },
      { title: 'Time to train', body: 'Consistency builds the physique. Log today’s session.' },
    ],
    workoutFree: [
      { title: 'Time to train', body: 'Get a session in today and log it.' },
      { title: 'Training check', body: 'Did you train today? Log it so I can track your progress.' },
    ],
    food: [
      { title: 'Log your food', body: 'Nothing in your food log yet today. Add what you ate so we stay on target.' },
      { title: 'Food log is empty', body: 'Two minutes now beats guessing tomorrow. Log today’s meals.' },
      { title: 'What did you eat today?', body: 'Your macros only work if they’re tracked. Log your food.' },
    ],
    weighin: [
      { title: 'Morning weigh-in', body: 'After the bathroom, before food. Step on the scale and log it.' },
      { title: 'Weigh in', body: 'Daily weigh-ins make the weekly average honest. Log today’s.' },
      { title: 'Scale time', body: 'One number, ten seconds. Log your bodyweight.' },
    ],
    checkin: [
      { title: 'Check-in due today', body: '{coach} is waiting on your check-in. Photos, weight and how the week went.' },
      { title: 'Check-in day', body: 'Fill in your check-in today so {coach} can adjust your plan.' },
    ],
    checkinSelf: [
      { title: 'Check-in day', body: 'Time for your weekly check-in. Photos, weight and how the week went.' },
      { title: 'Weekly check-in', body: 'Take five minutes to check in. It’s how we see what’s working.' },
    ],
    sleep: [
      { title: 'Log your sleep', body: 'Wind down and log last night’s sleep before bed.' },
    ],
    water: [
      { title: 'Hydration check', body: 'Are you on track for your water target today?' },
    ],
  };

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Local YYYY-MM-DD of a Date / ms. */
  function dateKey(t) {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function validTime(s) {
    return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  }

  /**
   * Saved settings (any shape, including the old reminders.js list) →
   * one entry per kind, in KINDS order.
   */
  function normalizeSettings(saved) {
    const list = Array.isArray(saved) ? saved : [];
    return KINDS.map(k => {
      const s = list.find(x => x && x.id === k.id) || {};
      const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : k.days.slice();
      return {
        id: k.id,
        enabled: typeof s.enabled === 'boolean' ? s.enabled : k.enabled,
        time: validTime(s.time) ? s.time : k.time,
        days,
      };
    });
  }

  // Small stable hash so the same day picks the same line on every re-plan.
  function pick(lines, seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return lines[Math.abs(h) % lines.length];
  }

  function fill(text, vars) {
    return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null || vars[k] === '' ? '' : String(vars[k])));
  }

  function usable(line, vars) {
    const need = (line.title + line.body).match(/\{(\w+)\}/g) || [];
    return need.every(m => {
      const v = vars[m.slice(1, -1)];
      return v != null && v !== '';
    });
  }

  /** Title and body for one ping. Pure. */
  function message(kind, vars, seed) {
    let key = kind;
    if (kind === 'workout' && !vars.planned) key = 'workoutFree';
    if (kind === 'checkin' && !vars.coach) key = 'checkinSelf';
    const all = LINES[key] || [];
    const lines = all.filter(l => usable(l, vars));
    const line = pick(lines.length ? lines : all, `${kind}|${seed}`);
    return { title: fill(line.title, vars).trim(), body: fill(line.body, vars).trim() };
  }

  /** Notification id for a kind on day d (0 = today). */
  function idFor(kind, d) {
    return ID_BASE + d * 10 + KIND_IDS.indexOf(kind);
  }

  /** Every id this module may have scheduled (to cancel before re-planning). */
  function allIds(days = DAYS) {
    const ids = [];
    for (let d = 0; d < days; d++) KIND_IDS.forEach((_, i) => ids.push(ID_BASE + d * 10 + i));
    return ids;
  }

  /**
   * The pings for the next `days` days.
   * ctx:
   *   settings     normalizeSettings() output
   *   now          ms
   *   done         { workout, food, weighin, checkin, sleep }: done today
   *   training     Map/obj date → session name ('' ok) when the user follows
   *                a program, else null (then the workout ping uses its days)
   *   checkinDates array of due dates (YYYY-MM-DD), or null/[] when the user
   *                has no check-in rhythm (no check-in ping then)
   *   coach        the coach's name when coached ('' otherwise)
   *   paused       vacation / sick mode: nothing is planned
   * → [{ id, kind, at (ms), date, title, body, tab }]
   */
  function planNudges(ctx) {
    const c = ctx || {};
    if (c.paused) return [];
    const settings = c.settings || normalizeSettings(null);
    const now = Number(c.now) || Date.now();
    const days = Number(c.days) || DAYS;
    const done = c.done || {};
    const training = c.training instanceof Map ? c.training
      : c.training && typeof c.training === 'object' ? new Map(Object.entries(c.training)) : null;
    const checkins = new Set(Array.isArray(c.checkinDates) ? c.checkinDates : []);
    const out = [];

    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    for (let d = 0; d < days; d++) {
      const day = new Date(base);
      day.setDate(base.getDate() + d);
      const key = dateKey(day);
      const dow = day.getDay();

      settings.forEach(s => {
        if (!s.enabled) return;
        const kind = byId(s.id);
        if (!kind) return;
        const [h, m] = s.time.split(':').map(Number);
        const at = new Date(day);
        at.setHours(h, m, 0, 0);
        if (at.getTime() <= now) return;
        if (d === 0 && done[s.id]) return;

        const vars = { coach: c.coach || '' };
        if (s.id === 'workout') {
          if (training && training.size) {
            if (!training.has(key)) return; // rest day on the program
            vars.planned = true;
            vars.session = training.get(key) || '';
          } else if (!s.days.includes(dow)) return;
        } else if (s.id === 'checkin') {
          if (!checkins.has(key)) return;
        } else if (!s.days.includes(dow)) return;

        const msg = message(s.id, vars, key);
        out.push({ id: idFor(s.id, d), kind: s.id, at: at.getTime(), date: key, title: msg.title, body: msg.body, tab: kind.tab });
      });
    }
    return out.sort((a, b) => a.at - b.at).slice(0, MAX);
  }

  /** One-line summary for the Settings tile, e.g. "4 on". */
  function summary(settings) {
    const on = (settings || []).filter(s => s.enabled).length;
    return on ? `${on} on` : 'Off';
  }

  return { DAYS, MAX, ID_BASE, KINDS, LINES, normalizeSettings, planNudges, message, idFor, allIds, dateKey, summary };
});
