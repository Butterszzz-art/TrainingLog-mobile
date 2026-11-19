/* =============================================================
   HABIT — weekly goal, starter mode, starter card
   Rules live in src/js/habit-core.js (tested). This file:

   - Weekly goal card (Home › This week, #weeklyGoalCard): "2 of 3
     sessions this week", a Mon–Sun strip and weeks-in-a-row. Tapping
     the goal opens a sheet to change it and the training days (which
     also set the days of the "Train" reminder).
   - Greeting streak: once a weekly goal is set, the greeting shows
     weeks in a row instead of the daily streak (greetingStreak()).
   - Starter mode: the first 14 days after onboarding, <html> gets
     .starter-mode (css/habit.css hides the advanced Home cards and the
     specialist All tiles) and Home shows the starter card
     (#starterCard): first session, weekly goal, reminders, history,
     training partner. "Show everything" turns it off for good.

   State: habit_<user> (see habit-core.js). Onboarding writes
   startedAt, weeklyGoal, trainingDays and reminderTime; accounts made
   before this shipped have no startedAt, so they never see starter
   mode or the early-days notifications.
   Styles: css/habit.css (.hb-*).
   ============================================================= */
(function (global) {
  'use strict';

  const H = () => global.HabitCore;
  const KEY = u => `habit_${u}`;
  const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Mon-first order of JS getDay() numbers.
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  // All-hub tiles that stay in the starter view (the rest come back with
  // "Show everything" or when starter mode ends).
  const STARTER_TILES = new Set(['programTab', 'logHistoryTab', 'progressTab', 'cardioTab', 'librariesTab', 'communityTab', 'settingsTab']);
  const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  /* ── State ──────────────────────────────────────────────── */

  function user() {
    return (typeof global.getActiveUsername === 'function' && global.getActiveUsername())
      || global.currentUser || localStorage.getItem('fitnessAppUser') || '';
  }

  function load(u = user()) {
    if (!u) return {};
    try { return JSON.parse(localStorage.getItem(KEY(u))) || {}; } catch { return {}; }
  }

  function save(u, s) {
    if (!u) return;
    try { localStorage.setItem(KEY(u), JSON.stringify(s)); } catch { /* storage full */ }
  }

  function update(fn, u = user()) {
    const s = load(u);
    fn(s);
    save(u, s);
    changed();
    return s;
  }

  function today() { return H().dateKey(Date.now()); }

  function history(u) {
    if (typeof global.getFullWorkoutHistory === 'function') return global.getFullWorkoutHistory(u);
    if (typeof global.getAllWorkoutsForUser === 'function') return global.getAllWorkoutsForUser(u);
    try { return JSON.parse(localStorage.getItem(`workouts_${u}`)) || []; } catch { return []; }
  }

  /** Everything the cards need, in one pass. */
  function snapshot(u = user()) {
    if (!u || !H()) return null;
    const s = load(u);
    const days = H().sessionDays(history(u));
    const t = today();
    const goal = H().clampGoal(s.weeklyGoal || 3);
    return {
      u, s, t, days,
      goalSet: !!s.weeklyGoal,
      week: H().weeklyProgress(days.all, goal, t),
      starter: H().isStarterMode(s, { today: t, importedSessions: days.imported }),
    };
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /* ── Weekly goal card ───────────────────────────────────── */

  function weekNote(snap) {
    const { week, s } = snap;
    if (week.hit) return week.done > week.goal ? `Goal hit, plus ${week.done - week.goal} bonus.` : 'Goal hit. Anything else this week is a bonus.';
    const daysLeft = week.week.filter(d => d.future || (d.isToday && !d.trained)).length;
    if (week.left > daysLeft) return `${week.left} to go and ${daysLeft} day${daysLeft === 1 ? '' : 's'} left. Get what you can in.`;
    const planned = Array.isArray(s.trainingDays) && s.trainingDays.length ? s.trainingDays : null;
    const todayDow = new Date().getDay();
    if (planned && !planned.includes(todayDow) && !week.week.find(d => d.isToday).trained) return `Rest day. ${week.left} to go this week.`;
    return week.left === 1 ? 'One more to hit your goal.' : `${week.left} more to hit your goal.`;
  }

  function renderWeeklyCard() {
    const el = document.getElementById('weeklyGoalCard');
    if (!el) return;
    const snap = snapshot();
    if (!snap) { el.innerHTML = ''; return; }
    const { week, s, goalSet } = snap;
    const planned = new Set(Array.isArray(s.trainingDays) ? s.trainingDays : []);
    const dots = week.week.map((d, i) => {
      const dow = WEEK_ORDER[i];
      const cls = ['hb-day', d.trained ? 'is-done' : '', d.isToday ? 'is-today' : '', planned.has(dow) ? 'is-planned' : '', d.future ? 'is-future' : ''].filter(Boolean).join(' ');
      return `<span class="${cls}" aria-label="${DAY_LONG[dow]}${d.trained ? ': trained' : planned.has(dow) ? ': training day' : ''}">${d.trained ? CHECK : DAY_LETTERS[i]}</span>`;
    }).join('');
    const streak = week.streakWeeks >= 1
      ? `<span class="hb-streak">${week.streakWeeks} week${week.streakWeeks === 1 ? '' : 's'} in a row</span>`
      : '';
    el.innerHTML = `
      <div class="hb-week${week.hit ? ' is-hit' : ''}">
        <div class="hb-week-head">
          <span class="wk-cap">Weekly goal</span>
          <button type="button" class="hb-goal-btn" data-hb-edit aria-label="Change weekly goal">${goalSet ? `${week.goal} day${week.goal === 1 ? '' : 's'} a week` : 'Set your goal'}</button>
        </div>
        <div class="hb-week-main">
          <b class="hb-count">${week.done}<small>/${week.goal}</small></b>
          <span class="hb-week-label">sessions this week</span>
          ${streak}
        </div>
        <div class="hb-days" role="img" aria-label="${week.done} of ${week.goal} sessions this week">${dots}</div>
        <p class="hb-note">${esc(weekNote(snap))}</p>
      </div>`;
    el.querySelector('[data-hb-edit]').addEventListener('click', openGoalSheet);
  }

  /** "3 weeks in a row" for the greeting, or '' (then the daily streak shows). */
  function greetingStreak(u = user()) {
    const snap = snapshot(u);
    if (!snap || !snap.goalSet) return null;
    const n = snap.week.streakWeeks;
    return n >= 1 ? `${n} week${n === 1 ? '' : 's'} in a row` : '';
  }

  /* ── Goal sheet ─────────────────────────────────────────── */

  function closeSheet() { document.querySelectorAll('.hb-backdrop').forEach(n => n.remove()); }

  /** Training days → the "Train" reminder's days (only matters without a program). */
  function syncReminderDays(trainingDays, time) {
    const N = global.CoachNudges;
    if (!N || typeof N.getSettings !== 'function') return;
    const list = N.getSettings();
    const w = list.find(x => x.id === 'workout');
    if (!w) return;
    if (Array.isArray(trainingDays) && trainingDays.length) w.days = trainingDays.slice().sort();
    if (time) w.time = time;
    N.saveSettings(list);
  }

  function openGoalSheet() {
    const snap = snapshot();
    if (!snap) return;
    closeSheet();
    let goal = snap.week.goal;
    const days = new Set(Array.isArray(snap.s.trainingDays) ? snap.s.trainingDays : []);
    const overlay = document.createElement('div');
    overlay.className = 'mx-sheet-backdrop hb-backdrop';
    const render = () => {
      overlay.innerHTML = `
        <div class="mx-sheet hb-sheet" role="dialog" aria-modal="true" aria-labelledby="hbSheetTitle">
          <div class="mx-sheet-head">
            <h3 class="pod-title mx-h3" id="hbSheetTitle">Your weekly goal</h3>
            <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-hb-close aria-label="Close">${CLOSE}</button>
          </div>
          <p class="mx-sub hb-lead">How many days a week will you train? Pick something you can hit on a busy week. Missing a day doesn’t break anything; your streak counts weeks.</p>
          <div class="hb-goal-chips" role="radiogroup" aria-label="Sessions a week">
            ${[1, 2, 3, 4, 5, 6, 7].map(n => `<button type="button" class="hb-chip${n === goal ? ' is-on' : ''}" role="radio" aria-checked="${n === goal}" data-hb-goal="${n}">${n}</button>`).join('')}
          </div>
          <div class="wk-cap hb-sub-label">Usual training days <small>(for reminders)</small></div>
          <div class="hb-day-chips">
            ${WEEK_ORDER.map((dow, i) => `<button type="button" class="hb-chip hb-chip--day${days.has(dow) ? ' is-on' : ''}" aria-pressed="${days.has(dow)}" aria-label="${DAY_LONG[dow]}" data-hb-day="${dow}">${DAY_LETTERS[i]}</button>`).join('')}
          </div>
          <div class="hb-sheet-foot">
            <button type="button" class="gd-go" data-hb-save>Save</button>
          </div>
        </div>`;
    };
    render();
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-hb-close]')) { closeSheet(); return; }
      const g = e.target.closest('[data-hb-goal]');
      if (g) { goal = Number(g.dataset.hbGoal); render(); return; }
      const d = e.target.closest('[data-hb-day]');
      if (d) {
        const dow = Number(d.dataset.hbDay);
        if (days.has(dow)) days.delete(dow); else days.add(dow);
        if (days.size && !snap.goalSet && goal === snap.week.goal) goal = H().suggestGoal([...days]);
        render();
        return;
      }
      if (e.target.closest('[data-hb-save]')) {
        update(s => {
          s.weeklyGoal = goal;
          if (days.size) s.trainingDays = [...days].sort();
        });
        if (days.size) syncReminderDays([...days], null);
        closeSheet();
      }
    });
    document.body.appendChild(overlay);
  }

  /* ── Starter mode ───────────────────────────────────────── */

  function applyStarterMode(snap = snapshot()) {
    const on = !!(snap && snap.starter);
    document.documentElement.classList.toggle('starter-mode', on);
    document.querySelectorAll('#allTab .all-hub-tile[data-tab]').forEach(tile => {
      tile.classList.toggle('hb-starter-hidden', on && !STARTER_TILES.has(tile.dataset.tab));
    });
    const hub = document.getElementById('allTab');
    let note = document.getElementById('starterAllNote');
    if (on && hub && !note) {
      note = document.createElement('div');
      note.id = 'starterAllNote';
      note.className = 'hb-all-note';
      note.innerHTML = '<span>Starter view: the basics for your first two weeks. Everything else is one tap away.</span><button type="button" class="gd-textbtn" data-hb-all>Show everything</button>';
      const header = hub.querySelector('.all-hub-header');
      if (header) header.insertAdjacentElement('afterend', note); else hub.prepend(note);
      note.querySelector('[data-hb-all]').addEventListener('click', endStarterMode);
    } else if (!on && note) {
      note.remove();
    }
    return on;
  }

  function endStarterMode() {
    update(s => { s.starterOff = true; });
    const t = global.nativeToast || global.showToast;
    if (typeof t === 'function') t('Everything’s on. Find it all under All.', 'success');
  }

  async function remindersOn() {
    const N = global.CoachNudges;
    if (!N) return false;
    try {
      const w = N.getSettings().find(x => x.id === 'workout');
      return !!(w && w.enabled) && (await N.permission()) === 'granted';
    } catch { return false; }
  }

  async function renderStarterCard() {
    const el = document.getElementById('starterCard');
    if (!el) return;
    const snap = snapshot();
    if (!snap || !snap.starter) { el.innerHTML = ''; return; }
    const { week, days, s, t } = snap;
    const left = H().starterDaysLeft(s, t);
    const remOn = await remindersOn();
    const partner = global.TrainTogether ? global.TrainTogether.hasPartner(snap.u) : true;
    const steps = [
      { id: 'first', label: 'Log your first session', sub: 'Your numbers get filled in for you next time.', done: days.own.length >= 1, action: 'Train' },
      { id: 'week', label: `Train ${week.goal} day${week.goal === 1 ? '' : 's'} this week`, sub: `${week.done} of ${week.goal} so far.`, done: week.hit, action: 'Train' },
      { id: 'remind', label: 'Turn on training reminders', sub: 'One ping on your training days, nothing else.', done: remOn, action: 'Turn on' },
      { id: 'partner', label: 'Train with someone', sub: 'Link your coach or invite a friend.', done: partner, action: 'Set up' },
      { id: 'history', label: 'Used another app before?', sub: 'Bring your history so your charts start full.', done: !!(global.HistoryImport && global.HistoryImport.lastImport(snap.u)), action: 'Import', optional: true },
    ];
    const open = steps.filter(x => !x.done);
    const doneCount = steps.length - open.length;
    el.innerHTML = `
      <div class="pod hb-starter">
        <div class="hb-starter-head">
          <div>
            <div class="mx-kicker">Your first two weeks</div>
            <div class="pod-title hb-starter-title">${open.length ? 'A few things that make it stick' : 'You’re set up'}</div>
          </div>
          <span class="hb-starter-left">${left} day${left === 1 ? '' : 's'} left</span>
        </div>
        <div class="mx-meter mx-meter--thin" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${doneCount}" aria-label="Starter steps done"><i style="width:${Math.round((doneCount / steps.length) * 100)}%"></i></div>
        <ul class="hb-steps">
          ${steps.map(x => `
            <li class="hb-step${x.done ? ' is-done' : ''}">
              <span class="hb-step-tick" aria-hidden="true">${x.done ? CHECK : ''}</span>
              <span class="hb-step-text"><span class="hb-step-label">${esc(x.label)}${x.optional ? ' <small>optional</small>' : ''}</span><span class="hb-step-sub">${esc(x.sub)}</span></span>
              ${x.done ? '' : `<button type="button" class="gd-go hb-step-go" data-hb-step="${x.id}">${esc(x.action)}</button>`}
            </li>`).join('')}
        </ul>
        <div class="hb-starter-foot">
          <span class="hb-starter-why">The rest of the app is still here. We’re just keeping the start simple.</span>
          <button type="button" class="gd-textbtn gd-dim" data-hb-all>Show everything</button>
        </div>
      </div>`;
    el.querySelector('[data-hb-all]').addEventListener('click', endStarterMode);
    el.querySelectorAll('[data-hb-step]').forEach(b => b.addEventListener('click', () => runStep(b.dataset.hbStep)));
  }

  async function runStep(id) {
    if (id === 'first' || id === 'week') {
      if (typeof global.showTab === 'function') global.showTab('logTab');
    } else if (id === 'remind') {
      const N = global.CoachNudges;
      if (!N) return;
      const list = N.getSettings();
      const w = list.find(x => x.id === 'workout');
      if (w) w.enabled = true;
      N.saveSettings(list);
      const p = await N.requestPermission();
      const t = global.nativeToast || global.showToast;
      if (typeof t === 'function') {
        t(p === 'granted' ? 'Reminders on for your training days.' : p === 'denied' ? 'Notifications are off for Pocket Coach. Turn them on in your phone’s Settings.' : 'Reminders need notification permission.', p === 'granted' ? 'success' : 'error');
      }
      changed();
    } else if (id === 'partner') {
      if (global.TrainTogether) global.TrainTogether.open();
    } else if (id === 'history') {
      if (global.HistoryImport) global.HistoryImport.open({ onClose: () => changed() });
    }
  }

  /* ── Wiring ─────────────────────────────────────────────── */

  let _t = null;
  function changed() {
    clearTimeout(_t);
    _t = setTimeout(renderAll, 60);
  }

  function renderAll() {
    if (!H() || !user()) return;
    const snap = snapshot();
    applyStarterMode(snap);
    renderWeeklyCard();
    renderStarterCard();
    if (global.CoachNudges && typeof global.CoachNudges.sync === 'function') global.CoachNudges.sync();
  }

  // Home re-renders through renderHomeDashboard(); follow it.
  function hookHome() {
    const fn = global.renderHomeDashboard;
    if (typeof fn !== 'function' || fn.__habitWrapped) return;
    const wrapped = function () { const r = fn.apply(this, arguments); renderAll(); return r; };
    wrapped.__habitWrapped = true;
    global.renderHomeDashboard = wrapped;
  }

  document.addEventListener('tl:habit-changed', changed);
  document.addEventListener('tl:history-imported', changed);
  document.addEventListener('tl:workout-finished', () => setTimeout(changed, 300));
  document.addEventListener('tl:set-logged', changed);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') changed(); });
  document.addEventListener('DOMContentLoaded', () => {
    hookHome();
    setTimeout(renderAll, 1200);
  });

  global.Habit = {
    load, save, update, snapshot, greetingStreak, renderAll, openGoalSheet, endStarterMode, syncReminderDays,
    isStarterMode: () => { const s = snapshot(); return !!(s && s.starter); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
