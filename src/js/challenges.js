/* =============================================================
   MONTHLY CHALLENGES & MILESTONE BADGES
   - Monthly challenges reset on the 1st of each month
   - Milestone badges are permanent once earned
   Renders into #milestoneBadges on the Progress tab.
   ============================================================= */

(function initChallenges() {
  'use strict';

  const KEY = 'challengeData_v1';
  const MILESTONE_KEY = 'milestoneBadges_v1';

  /* ── Helpers ─────────────────────────────────────────────── */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') || '';
  }

  function _parse(k) {
    try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; }
  }

  function _thisMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function _thisWeekStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
    return d.toISOString().slice(0, 10);
  }

  /* ── Monthly challenge definitions ──────────────────────── */

  const CHALLENGES = [
    {
      id:   'month_workouts_12',
      icon: '🏋️',
      name: 'Iron Month',
      desc: 'Log 12 workouts this month',
      check: (stats) => ({ progress: Math.min(stats.monthWorkouts, 12), goal: 12 }),
    },
    {
      id:   'month_workouts_20',
      icon: '🔥',
      name: 'Grind Mode',
      desc: 'Log 20 workouts this month',
      check: (stats) => ({ progress: Math.min(stats.monthWorkouts, 20), goal: 20 }),
    },
    {
      id:   'week_workouts_5',
      icon: '⚡',
      name: 'Full Week',
      desc: 'Train 5 days in a single week',
      check: (stats) => ({ progress: Math.min(stats.weekWorkouts, 5), goal: 5 }),
    },
    {
      id:   'month_prs_3',
      icon: '🏆',
      name: 'PR Machine',
      desc: 'Set 3 new PRs this month',
      check: (stats) => ({ progress: Math.min(stats.monthPRs, 3), goal: 3 }),
    },
    {
      id:   'month_volume_100k',
      icon: '💪',
      name: 'Volume King',
      desc: 'Lift 100,000 kg total this month',
      check: (stats) => ({ progress: Math.min(stats.monthVolume, 100000), goal: 100000 }),
    },
    {
      id:   'readiness_5days',
      icon: '😴',
      name: 'Check-in Habit',
      desc: 'Log readiness 5 days this week',
      check: (stats) => ({ progress: Math.min(stats.weekReadinessDays, 5), goal: 5 }),
    },
    {
      id:   'month_streak_14',
      icon: '📅',
      name: 'Two Weeks Strong',
      desc: 'Reach a 14-day workout streak',
      check: (stats) => ({ progress: Math.min(stats.maxStreak, 14), goal: 14 }),
    },
  ];

  /* ── Milestone badge definitions ─────────────────────────── */

  const MILESTONES = [
    { id: 'first_workout',   icon: '🥇', name: 'First Rep',      desc: 'Log your first workout',           check: (s) => s.totalWorkouts >= 1 },
    { id: 'workouts_10',     icon: '💪', name: '10 Workouts',    desc: 'Complete 10 workouts',              check: (s) => s.totalWorkouts >= 10 },
    { id: 'workouts_25',     icon: '🌟', name: '25 Workouts',    desc: 'Complete 25 workouts',              check: (s) => s.totalWorkouts >= 25 },
    { id: 'workouts_50',     icon: '🔥', name: '50 Workouts',    desc: 'Complete 50 workouts',              check: (s) => s.totalWorkouts >= 50 },
    { id: 'workouts_100',    icon: '🏆', name: 'Century Club',   desc: 'Complete 100 workouts',             check: (s) => s.totalWorkouts >= 100 },
    { id: 'streak_7',        icon: '📅', name: 'Week Warrior',   desc: 'Achieve a 7-day workout streak',    check: (s) => s.maxStreak >= 7 },
    { id: 'streak_30',       icon: '🌙', name: 'Month of Grind', desc: 'Achieve a 30-day streak',           check: (s) => s.maxStreak >= 30 },
    { id: 'prs_3',           icon: '🥈', name: 'PR Getter',      desc: 'Set 3 personal records',            check: (s) => s.totalPRs >= 3 },
    { id: 'prs_10',          icon: '🥇', name: 'PR Legend',      desc: 'Set 10 personal records',           check: (s) => s.totalPRs >= 10 },
    { id: 'volume_1m',       icon: '⚡', name: 'Tonne Lifted',   desc: 'Lift 1,000,000 kg total',           check: (s) => s.totalVolume >= 1000000 },
    { id: 'readiness_logged',icon: '😴', name: 'Body Aware',     desc: 'Complete your first readiness check',check:(s)=> s.totalReadiness >= 1 },
    { id: 'measurements_5',  icon: '📏', name: 'Track It',       desc: 'Log 5 body measurement entries',    check: (s) => s.totalMeasurements >= 5 },
  ];

  /* ── Stats computation ───────────────────────────────────── */

  function _computeStats(username) {
    const workouts     = _parse(`workouts_${username}`) || [];
    const prBoard      = _parse(`prBoard_${username}`)  || {};
    const readiness    = _parse('dailyReadiness_v1')     || {};
    const measurements = _parse(`bodyMeasurements_${username}`) || [];

    const month    = _thisMonth();
    const weekStart = _thisWeekStart();
    const today    = new Date().toISOString().slice(0, 10);

    // Total & month & week workouts
    const totalWorkouts = workouts.length;
    const monthWorkouts = workouts.filter(w => (w.date || '').startsWith(month)).length;
    const weekWorkouts  = workouts.filter(w => (w.date || '') >= weekStart).length;

    // Total volume & monthly volume
    let totalVolume = 0, monthVolume = 0;
    for (const w of workouts) {
      for (const entry of (w.log || [])) {
        const weights = entry.weightsArray || [];
        const reps    = entry.repsArray    || [];
        for (let i = 0; i < reps.length; i++) {
          const vol = (+weights[i] || 0) * (+reps[i] || 0);
          totalVolume += vol;
          if ((w.date || '').startsWith(month)) monthVolume += vol;
        }
      }
    }

    // PRs
    const totalPRs = Object.keys(prBoard).length;
    const monthPRs = Object.values(prBoard).filter(p => (p.date || '').startsWith(month)).length;

    // Streak (longest ever & current)
    const workedDates = new Set(workouts.map(w => w.date).filter(Boolean));
    let maxStreak = 0, curStreak = 0;
    let check = new Date();
    check.setHours(0, 0, 0, 0);
    while (workedDates.has(check.toISOString().slice(0, 10))) {
      curStreak++;
      check.setDate(check.getDate() - 1);
    }
    // Compute max streak (simplified: iterate all dates)
    const sortedDates = [...workedDates].sort();
    let run = 0;
    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) { run = 1; continue; }
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diff = (curr - prev) / 86400000;
      run = diff === 1 ? run + 1 : 1;
      if (run > maxStreak) maxStreak = run;
    }
    if (curStreak > maxStreak) maxStreak = curStreak;

    // Readiness
    const totalReadiness = Object.values(readiness).filter(e => !e.skipped).length;
    const weekReadinessDays = Object.entries(readiness)
      .filter(([k, v]) => !v.skipped && new Date(k).toISOString?.().slice(0, 10) >= weekStart).length;

    return {
      totalWorkouts, monthWorkouts, weekWorkouts,
      totalVolume: Math.round(totalVolume),
      monthVolume: Math.round(monthVolume),
      totalPRs, monthPRs,
      maxStreak, curStreak,
      totalReadiness, weekReadinessDays,
      totalMeasurements: measurements.length,
    };
  }

  /* ── Render ──────────────────────────────────────────────── */

  function renderChallenges() {
    const host = document.getElementById('milestoneBadges');
    if (!host) return;

    const username = _user();
    const stats = _computeStats(username);
    const month = _thisMonth();

    // Load earned milestones from storage
    let earned = _parse(MILESTONE_KEY) || {};

    // Check and award milestones
    let newlyEarned = [];
    for (const m of MILESTONES) {
      if (!earned[m.id] && m.check(stats)) {
        earned[m.id] = { awardedAt: Date.now(), month };
        newlyEarned.push(m);
      }
    }
    if (newlyEarned.length) {
      localStorage.setItem(MILESTONE_KEY, JSON.stringify(earned));
    }

    // Challenge progress bars
    const challengeHTML = CHALLENGES.map(c => {
      const { progress, goal } = c.check(stats);
      const pct     = Math.round((progress / goal) * 100);
      const done    = progress >= goal;
      const display = goal >= 1000
        ? `${Math.round(progress / 1000)}k / ${goal / 1000}k`
        : `${progress} / ${goal}`;
      return `
        <div class="challenge-card ${done ? 'done' : ''}">
          <div class="challenge-top">
            <span class="challenge-icon">${c.icon}</span>
            <div class="challenge-info">
              <span class="challenge-name">${c.name} ${done ? '✓' : ''}</span>
              <span class="challenge-desc">${c.desc}</span>
            </div>
            <span class="challenge-count">${display}</span>
          </div>
          <div class="challenge-bar-track">
            <div class="challenge-bar-fill ${done ? 'done' : ''}" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');

    // Milestone badges grid
    const milestoneHTML = MILESTONES.map(m => {
      const isEarned = !!earned[m.id];
      const when     = isEarned ? new Date(earned[m.id].awardedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
      return `
        <div class="milestone-badge ${isEarned ? 'earned' : 'locked'}" title="${m.desc}${when ? '\nEarned: ' + when : ''}">
          <span class="milestone-icon">${isEarned ? m.icon : '🔒'}</span>
          <span class="milestone-name">${m.name}</span>
          ${isEarned ? `<span class="milestone-earned-tag">Earned</span>` : `<span class="milestone-locked-tag">${m.desc.slice(0, 28)}</span>`}
        </div>
      `;
    }).join('');

    host.innerHTML = `
      <details class="challenges-section" open>
        <summary class="challenges-summary">🎯 Monthly Challenges — ${month}</summary>
        <div class="challenges-list">${challengeHTML}</div>
      </details>
      <details class="challenges-section" open>
        <summary class="challenges-summary">🏅 Milestone Badges</summary>
        <div class="milestone-grid">${milestoneHTML}</div>
      </details>
    `;

    // Celebrate newly earned milestones
    if (newlyEarned.length) {
      setTimeout(() => _celebrateMilestone(newlyEarned[0]), 400);
    }
  }

  function _celebrateMilestone(m) {
    const el = document.createElement('div');
    el.className = 'milestone-celebrate';
    el.innerHTML = `
      <div class="mc-box">
        <div class="mc-icon">${m.icon}</div>
        <div class="mc-title">Badge Unlocked!</div>
        <div class="mc-name">${m.name}</div>
        <div class="mc-desc">${m.desc}</div>
        <button class="mc-close" onclick="this.closest('.milestone-celebrate').remove()">Nice!</button>
      </div>
    `;
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 8000);
  }

  /* ── Boot ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderChallenges, 1500);
  });

  window.renderChallenges = renderChallenges;

})();
