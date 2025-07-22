const sampleUserStats = {
  Alice: {
    profile: { name: 'Alice', goal: 'Build strength' },
    workouts: [
      { date: '2023-09-10', exercise: 'Squat', sets: 5, reps: 5, weight: 100 },
      { date: '2023-09-08', exercise: 'Bench Press', sets: 5, reps: 5, weight: 70 },
      { date: '2023-09-06', exercise: 'Deadlift', sets: 5, reps: 5, weight: 120 }
    ],
    volumeByExercise: {
      Squat: 2500,
      'Bench Press': 1750,
      Deadlift: 3000
    },
    weeklyVolume: [5000, 5200, 5300, 5500]
  },
  Bob: {
    profile: { name: 'Bob', goal: 'Hypertrophy focus' },
    workouts: [
      { date: '2023-09-11', exercise: 'Squat', sets: 4, reps: 8, weight: 90 },
      { date: '2023-09-09', exercise: 'Bench Press', sets: 4, reps: 8, weight: 65 },
      { date: '2023-09-07', exercise: 'Deadlift', sets: 4, reps: 8, weight: 110 }
    ],
    volumeByExercise: {
      Squat: 2880,
      'Bench Press': 2080,
      Deadlift: 3520
    },
    weeklyVolume: [4800, 5000, 4950, 5100]
  }
};

const sampleGroupStats = {
  1: {
    name: 'Alpha Team',
    description: 'Strength training group',
    activities: ['Alice posted a new workout', 'Bob shared a tip'],
    topContributors: [{ user: 'Alice', posts: 12 }, { user: 'Bob', posts: 8 }],
    exerciseVolume: { Squat: 12000, 'Bench Press': 9000, Deadlift: 15000 },
    weeklyVolume: [8000, 8500, 8700, 9200]
  },
  2: {
    name: 'Bravo Squad',
    description: 'General fitness enthusiasts',
    activities: ['Cara joined the group'],
    topContributors: [{ user: 'Cara', posts: 4 }],
    exerciseVolume: { Squat: 9000, 'Bench Press': 7000, Deadlift: 11000 },
    weeklyVolume: [6000, 6400, 6300, 6500]
  }
};

let userVolumeChart;
let groupVolumeChart;

function showUserStats(name) {
  const stats = sampleUserStats[name];
  if (!stats) return;
  const container = document.getElementById('userStatsContent');
  if (!container) return;
  const workouts = (stats.workouts || [])
    .map(w => `<tr><td>${w.date}</td><td>${w.exercise}</td><td>${w.sets}</td><td>${w.reps}</td><td>${w.weight}</td></tr>`)
    .join('');
  const volumes = Object.entries(stats.volumeByExercise || {})
    .map(([ex,v]) => `<tr><td>${ex}</td><td>${v}</td></tr>`).join('');
  container.innerHTML = `
    <h3>${stats.profile.name}</h3>
    <p>${stats.profile.goal}</p>
    <h4>Recent Workouts</h4>
    <table><tr><th>Date</th><th>Exercise</th><th>Sets</th><th>Reps</th><th>Weight</th></tr>${workouts}</table>
    <h4>Exercise Summary</h4>
    <table><tr><th>Exercise</th><th>Total Volume</th></tr>${volumes}</table>
    <canvas id="userVolumeChart"></canvas>
    <div style="margin-top:10px;"><button onclick="showTab('leaderboardTab')">Back to Leaderboard</button></div>
  `;
  showTab('userStatsTab');
  if (typeof Chart !== 'undefined') {
    const ctx = document.getElementById('userVolumeChart');
    if (ctx) {
      if (userVolumeChart) userVolumeChart.destroy();
      userVolumeChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: stats.weeklyVolume.map((_,i)=>`W${i+1}`),
          datasets: [{ label: 'Weekly Volume', data: stats.weeklyVolume, fill:false, tension:0.4 }]
        },
        options: { responsive:true, plugins:{ legend:{ display:false } } }
      });
    }
  }
}

function showGroupStats(id) {
  const stats = sampleGroupStats[id];
  if (!stats) return;
  const container = document.getElementById('groupStatsContent');
  if (!container) return;
  const activities = (stats.activities || []).map(a=>`<li>${a}</li>`).join('');
  const contributors = (stats.topContributors || [])
    .map(c=>`<li>${c.user} (${c.posts})</li>`).join('');
  const volumes = Object.entries(stats.exerciseVolume || {})
    .map(([ex,v])=>`<tr><td>${ex}</td><td>${v}</td></tr>`).join('');
  container.innerHTML = `
    <h3>${stats.name}</h3>
    <p>${stats.description}</p>
    <h4>Recent Activity</h4>
    <ul>${activities}</ul>
    <h4>Top Contributors</h4>
    <ul>${contributors}</ul>
    <h4>Exercise Totals</h4>
    <table><tr><th>Exercise</th><th>Total Volume</th></tr>${volumes}</table>
    <canvas id="groupVolumeChart"></canvas>
    <div style="margin-top:10px;"><button onclick="showTab('communityTab'); if(window.showCommunitySection) showCommunitySection('competition');">Back to Leaderboard</button></div>
  `;
  showTab('groupStatsTab');
  if (typeof Chart !== 'undefined') {
    const ctx = document.getElementById('groupVolumeChart');
    if (ctx) {
      if (groupVolumeChart) groupVolumeChart.destroy();
      groupVolumeChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: stats.weeklyVolume.map((_,i)=>`W${i+1}`),
          datasets: [{ label: 'Weekly Volume', data: stats.weeklyVolume, fill:false, tension:0.4 }]
        },
        options: { responsive:true, plugins:{ legend:{ display:false } } }
      });
    }
  }
}

if (typeof window !== 'undefined') {
  window.showUserStats = showUserStats;
  window.showGroupStats = showGroupStats;
}
if (typeof module !== 'undefined') {
  module.exports = { showUserStats, showGroupStats };
}
