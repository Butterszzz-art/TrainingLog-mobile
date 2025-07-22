// Exercise-specific leaderboard with sample data

const sampleExerciseLeaderboard = {
  Squat: {
    weekly: [
      { user: 'Alice', volume: 3000, sets: 12, reps: 60, sessions: 3 },
      { user: 'Bob', volume: 2800, sets: 12, reps: 60, sessions: 3 },
      { user: 'Cara', volume: 2500, sets: 10, reps: 50, sessions: 2 }
    ],
    monthly: [
      { user: 'Alice', volume: 12000, sets: 48, reps: 240, sessions: 12 },
      { user: 'Bob', volume: 11000, sets: 45, reps: 225, sessions: 11 },
      { user: 'Cara', volume: 9000, sets: 40, reps: 200, sessions: 10 }
    ],
    all: [
      { user: 'Alice', volume: 48000, sets: 192, reps: 960, sessions: 48 },
      { user: 'Bob', volume: 44000, sets: 180, reps: 900, sessions: 45 },
      { user: 'Cara', volume: 36000, sets: 160, reps: 800, sessions: 40 }
    ]
  },
  'Bench Press': {
    weekly: [
      { user: 'Alice', volume: 2400, sets: 12, reps: 60, sessions: 3 },
      { user: 'Bob', volume: 2300, sets: 12, reps: 60, sessions: 3 },
      { user: 'Cara', volume: 2100, sets: 10, reps: 50, sessions: 2 }
    ],
    monthly: [
      { user: 'Alice', volume: 9600, sets: 48, reps: 240, sessions: 12 },
      { user: 'Bob', volume: 9200, sets: 46, reps: 230, sessions: 11 },
      { user: 'Cara', volume: 8400, sets: 40, reps: 200, sessions: 10 }
    ],
    all: [
      { user: 'Alice', volume: 38400, sets: 192, reps: 960, sessions: 48 },
      { user: 'Bob', volume: 36800, sets: 184, reps: 920, sessions: 46 },
      { user: 'Cara', volume: 33600, sets: 160, reps: 800, sessions: 40 }
    ]
  },
  Deadlift: {
    weekly: [
      { user: 'Alice', volume: 3500, sets: 10, reps: 50, sessions: 2 },
      { user: 'Bob', volume: 3400, sets: 10, reps: 50, sessions: 2 },
      { user: 'Cara', volume: 3000, sets: 8, reps: 40, sessions: 2 }
    ],
    monthly: [
      { user: 'Alice', volume: 14000, sets: 40, reps: 200, sessions: 8 },
      { user: 'Bob', volume: 13600, sets: 40, reps: 200, sessions: 8 },
      { user: 'Cara', volume: 12000, sets: 32, reps: 160, sessions: 6 }
    ],
    all: [
      { user: 'Alice', volume: 56000, sets: 160, reps: 800, sessions: 32 },
      { user: 'Bob', volume: 54400, sets: 160, reps: 800, sessions: 32 },
      { user: 'Cara', volume: 48000, sets: 128, reps: 640, sessions: 24 }
    ]
  }
};

function populateExerciseLbSelect() {
  const sel = document.getElementById('exerciseLbSelect');
  if (!sel) return;
  const options = Object.keys(sampleExerciseLeaderboard)
    .map(e => `<option value="${e}">${e}</option>`).join('');
  sel.innerHTML = options;
}

function renderExerciseLeaderboard() {
  const exSel = document.getElementById('exerciseLbSelect');
  const timeSel = document.getElementById('exerciseLbTime');
  const container = document.getElementById('exerciseLeaderboardContainer');
  if (!exSel || !timeSel || !container) return;
  const ex = exSel.value;
  const tf = timeSel.value;
  const data = (sampleExerciseLeaderboard[ex] && sampleExerciseLeaderboard[ex][tf]) || [];
  if (!data.length) {
    container.innerHTML = '<p>No data available.</p>';
    return;
  }
  const rows = data.map((d,i) => `
    <div class="leader-entry">
      <span>#${i + 1}</span>
      <span><strong>${d.user}</strong></span>
      <span>${d.volume.toLocaleString()} kg</span>
      <span>${d.sets} sets / ${d.reps} reps</span>
      <span>${d.sessions} sessions</span>
    </div>
  `).join('');
  container.innerHTML = `<div class="leaderboard">${rows}</div>`;
}

function initExerciseLeaderboard() {
  populateExerciseLbSelect();
  const exSel = document.getElementById('exerciseLbSelect');
  const timeSel = document.getElementById('exerciseLbTime');
  if (!exSel || !timeSel) return;
  exSel.onchange = renderExerciseLeaderboard;
  timeSel.onchange = renderExerciseLeaderboard;
  renderExerciseLeaderboard();
}

if (typeof window !== 'undefined') {
  window.initExerciseLeaderboard = initExerciseLeaderboard;
}
