// Groups array and localStorage handling
let groups = [];
if (typeof localStorage !== 'undefined') {
  groups = JSON.parse(localStorage.getItem('communityGroups')) || [];
}

const serverUrl = (typeof window !== 'undefined' && window.SERVER_URL) ||
  'https://traininglog-backend.onrender.com';

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
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, creatorId: window.currentUser, goal, tags })
});
      const g = await res.json();
      groups.push(g);
      saveGroups();
      return g;
    } catch (e) {
      console.warn('createGroup failed', e);
    }
  }
  // fallback local group creation
  const g = { id: Date.now(), name, goal, tags, members: [], posts: [] };
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
      credentials: 'include'
    });
    if (res.ok) {
      groups = await res.json();
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
    const res = await fetch(`${window.SERVER_URL}/community/groups?${params.toString()}`, { method: 'GET', credentials: 'include' });
    if (res.ok) {
      groups = await res.json();
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
    if (opts.search && !g.name.toLowerCase().includes(opts.search.toLowerCase())) return false;
    return true;
  });
}

async function fetchPosts(groupId) {
  try {
    const res = await fetch(`${window.SERVER_URL}/community/groups/${groupId}/posts`, {
      method: 'GET',
      credentials: 'include'
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitedUserId })
    });
    if (res.ok) {
      const g = groups.find(gr => gr.id === groupId);
      if (g) {
        if (!Array.isArray(g.members)) g.members = [];
        g.members.push(invitedUserId);
        saveGroups();
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
      headers: { 'Content-Type': 'application/json' },
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
      credentials: 'include'
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn('fetchProgress failed', e);
  }
  return null;
}


function loadGroups() {
  return fetchGroups(window.currentUser).then(renderGroups);
}

function doGroupSearch() {
  const search = document.getElementById('groupSearchInput').value;
  const goal = document.getElementById('goalFilter').value;
  const tag = document.getElementById('tagFilter').value;
  searchGroups({ search, goal, tag }).then(renderGroups);
}

function clearGroupFilters() {
  document.getElementById('groupSearchInput').value = '';
  document.getElementById('goalFilter').value = '';
  document.getElementById('tagFilter').value = '';
  searchGroups({}).then(renderGroups);
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
        headers: { 'Content-Type': 'application/json' },
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
    const div = document.createElement('div');
    div.textContent = g.name;
    div.className = 'group-item';
    div.onclick = () => openGroup(g.id);
    container.appendChild(div);
  });
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

if (typeof window !== 'undefined') {
  window.loadGroups = loadGroups;
  window.showCreateGroup = showCreateGroup;
  window.addPostToGroup = addPostToGroup;
  window.shareProgramInput = shareProgramInput;
  window.inviteUserToGroup = inviteUserToGroup;
  window.shareProgramToGroup = shareProgramToGroup;
  window.doGroupSearch = doGroupSearch;
  window.clearGroupFilters = clearGroupFilters;
}

// allow tests to import functions
if (typeof module !== 'undefined') {
  module.exports = { calculateLeaderboard, filterGroups };
}
