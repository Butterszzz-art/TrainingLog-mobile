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
    const monday = _isoWeekStart();
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    const d = new Date(dateStr);
    return d >= monday && d <= sunday;
  }

  /* ── Data gathering ──────────────────────────────────────── */

  function _gatherWeekData(username) {
    const workouts = _parse(`workouts_${username}`) || [];
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
    const weekStart = _isoWeekStart().toISOString().slice(0, 10);
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
    const sortedDates = workouts.map(w => w.date).filter(Boolean).sort().reverse();
    const seen = new Set();
    sortedDates.forEach(d => seen.add(d));
    let check = new Date();
    check.setHours(0, 0, 0, 0);
    while (true) {
      const iso = check.toISOString().slice(0, 10);
      if (seen.has(iso)) { streak++; check.setDate(check.getDate() - 1); }
      else break;
    }

    // Calorie compliance: days this week where macros were within 10% of target
    const targets = _parse(`macroTargets_${username}`) || {};
    const calTarget = targets.calories || 0;
    let calDaysHit = 0;
    if (calTarget > 0) {
      const macroHistory = _parse(`macroHistory_${username}`) || {};
      weekDates.forEach(ds => {
        const iso = new Date(ds).toISOString?.().slice(0, 10) || ds;
        const entry = macroHistory[iso];
        if (entry?.calories) {
          const ratio = entry.calories / calTarget;
          if (ratio >= 0.85 && ratio <= 1.15) calDaysHit++;
        }
      });
    }

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

  function _readinessBadge(score) {
    if (score === null) return '<span class="ws-na">—</span>';
    if (score >= 67) return `<span class="ws-high">${score}%</span>`;
    if (score >= 40) return `<span class="ws-med">${score}%</span>`;
    return `<span class="ws-low">${score}%</span>`;
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
    const mon = _isoWeekStart();
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const workouts = _parse(`workouts_${username}`) || [];
    const workedDays = new Set(workouts.filter(w => _isThisWeek(w.date)).map(w => w.date));

    // Mini calendar dots
    const dots = dayNames.map((day, i) => {
      const d2 = new Date(mon);
      d2.setDate(d2.getDate() + i);
      const iso = d2.toISOString().slice(0, 10);
      const isToday = iso === new Date().toISOString().slice(0, 10);
      const worked  = workedDays.has(iso);
      return `<div class="ws-day ${worked ? 'worked' : ''} ${isToday ? 'today' : ''}">
        <span class="ws-day-name">${day}</span>
        <span class="ws-day-dot">${worked ? '●' : '○'}</span>
      </div>`;
    }).join('');

    host.innerHTML = `
      <div class="weekly-summary-card">
        <div class="ws-header">
          <span class="ws-title">📅 This Week</span>
          <span class="ws-subtitle">Week of ${mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        </div>
        <div class="ws-calendar">${dots}</div>
        <div class="ws-stats">
          <div class="ws-stat">
            <span class="ws-stat-val">${d.workoutCount}</span>
            <span class="ws-stat-lbl">Workouts</span>
          </div>
          <div class="ws-stat">
            <span class="ws-stat-val">${d.totalVolume > 0 ? (d.totalVolume >= 1000 ? (d.totalVolume / 1000).toFixed(1) + 'k' : d.totalVolume) : '—'}</span>
            <span class="ws-stat-lbl">kg volume</span>
          </div>
          <div class="ws-stat">
            <span class="ws-stat-val">${d.prsThisWeek > 0 ? '🏆 ' + d.prsThisWeek : '—'}</span>
            <span class="ws-stat-lbl">New PRs</span>
          </div>
          <div class="ws-stat">
            <span class="ws-stat-val">${d.streak > 0 ? '🔥 ' + d.streak : '0'}</span>
            <span class="ws-stat-lbl">Day streak</span>
          </div>
          <div class="ws-stat">
            <span class="ws-stat-val">${_readinessBadge(d.avgReadiness)}</span>
            <span class="ws-stat-lbl">Avg readiness</span>
          </div>
          ${d.calTarget ? `<div class="ws-stat">
            <span class="ws-stat-val">${d.calDaysHit}/7</span>
            <span class="ws-stat-lbl">Cal targets hit</span>
          </div>` : ''}
        </div>
        ${d.workoutCount === 0 ? '<p class="ws-empty">No workouts logged yet this week. Get after it! 💪</p>' : ''}
      </div>
    `;
  }

  /* ── Boot ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderWeeklySummaryCard, 1000);
  });

  window.renderWeeklySummaryCard = renderWeeklySummaryCard;

})();
