/* =============================================================
   COACH REMINDERS — pings from your coach
   Phone notifications that nudge the user to train, log food,
   weigh in and check in (plus optional sleep and water pings).

   What gets sent is planned by coach-nudges-core.js (pure, tested).
   This file feeds it what's already done today and when training and
   check-ins are due, then:
   - in the iOS/Android app: schedules the next 7 days as real local
     notifications (Capacitor LocalNotifications), so they arrive with
     the app closed. It re-plans when the app opens, when it goes to
     the background, when settings change and when the coach's
     check-in rhythm changes, so a ping for something already done
     today is cancelled before it fires;
   - in a browser: shows today's pings while the app is open.

   Workout pings follow the active program's training days (rest days
   stay quiet) and name the session. Check-in pings follow the coach's
   check-in rhythm or the user's own check-in day
   (calendar-sync.js checkInEvents). Nothing is sent in vacation or
   sick mode.

   Tapping a ping opens the matching screen.
   Settings › Coach reminders (#remindersPanel) turns each one on/off
   and sets its time and days.

   reminders_<user>: see coach-nudges-core.js.
   ============================================================= */

(function () {
  'use strict';

  const Core = () => window.CoachNudgesCore;
  const KEY = u => 'reminders_' + u;
  const COACH_KEY = u => 'reminderCoach_' + u; // last known coach name
  const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const DAY_LONG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function _user() {
    return (typeof window.getActiveUsername === 'function' && window.getActiveUsername())
      || window.currentUser || localStorage.getItem('fitnessAppUser') || '';
  }

  function _json(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
  }

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── Settings ─────────────────────────────────────────────── */

  function getSettings(u = _user()) {
    const C = Core();
    let saved = _json(KEY(u), null);
    if (!Array.isArray(saved)) {
      // First run: carry over the old "Daily reminder" time.
      const old = typeof window.getStoredUserSettings === 'function' ? (window.getStoredUserSettings() || {}) : {};
      if (old.streakReminderEnabled && old.streakReminderTime) saved = [{ id: 'workout', enabled: true, time: old.streakReminderTime }];
    }
    return C.normalizeSettings(saved);
  }

  function saveSettings(list) {
    const u = _user();
    if (!u) return;
    try { localStorage.setItem(KEY(u), JSON.stringify(list)); } catch { /* storage full */ }
    sync({ now: true });
  }

  /* ── What's done today, what's due ────────────────────────── */

  function _todayKey() { return Core().dateKey(Date.now()); }

  function _workoutDone(u, today) {
    const list = [..._json('workouts_' + u, []), ..._json('workoutHistory_' + u, [])];
    return list.some(w => {
      if (!w || String(w.date || '').slice(0, 10) !== today) return false;
      return typeof window.isWorkoutCompleted === 'function' ? window.isWorkoutCompleted(w) || w.completed === true : true;
    });
  }

  function _foodDone() {
    const FL = window.FoodLog;
    if (!FL || typeof FL.load !== 'function') return false;
    const day = typeof FL.today === 'function' ? FL.today() : _todayKey();
    try { return FL.load().some(e => e && e.date === day); } catch { return false; }
  }

  function _weighDone(u, today) {
    return _json('bodyweightLog_' + u, []).some(e => e && String(e.date || '').slice(0, 10) === today);
  }

  function _checkinDone(u, today) {
    const ce = window.checkinEngine;
    let list = [];
    try { list = ce && typeof ce.loadCheckIns === 'function' ? ce.loadCheckIns(u) : _json('tl_checkins_v1_' + u, []); } catch { list = []; }
    return (Array.isArray(list) ? list : []).some(c => c && String(c.date || '').slice(0, 10) === today);
  }

  function _training(u, now) {
    const cs = window.calendarSync;
    if (!cs || typeof cs.trainingEvents !== 'function') return null;
    try {
      const { events } = cs.trainingEvents(u, now);
      if (!events || !events.length) return null;
      return new Map(events.map(e => [e.date, e.title || '']));
    } catch { return null; }
  }

  function _checkinDates(u, now) {
    const cs = window.calendarSync;
    if (!cs || typeof cs.checkInEvents !== 'function') return [];
    try { return cs.checkInEvents(u, now).map(e => e.date); } catch { return []; }
  }

  function _coach(u) {
    const live = typeof window.activeCoachName === 'function' ? window.activeCoachName() : null;
    if (live === null) return localStorage.getItem(COACH_KEY(u)) || '';
    try { live ? localStorage.setItem(COACH_KEY(u), live) : localStorage.removeItem(COACH_KEY(u)); } catch { /* ignore */ }
    return live;
  }

  function _paused() {
    try {
      return Boolean((typeof window.getVacationMode === 'function' && window.getVacationMode().active)
        || (typeof window.getSickMode === 'function' && window.getSickMode().active));
    } catch { return false; }
  }

  function context(u = _user(), now = Date.now()) {
    const today = Core().dateKey(now);
    return {
      settings: getSettings(u),
      now,
      done: {
        workout: _workoutDone(u, today),
        food: _foodDone(),
        weighin: _weighDone(u, today),
        checkin: _checkinDone(u, today),
      },
      training: _training(u, now),
      checkinDates: _checkinDates(u, now),
      coach: _coach(u),
      paused: _paused(),
    };
  }

  function plan() {
    const u = _user();
    if (!u || !Core()) return [];
    return Core().planNudges(context(u));
  }

  /* ── Native: local notifications ──────────────────────────── */

  function notifier() {
    const c = window.Capacitor;
    if (!c || typeof c.isNativePlatform !== 'function' || !c.isNativePlatform()) return null;
    if (typeof c.isPluginAvailable === 'function' && !c.isPluginAvailable('LocalNotifications')) return null;
    return (c.Plugins && c.Plugins.LocalNotifications) || (typeof c.registerPlugin === 'function' ? c.registerPlugin('LocalNotifications') : null);
  }

  // 'granted' | 'denied' | 'prompt' | 'unsupported'
  async function permission() {
    const ln = notifier();
    if (ln) {
      try { const p = await ln.checkPermissions(); return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt'; } catch { return 'prompt'; }
    }
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission === 'default' ? 'prompt' : Notification.permission;
  }

  async function requestPermission() {
    const ln = notifier();
    if (ln) {
      try { const p = await ln.requestPermissions(); sync({ now: true }); return p.display === 'granted' ? 'granted' : 'denied'; } catch { return 'denied'; }
    }
    if (!('Notification' in window)) return 'unsupported';
    const r = await Notification.requestPermission();
    sync({ now: true });
    return r === 'default' ? 'prompt' : r;
  }

  let _lastSig = null;
  let _syncTimer = null;
  let _webTimers = [];

  async function _scheduleNative(ln, list) {
    const sig = _user() + '|' + JSON.stringify(list.map(p => [p.id, p.at, p.title, p.body]));
    if (sig === _lastSig) return;
    try {
      const perm = await ln.checkPermissions();
      if (!perm || perm.display !== 'granted') return;
      await ln.cancel({ notifications: Core().allIds().map(id => ({ id })) });
      if (list.length) {
        await ln.schedule({
          notifications: list.map(p => ({
            id: p.id, title: p.title, body: p.body,
            schedule: { at: new Date(p.at), allowWhileIdle: true },
            extra: { kind: 'coach-nudge', nudge: p.kind, tab: p.tab },
          })),
        });
      }
      _lastSig = sig;
    } catch (err) {
      console.warn('[CoachReminders] could not schedule', err);
    }
  }

  // Browser: only while the page is open, so just today's. Each one
  // re-checks at fire time that it still isn't done.
  function _scheduleWeb(list) {
    _webTimers.forEach(clearTimeout);
    _webTimers = [];
    if (!('Notification' in window)) return;
    const today = _todayKey();
    list.filter(p => p.date === today).forEach(p => {
      const delay = p.at - Date.now();
      if (delay <= 0 || delay > 2147483647) return;
      _webTimers.push(setTimeout(() => {
        if (Notification.permission !== 'granted') return;
        const still = plan().some(q => q.id === p.id);
        if (!still) return;
        try {
          const n = new Notification(p.title, { body: p.body, icon: '/favicon.ico', tag: 'pc-' + p.kind });
          n.onclick = () => { window.focus(); _open(p.kind, p.tab); n.close(); };
        } catch { /* not supported */ }
      }, delay));
    });
  }

  async function syncNow() {
    if (!Core()) return;
    const list = plan();
    const ln = notifier();
    if (ln) await _scheduleNative(ln, list);
    else _scheduleWeb(list);
  }

  // Debounced: several things can change at once.
  function sync({ now = false } = {}) {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(syncNow, now ? 50 : 800);
  }

  function _open(kind, tab) {
    if (typeof window.showTab === 'function' && tab) window.showTab(tab);
    if (kind === 'food' && typeof window.openFoodSearch === 'function') {
      setTimeout(() => window.openFoodSearch({}), 300);
    }
  }

  /** A test ping in five seconds, so the user sees what they'll get. */
  async function sendTest() {
    const C = Core();
    const msg = C.message('workout', { planned: false, coach: '' }, String(Date.now()));
    const ln = notifier();
    if (ln) {
      if ((await permission()) !== 'granted' && (await requestPermission()) !== 'granted') return false;
      await ln.schedule({ notifications: [{ id: C.ID_BASE - 1, title: msg.title, body: msg.body, schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true }, extra: { kind: 'coach-nudge', nudge: 'workout', tab: 'logTab' } }] });
      return true;
    }
    if (!('Notification' in window)) return false;
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return false;
    setTimeout(() => { try { new Notification(msg.title, { body: msg.body, icon: '/favicon.ico' }); } catch { /* ignore */ } }, 5000);
    return true;
  }

  /* ── Settings panel ───────────────────────────────────────── */

  function _nextLabel(list) {
    const next = list[0];
    if (!next) return '';
    const d = new Date(next.at);
    const today = _todayKey();
    const tomorrow = Core().dateKey(Date.now() + 86400000);
    const day = next.date === today ? 'Today' : next.date === tomorrow ? 'Tomorrow' : DAY_LONG[d.getDay()];
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `Next: ${day} ${time} · ${esc(next.title)}`;
  }

  async function renderRemindersPanel() {
    const container = document.getElementById('remindersPanel');
    if (!container || !Core()) return;
    const u = _user();
    const settings = getSettings(u);
    const ctx = context(u);
    const upcoming = Core().planNudges(ctx);
    const perm = await permission();
    const anyOn = settings.some(s => s.enabled);

    let html = '';
    if (perm === 'prompt' && anyOn) {
      html += '<div class="reminder-perm-banner">'
        + '<span>Allow notifications so your coach can ping you</span>'
        + '<button type="button" class="reminder-perm-btn" id="reminderPermBtn">Allow</button>'
        + '</div>';
    } else if (perm === 'denied' && anyOn) {
      html += '<div class="reminder-perm-banner denied">'
        + '<span>Notifications are off for Pocket Coach. Turn them on in your phone’s Settings to get reminders.</span>'
        + '</div>';
    } else if (ctx.paused && anyOn) {
      html += '<div class="reminder-perm-banner"><span>Paused while vacation or sick mode is on.</span></div>';
    } else if (perm === 'granted' && upcoming.length) {
      html += '<p class="reminder-next">' + _nextLabel(upcoming) + '</p>';
    }

    settings.forEach((s, i) => {
      const kind = Core().KINDS.find(k => k.id === s.id);
      let schedule;
      if (s.id === 'workout' && ctx.training) {
        schedule = '<div class="reminder-follows">Follows your program: training days only</div>';
      } else if (s.id === 'checkin') {
        schedule = '<div class="reminder-follows">' + (ctx.checkinDates.length
          ? 'Follows your check-in schedule' + (ctx.coach ? ' with ' + esc(ctx.coach) : '')
          : 'Starts after your first check-in') + '</div>';
      } else {
        schedule = '<div class="reminder-days">' + DAY_NAMES.map((name, d) =>
          '<button type="button" class="reminder-day' + (s.days.includes(d) ? ' active' : '') + '" data-idx="' + i + '" data-day="' + d + '" aria-pressed="' + s.days.includes(d) + '" aria-label="' + DAY_LONG[d] + '">' + name + '</button>').join('') + '</div>';
      }
      html += '<div class="reminder-item">'
        + '<div class="reminder-item-header">'
        + '<span class="reminder-item-label">' + esc(kind.label) + '<small class="reminder-item-sub">' + esc(kind.sub) + '</small></span>'
        + '<label class="reminder-toggle">'
        + '<input type="checkbox"' + (s.enabled ? ' checked' : '') + ' data-toggle-idx="' + i + '" aria-label="' + esc(kind.label) + '">'
        + '<span class="reminder-toggle-track"></span>'
        + '</label>'
        + '</div>'
        + (s.enabled ? '<div class="reminder-item-body">'
          + '<div class="reminder-time-row"><input type="time" class="reminder-time-input" value="' + s.time + '" data-time-idx="' + i + '" aria-label="' + esc(kind.label) + ' time"></div>'
          + schedule
          + '</div>' : '')
        + '</div>';
    });

    html += '<button type="button" class="sx-link reminder-test" id="reminderTestBtn">Send a test ping</button>';
    container.innerHTML = html;

    const rerender = () => renderRemindersPanel();
    document.getElementById('reminderPermBtn')?.addEventListener('click', async () => {
      await requestPermission();
      rerender();
    });
    document.getElementById('reminderTestBtn')?.addEventListener('click', async (e) => {
      const ok = await sendTest();
      const toast = window.showToast || window.nativeToast;
      if (typeof toast === 'function') toast(ok ? 'Test ping on its way (5 seconds)' : 'Allow notifications first', ok ? 'success' : 'error');
      if (!ok) rerender();
      e.target.blur();
    });

    container.querySelectorAll('[data-toggle-idx]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const list = getSettings();
        list[Number(cb.dataset.toggleIdx)].enabled = cb.checked;
        saveSettings(list);
        if (cb.checked && (await permission()) === 'prompt') await requestPermission();
        rerender();
      });
    });

    container.querySelectorAll('[data-time-idx]').forEach(input => {
      input.addEventListener('change', () => {
        if (!input.value) return;
        const list = getSettings();
        list[Number(input.dataset.timeIdx)].time = input.value;
        saveSettings(list);
        rerender();
      });
    });

    container.querySelectorAll('.reminder-day').forEach(btn => {
      btn.addEventListener('click', () => {
        const list = getSettings();
        const days = list[Number(btn.dataset.idx)].days;
        const d = Number(btn.dataset.day);
        const pos = days.indexOf(d);
        if (pos >= 0) days.splice(pos, 1); else days.push(d);
        saveSettings(list);
        rerender();
      });
    });
  }

  /* ── Wiring ───────────────────────────────────────────────── */

  // Tapping a ping opens the matching screen.
  (function listenForTaps() {
    const ln = notifier();
    if (!ln || typeof ln.addListener !== 'function') return;
    ln.addListener('localNotificationActionPerformed', (ev) => {
      const extra = ev && ev.notification && ev.notification.extra;
      if (!extra || extra.kind !== 'coach-nudge') return;
      setTimeout(() => _open(extra.nudge, extra.tab), 600);
    });
  })();

  // Re-plan when the app comes back, and when it leaves (so whatever was
  // just logged cancels today's ping before the app is suspended).
  document.addEventListener('visibilitychange', () => sync({ now: document.visibilityState === 'hidden' }));
  try {
    const App = window.Capacitor?.Plugins?.App;
    if (App && typeof App.addListener === 'function') {
      App.addListener('pause', () => syncNow());
      App.addListener('resume', () => sync());
    }
  } catch { /* not native */ }
  // New coach / check-in rhythm, settings, vacation or sick mode.
  document.addEventListener('pc:coach-sharing-changed', () => sync());
  window.addEventListener('traininglog:settings-saved', () => sync());
  // Data that marks something as done today.
  window.addEventListener('storage', () => sync());
  const fn = window.addWeightEntry;
  if (typeof fn === 'function' && !fn.__nudgeWrapped) {
    const wrapped = function () { const r = fn.apply(this, arguments); sync(); return r; };
    wrapped.__nudgeWrapped = true;
    window.addWeightEntry = wrapped;
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(() => sync(), 4000));

  window.renderRemindersPanel = renderRemindersPanel;
  window.requestReminderPermission = requestPermission;
  window.CoachNudges = { sync, syncNow, plan, context, getSettings, saveSettings, permission, requestPermission, sendTest, render: renderRemindersPanel };
})();
