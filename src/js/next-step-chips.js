/* =============================================================
   NEXT-STEP CHIPS — after you log something, one small chip points
   at the tab that turns it into an insight ("See your bench trend →
   Progress"). Purely additive: it listens for tl:set-logged and wraps
   addWeightEntry / saveWeeklyCheckIn from the outside, calling the
   originals unchanged.

   pickNextStep() is pure (tested in tests/nextStepChips.test.js);
   the rest is the UI layer. Styles: css/next-step-chips.css (.nsc).

   Pacing, so it guides without nagging:
     - one chip per trigger per day, two chips per day in total
     - a chip whose button was tapped is retired (path learned)
     - a chip dismissed twice is retired; 4 dismissals with no
       taps at all turns chips off
     - never during the app tour or performance mode
   ============================================================= */
(function (global) {
  'use strict';

  const MAX_PER_DAY = 2;
  const MAX_SHOWS = 3;           // lifetime shows per chip
  const RETIRE_DISMISSALS = 2;   // per chip
  const OFF_AFTER_DISMISSALS = 4;

  // Each rule: trigger, id, when(ctx) → bool, build(ctx) → chip.
  // Order matters: the first eligible rule for a trigger wins.
  const RULES = [
    // ── After a workout set ────────────────────────────────────
    {
      trigger: 'workout', id: 'first-workout',
      when: c => c.workoutDays === 1,
      build: () => ({
        text: 'First session logged. Your stats and PRs build up in Progress.',
        cta: 'Open Progress', action: { tab: 'progressTab' },
      }),
    },
    {
      trigger: 'workout', id: 'lift-trend',
      when: c => c.exerciseDays >= 3 && !!c.exercise,
      build: c => ({
        text: `${c.exerciseDays} ${c.exercise} sessions logged. Your strength trend is ready.`,
        cta: 'See trend', action: { tab: 'progressTab' },
      }),
    },
    {
      trigger: 'workout', id: 'try-program',
      when: c => !c.hasProgram && c.workoutDays >= 3,
      build: () => ({
        text: 'Training freestyle? A program puts what’s due today on Home.',
        cta: 'Browse programs', action: { tab: 'programTab' },
      }),
    },
    {
      trigger: 'workout', id: 'coach-session',
      when: c => c.coachAvailable && c.workoutDays >= 5,
      build: () => ({
        text: 'Your coach can compare today with your last few weeks.',
        cta: 'Ask coach', action: { coach: 'How does today’s session compare to my recent training?' },
      }),
    },

    // ── After a weigh-in ───────────────────────────────────────
    {
      trigger: 'weighin', id: 'weighin-macros',
      when: c => !c.hasMacroTargets,
      build: () => ({
        text: 'Set macro targets so your weigh-ins can steer them.',
        cta: 'Set macros', action: { tab: 'macroTab' },
      }),
    },
    {
      trigger: 'weighin', id: 'weighin-checkin',
      when: c => !c.checkInThisWeek,
      build: () => ({
        text: 'Add it to your weekly check-in to track progress week by week.',
        cta: 'Open check-in', action: { tab: 'checkInTab' },
      }),
    },
    {
      trigger: 'weighin', id: 'weighin-coach',
      when: c => c.coachAvailable && c.weighIns >= 5,
      build: c => ({
        text: `${c.weighIns} weigh-ins logged. Is your trend on pace for your goal?`,
        cta: 'Ask coach', action: { coach: 'Is my bodyweight trend on pace for my goal?' },
      }),
    },

    // ── After a weekly check-in ────────────────────────────────
    {
      trigger: 'checkin', id: 'checkin-progress',
      when: () => true,
      build: () => ({
        text: 'See how your lifts moved alongside this check-in.',
        cta: 'Open Progress', action: { tab: 'progressTab' },
      }),
    },
    {
      trigger: 'checkin', id: 'checkin-coach',
      when: c => c.coachAvailable,
      build: () => ({
        text: 'Ask your coach what to change for next week.',
        cta: 'Ask coach', action: { coach: 'Based on my latest check-in, what should I change next week?' },
      }),
    },
  ];

  function emptyState() {
    return { off: false, day: '', todayCount: 0, triggersToday: [], shows: {}, dismissals: {}, retired: {}, taps: 0, totalDismissals: 0 };
  }

  // Pure: which chip (if any) to show for this trigger, given the
  // user's data (ctx) and the pacing state.
  function pickNextStep(trigger, ctx, state, today) {
    const s = Object.assign(emptyState(), state || {});
    if (s.off) return null;
    const sameDay = s.day === today;
    if (sameDay && (s.todayCount >= MAX_PER_DAY || s.triggersToday.includes(trigger))) return null;
    for (const rule of RULES) {
      if (rule.trigger !== trigger) continue;
      if (s.retired[rule.id] || (s.shows[rule.id] || 0) >= MAX_SHOWS) continue;
      if (!rule.when(ctx || {})) continue;
      return Object.assign({ id: rule.id, trigger }, rule.build(ctx || {}));
    }
    return null;
  }

  function recordShown(state, chip, today) {
    const s = Object.assign(emptyState(), state || {});
    if (s.day !== today) { s.day = today; s.todayCount = 0; s.triggersToday = []; }
    s.todayCount += 1;
    s.triggersToday = s.triggersToday.concat(chip.trigger);
    s.shows = Object.assign({}, s.shows, { [chip.id]: (s.shows[chip.id] || 0) + 1 });
    return s;
  }

  function recordTapped(state, chip) {
    const s = Object.assign(emptyState(), state || {});
    s.retired = Object.assign({}, s.retired, { [chip.id]: true });
    s.taps += 1;
    return s;
  }

  function recordDismissed(state, chip) {
    const s = Object.assign(emptyState(), state || {});
    const n = (s.dismissals[chip.id] || 0) + 1;
    s.dismissals = Object.assign({}, s.dismissals, { [chip.id]: n });
    if (n >= RETIRE_DISMISSALS) s.retired = Object.assign({}, s.retired, { [chip.id]: true });
    s.totalDismissals += 1;
    if (s.taps === 0 && s.totalDismissals >= OFF_AFTER_DISMISSALS) s.off = true;
    return s;
  }

  const api = { RULES, pickNextStep, recordShown, recordTapped, recordDismissed };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  // ── UI layer (browser only) ────────────────────────────────

  function userId() {
    try { if (typeof currentUser !== 'undefined' && currentUser) return currentUser; } catch (_) { /* not defined yet */ }
    return localStorage.getItem('currentUser') || localStorage.getItem('username') || null;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (_) { return fallback; }
  }

  const stateKey = u => `nextStepChips_${u}`;
  const loadState = u => readJSON(stateKey(u), emptyState());
  function saveState(u, s) { try { localStorage.setItem(stateKey(u), JSON.stringify(s)); } catch (_) { /* storage full / blocked */ } }

  function loadCheckIns(u) {
    try { return global.checkinEngine?.loadCheckIns?.(u) || []; } catch (_) { return []; }
  }

  function buildContext(u, extra) {
    const workouts = readJSON(`workouts_${u}`, []);
    const days = new Set();
    const exDays = new Set();
    const ex = String(extra?.exercise || '').trim().toLowerCase();
    (Array.isArray(workouts) ? workouts : []).forEach(w => {
      if (!w || !Array.isArray(w.log) || !w.log.length) return;
      days.add(w.date);
      if (ex && w.log.some(e => String(e?.exercise || '').trim().toLowerCase() === ex)) exDays.add(w.date);
    });
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    return {
      exercise: extra?.exercise ? String(extra.exercise).trim() : '',
      workoutDays: days.size,
      exerciseDays: exDays.size,
      hasProgram: !!localStorage.getItem(`activeProgram_${u}`),
      hasMacroTargets: !!readJSON(`macroTargets_${u}`, null),
      weighIns: (readJSON(`bodyweightLog_${u}`, []) || []).length,
      checkInThisWeek: loadCheckIns(u).some(c => (c?.date || '') >= weekAgo),
      coachAvailable: !!document.getElementById('aiCoachFab') && typeof global.openAiCoach === 'function',
    };
  }

  // getClientRects() also catches position:fixed boxes, where offsetParent is null.
  function shown(el) {
    return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function modalOpen() {
    return [...document.querySelectorAll('[aria-modal="true"], .nm-overlay')].some(shown);
  }

  function blocked() {
    return document.hidden
      || modalOpen()
      || !!document.getElementById('loginContainer')?.offsetParent
      || document.body.classList.contains('performance-mode')
      || !!document.querySelector('.tour-root')
      || !!document.getElementById('tutorialOverlay')?.offsetParent
      || !!document.getElementById('nextStepChip');
  }

  let hideTimer = null;

  function removeChip(el) {
    clearTimeout(hideTimer);
    if (!el || !el.isConnected) return;
    el.classList.add('nsc--out');
    setTimeout(() => el.remove(), 220);
  }

  function runAction(action) {
    if (action.coach && typeof global.openAiCoach === 'function') global.openAiCoach(action.coach);
    else if (action.tab && typeof global.showTab === 'function') global.showTab(action.tab);
  }

  function render(u, chip) {
    const el = document.createElement('div');
    el.id = 'nextStepChip';
    el.className = 'nsc';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <span class="nsc-dot" aria-hidden="true"></span>
      <span class="nsc-text"></span>
      <button type="button" class="nsc-cta"></button>
      <button type="button" class="nsc-close" aria-label="Dismiss tip">×</button>`;
    el.querySelector('.nsc-text').textContent = chip.text;
    el.querySelector('.nsc-cta').textContent = chip.cta;

    el.querySelector('.nsc-cta').addEventListener('click', () => {
      saveState(u, recordTapped(loadState(u), chip));
      removeChip(el);
      runAction(chip.action);
    });
    el.querySelector('.nsc-close').addEventListener('click', () => {
      saveState(u, recordDismissed(loadState(u), chip));
      removeChip(el);
    });
    // Ignored chips just fade — that counts as neither tap nor dismissal.
    const arm = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => removeChip(el), 10000); };
    el.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    el.addEventListener('pointerleave', arm);

    document.body.appendChild(el);
    arm();
  }

  function offer(trigger, extra) {
    const u = userId();
    if (!u || blocked()) return;
    const today = todayStr();
    const state = loadState(u);
    const chip = pickNextStep(trigger, buildContext(u, extra), state, today);
    if (!chip) return;
    saveState(u, recordShown(state, chip, today));
    render(u, chip);
  }

  function later(ms, fn) { setTimeout(fn, ms); }

  // Workouts: wait until the post-log toasts have cleared.
  document.addEventListener('tl:set-logged', e => later(3800, () => offer('workout', e.detail)));

  // Wrap a global save function from the outside; offer the chip only
  // when the saved data actually changed (validation can bail early).
  function wrap(name, snapshot, trigger, delay, guard) {
    const original = global[name];
    if (typeof original !== 'function' || original.__nextStepWrapped) return;
    const wrapped = function () {
      const u = userId();
      const before = u ? snapshot(u) : null;
      // finally: a save can land and then throw in later UI refresh code;
      // the chip follows what was saved, and the error still propagates.
      try {
        return original.apply(this, arguments);
      } finally {
        try {
          if (u && (!guard || guard(arguments)) && snapshot(u) !== before) later(delay, () => offer(trigger));
        } catch (_) { /* never let a tip break a save */ }
      }
    };
    wrapped.__nextStepWrapped = true;
    global[name] = wrapped;
  }

  function install() {
    wrap('addWeightEntry', u => localStorage.getItem(`bodyweightLog_${u}`), 'weighin', 900);
    wrap('saveWeeklyCheckIn', u => JSON.stringify(loadCheckIns(u)), 'checkin', 1800,
      args => (args[0] || 'athlete') === 'athlete');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();

  global.nextStepChips = Object.assign(api, {
    offer,
    setEnabled(on) { const u = userId(); if (u) saveState(u, Object.assign(loadState(u), { off: !on })); },
    reset() { const u = userId(); if (u) localStorage.removeItem(stateKey(u)); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
