/* =============================================================
   NOTIFICATIONS — what other people did that involves you
   Server inbox at /api/notifications (backend src/routes/notifications.js):
   friend requests and accepts, shared templates/programs, being added to
   a group, new group posts, friends' feed posts, being passed on a
   leaderboard, and coaching: a coach's invite (with Accept), their notes
   and plan updates, and, for coaches, an accepted invite.

   UI: a bell in the Community and Leaderboard headers opens a sheet with
   the list (tap a row to jump to it) and per-category mute switches.
   Unread counts also show on the bottom-nav "All" button and the All
   hub's Community tile. New items toast once, except friend requests,
   which friends.js already toasts.
   ============================================================= */

(function (global) {
  'use strict';

  const DEFAULT_SERVER = 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
  const POLL_MS = 2 * 60 * 1000;
  const TOASTED_MAX = 200;

  const CATEGORIES = [
    { id: 'friends', label: 'Friend requests', sub: 'Requests and accepted requests' },
    { id: 'shares', label: 'Shared with you', sub: 'Templates and programs friends send you' },
    { id: 'groups', label: 'Groups', sub: 'Being added to a group, new posts' },
    { id: 'feed', label: 'Friends’ posts', sub: 'Workouts, PRs and updates in your feed' },
    { id: 'leaderboard', label: 'Leaderboards', sub: 'When someone passes you' },
    { id: 'coaching', label: 'Coaching', sub: 'Invites, notes and plan updates from a coach' },
  ];
  const ICON_FOR = { friends: 'users', shares: 'download', groups: 'message', feed: 'activity', leaderboard: 'trophy', coaching: 'clipboard' };
  // friends.js already toasts these when it polls.
  const NO_TOAST = new Set(['friend_request', 'friend_accepted']);

  let _items = [];
  let _unread = 0;
  let _loadedFor = null;
  let _inflight = null;
  let _prefs = null;

  function _user() {
    return global.currentUser
      || (typeof global.getActiveUsername === 'function' && global.getActiveUsername())
      || localStorage.getItem('fitnessAppUser') || '';
  }

  function _authHeaders() {
    if (typeof global.getAuthHeaders === 'function') {
      try { return global.getAuthHeaders() || {}; } catch { /* fall through */ }
    }
    const token = localStorage.getItem('token');
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function _toast(msg, type) {
    if (typeof global.showToast === 'function') global.showToast(msg, type);
    else if (typeof global.nativeToast === 'function') global.nativeToast(msg, type);
  }

  async function api(method, path, body) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, _authHeaders());
    if (!headers.Authorization) {
      const err = new Error('Sign in to see notifications.');
      err.code = 'notifications.signed_out';
      throw err;
    }
    const res = await fetch((global.SERVER_URL || DEFAULT_SERVER) + '/api/notifications' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok || !data || data.success === false) {
      const err = new Error(data?.error?.message || 'Could not reach the server. Try again.');
      err.code = data?.error?.code || 'notifications.network';
      throw err;
    }
    return data;
  }

  /* ── Text ───────────────────────────────────────────────── */

  function _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // One line of HTML for a notification; the actor's name is bold.
  function describe(n) {
    const who = `<b>${_esc(n.actor)}</b>`;
    const count = Number(n.count) || 1;
    const group = _esc(n.data?.name || 'your group');
    switch (n.type) {
      case 'group_post':
        return count > 1 ? `<b>${count} new posts</b> in ${group}, latest from ${_esc(n.actor)}` : `${who} posted in ${group}`;
      case 'feed_post':
        return count > 1 ? `${who} shared ${count} new posts` : `${who} ${_esc(n.text)}`;
      case 'coach_note':
        return count > 1 ? `${who} sent you ${count} notes` : `${who} ${_esc(n.text)}`;
      case 'exercise_passed':
      case 'volume_passed':
        return `${who} ${_esc(n.text)}${count > 1 ? ` <span class="nt-x">×${count}</span>` : ''}`;
      default:
        return `${who} ${_esc(n.text)}`;
    }
  }

  // Plain text version for toasts.
  function describeText(n) {
    const div = document.createElement('div');
    div.innerHTML = describe(n);
    return div.textContent;
  }

  function ago(iso, now = Date.now()) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /* ── Badges ─────────────────────────────────────────────── */

  function _paintBadges() {
    const label = _unread > 9 ? '9+' : String(_unread);
    document.querySelectorAll('[data-notif-badge]').forEach(b => {
      b.textContent = label;
      b.hidden = !_unread;
    });
    document.querySelectorAll('.nt-bell').forEach(btn => {
      btn.setAttribute('aria-label', _unread ? `Notifications, ${_unread} unread` : 'Notifications');
    });
    const allBtn = document.querySelector('#bottomNav .bn-item[data-tab="allTab"]');
    if (allBtn) allBtn.classList.toggle('has-notif', _unread > 0);
  }

  /* ── Toasts for new items ───────────────────────────────── */

  const _toastedKey = () => 'notifToasted_' + _user().toLowerCase();

  // `id:count` pairs already toasted, so a collapsed row toasts again when
  // its count goes up. The first load after sign-in only records them.
  function _toastNew(items) {
    let toasted;
    try { toasted = JSON.parse(localStorage.getItem(_toastedKey())); } catch { toasted = null; }
    const first = !Array.isArray(toasted);
    const seen = new Set(first ? [] : toasted);
    const fresh = items.filter(n => !n.read && !seen.has(`${n.id}:${n.count}`));
    const keys = items.filter(n => !n.read).map(n => `${n.id}:${n.count}`);
    localStorage.setItem(_toastedKey(), JSON.stringify([...new Set([...keys, ...(toasted || [])])].slice(0, TOASTED_MAX)));
    if (first) return;
    const show = fresh.filter(n => !NO_TOAST.has(n.type));
    if (show.length === 1) _toast(describeText(show[0]), 'info');
    else if (show.length > 1) _toast(`${show.length} new notifications`, 'info');
    if (show.length && document.visibilityState !== 'visible') {
      try {
        if ('Notification' in global && Notification.permission === 'granted') {
          new Notification('Pocket Coach', { body: show.length === 1 ? describeText(show[0]) : `${show.length} new notifications`, tag: 'pc-notifications', icon: '/favicon.ico' });
        }
      } catch { /* not supported */ }
    }
  }

  /* ── Data ───────────────────────────────────────────────── */

  function _changed() {
    _paintBadges();
    const list = document.getElementById('ntList');
    if (list) _renderList(list);
    document.dispatchEvent(new CustomEvent('pc:notifications-changed', { detail: { items: _items, unread: _unread } }));
  }

  async function refresh({ throwOnError = false } = {}) {
    const user = _user();
    if (_loadedFor !== user) { _items = []; _unread = 0; _prefs = null; _loadedFor = user; }
    if (!_inflight) {
      _inflight = api('GET', '')
        .then(data => {
          _items = data.items || [];
          _unread = Number(data.unread) || _items.filter(n => !n.read).length;
          _toastNew(_items);
          _changed();
          return _items;
        })
        .finally(() => { _inflight = null; });
    }
    try {
      return await _inflight;
    } catch (err) {
      if (throwOnError) throw err;
      return _items;
    }
  }

  async function markRead(ids) {
    const all = !ids;
    const target = new Set(ids || []);
    _items = _items.map(n => (all || target.has(n.id) ? { ...n, read: true } : n));
    _unread = _items.filter(n => !n.read).length;
    _paintBadges();
    try { await api('POST', '/read', all ? {} : { ids: [...target] }); } catch { /* next poll corrects it */ }
  }

  async function dismiss(id) {
    _items = _items.filter(n => n.id !== id);
    _unread = _items.filter(n => !n.read).length;
    _changed();
    try { await api('DELETE', '/' + encodeURIComponent(id)); } catch (err) { _toast(err.message, 'error'); }
  }

  /* ── Opening an item ────────────────────────────────────── */

  function _community(section) {
    if (typeof global.showTab === 'function') global.showTab('communityTab');
    if (typeof global.showCommunitySection === 'function') global.showCommunitySection(section);
  }

  // Settings › Your Coach: the invite (Accept / Decline), notes and plan.
  function _yourCoach() {
    if (typeof global.showTab === 'function') global.showTab('settingsTab');
    const section = document.getElementById('yourCoachSection');
    const scroll = () => section && !section.hidden && section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const render = typeof global.renderYourCoachSection === 'function' ? global.renderYourCoachSection() : null;
    Promise.resolve(render).catch(() => {}).then(() => setTimeout(scroll, 60));
  }

  function open(n) {
    closeSheet();
    switch (n.type) {
      case 'friend_request':
      case 'friend_accepted':
        return _community('friends');
      case 'share_received':
        return _community('share');
      case 'feed_post':
        return _community('feed');
      case 'group_added':
      case 'group_post': {
        _community('groups');
        const id = n.data?.groupId;
        if (id && typeof global.loadGroups === 'function') {
          Promise.resolve(global.loadGroups()).catch(() => {}).then(() => {
            if (typeof global.openGroup === 'function') global.openGroup(id);
          });
        }
        return;
      }
      case 'exercise_passed': {
        if (typeof global.showTab === 'function') global.showTab('leaderboardTab');
        const details = document.getElementById('lbExerciseSection');
        const sel = document.getElementById('exerciseLbSelectInline');
        if (sel && n.data?.lift) {
          sel.value = n.data.lift;
          if (details?.open) sel.dispatchEvent(new Event('change'));
        }
        if (details) {
          details.open = true;
          setTimeout(() => details.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        }
        return;
      }
      case 'volume_passed':
        if (typeof global.showTab === 'function') global.showTab('leaderboardTab');
        return;
      case 'coach_invite':
      case 'coach_note':
      case 'coach_plan':
        return _yourCoach();
      case 'coach_accepted':
      case 'coach_left':
        if (typeof global.showTab === 'function') global.showTab('clientsTab');
        return;
      default:
        return undefined;
    }
  }

  /* ── Sheet ──────────────────────────────────────────────── */

  function _icon(name) {
    return typeof global.sxIcon === 'function' ? global.sxIcon(name) : `<span class="ui-icon" data-icon="${name}"></span>`;
  }

  function closeSheet() {
    document.getElementById('ntSheet')?.remove();
    document.removeEventListener('keydown', _onKey);
  }

  function _onKey(e) { if (e.key === 'Escape') closeSheet(); }

  function _rowHtml(n) {
    let actions = '';
    if (n.type === 'friend_request' && !n._answered) {
      actions = `<span class="nt-actions">
           <button type="button" class="nt-btn nt-btn--go" data-act="accept">Accept</button>
           <button type="button" class="nt-btn" data-act="decline">Decline</button>
         </span>`;
    } else if (n.type === 'coach_invite' && n.data?.status === 'pending' && !n._answered) {
      // Decline (and what accepting shares) lives in Settings › Your Coach;
      // tapping the row goes there.
      actions = `<span class="nt-actions">
           <button type="button" class="nt-btn nt-btn--go" data-act="coach-accept">Accept</button>
         </span>`;
    }
    return `
      <li class="nt-row${n.read ? '' : ' is-unread'}" data-id="${_esc(n.id)}">
        <button type="button" class="nt-main" data-act="open">
          <span class="nt-ico nt-ico--${_esc(n.category)}">${_icon(ICON_FOR[n.category] || 'bell')}</span>
          <span class="nt-body">
            <span class="nt-text">${describe(n)}</span>
            <span class="nt-time">${_esc(ago(n.createdAt))}</span>
          </span>
        </button>
        ${actions}
        <button type="button" class="nt-dismiss" data-act="dismiss" aria-label="Dismiss">${_icon('x')}</button>
      </li>`;
  }

  function _renderList(list) {
    if (!_items.length) {
      list.innerHTML = `<div class="nt-empty">${_icon('bell')}<p>Nothing yet. Friend requests, things friends send you, group activity, leaderboard moves and coach invites show up here.</p></div>`;
      return;
    }
    // "New" = unread when the sheet opened, so rows don't jump as they're read.
    const isNew = n => list.dataset.newIds ? list.dataset.newIds.split(',').includes(n.id) : !n.read;
    const fresh = _items.filter(isNew);
    const older = _items.filter(n => !isNew(n));
    list.innerHTML = [
      fresh.length ? `<div class="sx-lbl nt-sec">New</div><ul class="nt-ul">${fresh.map(_rowHtml).join('')}</ul>` : '',
      older.length ? `<div class="sx-lbl nt-sec">Earlier</div><ul class="nt-ul">${older.map(_rowHtml).join('')}</ul>` : '',
    ].join('');
  }

  async function _onListClick(e) {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('.nt-row');
    if (!btn || !row) return;
    const n = _items.find(x => x.id === row.dataset.id);
    if (!n) return;
    const act = btn.dataset.act;
    if (act === 'open') return open(n);
    if (act === 'dismiss') return dismiss(n.id);
    if (act === 'coach-accept' && typeof global.acceptCoachInvite === 'function') {
      const coach = n.data?.coach || n.actor;
      const ok = typeof global.showConfirm === 'function'
        ? await global.showConfirm(`Let ${coach} coach you? They'll see your check-ins, bodyweight and weekly workout counts. You can change what they see, or leave, in Settings › Your Coach.`, { confirmText: 'Accept' })
        : true;
      if (!ok) return;
      btn.disabled = true;
      try {
        await global.acceptCoachInvite(coach);
        _toast(`You're now coached by ${coach}.`, 'success');
        n._answered = true;
        _changed();
      } catch (err) {
        btn.disabled = false;
        _toast(err.message || 'Could not accept the invite.', 'error');
      }
      return;
    }
    if ((act === 'accept' || act === 'decline') && global.Friends) {
      btn.disabled = true;
      try {
        await global.Friends.respond(n.actor, act === 'accept');
        _toast(act === 'accept' ? `You and ${n.actor} are now friends` : 'Request declined', act === 'accept' ? 'success' : 'info');
        n._answered = true;
        if (act === 'decline') return dismiss(n.id);
        _changed();
      } catch (err) {
        btn.disabled = false;
        _toast(err.message, 'error');
      }
    }
  }

  async function _renderSettings(sheet) {
    const body = sheet.querySelector('#ntBody');
    body.innerHTML = '<div class="nt-empty"><p>Loading…</p></div>';
    try {
      if (!_prefs) _prefs = (await api('GET', '/prefs')).prefs;
    } catch (err) {
      body.innerHTML = `<div class="nt-empty"><p>${_esc(err.message)}</p></div>`;
      return;
    }
    body.innerHTML = `
      <p class="nt-note">Choose what shows up here. Muted kinds aren’t saved at all.</p>
      <div class="nt-prefs">${CATEGORIES.map(c => `
        <div class="mx-srow">
          <div class="mx-srow-l"><span class="mx-srow-t">${c.label}</span><span class="mx-srow-s">${c.sub}</span></div>
          <button type="button" class="mx-switch" role="switch" data-cat="${c.id}" aria-checked="${_prefs[c.id] !== false}" aria-label="${c.label}"></button>
        </div>`).join('')}
      </div>`;
    body.querySelectorAll('.mx-switch').forEach(sw => sw.addEventListener('click', async () => {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      try {
        _prefs = (await api('PUT', '/prefs', { [sw.dataset.cat]: on })).prefs;
      } catch (err) {
        sw.setAttribute('aria-checked', String(!on));
        _toast(err.message, 'error');
      }
    }));
  }

  function openSheet() {
    closeSheet();
    const wrap = document.createElement('div');
    wrap.id = 'ntSheet';
    wrap.className = 'mx-sheet-backdrop nt-backdrop';
    wrap.innerHTML = `
      <div class="mx-sheet nt-sheet" role="dialog" aria-modal="true" aria-labelledby="ntTitle">
        <div class="mx-sheet-head">
          <h3 class="pod-title mx-h3" id="ntTitle">Notifications</h3>
          <span class="nt-head-actions">
            <button type="button" class="sx-link" id="ntSettingsBtn">${_icon('settings')}Settings</button>
            <button type="button" class="mx-iconbtn mx-iconbtn--ghost nt-close" aria-label="Close">${_icon('x')}</button>
          </span>
        </div>
        <div id="ntBody"><div id="ntList" class="nt-list"></div></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target === wrap) closeSheet(); });
    wrap.querySelector('.nt-close').addEventListener('click', closeSheet);
    document.addEventListener('keydown', _onKey);

    const sheet = wrap.querySelector('.nt-sheet');
    const settingsBtn = wrap.querySelector('#ntSettingsBtn');
    let inSettings = false;
    const showList = () => {
      inSettings = false;
      settingsBtn.innerHTML = `${_icon('settings')}Settings`;
      sheet.querySelector('#ntBody').innerHTML = '<div id="ntList" class="nt-list"></div>';
      const list = sheet.querySelector('#ntList');
      list.dataset.newIds = _items.filter(n => !n.read).map(n => n.id).join(',');
      list.addEventListener('click', _onListClick);
      _renderList(list);
    };
    settingsBtn.addEventListener('click', () => {
      if (inSettings) return showList();
      inSettings = true;
      settingsBtn.innerHTML = 'Done';
      _renderSettings(sheet);
    });

    showList();
    // Opening the sheet counts as reading everything in it.
    const hadUnread = _unread > 0;
    refresh().then(() => {
      const list = sheet.querySelector('#ntList');
      if (list && !inSettings) {
        list.dataset.newIds = [...new Set([...list.dataset.newIds.split(','), ..._items.filter(n => !n.read).map(n => n.id)])].filter(Boolean).join(',');
        _renderList(list);
      }
      if (hadUnread || _unread) markRead();
    });
    wrap.querySelector('.nt-close').focus();
  }

  /* ── Bells ──────────────────────────────────────────────── */

  function _wireBells() {
    document.querySelectorAll('.nt-bell').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', openSheet);
    });
    _paintBadges();
  }

  /* ── Polling ────────────────────────────────────────────── */

  function _poll() {
    if (document.visibilityState === 'hidden' && !('Notification' in global && Notification.permission === 'granted')) return;
    if (!_authHeaders().Authorization || !_user()) return;
    refresh().catch(() => {});
  }

  if (typeof document !== 'undefined' && !global.__NOTIFICATIONS_NO_POLL) {
    setInterval(_poll, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _poll(); });
    const start = () => { _wireBells(); setTimeout(_poll, 3500); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  const Notifications = { refresh, markRead, dismiss, open, openSheet, closeSheet, describe, ago, getItems: () => _items, getUnread: () => _unread };
  global.Notifications = Notifications;
  if (typeof module !== 'undefined' && module.exports) module.exports = Notifications;
})(typeof window !== 'undefined' ? window : globalThis);
