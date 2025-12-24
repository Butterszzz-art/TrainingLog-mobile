// Groups array and localStorage handling
let groups = [];
if (typeof localStorage !== 'undefined') {
  groups = JSON.parse(localStorage.getItem('communityGroups')) || [];
  groups = normalizeGroups(groups);
}

const serverUrl = (typeof window !== 'undefined' && window.SERVER_URL) ||
  'https://traininglog-backend.onrender.com';

function getAuthHeaders() {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Sample data used for prototype leaderboards
const sampleExerciseData = {
  Squat: [
    { user: 'Alice', volume: 12000, sets: 50, reps: 200 },
    { user: 'Bob', volume: 11000, sets: 45, reps: 180 },
    { user: 'Cara', volume: 9000, sets: 40, reps: 160 }
  ],
  'Bench Press': [
    { user: 'Alice', volume: 8000, sets: 40, reps: 160 },
    { user: 'Bob', volume: 7500, sets: 38, reps: 150 },
    { user: 'Cara', volume: 7000, sets: 35, reps: 140 }
  ],
  Deadlift: [
    { user: 'Alice', volume: 14000, sets: 45, reps: 180 },
    { user: 'Bob', volume: 13500, sets: 42, reps: 170 },
    { user: 'Cara', volume: 12000, sets: 40, reps: 160 }
  ]
};

function normalizeMember(member) {
  if (!member) return null;
  if (typeof member === 'string') {
    return { userId: member };
  }
  if (typeof member === 'object') {
    if (!member.userId) {
      if (member.id) member.userId = member.id;
      if (member.username) member.userId = member.username;
    }
    return member;
  }
  return null;
}

function normalizeGroup(group) {
  if (!group) return group;
  if (Array.isArray(group.members)) {
    group.members = group.members
      .map(normalizeMember)
      .filter(Boolean);
  } else {
    group.members = [];
  }
  return group;
}

function normalizeGroups(list = []) {
  return list.map(g => normalizeGroup({ ...g }));
}

function saveGroups() {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('communityGroups', JSON.stringify(groups));
  }
}

// Async createGroup to call backend or fallback to local
async function createGroup(name, goal = '', tags = []) {
  if (!name) return null;
  if (typeof fetch !== 'undefined' && window && window.currentUser) {
    try {
      const res = await fetch(`${window.SERVER_URL}/community/groups`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  body: JSON.stringify({ name, creatorId: window.currentUser, goal, tags })
});
      const g = normalizeGroup(await res.json());
      groups.push(g);
      saveGroups();
      return g;
    } catch (e) {
      console.warn('createGroup failed', e);
    }
  }
  // fallback local group creation
  const g = normalizeGroup({ id: Date.now(), name, goal, tags, members: [], posts: [] });
  groups.push(g);
  saveGroups();
  return g;
}

function getGroups() {
  return groups;
}

async function fetchGroups(userId) {
  if (!userId || typeof fetch === 'undefined') return getGroups();
  try {
    const res = await fetch(`${window.SERVER_URL}/community/groups?userId=${encodeURIComponent(userId)}`, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      groups = normalizeGroups(await res.json());
      saveGroups();
    }
  } catch (e) {
    console.warn('fetchGroups failed', e);
  }
  return groups;
}

async function searchGroups(opts = {}) {
  const params = new URLSearchParams();
  if (opts.goal) params.set('goal', opts.goal);
  if (opts.tag) params.set('tag', opts.tag);
  if (opts.search) params.set('search', opts.search);
  try {
    const res = await fetch(`${window.SERVER_URL}/community/groups?${params.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      groups = normalizeGroups(await res.json());
      saveGroups();
    }
  } catch (e) {
    console.warn('searchGroups failed', e);
  }
  return groups;
}

function filterGroups(list, opts = {}) {
  return list.filter(g => {
    if (opts.goal && !(g.goal || '').toLowerCase().includes(opts.goal.toLowerCase())) return false;
    if (opts.tag && !(g.tags || []).some(t => t.toLowerCase().includes(opts.tag.toLowerCase()))) return false;
    if (opts.search) {
      const term = opts.search.toLowerCase();
      const inName = (g.name || '').toLowerCase().includes(term);
      const inGoal = (g.goal || '').toLowerCase().includes(term);
      const inTags = (g.tags || []).some(t => t.toLowerCase().includes(term));
      if (!inName && !inGoal && !inTags) return false;
    }
    return true;
  });
}

function getLastActiveDate(g) {
  if (Array.isArray(g.posts) && g.posts.length) {
    const last = g.posts[g.posts.length - 1];
    return new Date(last.date).getTime();
  }
  return 0;
}

function sortGroups(list, mode) {
  const sorted = [...list];
  if (mode === 'members') {
    sorted.sort((a, b) => (b.members?.length || 0) - (a.members?.length || 0));
  } else if (mode === 'active') {
    sorted.sort((a, b) => getLastActiveDate(b) - getLastActiveDate(a));
  } else if (mode === 'alpha') {
    sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }
  return sorted;
}

async function fetchPosts(groupId) {
  try {
    const res = await fetch(`${window.SERVER_URL}/community/groups/${groupId}/posts`, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const posts = await res.json();
      const g = groups.find(gr => gr.id === groupId);
      if (g) {
        g.posts = posts;
        saveGroups();
      }
      return posts;
    }
  } catch (e) {
    console.warn('fetchPosts failed', e);
  }
  const g = groups.find(gr => gr.id === groupId);
  return (g && g.posts) || [];
}

async function inviteUserToGroup(groupId, invitedUserId) {
  if (!invitedUserId || typeof fetch === 'undefined') return;
  try {
    const res = await fetch(`${window.SERVER_URL}/community/groups/${groupId}/invite`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ invitedUserId })
    });
    if (res.ok) {
      const g = groups.find(gr => gr.id === groupId);
      if (g) {
        if (!Array.isArray(g.members)) g.members = [];
        if (!isMemberOf(g, invitedUserId)) {
          g.members.push({ userId: invitedUserId, invitedAt: new Date().toISOString() });
          saveGroups();
        }
      }
      alert('Invitation sent');
      openGroup(groupId);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Failed to invite user');
    }
  } catch (e) {
    console.warn('inviteUserToGroup failed', e);
    alert('Failed to invite user');
  }
}

async function shareProgramToGroup(groupId, programData) {
  if (!programData || typeof fetch === 'undefined' || !window.currentUser) return;
  try {
    const res = await fetch(`${window.SERVER_URL}/community/groups/${groupId}/share`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ senderId: window.currentUser, programData })
    });
    if (res.ok) {
      alert('Program shared');
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Failed to share program');
    }
  } catch (e) {
    console.warn('shareProgramToGroup failed', e);
    alert('Failed to share program');
  }
}


async function fetchProgress(groupId) {
  try {
    const res = await fetch(`${window.SERVER_URL}/community/groups/${groupId}/progress`, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn('fetchProgress failed', e);
  }
  return null;
}


function loadGroups() {
  return fetchGroups(window.currentUser).then(list => {
    const sort = document.getElementById('sortFilter')?.value || '';
    renderGroups(sortGroups(list, sort));
  });
}

function doGroupSearch() {
  const search = document.getElementById('groupSearchInput').value.trim();
  const goal = document.getElementById('goalFilter').value.trim();
  const tag = document.getElementById('tagFilter').value.trim();
  const sort = document.getElementById('sortFilter').value;
  const btn = document.getElementById('groupSearchBtn');
  if (btn) btn.classList.add('loading');
  setTimeout(() => {
    let list = filterGroups(groups, { search, goal, tag });
    list = sortGroups(list, sort);
    renderGroups(list);
    if (btn) btn.classList.remove('loading');
  }, 10);
}

function clearGroupFilters() {
  document.getElementById('groupSearchInput').value = '';
  document.getElementById('goalFilter').value = '';
  document.getElementById('tagFilter').value = '';
  document.getElementById('sortFilter').value = '';
  renderGroups(sortGroups(groups));
}

// Add post locally and via backend
async function addPost(groupId, user, text) {
  const g = groups.find(gr => gr.id === groupId);
  if (!g) return;
  if (typeof fetch !== 'undefined') {
    try {
      await fetch(`${window.SERVER_URL}/community/groups/${groupId}/posts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ userId: user, text })
      });
    } catch (e) {
      console.warn('addPost failed', e);
    }
  }
  g.posts.push({ user, text, date: new Date().toISOString() });
  saveGroups();
}








function calculateLeaderboard(members) {
  if (!Array.isArray(members)) return { consistent: [], improving: [] };
  const byConsistent = [...members].sort((a,b) => (b.consistencyScore||0) - (a.consistencyScore||0));
  const byImprove = [...members].sort((a,b) => (b.improvementScore||0) - (a.improvementScore||0));
  return {
    consistent: byConsistent.slice(0,3).map(m => m.name),
    improving: byImprove.slice(0,3).map(m => m.name)
  };
}

function renderGroups(list) {
  const container = document.getElementById('groupList');
  if (!container) return;
  container.innerHTML = '';
  list.forEach(g => {
    const card = document.createElement('div');
    card.className = 'group-card card group-item';

    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = g.name;
    card.appendChild(title);

    const descText = g.goal && g.goal.trim() ? g.goal : 'No description';
    const desc = document.createElement('div');
    desc.className = 'group-desc';
    desc.textContent = descText;
    card.appendChild(desc);

    const count = Array.isArray(g.members) ? g.members.length : 0;
    const members = document.createElement('div');
    members.className = 'group-members';
    members.textContent = `${count} member${count === 1 ? '' : 's'}`;
    card.appendChild(members);

    const isMember = isMemberOf(g, getCurrentUserId());
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = isMember ? 'View Group' : 'Join';
    btn.onclick = () => {
      if (isMember) openGroup(g.id); else joinGroup(g.id);
    };
    card.appendChild(btn);

    container.appendChild(card);
  });
}

function getCurrentUserId() {
  if (typeof window !== 'undefined' && window.currentUser) return window.currentUser;
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('currentUser');
    if (stored) return stored;
  }
  return null;
}

function isMemberOf(group, userId) {
  if (!Array.isArray(group?.members) || !userId) return false;
  return group.members.some(member => {
    if (member == null) return false;
    if (typeof member === 'string') return member === userId;
    if (typeof member === 'object') {
      return member.userId === userId || member.id === userId || member.username === userId;
    }
    return false;
  });
}

function joinGroup(id) {
  const g = groups.find(gr => gr.id === id);
  if (!g) return;
  const userId = getCurrentUserId();
  if (!userId) {
    if (typeof showToast === 'function') showToast('Please sign in to join groups');
    return;
  }
  if (!Array.isArray(g.members)) g.members = [];
  if (!isMemberOf(g, userId)) {
    g.members.push({ userId, joinedAt: new Date().toISOString() });
    saveGroups();
    const sort = document.getElementById('sortFilter')?.value || '';
    renderGroups(sortGroups(groups, sort));
    if (typeof showToast === 'function') showToast(`You joined ${g.name}`);
  }
  openGroup(id);
}

async function openGroup(id) {
  const group = groups.find(gr => gr.id === id);
  if (!group) return;
  const detail = document.getElementById('groupDetail');
  if (!detail) return;
  detail.style.display = 'block';
  await fetchPosts(id);
  const postsHtml = (group.posts || [])
    .sort((a,b) => new Date(a.date)-new Date(b.date))
    .map(p => `<div><strong>${p.user}</strong>: ${p.text} <small>${new Date(p.date).toLocaleString()}</small></div>`)
    .join('');
  detail.innerHTML = `
    <h3>${group.name}</h3>
    <div>
      <input id="inviteUserInput" placeholder="User ID" />
      <button onclick="inviteUserToGroup(${id}, document.getElementById('inviteUserInput').value)">Invite</button>
    </div>
    <div id="groupPosts">${postsHtml}</div>
    <textarea id="newPostText"></textarea>
    <button onclick="addPostToGroup(${id}, window.currentUser, document.getElementById('newPostText').value)">Post</button>
    <h4>Share Program</h4>
    <textarea id="shareProgramData"></textarea>
    <button onclick="shareProgramInput(${id}, document.getElementById('shareProgramData').value)">Share</button>
    <button onclick="loadGroupStats(${id})">Load Progress</button>
    <div id="groupProgress"></div>
  `;
}

async function loadGroupStats(id) {
  const data = await fetchProgress(id);
  const div = document.getElementById('groupProgress');
  if (!div || !data) return;
  const rows = (data.members || [])
    .map(m => `<tr><td>${m.userId}</td><td>${m.volume||0}</td><td>${m.reps||0}</td></tr>`) 
    .join('');
  const lb = data.leaderboard;
  div.innerHTML = `
    <table><tr><th>User</th><th>Volume</th><th>Reps</th></tr>${rows}</table>
    <p>Most Consistent: ${lb.consistent.join(', ')}</p>
    <p>Most Improving: ${lb.improving.join(', ')}</p>`;
}

// wrapper helpers for inline onclick handlers
function addPostToGroup(id, user, text) {
  if (!text) return;
  addPost(id, user, text);
  // re-render group to show new post
  openGroup(id);
}

function shareProgramInput(id, dataStr) {
  if (!dataStr) return;
  let parsed;
  try {
    parsed = JSON.parse(dataStr);
  } catch (e) {
    console.warn('Invalid program data', e);
    return;
  }
  shareProgramToGroup(id, parsed);
}

function showCreateGroup() {
  const name = prompt('Group name?');
  if (!name) return;
  const goal = prompt('Group goal? (optional)') || '';
  const tagsStr = prompt('Tags? (comma separated)') || '';
  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
  createGroup(name, goal, tags).then(() => renderGroups(groups));
}

// ----- Competition Features -----
let currentCommunitySection = 'groups';
let competitionChart;

function showCommunitySection(section) {
  currentCommunitySection = section;
  const panels = {
    groups: document.getElementById('groupsPanel'),
    competition: document.getElementById('competitionPanel'),
    posts: document.getElementById('postsPanel')
  };
  Object.values(panels).forEach(p => { if (p) p.style.display = 'none'; });
  if (panels[section]) panels[section].style.display = 'block';
  if (section === 'groups') {
    loadGroups();
  } else if (section === 'competition') {
    renderCompetition();
  }
}

function calcStatsForGroup(g) {
  const members = Object.values(g.progress || {});
  const workouts = members.reduce((s,m) => s + (m.workouts || 0), 0);
  const studyHours = members.reduce((s,m) => s + (m.studyHours || 0), 0);
  const engagement = (g.posts?.length || 0);
  return { workouts, studyHours, engagement };
}

function renderCompetition(metric = 'workouts') {
  const container = document.getElementById('competitionContent');
  if (!container) return;
  if (!groups.length) {
    groups = [
      { id: 1, name: 'Alpha Team', progress: { a: { workouts: 20, studyHours: 5 } }, posts: [{}] },
      { id: 2, name: 'Bravo Squad', progress: { b: { workouts: 15, studyHours: 8 } }, posts: [] },
      { id: 3, name: 'Charlie Crew', progress: { c: { workouts: 25, studyHours: 3 } }, posts: [{},{}] }
    ];
  }
  const data = groups.map(g => {
    const stats = calcStatsForGroup(g);
    return { id: g.id, name: g.name, ...stats };
  });
  data.sort((a,b) => (b[metric]||0) - (a[metric]||0));

  const rows = data.map((d,i) =>
    `<div class="leader-entry" data-id="${d.id}"><span>#${i+1}</span><span><strong>${d.name}</strong></span><span>${d[metric]||0}</span></div>`
  ).join('');

  container.innerHTML = `
    <div class="leaderboard-controls">
      <label for="leaderSort">Sort by</label>
      <select id="leaderSort" onchange="renderCompetition(this.value)">
        <option value="workouts">Workouts Logged</option>
        <option value="studyHours">Study Hours</option>
        <option value="engagement">Group Activity</option>
      </select>
      <div class="leaderboard">${rows}</div>
      <canvas id="competitionChart"></canvas>
      <div id="leaderDetails" class="leader-details" style="display:none;"></div>
    </div>`;

  container.querySelectorAll('.leader-entry').forEach(el => {
    el.addEventListener('click', () => {
      if (window.showGroupStats) {
        window.showGroupStats(el.dataset.id);
      } else {
        showLeaderDetail(el.dataset.id);
      }
    });
  });

  renderCompetitionChart(data.slice(0,5), metric);
}

function renderCompetitionChart(items, metric) {
  const ctx = document.getElementById('competitionChart');
  if (!ctx || typeof Chart === 'undefined') return;
  if (competitionChart) competitionChart.destroy();
  competitionChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map(i => i.name),
      datasets: [{ label: metric, data: items.map(i => i[metric]||0) }]
    },
    options: { plugins: { legend: { display: false } }, responsive: true }
  });
}

function showLeaderDetail(groupId) {
  const g = groups.find(gr => gr.id == groupId);
  if (!g) return;
  const detail = document.getElementById('leaderDetails');
  if (!detail) return;
  const stats = calcStatsForGroup(g);
  const exercises = Object.keys(sampleExerciseData);
  const exOptions = exercises.map(e => `<option value="${e}">${e}</option>`).join('');
  detail.innerHTML = `
    <strong>${g.name}</strong><br>
    Workouts: ${stats.workouts}<br>
    Study Hours: ${stats.studyHours}<br>
    Posts: ${stats.engagement}
    <div class="exercise-compare">
      <h4>Exercise Comparison</h4>
      <label for="exerciseSelect">Exercise</label>
      <select id="exerciseSelect">${exOptions}</select>
      <label for="timeFilter">Timeframe</label>
      <select id="timeFilter">
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="all">All-Time</option>
      </select>
      <div id="exerciseLb"></div>
    </div>`;
  detail.style.display = 'block';

  const selectEl = document.getElementById('exerciseSelect');
  const timeEl = document.getElementById('timeFilter');
  const render = () => renderExerciseLeaderboard(selectEl.value, timeEl.value);
  selectEl.onchange = render;
  timeEl.onchange = render;
  render();
}

function renderExerciseLeaderboard(exercise, timeframe) {
  const container = document.getElementById('exerciseLb');
  if (!container) return;
  const data = sampleExerciseData[exercise] || [];
  if (!data.length) {
    container.innerHTML = '<p>No data available for this exercise/timeframe.</p>';
    return;
  }
  const rows = data.map((d,i) =>
    `<div class="leader-entry"><span>#${i+1}</span><span><strong>${d.user}</strong></span><span>${d.volume.toLocaleString()} kg</span><span>${d.sets} sets, ${d.reps} reps</span></div>`
  ).join('');
  container.innerHTML = `<div class="leaderboard">${rows}</div>`;
}

if (typeof window !== 'undefined') {
  window.loadGroups = loadGroups;
  window.showCreateGroup = showCreateGroup;
  window.addPostToGroup = addPostToGroup;
  window.shareProgramInput = shareProgramInput;
  window.inviteUserToGroup = inviteUserToGroup;
  window.shareProgramToGroup = shareProgramToGroup;
  window.doGroupSearch = doGroupSearch;
  window.clearGroupFilters = clearGroupFilters;
  window.joinGroup = joinGroup;
  window.showCommunitySection = showCommunitySection;
  window.renderCompetition = renderCompetition;
}

// allow tests to import functions
if (typeof module !== 'undefined') {
  module.exports = { calculateLeaderboard, filterGroups, sortGroups };
}
