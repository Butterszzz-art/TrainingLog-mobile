/* =============================================================
   LEADERBOARD
   - Improvement ①: Always-visible local personal-stats card
   - Improvement ②: Styled medal rank cards with progress bars
   - Improvement ③: "Your position" banner for logged-in user
   ============================================================= */

let leaderboardData = [];
let _currentSortKey  = 'workoutsLogged';
let barChart;
let lineChart;

/* ── Helpers ─────────────────────────────────────────────────── */

function getAuthHeaders() {
  if (typeof localStorage === 'undefined') return {};
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sum(arr) {
  return Array.isArray(arr) ? arr.reduce((t, n) => t + n, 0) : 0;
}

function _parse(k) {
  try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; }
}

function _username() {
  return (window.getActiveUsername && window.getActiveUsername()) ||
    localStorage.getItem('fitnessAppUser') ||
    localStorage.getItem('username') || '';
}

/* ── ① Local personal stats ─────────────────────────────────── */

function buildLocalStats(username) {
  if (!username) return null;

  const workouts    = _parse(`workouts_${username}`) || [];
  const prBoard     = _parse(`prBoard_${username}`)  || {};
  const weightLog   = _parse(`weightLog_${username}`) || _parse('weightEntries') || [];
  const readiness   = _parse('dailyReadiness_v1') || {};

  // Workout streak (vacation days count as "kept" so they don't break the streak)
  const workedDates   = new Set(workouts.map(w => w.date).filter(Boolean));
  const _isVacation   = typeof window.isVacationDate === 'function' ? window.isVacationDate : () => false;
  let streak = 0;
  const today = new Date();
  const check = new Date(today);
  check.setHours(0, 0, 0, 0);
  while (true) {
    const ds = check.toISOString().slice(0, 10);
    if (workedDates.has(ds) || _isVacation(ds)) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else {
      break;
    }
  }

  // Workouts this month
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd   = today.toISOString().slice(0, 10);
  const monthWorkouts = workouts.filter(w => w.date >= monthStart && w.date <= monthEnd).length;

  // Total volume (all time)
  let totalVolume = 0;
  for (const w of workouts) {
    for (const e of (w.log || [])) {
      const wts = e.weightsArray || [];
      const rps = e.repsArray    || [];
      for (let i = 0; i < rps.length; i++) totalVolume += (+wts[i] || 0) * (+rps[i] || 0);
    }
  }

  // Top PR by e1RM
  const topPR = Object.entries(prBoard)
    .map(([ex, pr]) => ({ ex, e1rm: pr.e1rm || 0, unit: pr.unit || 'kg' }))
    .sort((a, b) => b.e1rm - a.e1rm)[0] || null;

  // Average readiness (last 30 days)
  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - 29);
  const rsStr = rangeStart.toISOString().slice(0, 10);
  const rEntries = Object.entries(readiness)
    .filter(([k, v]) => !v.skipped && k >= rsStr);
  const avgReadiness = rEntries.length
    ? Math.round(rEntries.reduce((s, [, v]) => s + v.score, 0) / rEntries.length)
    : null;

  // Latest weight
  const lastWeight = weightLog.length ? weightLog[weightLog.length - 1] : null;

  return {
    username,
    streak,
    monthWorkouts,
    totalWorkouts: workouts.length,
    totalVolume:   Math.round(totalVolume),
    topPR,
    avgReadiness,
    lastWeight,
  };
}

function renderPersonalStats() {
  const el = document.getElementById('lbPersonalStats');
  if (!el) return;
  const username = _username();
  if (!username) {
    el.innerHTML = `<p class="lb-ps-note">Log in to see your personal stats.</p>`;
    return;
  }
  const s = buildLocalStats(username);
  if (!s) { el.innerHTML = ''; return; }

  const volStr = s.totalVolume >= 1000
    ? (s.totalVolume / 1000).toFixed(1) + 'k kg'
    : s.totalVolume + ' kg';

  const readStr = s.avgReadiness !== null
    ? `<span class="lb-ps-badge ${s.avgReadiness >= 67 ? 'green' : s.avgReadiness >= 40 ? 'amber' : 'red'}">${s.avgReadiness}%</span>`
    : '—';

  el.innerHTML = `
    <div class="lb-ps-header">
      <div class="lb-ps-avatar">${s.username.slice(0, 1).toUpperCase()}</div>
      <div class="lb-ps-name">
        <strong>${s.username}</strong>
        <span class="lb-ps-sub">Your stats (local)</span>
      </div>
      ${s.streak > 0 ? `<div class="lb-ps-streak">🔥 ${s.streak}</div>` : ''}
    </div>
    <div class="lb-ps-grid">
      <div class="lb-ps-stat">
        <span class="lb-ps-val">${s.monthWorkouts}</span>
        <span class="lb-ps-lbl">This month</span>
      </div>
      <div class="lb-ps-stat">
        <span class="lb-ps-val">${s.totalWorkouts}</span>
        <span class="lb-ps-lbl">All-time</span>
      </div>
      <div class="lb-ps-stat">
        <span class="lb-ps-val">${volStr}</span>
        <span class="lb-ps-lbl">Total volume</span>
      </div>
      <div class="lb-ps-stat">
        <span class="lb-ps-val">${readStr}</span>
        <span class="lb-ps-lbl">Avg readiness</span>
      </div>
    </div>
    ${s.topPR ? `<div class="lb-ps-pr">🏆 Top PR: <strong>${s.topPR.ex}</strong> — ${s.topPR.e1rm} ${s.topPR.unit} e1RM</div>` : ''}
    ${s.lastWeight ? `<div class="lb-ps-weight">⚖️ Last weight: <strong>${s.lastWeight.weight || s.lastWeight.kg || '—'} kg</strong> on ${s.lastWeight.date}</div>` : ''}
  `;
}

/* ── ② Medal rank cards ──────────────────────────────────────── */

function _medalIcon(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `<span class="lb-rank-num">#${rank}</span>`;
}

function _medalClass(rank) {
  if (rank === 1) return 'lb-card--gold';
  if (rank === 2) return 'lb-card--silver';
  if (rank === 3) return 'lb-card--bronze';
  return '';
}

function renderLeaderboard(sortKey = _currentSortKey) {
  _currentSortKey = sortKey;

  // Sync hidden select for JS compatibility
  const sel = document.getElementById('leaderSortStatic');
  if (sel) sel.value = sortKey;

  // Update pill active state
  document.querySelectorAll('.lb-sort-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sortKey);
  });

  const container = document.getElementById('leaderboardContainer');
  if (!container) return;
  if (!leaderboardData.length) { container.innerHTML = ''; return; }

  const sorted   = [...leaderboardData].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  const topValue = sorted[0]?.[sortKey] || 1;
  const username = _username();

  const cards = sorted.map((d, i) => {
    const rank    = i + 1;
    const value   = d[sortKey] || 0;
    const pct     = Math.round((value / topValue) * 100);
    const isMe    = username && d.name.toLowerCase() === username.toLowerCase();
    const initial = (d.name || '?').slice(0, 1).toUpperCase();

    return `
      <div class="lb-card ${_medalClass(rank)} ${isMe ? 'lb-card--me' : ''}"
           data-name="${d.name}"
           role="button" tabindex="0">
        <div class="lb-card-left">
          <div class="lb-card-medal">${_medalIcon(rank)}</div>
          <div class="lb-card-avatar">${initial}</div>
          <div class="lb-card-info">
            <span class="lb-card-name">${d.name}${isMe ? ' <span class="lb-you-tag">You</span>' : ''}</span>
            <div class="lb-card-bar-wrap">
              <div class="lb-card-bar" style="width:${pct}%"></div>
            </div>
          </div>
        </div>
        <div class="lb-card-value">${value}</div>
      </div>`;
  }).join('');

  container.innerHTML = cards;

  container.querySelectorAll('.lb-card').forEach(el => {
    el.addEventListener('click', () => {
      if (window.showUserStats) window.showUserStats(el.dataset.name);
    });
  });

  renderYourRankBanner(sorted, sortKey, username);
  renderCharts(sorted);
}

/* ── ③ Your position banner ──────────────────────────────────── */

function renderYourRankBanner(sorted, sortKey, username) {
  const el = document.getElementById('lbYourRank');
  if (!el) return;
  if (!username) { el.style.display = 'none'; return; }

  const idx = sorted.findIndex(d => d.name.toLowerCase() === username.toLowerCase());
  if (idx === -1) { el.style.display = 'none'; return; }

  const rank   = idx + 1;
  const d      = sorted[idx];
  const value  = d[sortKey] || 0;
  const total  = sorted.length;
  const above  = rank > 1 ? sorted[rank - 2] : null;
  const gap    = above ? (above[sortKey] || 0) - value : 0;

  const labelMap = { workoutsLogged: 'workouts', studyHours: 'study hrs', groupActivity: 'activities' };
  const unit = labelMap[sortKey] || sortKey;

  el.style.display = 'block';
  el.innerHTML = `
    <div class="lb-rank-banner">
      <div class="lb-rank-banner-left">
        <span class="lb-rank-banner-medal">${_medalIcon(rank)}</span>
        <div>
          <div class="lb-rank-banner-title">Your rank: <strong>#${rank}</strong> of ${total}</div>
          <div class="lb-rank-banner-sub">${value} ${unit}${gap > 0 ? ` &nbsp;·&nbsp; <span class="lb-gap">Need ${gap} more to reach #${rank - 1}</span>` : ' &nbsp;·&nbsp; <span class="lb-gap-top">You\'re #1! 🎉</span>'}</div>
        </div>
      </div>
    </div>`;
}

/* ── Charts ─────────────────────────────────────────────────── */

function renderCharts(data) {
  if (typeof Chart === 'undefined') return;
  const barCtx  = document.getElementById('lbBarChart');
  const lineCtx = document.getElementById('lbLineChart');
  if (!barCtx || !lineCtx) return;

  const labels  = data.map(d => d.name);
  const barData = data.map(d => sum(d.weeklyVolume));

  const chartDefaults = {
    color: '#b2dfdb',
    grid:  'rgba(255,255,255,0.06)',
    tick:  '#7a8f7d',
  };

  if (barChart) barChart.destroy();
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Weekly Volume',
        data: barData,
        backgroundColor: 'rgba(95,168,126,0.75)',
        borderColor:     '#5fa87e',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { color: chartDefaults.grid }, ticks: { color: chartDefaults.tick } },
        y: { grid: { color: chartDefaults.grid }, ticks: { color: chartDefaults.tick } },
      }
    }
  });

  const maxLen   = Math.max(...data.map(d => (d.progress || []).length), 1);
  const lineLbls = Array.from({ length: maxLen }, (_, i) => `W${i + 1}`);
  const palette  = ['#5fa87e','#81c784','#a5d6a7','#4db6ac','#80cbc4','#ffb74d','#ff8a65'];
  const lineSets = data.map((d, i) => ({
    label:       d.name,
    data:        d.progress || [],
    tension:     0.4,
    fill:        false,
    borderColor: palette[i % palette.length],
    pointBackgroundColor: palette[i % palette.length],
    pointRadius: 3,
  }));

  if (lineChart) lineChart.destroy();
  lineChart = new Chart(lineCtx, {
    type: 'line',
    data: { labels: lineLbls, datasets: lineSets },
    options: {
      responsive: true,
      plugins: { tooltip: { enabled: true }, legend: { labels: { color: chartDefaults.color } } },
      scales: {
        x: { grid: { color: chartDefaults.grid }, ticks: { color: chartDefaults.tick } },
        y: { grid: { color: chartDefaults.grid }, ticks: { color: chartDefaults.tick } },
      }
    }
  });
}

/* ── Fetch ───────────────────────────────────────────────────── */

async function fetchLeaderboard() {
  const spinner = document.getElementById('leaderboardLoading');
  const empty   = document.getElementById('leaderboardEmpty');
  if (spinner) spinner.style.display = 'flex';
  if (empty)   empty.style.display   = 'none';
  try {
    const res = await fetch(`${window.SERVER_URL}/leaderboard`, { headers: getAuthHeaders(), signal: AbortSignal.timeout(5000) });
    leaderboardData = await res.json();
  } catch (e) {
    console.warn('fetch leaderboard failed', e);
    leaderboardData = [];
  }
  if (spinner) spinner.style.display = 'none';
  if (!leaderboardData.length && empty) empty.style.display = 'block';
}

/* ── Init ───────────────────────────────────────────────────── */

function initLeaderboard() {
  // Always render personal stats first (local, instant)
  renderPersonalStats();

  // Wire sort pills
  document.querySelectorAll('.lb-sort-pill').forEach(btn => {
    btn.addEventListener('click', () => renderLeaderboard(btn.dataset.sort));
  });

  // Wire hidden select for compatibility
  const sel = document.getElementById('leaderSortStatic');
  if (sel) sel.onchange = () => renderLeaderboard(sel.value);

  // Fetch + render board
  fetchLeaderboard().then(() => renderLeaderboard(_currentSortKey));
}

if (typeof window !== 'undefined') {
  window.initLeaderboard = initLeaderboard;
}
