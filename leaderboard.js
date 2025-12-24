let leaderboardData = [];
let barChart;
let lineChart;

function getAuthHeaders() {
  if (typeof window !== 'undefined' && typeof window.getAuthHeaders === 'function') {
    return window.getAuthHeaders();
  }
  return {};
}

function sum(arr) {
  return Array.isArray(arr) ? arr.reduce((t, n) => t + n, 0) : 0;
}

async function fetchLeaderboard() {
  const spinner = document.getElementById('leaderboardLoading');
  const empty = document.getElementById('leaderboardEmpty');
  if (spinner) spinner.style.display = 'block';
  if (empty) empty.style.display = 'none';
  try {
    const res = await fetch(`${window.SERVER_URL}/leaderboard`, {
      headers: getAuthHeaders()
    });
    leaderboardData = await res.json();
  } catch (e) {
    console.warn('fetch leaderboard failed', e);
    leaderboardData = [];
  }
  if (spinner) spinner.style.display = 'none';
  if (!leaderboardData.length && empty) empty.style.display = 'block';
}

function renderLeaderboard(sortKey = 'workoutsLogged') {
  const container = document.getElementById('leaderboardContainer');
  if (!container) return;
  if (!leaderboardData.length) {
    container.innerHTML = '';
    return;
  }
  const data = [...leaderboardData].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  const rows = data.map((d, i) =>
    `<div class="leader-entry" data-name="${d.name}"><span>#${i + 1}</span><span><strong>${d.name}</strong></span><span>${d[sortKey]}</span></div>`
  ).join('');
  container.innerHTML = `<div class="leaderboard">${rows}</div>`;
  container.querySelectorAll('.leader-entry').forEach(el => {
    el.addEventListener('click', () => {
      if (window.showUserStats) window.showUserStats(el.dataset.name);
    });
  });
  renderCharts(data);
}

function renderCharts(data) {
  if (typeof Chart === 'undefined') return;
  const barCtx = document.getElementById('lbBarChart');
  const lineCtx = document.getElementById('lbLineChart');
  if (!barCtx || !lineCtx) return;
  const labels = data.map(d => d.name);
  const barData = data.map(d => sum(d.weeklyVolume));
  if (barChart) barChart.destroy();
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Weekly Volume', data: barData, backgroundColor: '#2F80ED' }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { enabled: true } } }
  });

  const maxLen = Math.max(...data.map(d => d.progress.length));
  const lineLabels = Array.from({ length: maxLen }, (_, i) => `W${i + 1}`);
  const lineSets = data.map(d => ({ label: d.name, data: d.progress, tension: .4, fill: false }));
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(lineCtx, {
    type: 'line',
    data: { labels: lineLabels, datasets: lineSets },
    options: { responsive: true, plugins: { tooltip: { enabled: true } } }
  });
}

function initLeaderboard() {
  const select = document.getElementById('leaderSortStatic');
  if (!select) return;
  select.onchange = () => renderLeaderboard(select.value);
  fetchLeaderboard().then(() => renderLeaderboard(select.value));
}

if (typeof window !== 'undefined') {
  window.initLeaderboard = initLeaderboard;
}
