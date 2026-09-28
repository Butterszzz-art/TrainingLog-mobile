/* =============================================================
   FRIENDS & SOCIAL SHARING
   Friend requests (send → the other person accepts), quick-share
   panel, and shared template/program inbox.

   Friendships live on the server (/api/friends) so the other person
   actually hears about a request. The accepted list is cached in
   localStorage so getFriends() stays synchronous for the share sheet
   and the group builder. The app polls for new requests and shows a
   toast, a badge on the Friends tab and (if allowed) a system
   notification when someone adds you or accepts your request.
   ============================================================= */

(function () {
  'use strict';

  const DEFAULT_SERVER = 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
  const POLL_MS = 2 * 60 * 1000;
  const _u = () => window.currentUser || localStorage.getItem('fitnessAppUser') || 'anon';
  const FRIENDS_KEY = () => 'friends_' + _u();
  const REQUESTS_KEY = () => 'friendRequests_' + _u();
  const SEEN_KEY = () => 'friendRequestsSeen_' + _u();
  const MIGRATED_KEY = () => 'friendsMigrated_' + _u();
  const INBOX_KEY = () => 'sharedInbox_' + _u();
  const OUTBOX_KEY = () => 'sharedOutbox_' + _u();
  const _attr = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const _toast = (msg, type) => { if (typeof window.nativeToast === 'function') window.nativeToast(msg, type); };
  const _lower = s => String(s || '').toLowerCase();

  function _readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  }

  // ── Server API ──────────────────────────────────────────────

  function _authHeaders() {
    if (typeof window.getAuthHeaders === 'function') {
      try { return window.getAuthHeaders() || {}; } catch { /* fall through */ }
    }
    const token = localStorage.getItem('token');
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  async function api(method, path, body) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, _authHeaders());
    if (!headers.Authorization) {
      const err = new Error('Sign in to add friends.');
      err.code = 'friends.signed_out';
      throw err;
    }
    const res = await fetch((window.SERVER_URL || DEFAULT_SERVER) + '/api/friends' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok || !data || data.success === false) {
      const err = new Error(data?.error?.message || 'Could not reach the server. Try again.');
      err.code = data?.error?.code || 'friends.network';
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ── Friends & requests (local cache) ────────────────────────

  function getFriends() {
    return _readJson(FRIENDS_KEY(), []);
  }

  function saveFriends(list) {
    localStorage.setItem(FRIENDS_KEY(), JSON.stringify(list));
  }

  function getRequests() {
    const r = _readJson(REQUESTS_KEY(), {});
    return { incoming: r.incoming || [], outgoing: r.outgoing || [] };
  }

  function saveRequests(r) {
    localStorage.setItem(REQUESTS_KEY(), JSON.stringify({ incoming: r.incoming || [], outgoing: r.outgoing || [] }));
  }

  function updateFriendsBadge() {
    const badge = document.getElementById('commFriendsBadge');
    if (!badge) return;
    const n = getRequests().incoming.length;
    badge.style.display = n ? '' : 'none';
    badge.textContent = n;
  }

  function _systemNotify(body, tag) {
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        new Notification('Pocket Coach', { body, tag, icon: '/favicon.ico' });
      }
    } catch { /* not supported */ }
  }

  // Toast (and system notification when the app is in the background) for
  // requests we haven't told the user about yet, and for our own requests
  // that were just accepted.
  function _notifyChanges(prevOutgoing, data) {
    const seen = new Set(_readJson(SEEN_KEY(), []));
    const fresh = data.incoming.filter(r => !seen.has(_lower(r.username)));
    if (fresh.length === 1) {
      const msg = fresh[0].username + ' sent you a friend request';
      _toast(msg, 'info');
      _systemNotify(msg, 'pc-friend-req');
    } else if (fresh.length > 1) {
      const msg = fresh.length + ' new friend requests';
      _toast(msg, 'info');
      _systemNotify(msg, 'pc-friend-req');
    }
    localStorage.setItem(SEEN_KEY(), JSON.stringify(data.incoming.map(r => _lower(r.username))));

    const nowFriends = new Set(data.friends.map(f => _lower(f.username)));
    prevOutgoing.filter(r => nowFriends.has(_lower(r.username))).forEach(r => {
      const msg = r.username + ' accepted your friend request';
      _toast(msg, 'success');
      _systemNotify(msg, 'pc-friend-acc-' + _lower(r.username));
    });
  }

  // Friends added before requests existed were one-sided. Send each of them
  // a request once so they get to confirm too.
  async function _migrateLegacyFriends(data) {
    if (localStorage.getItem(MIGRATED_KEY())) return false;
    localStorage.setItem(MIGRATED_KEY(), '1');
    const known = new Set([...data.friends, ...data.incoming, ...data.outgoing].map(r => _lower(r.username)));
    const legacy = getFriends().filter(f => f && f.username && !known.has(_lower(f.username)));
    if (!legacy.length) return false;
    await Promise.all(legacy.map(f => api('POST', '/requests', { username: f.username }).catch(() => null)));
    return true;
  }

  let _syncQueue = Promise.resolve();

  // Pull friends + pending requests from the server into the cache. Calls run
  // one after another, so a refresh after a write never reuses a GET that
  // started before it.
  function syncFriends({ notify = true } = {}) {
    const run = async () => {
      const prevOutgoing = getRequests().outgoing;
      let data = await api('GET', '');
      if (await _migrateLegacyFriends(data)) data = await api('GET', '');
      saveFriends(data.friends.map(f => ({ username: f.username, addedAt: f.since || null })));
      saveRequests(data);
      if (notify) _notifyChanges(prevOutgoing, data);
      updateFriendsBadge();
      return data;
    };
    const p = _syncQueue.then(run, run);
    _syncQueue = p.catch(() => {});
    return p;
  }

  async function sendFriendRequest(username) {
    username = String(username || '').trim();
    if (!username) return null;
    if (_lower(username) === _lower(_u())) {
      const err = new Error('You can’t add yourself.');
      err.code = 'friends.self';
      throw err;
    }
    const res = await api('POST', '/requests', { username });
    await syncFriends({ notify: false }).catch(() => {});
    return res;
  }

  async function respondToRequest(username, accept) {
    const res = await api('POST', '/requests/' + encodeURIComponent(username) + (accept ? '/accept' : '/decline'));
    await syncFriends({ notify: false }).catch(() => {});
    return res;
  }

  async function removeFriend(username) {
    await api('DELETE', '/' + encodeURIComponent(username));
    saveFriends(getFriends().filter(f => _lower(f.username) !== _lower(username)));
    await syncFriends({ notify: false }).catch(() => {});
  }

  // ── Inbox / Outbox ──────────────────────────────────────────

  function getInbox() {
    try { return JSON.parse(localStorage.getItem(INBOX_KEY()) || '[]'); } catch { return []; }
  }

  function saveInbox(list) {
    localStorage.setItem(INBOX_KEY(), JSON.stringify(list));
  }

  function getOutbox() {
    try { return JSON.parse(localStorage.getItem(OUTBOX_KEY()) || '[]'); } catch { return []; }
  }

  function saveOutbox(list) {
    localStorage.setItem(OUTBOX_KEY(), JSON.stringify(list));
  }

  function sendToFriend(recipientUsername, item, note) {
    const outbox = getOutbox();
    const entry = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      to: recipientUsername,
      from: _u(),
      item,
      note: note || '',
      sentAt: new Date().toISOString(),
    };
    outbox.unshift(entry);
    saveOutbox(outbox);

    // Also put in recipient's inbox (localStorage — works for same-device demos)
    const recipientKey = 'sharedInbox_' + recipientUsername;
    try {
      const rInbox = JSON.parse(localStorage.getItem(recipientKey) || '[]');
      rInbox.unshift(entry);
      localStorage.setItem(recipientKey, JSON.stringify(rInbox));
    } catch {}

    // Also try backend
    const serverUrl = window.SERVER_URL || '';
    if (serverUrl && navigator.onLine) {
      fetch(serverUrl + '/sendTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderUsername: _u(),
          recipientUsername,
          templateName: item.name,
          templateData: item,
        }),
      }).catch(() => {});
    }

    return entry;
  }

  function acceptInboxItem(itemId) {
    const inbox = getInbox();
    const idx = inbox.findIndex(i => i.id === itemId);
    if (idx < 0) return null;
    const item = inbox[idx];
    inbox.splice(idx, 1);
    saveInbox(inbox);

    // Save the template/program to user's library
    if (item.item?.type === 'template' || item.item?.exercises) {
      const key = 'exerciseTemplates_' + _u();
      try {
        const templates = JSON.parse(localStorage.getItem(key) || '[]');
        templates.push({
          ...item.item,
          name: item.item.name + ' (from ' + item.from + ')',
          receivedAt: new Date().toISOString(),
        });
        localStorage.setItem(key, JSON.stringify(templates));
      } catch {}
    }

    if (item.item?.type === 'program' || item.item?.days) {
      const key = 'programs_' + _u();
      try {
        const programs = JSON.parse(localStorage.getItem(key) || '[]');
        programs.push({
          ...item.item,
          name: item.item.name + ' (from ' + item.from + ')',
          receivedAt: new Date().toISOString(),
        });
        localStorage.setItem(key, JSON.stringify(programs));
      } catch {}
    }

    return item;
  }

  function dismissInboxItem(itemId) {
    const inbox = getInbox().filter(i => i.id !== itemId);
    saveInbox(inbox);
  }

  // ── Share Code (encode/decode for clipboard sharing) ────────

  function generateShareCode(item) {
    try {
      const payload = JSON.stringify(item);
      return 'PC:' + btoa(unescape(encodeURIComponent(payload)));
    } catch { return ''; }
  }

  function decodeShareCode(code) {
    try {
      if (!code.startsWith('PC:')) return null;
      const json = decodeURIComponent(escape(atob(code.slice(3))));
      return JSON.parse(json);
    } catch { return null; }
  }

  // ── Render Friends Panel ────────────────────────────────────

  function renderFriendsPanel() {
    const container = document.getElementById('friendsPanel');
    if (!container) return;

    const friends = getFriends();
    const inbox = getInbox();

    let html = '';

    // Inbox badge
    if (inbox.length > 0) {
      html += '<div class="friends-card">'
        + '<h3>📥 Received (' + inbox.length + ')</h3>';
      inbox.forEach(item => {
        const date = new Date(item.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        html += '<div class="shared-inbox-item">'
          + '<div class="shared-inbox-header">'
          + '<span class="shared-inbox-from">From ' + item.from + '</span>'
          + '<span class="shared-inbox-date">' + date + '</span>'
          + '</div>'
          + '<div class="shared-inbox-name">' + (item.item?.name || 'Workout') + '</div>'
          + (item.note ? '<div class="shared-inbox-note">"' + item.note + '"</div>' : '')
          + '<div class="shared-inbox-actions">'
          + '<button class="shared-inbox-accept" onclick="acceptSharedItem(\'' + item.id + '\')">Save to Library</button>'
          + '<button class="shared-inbox-dismiss" onclick="dismissSharedItem(\'' + item.id + '\')">Dismiss</button>'
          + '</div></div>';
      });
      html += '</div>';
    }

    const { incoming, outgoing } = getRequests();
    const shortDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    const avatar = (name, open) => '<div class="friend-avatar" data-avatar-user="' + _attr(name) + '"' + (open ? ' data-avatar-open' : '') + '>'
      + _attr(String(name).charAt(0).toUpperCase()) + '</div>';

    // Incoming friend requests
    if (incoming.length) {
      html += '<div class="friends-card friends-requests">'
        + '<h3>Friend requests (' + incoming.length + ')</h3>'
        + '<div class="friends-list">';
      incoming.forEach(r => {
        const name = _attr(r.username);
        html += '<div class="friend-item">'
          + avatar(r.username, true)
          + '<div class="friend-info">'
          + '<div class="friend-name">' + name + '</div>'
          + '<div class="friend-meta">Wants to be your friend' + (r.sentAt ? ' · ' + shortDate(r.sentAt) : '') + '</div>'
          + '</div>'
          + '<div class="friend-actions">'
          + '<button class="friend-accept-btn" onclick="acceptFriendRequestUI(\'' + name + '\')">Accept</button>'
          + '<button class="friend-remove-btn" onclick="declineFriendRequestUI(\'' + name + '\')" aria-label="Decline request from ' + name + '">Decline</button>'
          + '</div></div>';
      });
      html += '</div></div>';
    }

    // Add friend
    html += '<div class="friends-card">'
      + '<h3>Friends</h3>'
      + '<div class="friends-add-row">'
      + '<input type="text" id="addFriendInput" placeholder="Username…" autocapitalize="off" autocomplete="off">'
      + '<button class="friends-add-btn" id="addFriendBtn" onclick="addFriendFromInput()">Send request</button>'
      + '</div>';

    // Import via share code
    html += '<div class="share-code-row" style="margin-top:0;margin-bottom:14px;">'
      + '<input type="text" id="importShareCode" class="share-code-input" placeholder="Paste a share code…">'
      + '<button class="share-code-copy" onclick="importFromShareCode()">Import</button>'
      + '</div>';

    if (!friends.length && !outgoing.length) {
      html += '<div class="friends-empty">No friends yet. Enter a username above — they\'ll get a request to accept.</div>';
    } else {
      html += '<div class="friends-list">';
      friends.forEach(f => {
        const name = _attr(f.username);
        html += '<div class="friend-item">'
          + avatar(f.username, true)
          + '<div class="friend-info">'
          + '<div class="friend-name">' + name + '</div>'
          + '<div class="friend-meta">' + (f.addedAt ? 'Friends since ' + shortDate(f.addedAt) : 'Friend') + '</div>'
          + '</div>'
          + '<div class="friend-actions">'
          + '<button class="friend-share-btn" onclick="openQuickShare(null, \'' + name + '\')">Share</button>'
          + '<button class="friend-remove-btn" onclick="removeFriendUI(\'' + name + '\')" aria-label="Remove ' + name + '">✕</button>'
          + '</div></div>';
      });
      outgoing.forEach(r => {
        const name = _attr(r.username);
        html += '<div class="friend-item friend-item--pending">'
          + avatar(r.username, false)
          + '<div class="friend-info">'
          + '<div class="friend-name">' + name + '</div>'
          + '<div class="friend-meta">Request sent · waiting for them to accept</div>'
          + '</div>'
          + '<div class="friend-actions">'
          + '<button class="friend-remove-btn" onclick="cancelFriendRequestUI(\'' + name + '\')">Cancel</button>'
          + '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
    updateFriendsBadge();
  }

  // Draw from cache right away, then again once the server answers.
  function openFriendsPanel() {
    renderFriendsPanel();
    syncFriends().then(renderFriendsPanel).catch(() => {});
  }

  // ── Quick Share Panel ───────────────────────────────────────

  let _quickShareItem = null;
  let _quickShareSelected = new Set();

  function openQuickShare(item, preselectedFriend) {
    _quickShareItem = item;
    _quickShareSelected = new Set();
    if (preselectedFriend) _quickShareSelected.add(preselectedFriend);

    let overlay = document.getElementById('quickShareOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'quickShareOverlay';
      overlay.className = 'quick-share-overlay';
      document.body.appendChild(overlay);
    }

    const friends = getFriends();
    const itemPreview = item
      ? '<div class="quick-share-item">'
        + '<div class="quick-share-item-name">' + (item.name || 'Workout') + '</div>'
        + '<div class="quick-share-item-meta">' + (item.type || 'template') + (item.exercises ? ' · ' + item.exercises.length + ' exercises' : '') + (item.days ? ' · ' + item.days.length + ' days' : '') + '</div>'
        + '</div>'
      : '<div class="quick-share-item">'
        + '<div class="quick-share-item-name">Select what to share</div>'
        + '<div class="quick-share-item-meta">Choose a template or program from your library</div>'
        + '</div>';

    let libraryPicker = '';
    if (!item) {
      const templates = _getUserTemplates();
      const programs = _getUserPrograms();
      libraryPicker = '<div style="margin-bottom:12px;">';
      if (templates.length) {
        libraryPicker += '<div style="font-size:0.75rem;color:var(--text-muted);font-weight:600;margin-bottom:6px;text-transform:uppercase;">Templates</div>';
        templates.forEach((t, i) => {
          libraryPicker += '<div class="quick-share-friend" onclick="selectQuickShareItem(\'template\',' + i + ')" data-lib="template-' + i + '">'
            + '<span style="flex:1;font-size:0.85rem;font-weight:600;color:var(--text-color);">📋 ' + (t.name || 'Template ' + (i+1)) + '</span>'
            + '</div>';
        });
      }
      if (programs.length) {
        libraryPicker += '<div style="font-size:0.75rem;color:var(--text-muted);font-weight:600;margin:10px 0 6px;text-transform:uppercase;">Programs</div>';
        programs.forEach((p, i) => {
          libraryPicker += '<div class="quick-share-friend" onclick="selectQuickShareItem(\'program\',' + i + ')" data-lib="program-' + i + '">'
            + '<span style="flex:1;font-size:0.85rem;font-weight:600;color:var(--text-color);">🗓 ' + (p.name || 'Program ' + (i+1)) + '</span>'
            + '</div>';
        });
      }
      if (!templates.length && !programs.length) {
        libraryPicker += '<div class="friends-empty">No templates or programs to share yet.</div>';
      }
      libraryPicker += '</div>';
    }

    let friendsHtml = '';
    if (friends.length) {
      friendsHtml = '<div class="quick-share-friends">';
      friends.forEach(f => {
        const sel = _quickShareSelected.has(f.username) ? ' selected' : '';
        const init = f.username.charAt(0).toUpperCase();
        friendsHtml += '<div class="quick-share-friend' + sel + '" onclick="toggleQuickShareFriend(\'' + f.username + '\')">'
          + '<div class="friend-avatar" data-avatar-user="' + _attr(f.username) + '">' + init + '</div>'
          + '<span class="quick-share-friend-name">' + f.username + '</span>'
          + '<span class="quick-share-check">✓</span>'
          + '</div>';
      });
      friendsHtml += '</div>';
    } else {
      friendsHtml = '<div class="friends-empty" style="margin-bottom:12px">Add friends first from the Friends tab.</div>';
    }

    // Share code
    let shareCodeHtml = '';
    if (item) {
      const code = generateShareCode(item);
      shareCodeHtml = '<div class="share-code-row">'
        + '<input type="text" class="share-code-input" value="' + code + '" readonly id="shareCodeValue">'
        + '<button class="share-code-copy" onclick="copyShareCode()">Copy</button>'
        + '</div>';
    }

    overlay.innerHTML = '<div class="quick-share-panel">'
      + '<div class="quick-share-handle"></div>'
      + '<div class="quick-share-title">Share with Friends</div>'
      + '<div class="quick-share-subtitle">Select friends to send this to</div>'
      + itemPreview
      + libraryPicker
      + friendsHtml
      + '<textarea class="quick-share-note" id="quickShareNote" placeholder="Add a note… (optional)"></textarea>'
      + '<button class="quick-share-send" id="quickShareSendBtn" onclick="sendQuickShare()"'
      + (_quickShareSelected.size ? '' : ' disabled') + '>Send to ' + (_quickShareSelected.size || 0) + ' friend' + (_quickShareSelected.size !== 1 ? 's' : '') + '</button>'
      + shareCodeHtml
      + '</div>';

    overlay.classList.add('open');

    // Close on scrim click
    overlay.addEventListener('click', function handler(e) {
      if (e.target === overlay) {
        overlay.classList.remove('open');
        overlay.removeEventListener('click', handler);
      }
    });
  }

  function toggleQuickShareFriend(username) {
    if (_quickShareSelected.has(username)) _quickShareSelected.delete(username);
    else _quickShareSelected.add(username);

    // Update UI
    document.querySelectorAll('#quickShareOverlay .quick-share-friend').forEach(el => {
      const name = el.querySelector('.quick-share-friend-name')?.textContent;
      el.classList.toggle('selected', _quickShareSelected.has(name));
    });
    const btn = document.getElementById('quickShareSendBtn');
    if (btn) {
      btn.disabled = _quickShareSelected.size === 0;
      btn.textContent = 'Send to ' + _quickShareSelected.size + ' friend' + (_quickShareSelected.size !== 1 ? 's' : '');
    }
  }

  function selectQuickShareItem(type, index) {
    const items = type === 'template' ? _getUserTemplates() : _getUserPrograms();
    if (items[index]) {
      _quickShareItem = { ...items[index], type };
      // Highlight selected
      document.querySelectorAll('#quickShareOverlay [data-lib]').forEach(el => {
        el.classList.toggle('selected', el.dataset.lib === type + '-' + index);
      });
    }
  }

  function sendQuickShare() {
    if (!_quickShareItem || _quickShareSelected.size === 0) return;
    const note = document.getElementById('quickShareNote')?.value?.trim() || '';
    let sent = 0;
    _quickShareSelected.forEach(username => {
      sendToFriend(username, _quickShareItem, note);
      sent++;
    });

    const overlay = document.getElementById('quickShareOverlay');
    if (overlay) overlay.classList.remove('open');

    if (typeof nativeToast === 'function') {
      nativeToast('Sent to ' + sent + ' friend' + (sent > 1 ? 's' : ''), 'success');
    }
    renderFriendsPanel();
  }

  function copyShareCode() {
    const input = document.getElementById('shareCodeValue');
    if (!input) return;
    navigator.clipboard?.writeText(input.value).then(() => {
      if (typeof nativeToast === 'function') nativeToast('Share code copied!', 'success');
    }).catch(() => {
      input.select();
      document.execCommand('copy');
      if (typeof nativeToast === 'function') nativeToast('Share code copied!', 'success');
    });
  }

  function importFromShareCode() {
    const input = document.getElementById('importShareCode');
    if (!input?.value) return;
    const item = decodeShareCode(input.value.trim());
    if (!item) {
      if (typeof nativeToast === 'function') nativeToast('Invalid share code', 'error');
      return;
    }

    // Add to inbox
    const inbox = getInbox();
    inbox.unshift({
      id: Date.now() + '_import',
      from: 'share code',
      to: _u(),
      item,
      note: 'Imported via share code',
      sentAt: new Date().toISOString(),
    });
    saveInbox(inbox);
    input.value = '';
    if (typeof nativeToast === 'function') nativeToast('Imported! Check your Received section.', 'success');
    renderFriendsPanel();
  }

  // ── UI Helpers ──────────────────────────────────────────────

  function _getUserTemplates() {
    try { return JSON.parse(localStorage.getItem('exerciseTemplates_' + _u()) || '[]'); } catch { return []; }
  }

  function _getUserPrograms() {
    try {
      const raw = localStorage.getItem('programs_' + _u());
      if (raw) return JSON.parse(raw);
      const ai = localStorage.getItem('aiGeneratedProgram_' + _u());
      if (ai) return [JSON.parse(ai)];
      return [];
    } catch { return []; }
  }

  function _friendError(err) {
    _toast(err?.message || 'Something went wrong. Try again.', err?.code === 'friends.already_friends' ? 'warn' : 'error');
  }

  window.addFriendFromInput = async function () {
    const input = document.getElementById('addFriendInput');
    const btn = document.getElementById('addFriendBtn');
    const name = input?.value?.trim();
    if (!name) return;
    if (btn) btn.disabled = true;
    try {
      const res = await sendFriendRequest(name);
      if (input) input.value = '';
      if (res?.status === 'accepted') _toast('You and ' + res.username + ' are now friends!', 'success');
      else _toast('Friend request sent to ' + (res?.username || name), 'success');
    } catch (err) {
      _friendError(err);
    } finally {
      if (btn) btn.disabled = false;
      renderFriendsPanel();
    }
  };

  window.acceptFriendRequestUI = async function (username) {
    try {
      await respondToRequest(username, true);
      _toast('You and ' + username + ' are now friends!', 'success');
    } catch (err) { _friendError(err); }
    renderFriendsPanel();
  };

  window.declineFriendRequestUI = async function (username) {
    try { await respondToRequest(username, false); } catch (err) { _friendError(err); }
    renderFriendsPanel();
  };

  window.cancelFriendRequestUI = async function (username) {
    try { await respondToRequest(username, false); } catch (err) { _friendError(err); }
    renderFriendsPanel();
  };

  window.removeFriendUI = async function (username) {
    const ok = typeof window.showConfirm === 'function'
      ? await window.showConfirm('Remove ' + username + ' from your friends?', { confirmText: 'Remove', danger: true })
      : true;
    if (!ok) return;
    try { await removeFriend(username); } catch (err) { _friendError(err); }
    renderFriendsPanel();
  };

  window.acceptSharedItem = function (itemId) {
    const item = acceptInboxItem(itemId);
    if (item && typeof nativeToast === 'function') {
      nativeToast('Saved "' + (item.item?.name || 'item') + '" to your library!', 'success');
    }
    renderFriendsPanel();
  };

  window.dismissSharedItem = function (itemId) {
    dismissInboxItem(itemId);
    renderFriendsPanel();
  };

  window.openQuickShare = openQuickShare;
  window.toggleQuickShareFriend = toggleQuickShareFriend;
  window.selectQuickShareItem = selectQuickShareItem;
  window.sendQuickShare = sendQuickShare;
  window.copyShareCode = copyShareCode;
  window.importFromShareCode = importFromShareCode;
  window.renderFriendsPanel = openFriendsPanel;
  window.generateShareCode = generateShareCode;
  window.decodeShareCode = decodeShareCode;
  window.getFriends = getFriends;
  window.Friends = { sync: syncFriends, sendRequest: sendFriendRequest, respond: respondToRequest, remove: removeFriend, getFriends, getRequests };

  // ── Polling for new requests ────────────────────────────────

  function _poll() {
    if (document.visibilityState === 'hidden' && !('Notification' in window && Notification.permission === 'granted')) return;
    if (!_authHeaders().Authorization) return;
    syncFriends().then(() => {
      const panel = document.getElementById('friendsPanel');
      if (panel && panel.style.display !== 'none') renderFriendsPanel();
    }).catch(() => {});
  }

  if (!window.__FRIENDS_NO_POLL) {
    setTimeout(_poll, 3000);
    setInterval(_poll, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _poll(); });
  }
  updateFriendsBadge();
})();
