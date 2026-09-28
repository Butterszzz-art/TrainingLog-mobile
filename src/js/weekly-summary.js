/* =============================================================
   WEEKLY SUMMARY CARD
   Renders a "this week at a glance" card on the home dashboard.
   Pulls data from workouts, PRs, readiness, and macro logs.
   ============================================================= */

(function initWeeklySummary() {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────── */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') || '';
  }

  function _parse(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
  }

  function _isoWeekStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1)); // Monday
    return d;
  }

  function _isThisWeek(dateStr) {
    if (!dateStr) return false;
    // Compare local YYYY-MM-DD keys: new Date('2026-09-28') is UTC midnight,
    // which lands on the previous day anywhere west of UTC.
    const key = _entryKey(dateStr);
    if (!key) return false;
    const monday = _isoWeekStart();
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return key >= _toDateKey(monday) && key <= _toDateKey(sunday);
  }

  function _pad(n) { return String(n).padStart(2, '0'); }

  /** Local-time YYYY-MM-DD key (toISOString() would shift the day outside UTC). */
  function _toDateKey(d) {
    return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
  }

  /** Normalise any stored date (YYYY-MM-DD, ISO timestamp, toDateString) to a local key. */
  function _entryKey(value) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    return isNaN(d) ? null : _toDateKey(d);
  }

  /**
   * Count the days in `dayKeys` whose logged calories land within 0.85–1.15
   * of `calTarget`. macroHistory is an array of { date, meals, totals } with
   * one entry per save (see addMacroHistoryEntry in index.html); the older
   * object-keyed-by-date shape is tolerated too. Last save of a day wins.
   */
  function _countCalTargetDays(history, calTarget, dayKeys) {
    if (!(calTarget > 0) || !history) return 0;
    const list = Array.isArray(history)
      ? history
      : Object.entries(history).map(([date, v]) => ({ date, ...(v || {}) }));
    const byDay = {};
    list.forEach(e => {
      const day = _entryKey(e && e.date);
      if (!day) return;
      const kcal = parseFloat((e.totals || e).calories);
      if (Number.isFinite(kcal) && kcal > 0) byDay[day] = kcal;
    });
    return dayKeys.filter(day => {
      const kcal = byDay[day];
      if (!kcal) return false;
      const ratio = kcal / calTarget;
      return ratio >= 0.85 && ratio <= 1.15;
    }).length;
  }

  /* ── Data gathering ──────────────────────────────────────── */

  function _gatherWeekData(username) {
    // workouts_{user} alone only covers a rolling ~7 days (older entries
    // move to workoutHistory_{user} — see archiveOldWorkouts.js). That
    // window is normally enough to cover the current calendar week, but
    // using the merged store keeps this correct at timezone/DST edges
    // and consistent with the other consumers of workout history.
    const workouts = (window.getAllWorkoutsForUser && window.getAllWorkoutsForUser(username)) || [];
    const thisWeek = workouts.filter(w => _isThisWeek(w.date));

    // Volume & sets
    let totalVolume = 0, totalSets = 0;
    for (const w of thisWeek) {
      for (const entry of (w.log || [])) {
        const weights = entry.weightsArray || [];
        const reps    = entry.repsArray    || [];
        for (let i = 0; i < reps.length; i++) {
          const wt = +weights[i] || 0;
          const rp = +reps[i]   || 0;
          if (wt > 0 && rp > 0) {
            totalVolume += wt * rp;
            totalSets++;
          }
        }
      }
    }

    // PRs set this week
    const prBoard = _parse(`prBoard_${username}`) || {};
    let prsThisWeek = 0;
    const weekStart = _toDateKey(_isoWeekStart());
    for (const ex of Object.values(prBoard)) {
      if (ex.date && ex.date >= weekStart) prsThisWeek++;
    }

    // Readiness — avg this week
    const readiness = _parse('dailyReadiness_v1') || {};
    const weekDates = [];
    const mon = _isoWeekStart();
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(d.getDate() + i);
      weekDates.push(d.toDateString());
    }
    const readinessEntries = weekDates
      .map(k => readiness[k])
      .filter(e => e && !e.skipped && e.score != null);
    const avgReadiness = readinessEntries.length
      ? Math.round(readinessEntries.reduce((s, e) => s + e.score, 0) / readinessEntries.length)
      : null;

    // Streak
    let streak = 0;
    const seen = new Set(workouts.map(w => _entryKey(w.date)).filter(Boolean));
    let check = new Date();
    check.setHours(0, 0, 0, 0);
    while (true) {
      if (seen.has(_toDateKey(check))) { streak++; check.setDate(check.getDate() - 1); }
      else break;
    }

    // Calorie compliance: days this week where calories were within ±15% of target
    const targets = _parse(`macroTargets_${username}`) || {};
    const calTarget = targets.calories || 0;
    const weekDayKeys = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(d.getDate() + i);
      weekDayKeys.push(_toDateKey(d));
    }
    const calDaysHit = _countCalTargetDays(_parse(`macroHistory_${username}`), calTarget, weekDayKeys);

    return {
      workoutCount:  thisWeek.length,
      totalVolume:   Math.round(totalVolume),
      totalSets,
      prsThisWeek,
      avgReadiness,
      streak,
      calDaysHit,
      calTarget: calTarget > 0,
    };
  }

  /* ── Render ──────────────────────────────────────────────── */

  /** Planned sessions per week from the training profile (0 = not set). */
  function _weekTarget(username) {
    const settings = _parse(`settings_${username}`) || {};
    const n = parseInt(settings.profile && settings.profile.daysPerWeek, 10);
    return n > 0 && n <= 7 ? n : 0;
  }

  function _readinessTone(score) {
    if (score === null) return '';
    if (score >= 67) return 'is-good';
    if (score >= 40) return 'is-mid';
    return 'is-low';
  }

  function _fmtVolume(v) {
    if (!(v > 0)) return '—';
    return v >= 1000 ? `${(v / 1000).toFixed(1)}<small>k</small>` : String(v);
  }

  function _stat(value, label, tone) {
    return `<div class="wk-stat">
      <span class="wk-stat-v ${tone || ''}">${value}</span>
      <span class="wk-cap">${label}</span>
    </div>`;
  }

  function renderWeeklySummaryCard() {
    const host = document.getElementById('weeklySummaryCard');
    if (!host) return;

    const username = _user();
    if (!username) {
      host.innerHTML = '';
      return;
    }

    const d = _gatherWeekData(username);
    const target = _weekTarget(username);
    const mon = _isoWeekStart();
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    const fmt = dt => dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    const workouts = (window.getAllWorkoutsForUser && window.getAllWorkoutsForUser(username)) || [];
    const workedDays = new Set(workouts.map(w => _entryKey(w.date)).filter(Boolean));
    const todayKey = _toDateKey(new Date());
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    const strip = dayNames.map((name, i) => {
      const day = new Date(mon);
      day.setDate(day.getDate() + i);
      const key = _toDateKey(day);
      const done = workedDays.has(key);
      const today = key === todayKey;
      const cls = `wk-day${done ? ' is-done' : ''}${today ? ' is-today' : ''}`;
      const aria = `${name}${today ? ' (today)' : ''}: ${done ? 'trained' : 'no session'}`;
      return `<li class="${cls}" aria-label="${aria}">
        <span class="wk-bar"></span>
        <span class="wk-cap" aria-hidden="true">${name[0]}</span>
      </li>`;
    }).join('');

    const hitTarget = target > 0 && d.workoutCount >= target;
    const stats = [
      _stat(_fmtVolume(d.totalVolume), 'kg volume'),
      _stat(d.prsThisWeek > 0 ? d.prsThisWeek : '—', d.prsThisWeek === 1 ? 'New PR' : 'New PRs', d.prsThisWeek > 0 ? 'is-pr' : ''),
      _stat(d.avgReadiness === null ? '—' : d.avgReadiness, 'Readiness', _readinessTone(d.avgReadiness)),
      d.calTarget ? _stat(`${d.calDaysHit}<small>/7</small>`, 'Cal days') : '',
    ].join('');

    host.innerHTML = `
      <div class="wk-board">
        <div class="wk-top">
          <div class="wk-hero">
            <div class="wk-hero-num${hitTarget ? ' is-hit' : ''}">
              <span class="wk-hero-val">${d.workoutCount}</span>${target ? `<span class="wk-hero-of">/${target}</span>` : ''}
            </div>
            <span class="wk-cap">${d.workoutCount === 1 ? 'Session' : 'Sessions'}</span>
            ${d.streak > 0 ? `<span class="wk-cap wk-streak">${d.streak}-day streak</span>` : ''}
          </div>
          <div class="wk-week">
            <span class="wk-cap wk-range">${fmt(mon)} – ${fmt(sun)}</span>
            <ol class="wk-strip" aria-label="Days trained this week">${strip}</ol>
          </div>
        </div>
        <div class="wk-stats">${stats}</div>
        ${d.workoutCount === 0 ? '<p class="wk-empty">No sessions yet this week. Today\'s a good day to start.</p>' : ''}
      </div>
    `;
  }

  /* ── Boot ─────────────────────────────────────────────────── */

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { _countCalTargetDays, _toDateKey };
  }

  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderWeeklySummaryCard, 1000);

    // Re-render on return to Home so a session logged elsewhere shows up.
    document.addEventListener('traininglog:tab-changed', (e) => {
      if (e.detail?.tab === 'homeTab') renderWeeklySummaryCard();
    });
  });

  window.renderWeeklySummaryCard = renderWeeklySummaryCard;

})();
