// Community groups. Groups, members and posts live on the server
// (/api/groups, see the backend's src/routes/groups.js) so every member sees
// the same thing. The last list is cached per user in localStorage only so
// the tab isn't empty while offline; nothing is created locally any more.
let groups = [];

const DEFAULT_GROUPS_SERVER = 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
const GROUP_POLL_MS = 30 * 1000;
const GROUP_REPORT_REASONS = [
  ['inappropriate', 'Inappropriate or offensive'],
  ['harassment', 'Harassment or bullying'],
  ['spam', 'Spam'],
  ['other', 'Something else'],
];

function getAuthHeaders() {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function _groupsCacheKey() {
  return `communityGroups_v2_${getCurrentUserId() || 'anon'}`;
}

function _loadCachedGroups() {
  if (typeof localStorage === 'undefined') return [];
  try { return normalizeGroups(JSON.parse(localStorage.getItem(_groupsCacheKey())) || []); } catch { return []; }
}

function saveGroups() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(_groupsCacheKey(), JSON.stringify(groups)); } catch { /* quota */ }
}

async function groupsApi(method, path, body) {
  const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    const err = new Error('Sign in to use groups.');
    err.code = 'groups.signed_out';
    throw err;
  }
  const base = (typeof window !== 'undefined' && window.SERVER_URL) || DEFAULT_GROUPS_SERVER;
  const res = await fetch(`${base}/api/groups${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || !data || data.success === false) {
    const err = new Error(data?.error?.message || 'Could not reach the server. Try again.');
    err.code = data?.error?.code || 'groups.network';
    err.status = res.status;
    throw err;
  }
  return data;
}

function _groupToast(msg, type) {
  if (typeof window === 'undefined') return;
  if (typeof window.showToast === 'function') window.showToast(msg, type);
  else if (typeof window.nativeToast === 'function') window.nativeToast(msg, type);
}

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

// Server groups carry `recentPostTimes`; exposing them as `posts` keeps the
// activity bars, "Active 2d ago" and the "Most active" sort working.
function normalizeGroup(group) {
  if (!group) return group;
  if (Array.isArray(group.members)) {
    group.members = group.members
      .map(normalizeMember)
      .filter(Boolean);
  } else {
    group.members = [];
  }
  if (Array.isArray(group.recentPostTimes)) {
    group.posts = group.recentPostTimes.map(date => ({ date }));
  } else if (!Array.isArray(group.posts)) {
    group.posts = [];
  }
  return group;
}

function normalizeGroups(list = []) {
  return list.map(g => normalizeGroup({ ...g }));
}

function _upsertGroup(g) {
  const i = groups.findIndex(x => x.id === g.id);
  if (i >= 0) groups[i] = g; else groups.unshift(g);
  saveGroups();
}

function _rerenderGroups() {
  const sort = (typeof document !== 'undefined' && document.getElementById('sortFilter')?.value) || '';
  renderGroups(sortGroups(groups, sort));
}

// `memberIds` are friends picked in the create sheet; the server only
// accepts accepted friends. Throws with a readable message on failure.
async function createGroup(name, goal = '', tags = [], memberIds = []) {
  if (!name) return null;
  const { group } = await groupsApi('POST', '', { name, goal, tags, members: memberIds });
  const g = normalizeGroup(group);
  _upsertGroup(g);
  return g;
}

function getGroups() {
  return groups;
}

async function fetchGroups() {
  const { groups: list } = await groupsApi('GET', '');
  groups = normalizeGroups(list || []);
  saveGroups();
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
  const times = (Array.isArray(g.posts) ? g.posts : [])
    .map(p => new Date(p && p.date).getTime()).filter(n => !Number.isNaN(n));
  return times.length ? Math.max(...times) : 0;
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

// Shares a program or template into a group as a post other members can
// save. Called from the Share panel; returns true on success.
async function shareProgramToGroup(groupId, programData) {
  if (!programData) return false;
  const { _type, _itemName, _message, _sharedBy, ...data } = programData;
  try {
    await groupsApi('POST', `/${encodeURIComponent(groupId)}/posts`, {
      text: _message || '',
      share: { type: _type === 'template' ? 'template' : 'program', name: _itemName || data.name || 'Untitled', data },
    });
    return true;
  } catch (e) {
    _groupToast(e.message, 'error');
    return false;
  }
}

let _groupsLoadError = '';

function loadGroups() {
  if (!groups.length) groups = _loadCachedGroups();
  _rerenderGroups();
  return fetchGroups()
    .then(() => { _groupsLoadError = ''; })
    .catch(e => { _groupsLoadError = e.message; })
    .then(() => {
      if (document.getElementById('groupSearchInput')?.value || document.getElementById('tagFilter')?.value) doGroupSearch();
      else _rerenderGroups();
      return groups;
    });
}

function doGroupSearch() {
  const search = document.getElementById('groupSearchInput')?.value.trim() ?? '';
  const goal = document.getElementById('goalFilter')?.value.trim() ?? '';
  const tag = document.getElementById('tagFilter')?.value.trim() ?? '';
  const sort = document.getElementById('sortFilter')?.value ?? '';
  let list = filterGroups(groups, { search, goal, tag });
  list = sortGroups(list, sort);
  renderGroups(list);
}

function clearGroupFilters() {
  const _g = id => document.getElementById(id);
  if (_g('groupSearchInput')) _g('groupSearchInput').value = '';
  if (_g('goalFilter'))       _g('goalFilter').value = '';
  if (_g('tagFilter'))        _g('tagFilter').value = '';
  if (_g('sortFilter'))       _g('sortFilter').value = '';
  renderGroups(sortGroups(groups));
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

const GROUP_TAG_STYLES = ['strength', 'hypertrophy', 'conditioning', 'crossfit'];

function _escGroup(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _groupInitials(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const two = words.length > 1 ? words[0][0] + words[1][0] : String(name || '?').slice(0, 2);
  return two.toUpperCase();
}

// Posts per day for the last 7 days, oldest first, today last.
function groupActivity7d(posts, now = new Date()) {
  const out = new Array(7).fill(0);
  const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const index = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    index[dayKey(d)] = i;
  }
  (Array.isArray(posts) ? posts : []).forEach(p => {
    if (!p || !p.date) return;
    const d = new Date(p.date);
    if (Number.isNaN(d.getTime())) return;
    const i = index[dayKey(d)];
    if (i !== undefined) out[i]++;
  });
  return out;
}

function _groupTagStyle(g) {
  const tag = (g.tags || []).map(t => String(t).toLowerCase()).find(t => GROUP_TAG_STYLES.includes(t));
  return tag ? `sx-mono--${tag}` : '';
}

function _groupMeta(g) {
  const count = Array.isArray(g.members) ? g.members.length : 0;
  const tag = (g.tags || [])[0];
  return `${tag ? `${_escGroup(tag)} · ` : ''}${count} member${count === 1 ? '' : 's'}`;
}

function _groupBars(g) {
  const days = groupActivity7d(g.posts);
  if (!days.some(Boolean)) return '';
  const max = Math.max(...days);
  return `<div class="sx-bars" role="img" aria-label="Posts per day, last 7 days">${days.map((n, i) =>
    `<i class="${i === 6 ? 'is-today' : ''}" style="height:${Math.round((n / max) * 100)}%;--b:${i}"></i>`).join('')}</div>`;
}

function _groupLastActive(g) {
  const t = getLastActiveDate(g);
  if (!t) return 'No posts yet';
  const days = Math.floor((Date.now() - t) / 86400000);
  return days <= 0 ? 'Active today' : days === 1 ? 'Active yesterday' : `Active ${days}d ago`;
}

function _groupHead(g) {
  return `
    <div class="sx-g-h">
      <span class="sx-mono ${_groupTagStyle(g)}">${_escGroup(_groupInitials(g.name))}</span>
      <div style="min-width:0"><span class="sx-g-name">${_escGroup(g.name)}</span><span class="sx-g-meta">${_groupMeta(g)}</span></div>
    </div>`;
}

function renderGroups(list) {
  const container = document.getElementById('groupList');
  if (!container) return;
  const userId = getCurrentUserId();
  const mine   = list.filter(g => isMemberOf(g, userId));
  const others = list.filter(g => !isMemberOf(g, userId));

  // Your groups: swipeable row
  const mineWrap = document.getElementById('groupMineWrap');
  const mineEl   = document.getElementById('groupMine');
  if (mineWrap && mineEl) {
    mineWrap.style.display = mine.length ? '' : 'none';
    const mineCount = document.getElementById('groupMineCount');
    if (mineCount) mineCount.textContent = mine.length;
    mineEl.innerHTML = mine.map((g, i) => `
      <div class="pod ${i === 0 ? 'pod--hero' : ''} sx-in" style="--i:${i}" role="button" tabindex="0" data-group-open="${i}">
        ${_groupHead(g)}
        <div class="sx-g-foot"><span class="sx-g-ct">${_groupLastActive(g)}</span>${_groupBars(g)}</div>
      </div>`).join('');
    mineEl.querySelectorAll('[data-group-open]').forEach(card => {
      const g = mine[+card.dataset.groupOpen];
      card.addEventListener('click', () => openGroup(g.id));
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGroup(g.id); } });
    });
  }

  // Discover list
  if (!others.length) {
    const searching = !!(document.getElementById('groupSearchInput')?.value || document.getElementById('tagFilter')?.value);
    const msg = _groupsLoadError && !groups.length ? `Couldn’t load groups. ${_escGroup(_groupsLoadError)}`
      : searching ? 'No groups match that search.'
      : mine.length ? "You're in every group so far. Start a new one below." : 'No groups yet. Start the first one below.';
    container.innerHTML = `<div class="pod sx-empty">${msg}</div>`;
  } else {
    container.innerHTML = others.map((g, i) => {
      const members = Array.isArray(g.members) ? g.members : [];
      const faces = members.slice(0, 3).map(m => {
        const id = _escGroup(m.username || m.userId || '');
        return `<span class="sx-av sx-av--sm" data-avatar-user="${id}">${_escGroup(String(id).slice(0, 1).toUpperCase() || '?')}</span>`;
      }).join('');
      const tags = (g.tags || []).slice(0, 3).map(t => `<span class="mx-tag">${_escGroup(t)}</span>`).join('');
      return `
        <article class="pod sx-gcard group-item sx-in" style="--i:${Math.min(i, 8)}">
          ${_groupHead(g)}
          ${g.goal && g.goal.trim() ? `<p>${_escGroup(g.goal)}</p>` : ''}
          ${tags ? `<div class="sx-tags">${tags}</div>` : ''}
          <div class="sx-g-foot">
            ${faces ? `<div class="sx-stack">${faces}</div>` : ''}
            <span class="sx-g-ct">${members.length > 3 ? `+${members.length - 3}` : _groupLastActive(g)}</span>
            ${_groupBars(g)}
            <button type="button" class="sx-join" data-join="${i}">Join</button>
          </div>
        </article>`;
    }).join('');
    container.querySelectorAll('[data-join]').forEach(btn => {
      const g = others[+btn.dataset.join];
      btn.addEventListener('click', async () => {
        if (!getCurrentUserId()) { _groupToast('Please sign in to join groups'); return; }
        btn.disabled = true;
        const ok = await joinGroup(g.id, { open: false });
        if (!ok) { btn.disabled = false; return; }
        btn.classList.add('is-joined');
        const check = typeof ICONS !== 'undefined' && ICONS.check ? `<span class="ui-icon" data-icon="check">${ICONS.check}</span>` : '';
        btn.innerHTML = `${check}Joined`;
        setTimeout(() => { _rerenderGroups(); openGroup(g.id); }, 450);
      });
    });
  }

  const panel = document.getElementById('groupsPanel');
  if (panel) { panel.classList.remove('sx-anim'); void panel.offsetWidth; panel.classList.add('sx-anim'); }
}

function getCurrentUserId() {
  if (typeof window !== 'undefined' && window.currentUser) return window.currentUser;
  // index.html keeps the signed-in username in a script-level `let
  // currentUser`, which is not a window property.
  if (typeof window !== 'undefined' && typeof window.getActiveUsername === 'function') {
    const active = window.getActiveUsername();
    if (active) return active;
  }
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('currentUser') || localStorage.getItem('fitnessAppUser');
    if (stored) return stored;
  }
  return null;
}

// Usernames are case-insensitive on the server.
function isMemberOf(group, userId) {
  if (!group || !userId) return false;
  const key = String(userId).toLowerCase();
  if (typeof group.isMember === 'boolean' && String(getCurrentUserId() || '').toLowerCase() === key) return group.isMember;
  if (!Array.isArray(group.members)) return false;
  return group.members.some(member => {
    if (member == null) return false;
    const id = typeof member === 'string' ? member : (member.userId || member.id || member.username);
    return String(id || '').toLowerCase() === key;
  });
}

async function joinGroup(id, { open = true } = {}) {
  if (!getCurrentUserId()) {
    _groupToast('Please sign in to join groups');
    return false;
  }
  try {
    const { group } = await groupsApi('POST', `/${encodeURIComponent(id)}/join`);
    const g = normalizeGroup(group);
    _upsertGroup(g);
    _groupToast(`You joined ${g.name}`);
    if (open) { _rerenderGroups(); openGroup(id); }
    return true;
  } catch (e) {
    _groupToast(e.message, 'error');
    if (e.status === 404) loadGroups();
    return false;
  }
}

// ── Group sheet: posts, composer, members, report ─────────────

let _groupSheet = { id: null, posts: [], timer: null, loading: false };

function _timeAgoGroup(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

function _groupOverlay() {
  let overlay = document.getElementById('groupSheetOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'groupSheetOverlay';
    overlay.className = 'quick-share-overlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeGroup(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeGroup(); });
  }
  return overlay;
}

function closeGroup() {
  const overlay = document.getElementById('groupSheetOverlay');
  if (overlay) overlay.classList.remove('open');
  if (_groupSheet.timer) clearInterval(_groupSheet.timer);
  _groupSheet = { id: null, posts: [], timer: null, loading: false };
}

function _postHtml(p) {
  const author = _escGroup(p.author);
  const icon = p.share && p.share.type === 'template' ? 'clipboard' : 'calendar';
  const share = p.share ? `
    <div class="sx-gshare">
      <span class="ui-icon" data-icon="${icon}">${typeof ICONS !== 'undefined' && ICONS[icon] ? ICONS[icon] : ''}</span>
      <div style="min-width:0"><b>${_escGroup(p.share.name)}</b><small>${p.share.type === 'template' ? 'Template' : 'Program'}</small></div>
      ${p.mine ? '' : `<button type="button" class="sx-join" data-post-save="${_escGroup(p.id)}">Save</button>`}
    </div>` : '';
  return `
    <article class="pod sx-post" data-post-id="${_escGroup(p.id)}">
      <div class="sx-post-h">
        <span class="sx-av" data-avatar-user="${author}" data-avatar-open>${_escGroup(String(p.author || '?').charAt(0).toUpperCase())}</span>
        <div style="min-width:0"><b>${author}</b><small>${_timeAgoGroup(p.date)}</small></div>
        <button type="button" class="sx-gpost-menu" data-post-menu="${_escGroup(p.id)}" aria-label="Post options">•••</button>
      </div>
      ${p.text ? `<p class="sx-gpost-text">${_escGroup(p.text)}</p>` : ''}
      ${share}
    </article>`;
}

function _renderGroupSheet(group) {
  const overlay = _groupOverlay();
  const member = isMemberOf(group, getCurrentUserId());
  const friends = typeof window.getFriends === 'function' ? window.getFriends() : [];
  const invitable = friends.filter(f => !isMemberOf(group, f.username));
  const postsHtml = !member
    ? '<div class="sx-empty">Join the group to see posts and chat with members.</div>'
    : _groupSheet.loading && !_groupSheet.posts.length
      ? '<div class="sx-empty">Loading posts…</div>'
      : _groupSheet.posts.length
        ? _groupSheet.posts.map(_postHtml).join('')
        : '<div class="sx-empty">No posts yet. Say hi to the group.</div>';

  overlay.innerHTML = `
    <div class="quick-share-panel sx-gsheet" role="dialog" aria-modal="true" aria-labelledby="groupSheetTitle">
      <div class="quick-share-handle"></div>
      <div class="sx-gsheet-top">
        <span class="sx-mono ${_groupTagStyle(group)}">${_escGroup(_groupInitials(group.name))}</span>
        <div style="min-width:0;flex:1">
          <div class="quick-share-title" id="groupSheetTitle">${_escGroup(group.name)}</div>
          <div class="quick-share-subtitle" style="margin:0">${_groupMeta(group)}${group.owner ? ` · run by @${_escGroup(group.owner)}` : ''}</div>
        </div>
        <button type="button" class="sx-gpost-menu" id="groupSheetMenu" aria-label="Group options">•••</button>
        <button type="button" class="sx-gsheet-close" id="groupSheetClose" aria-label="Close">✕</button>
      </div>
      ${group.goal ? `<p class="sx-gsheet-goal">${_escGroup(group.goal)}</p>` : ''}
      <div class="sx-gsheet-members">${(group.members || []).slice(0, 12).map(m => {
        const id = _escGroup(m.userId);
        return `<span class="sx-av sx-av--sm" data-avatar-user="${id}" data-avatar-open title="@${id}">${_escGroup(String(m.userId || '?').charAt(0).toUpperCase())}</span>`;
      }).join('')}${(group.members || []).length > 12 ? `<span class="sx-g-ct">+${group.members.length - 12}</span>` : ''}</div>
      ${member ? `
        <div class="sx-gcompose">
          <textarea id="groupPostText" rows="2" maxlength="1000" placeholder="Write to the group…" aria-label="Post to the group"></textarea>
          <button type="button" class="sx-post-btn" id="groupPostBtn">Post</button>
        </div>
        ${invitable.length ? `
          <div class="sx-ginvite">
            <select id="groupInviteSelect" aria-label="Add a friend">
              <option value="">Add a friend…</option>
              ${invitable.map(f => `<option value="${_escGroup(f.username)}">@${_escGroup(f.username)}</option>`).join('')}
            </select>
            <button type="button" class="sx-link" id="groupInviteBtn">Add</button>
          </div>` : ''}`
      : `<button type="button" class="quick-share-send" id="groupSheetJoin">Join group</button>`}
      <div class="sx-feed sx-gposts" id="groupPosts">${postsHtml}</div>
      ${member && _groupSheet.hasMore ? '<button type="button" class="sx-link" id="groupMorePosts" style="margin:10px auto 0;display:flex">Show older posts</button>' : ''}
    </div>`;
  overlay.classList.add('open');
  _wireGroupSheet(group);
}

function _wireGroupSheet(group) {
  const overlay = _groupOverlay();
  const $ = sel => overlay.querySelector(sel);
  $('#groupSheetClose')?.addEventListener('click', closeGroup);
  $('#groupSheetJoin')?.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    if (!(await joinGroup(group.id, { open: false }))) { e.currentTarget.disabled = false; return; }
    _rerenderGroups();
    openGroup(group.id);
  });
  $('#groupSheetMenu')?.addEventListener('click', () => _groupMenu(group));

  const postBtn = $('#groupPostBtn');
  const ta = $('#groupPostText');
  postBtn?.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) return;
    postBtn.disabled = true;
    try {
      const { post } = await groupsApi('POST', `/${encodeURIComponent(group.id)}/posts`, { text });
      _groupSheet.posts.unshift(post);
      group.posts = [{ date: post.date }, ...(group.posts || [])];
      saveGroups();
      _renderGroupSheet(group);
    } catch (e) {
      _groupToast(e.message, 'error');
      postBtn.disabled = false;
    }
  });

  $('#groupInviteBtn')?.addEventListener('click', async () => {
    const username = $('#groupInviteSelect').value;
    if (!username) return;
    try {
      const res = await groupsApi('POST', `/${encodeURIComponent(group.id)}/invite`, { username });
      group.members.push({ userId: res.username });
      saveGroups();
      _groupToast(`Added @${res.username} to ${group.name}`);
      _renderGroupSheet(group);
      _rerenderGroups();
    } catch (e) {
      _groupToast(e.message, 'error');
    }
  });

  $('#groupMorePosts')?.addEventListener('click', () => _loadGroupPosts(group, { older: true }));

  overlay.querySelectorAll('[data-post-menu]').forEach(btn => {
    btn.addEventListener('click', () => {
      const post = _groupSheet.posts.find(p => p.id === btn.dataset.postMenu);
      if (post) _postMenu(group, post);
    });
  });
  overlay.querySelectorAll('[data-post-save]').forEach(btn => {
    btn.addEventListener('click', () => {
      const post = _groupSheet.posts.find(p => p.id === btn.dataset.postSave);
      if (post && _saveSharedItem(post.share, post.author)) {
        btn.disabled = true;
        btn.textContent = 'Saved';
      }
    });
  });
}

async function _loadGroupPosts(group, { older = false } = {}) {
  if (!isMemberOf(group, getCurrentUserId())) return;
  const id = group.id;
  const before = older && _groupSheet.posts.length ? _groupSheet.posts[_groupSheet.posts.length - 1].date : '';
  try {
    const res = await groupsApi('GET', `/${encodeURIComponent(id)}/posts${before ? `?before=${encodeURIComponent(before)}` : ''}`);
    if (_groupSheet.id !== id) return;
    _groupSheet.posts = older ? [..._groupSheet.posts, ...res.posts] : res.posts;
    if (!older || !res.hasMore) _groupSheet.hasMore = res.hasMore;
  } catch (e) {
    if (_groupSheet.id !== id) return;
    if (e.status === 404 || e.status === 403) {
      closeGroup();
      _groupToast(e.message, 'error');
      loadGroups();
      return;
    }
    if (!older && !_groupSheet.posts.length) _groupToast(e.message, 'error');
  }
  _groupSheet.loading = false;
  // Don't wipe a half-written post on the background refresh.
  const draft = document.getElementById('groupPostText');
  const text = draft ? draft.value : '';
  const focused = draft && document.activeElement === draft;
  _renderGroupSheet(group);
  const next = document.getElementById('groupPostText');
  if (next && text) { next.value = text; if (focused) next.focus(); }
}

function openGroup(id) {
  const group = groups.find(gr => gr.id === id);
  if (!group) return;
  if (_groupSheet.timer) clearInterval(_groupSheet.timer);
  _groupSheet = { id, posts: [], timer: null, loading: true, hasMore: false };
  _renderGroupSheet(group);
  _loadGroupPosts(group);
  _groupSheet.timer = setInterval(() => {
    const draft = document.getElementById('groupPostText');
    if (draft && draft.value) return; // don't refresh while typing
    _loadGroupPosts(group);
  }, GROUP_POLL_MS);
}

// Small action list shown in the same sheet overlay (above the sheet).
function _actionSheet(title, actions) {
  let el = document.getElementById('groupActionOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'groupActionOverlay';
    el.className = 'quick-share-overlay';
    el.style.zIndex = '3100';
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
  }
  el.innerHTML = `
    <div class="quick-share-panel" role="dialog" aria-modal="true" aria-label="${_escGroup(title)}">
      <div class="quick-share-handle"></div>
      <div class="quick-share-title">${_escGroup(title)}</div>
      <div class="sx-gactions">${actions.map((a, i) =>
        `<button type="button" class="mx-outline mx-outline--block${a.danger ? ' mx-outline--danger' : ''}" data-action="${i}">${_escGroup(a.label)}</button>`).join('')}
        <button type="button" class="mx-outline mx-outline--block" data-action="cancel">Cancel</button>
      </div>
    </div>`;
  el.classList.add('open');
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      el.classList.remove('open');
      const a = actions[+btn.dataset.action];
      if (a) a.run();
    });
  });
}

function _confirmGroup(message) {
  return typeof window.confirm === 'function' ? window.confirm(message) : true;
}

function _reportFlow(title, path) {
  _actionSheet(title, GROUP_REPORT_REASONS.map(([reason, label]) => ({
    label,
    run: async () => {
      try {
        await groupsApi('POST', path, { reason });
        _groupToast('Thanks. Our moderators will review this within 24 hours.');
      } catch (e) {
        _groupToast(e.message, 'error');
      }
    },
  })));
}

function _postMenu(group, post) {
  const actions = [];
  if (!post.mine) {
    actions.push({ label: 'Report post', run: () => _reportFlow('Why are you reporting this post?', `/${encodeURIComponent(group.id)}/posts/${encodeURIComponent(post.id)}/report`) });
    if (window.Profiles && typeof window.Profiles.openProfileCard === 'function') {
      actions.push({ label: `View @${post.author} (block or report)`, run: () => window.Profiles.openProfileCard(post.author) });
    }
  }
  if (post.canDelete) {
    actions.push({
      label: 'Delete post',
      danger: true,
      run: async () => {
        if (!_confirmGroup('Delete this post?')) return;
        try {
          await groupsApi('DELETE', `/${encodeURIComponent(group.id)}/posts/${encodeURIComponent(post.id)}`);
          _groupSheet.posts = _groupSheet.posts.filter(p => p.id !== post.id);
          _renderGroupSheet(group);
        } catch (e) {
          _groupToast(e.message, 'error');
        }
      },
    });
  }
  if (actions.length) _actionSheet('Post', actions);
}

function _groupMenu(group) {
  const actions = [];
  const member = isMemberOf(group, getCurrentUserId());
  if (!group.isOwner) {
    actions.push({ label: 'Report group', run: () => _reportFlow('Why are you reporting this group?', `/${encodeURIComponent(group.id)}/report`) });
  }
  if (member) {
    actions.push({
      label: 'Leave group',
      danger: true,
      run: async () => {
        const note = group.isOwner && group.members.length > 1 ? ' Another member will take over as owner.' : '';
        if (!_confirmGroup(`Leave ${group.name}?${note}`)) return;
        try {
          await groupsApi('POST', `/${encodeURIComponent(group.id)}/leave`);
          closeGroup();
          _groupToast(`You left ${group.name}`);
          loadGroups();
        } catch (e) {
          _groupToast(e.message, 'error');
        }
      },
    });
  }
  if (group.isOwner) {
    actions.push({
      label: 'Delete group',
      danger: true,
      run: async () => {
        if (!_confirmGroup(`Delete ${group.name} and all its posts for everyone? This can’t be undone.`)) return;
        try {
          await groupsApi('DELETE', `/${encodeURIComponent(group.id)}`);
          groups = groups.filter(g => g.id !== group.id);
          saveGroups();
          closeGroup();
          _groupToast(`Deleted ${group.name}`);
          _rerenderGroups();
        } catch (e) {
          _groupToast(e.message, 'error');
        }
      },
    });
  }
  _actionSheet(group.name, actions);
}

// Saves a program/template someone shared in a group into your own library
// (same storage the Share inbox uses).
function _saveSharedItem(share, from) {
  const user = getCurrentUserId();
  if (!share || !user || typeof localStorage === 'undefined') return false;
  const read = key => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
  if (share.type === 'template') {
    const key = `managedTemplates_${user}`;
    const tpls = read(key);
    tpls.unshift({ localId: `local_${Date.now()}`, name: `${share.name} (from @${from})`, data: share.data, source: 'community' });
    localStorage.setItem(key, JSON.stringify(tpls));
    _groupToast(`"${share.name}" added to your Templates!`, 'success');
  } else {
    const key = `programs_${user}`;
    const progs = read(key);
    progs.unshift({ ...share.data, id: `comm_${Date.now()}`, name: `${share.name} (from @${from})`, _sharedBy: from });
    localStorage.setItem(key, JSON.stringify(progs));
    _groupToast(`"${share.name}" added to your Programs!`, 'success');
  }
  return true;
}

// Bottom sheet: name, goal, tags and a tap-to-select list of your friends.
function showCreateGroup() {
  let overlay = document.getElementById('createGroupOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'createGroupOverlay';
    overlay.className = 'quick-share-overlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  }
  const friends = typeof window.getFriends === 'function' ? window.getFriends() : [];
  const selected = new Set();

  const friendsHtml = friends.length
    ? `<div class="quick-share-friends">${friends.map(f => `
        <div class="quick-share-friend" role="checkbox" aria-checked="false" tabindex="0" data-friend="${_escGroup(f.username)}">
          <div class="friend-avatar" data-avatar-user="${_escGroup(f.username)}">${_escGroup(String(f.username).charAt(0).toUpperCase())}</div>
          <span class="quick-share-friend-name">${_escGroup(f.username)}</span>
          <span class="quick-share-check">✓</span>
        </div>`).join('')}</div>`
    : `<div class="friends-empty" style="margin-bottom:12px">No friends yet — add some from the Friends tab and they'll show up here.</div>`;

  overlay.innerHTML = `
    <div class="quick-share-panel" role="dialog" aria-modal="true" aria-labelledby="createGroupTitle">
      <div class="quick-share-handle"></div>
      <div class="quick-share-title" id="createGroupTitle">Create group</div>
      <div class="quick-share-subtitle">Anyone can find and join your group. Tap friends to add them now.</div>
      <label class="create-group-field"><span>Name</span><input id="createGroupName" type="text" maxlength="60" placeholder="e.g. Morning Lifters"></label>
      <label class="create-group-field"><span>Goal (optional)</span><input id="createGroupGoal" type="text" maxlength="80" placeholder="e.g. Hit a 200kg deadlift"></label>
      <label class="create-group-field"><span>Tags (optional, comma separated)</span><input id="createGroupTags" type="text" placeholder="strength, beginner"></label>
      <div class="create-group-field"><span>Add friends${friends.length ? ` <em id="createGroupCount" style="font-style:normal"></em>` : ''}</span></div>
      ${friendsHtml}
      <button class="quick-share-send" id="createGroupSubmit" disabled>Create group</button>
    </div>`;
  overlay.classList.add('open');

  const nameInput = overlay.querySelector('#createGroupName');
  const submit = overlay.querySelector('#createGroupSubmit');
  const count = overlay.querySelector('#createGroupCount');
  const refresh = () => {
    submit.disabled = !nameInput.value.trim();
    submit.textContent = selected.size
      ? `Create group with ${selected.size} friend${selected.size === 1 ? '' : 's'}`
      : 'Create group';
    if (count) count.textContent = selected.size ? `· ${selected.size} selected` : '';
  };
  nameInput.addEventListener('input', refresh);
  overlay.querySelectorAll('[data-friend]').forEach(el => {
    const toggle = () => {
      const name = el.dataset.friend;
      if (selected.has(name)) selected.delete(name); else selected.add(name);
      el.classList.toggle('selected', selected.has(name));
      el.setAttribute('aria-checked', String(selected.has(name)));
      refresh();
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
  submit.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    submit.disabled = true;
    const goal = overlay.querySelector('#createGroupGoal').value.trim();
    const tagsStr = overlay.querySelector('#createGroupTags').value;
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
    let g;
    try {
      g = await createGroup(name, goal, tags, [...selected]);
    } catch (e) {
      _groupToast(e.message, 'error');
      refresh();
      return;
    }
    overlay.classList.remove('open');
    _rerenderGroups();
    _groupToast(selected.size ? `Created ${g.name} with ${selected.size} friend${selected.size === 1 ? '' : 's'}` : `Created ${g.name}`);
    openGroup(g.id);
  });
  refresh();
  setTimeout(() => nameInput.focus(), 50);
}

// ----- Competition Features -----
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

let currentCommunitySection = 'groups';
let competitionChart;

function showCommunitySection(section) {
  currentCommunitySection = section;
  const panels = {
    groups:      document.getElementById('groupsPanel'),
    competition: document.getElementById('competitionPanel'),
    posts:       document.getElementById('postsPanel'),
    feed:        document.getElementById('feedPanel'),
    share:       document.getElementById('commSharePanel'),
    friends:     document.getElementById('friendsPanel'),
  };
  Object.values(panels).forEach(p => { if (p) p.style.display = 'none'; });
  if (panels[section]) panels[section].style.display = 'block';

  // Update nav active class
  const navMap = {
    groups:      'commNavGroups',
    feed:        'commNavFeed',
    competition: 'commNavCompetition',
    share:       'commNavShare',
    friends:     'commNavFriends',
  };
  document.querySelectorAll('.comm-nav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(navMap[section]);
  if (activeBtn) activeBtn.classList.add('active');
  const nav = document.getElementById('commNav');
  if (nav && window.sxPlaceThumb) window.sxPlaceThumb(nav);

  if (section === 'groups') {
    loadGroups();
    if (window.renderWeeklyChallenge) renderWeeklyChallenge();
  } else if (section === 'competition') {
    renderCompetition();
  } else if (section === 'feed') {
    if (window.renderActivityFeed) renderActivityFeed();
  } else if (section === 'share') {
    if (typeof window.renderSharePanel === 'function') window.renderSharePanel();
  } else if (section === 'friends') {
    if (typeof window.renderFriendsPanel === 'function') window.renderFriendsPanel();
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
      <canvas id="competitionChart" height="200"></canvas>
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
  const render = () => renderGroupExerciseLeaderboard(selectEl.value, timeEl.value);
  selectEl.onchange = render;
  timeEl.onchange = render;
  render();
}

// Renamed from renderExerciseLeaderboard — that name collided with an
// unrelated, differently-shaped function of the same name in
// exerciseLeaderboard.js (zero-arg, reads its own #exerciseLbSelect/
// #exerciseLeaderboardContainer). Since exerciseLeaderboard.js loads after
// this file, its version silently won every call, meaning the Exercise
// Comparison panel inside a group's leader detail view has been rendering
// nothing since whichever script started shadowing this one.
function renderGroupExerciseLeaderboard(exercise, timeframe) {
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
  window.openGroup = openGroup;
  window.closeGroup = closeGroup;
  window.shareProgramToGroup = shareProgramToGroup;
  window.doGroupSearch = doGroupSearch;
  window.clearGroupFilters = clearGroupFilters;
  window.joinGroup = joinGroup;
  window.showCommunitySection = showCommunitySection;
  window.renderCompetition = renderCompetition;
}

// allow tests to import functions
if (typeof module !== 'undefined') {
  module.exports = { calculateLeaderboard, filterGroups, sortGroups, groupActivity7d, createGroup, getGroups, fetchGroups, isMemberOf, normalizeGroup };
}
