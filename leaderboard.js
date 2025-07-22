const sampleLeaders = [
  { name: 'User A', workoutsLogged: 25, studyHours: 40, groupActivity: 300 },
  { name: 'User B', workoutsLogged: 30, studyHours: 35, groupActivity: 280 },
  { name: 'User C', workoutsLogged: 20, studyHours: 50, groupActivity: 320 }
];

function renderLeaderboard(sortKey = 'workoutsLogged') {
  const container = document.getElementById('leaderboardContainer');
  if (!container) return;
  const data = [...sampleLeaders].sort((a,b) => (b[sortKey]||0) - (a[sortKey]||0));
  const rows = data.map((d,i) =>
    `<div class="leader-entry" data-name="${d.name}"><span>#${i+1}</span><span><strong>${d.name}</strong></span><span>${d[sortKey]}</span></div>`
  ).join('');
  container.innerHTML = `<div class="leaderboard">${rows}</div>`;
  container.querySelectorAll('.leader-entry').forEach(el => {
    el.addEventListener('click', () => alert(`Clicked ${el.dataset.name}`));
  });
}

function initLeaderboard() {
  const select = document.getElementById('leaderSortStatic');
  if (!select) return;
  select.onchange = () => renderLeaderboard(select.value);
  renderLeaderboard(select.value);
}

if (typeof window !== 'undefined') {
  window.initLeaderboard = initLeaderboard;
}

