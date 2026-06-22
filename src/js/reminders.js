/* =============================================================
   REMINDERS & NOTIFICATIONS
   Local notification scheduling for workout reminders, weigh-in
   prompts, and streak maintenance. Uses Notification API for
   PWA and Capacitor Local Notifications for native.
   ============================================================= */

(function () {
  'use strict';

  const REMINDERS_KEY = () => 'reminders_' + (_user() || 'anon');

  function _user() {
    return window.currentUser || localStorage.getItem('fitnessAppUser') || '';
  }

  // ── Default reminder presets ────────────────────────────────

  const DEFAULT_REMINDERS = [
    { id: 'workout', label: 'Workout reminder', time: '17:00', days: [1,2,3,4,5], enabled: true, message: "Time to train! Don't break your streak 💪" },
    { id: 'weighin', label: 'Morning weigh-in', time: '07:30', days: [1,2,3,4,5,6,0], enabled: false, message: 'Step on the scale — consistency beats perfection ⚖️' },
    { id: 'sleep', label: 'Sleep log reminder', time: '22:00', days: [1,2,3,4,5,6,0], enabled: false, message: 'Log your sleep before bed 😴' },
    { id: 'water', label: 'Hydration check', time: '12:00', days: [1,2,3,4,5,6,0], enabled: false, message: 'Have you hit your water target today? 💧' },
  ];

  function getReminders() {
    try {
      const saved = JSON.parse(localStorage.getItem(REMINDERS_KEY()));
      if (Array.isArray(saved) && saved.length) return saved;
    } catch {}
    return JSON.parse(JSON.stringify(DEFAULT_REMINDERS));
  }

  function saveReminders(list) {
    localStorage.setItem(REMINDERS_KEY(), JSON.stringify(list));
    scheduleAll();
  }

  // ── Permission handling ─────────────────────────────────────

  function getPermissionStatus() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  async function requestPermission() {
    if (!('Notification' in window)) return 'unsupported';
    const result = await Notification.requestPermission();
    return result;
  }

  // ── Scheduling (using setTimeout for PWA) ───────────────────

  let _timers = [];

  function scheduleAll() {
    _timers.forEach(clearTimeout);
    _timers = [];

    const reminders = getReminders();
    const now = new Date();
    const today = now.getDay();

    reminders.forEach(r => {
      if (!r.enabled) return;
      if (!r.days.includes(today)) return;

      const [h, m] = r.time.split(':').map(Number);
      const target = new Date();
      target.setHours(h, m, 0, 0);

      let delay = target.getTime() - now.getTime();
      if (delay < 0) return; // already passed today

      const tid = setTimeout(() => {
        fireNotification(r);
      }, delay);
      _timers.push(tid);
    });
  }

  function fireNotification(reminder) {
    if (getPermissionStatus() !== 'granted') return;

    try {
      new Notification('Pocket Coach', {
        body: reminder.message,
        icon: '/favicon.ico',
        tag: 'pc-' + reminder.id,
        silent: false,
      });
    } catch {}
  }

  // ── Inactivity check (no workout in N days) ─────────────────

  function checkInactivity() {
    const user = _user();
    if (!user) return;
    const workouts = JSON.parse(localStorage.getItem('workouts_' + user) || '[]');
    if (!workouts.length) return;

    const sorted = workouts.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const lastDate = sorted[0]?.date;
    if (!lastDate) return;

    const daysSince = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);
    if (daysSince >= 3 && getPermissionStatus() === 'granted') {
      try {
        new Notification('Pocket Coach', {
          body: "You haven't trained in " + daysSince + " days. Time to get back at it!",
          icon: '/favicon.ico',
          tag: 'pc-inactivity',
        });
      } catch {}
    }
  }

  // ── Render reminders settings panel ─────────────────────────

  function renderRemindersPanel() {
    const container = document.getElementById('remindersPanel');
    if (!container) return;

    const reminders = getReminders();
    const perm = getPermissionStatus();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let html = '';

    // Permission banner
    if (perm === 'default') {
      html += '<div class="reminder-perm-banner">'
        + '<span>Enable notifications to get workout reminders</span>'
        + '<button class="reminder-perm-btn" id="reminderPermBtn">Enable</button>'
        + '</div>';
    } else if (perm === 'denied') {
      html += '<div class="reminder-perm-banner denied">'
        + '<span>Notifications blocked — enable in browser settings</span>'
        + '</div>';
    }

    reminders.forEach((r, i) => {
      const dayPills = dayNames.map((name, d) => {
        const active = r.days.includes(d) ? ' active' : '';
        return '<button class="reminder-day' + active + '" data-idx="' + i + '" data-day="' + d + '">' + name + '</button>';
      }).join('');

      html += '<div class="reminder-item">'
        + '<div class="reminder-item-header">'
        + '<span class="reminder-item-label">' + r.label + '</span>'
        + '<label class="reminder-toggle">'
        + '<input type="checkbox"' + (r.enabled ? ' checked' : '') + ' data-toggle-idx="' + i + '">'
        + '<span class="reminder-toggle-track"></span>'
        + '</label>'
        + '</div>'
        + '<div class="reminder-item-body' + (r.enabled ? '' : ' disabled') + '">'
        + '<div class="reminder-time-row">'
        + '<input type="time" class="reminder-time-input" value="' + r.time + '" data-time-idx="' + i + '">'
        + '</div>'
        + '<div class="reminder-days">' + dayPills + '</div>'
        + '<div class="reminder-msg">' + r.message + '</div>'
        + '</div></div>';
    });

    container.innerHTML = html;

    // Wire events
    document.getElementById('reminderPermBtn')?.addEventListener('click', async () => {
      await requestPermission();
      renderRemindersPanel();
    });

    container.querySelectorAll('[data-toggle-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = Number(cb.dataset.toggleIdx);
        const rem = getReminders();
        rem[idx].enabled = cb.checked;
        saveReminders(rem);
        renderRemindersPanel();
      });
    });

    container.querySelectorAll('[data-time-idx]').forEach(input => {
      input.addEventListener('change', () => {
        const idx = Number(input.dataset.timeIdx);
        const rem = getReminders();
        rem[idx].time = input.value;
        saveReminders(rem);
      });
    });

    container.querySelectorAll('.reminder-day').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const day = Number(btn.dataset.day);
        const rem = getReminders();
        const days = rem[idx].days;
        const pos = days.indexOf(day);
        if (pos >= 0) days.splice(pos, 1);
        else days.push(day);
        saveReminders(rem);
        renderRemindersPanel();
      });
    });
  }

  // ── Init ────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    scheduleAll();
    setTimeout(checkInactivity, 5000);
  });

  window.renderRemindersPanel = renderRemindersPanel;
  window.requestReminderPermission = requestPermission;
})();
