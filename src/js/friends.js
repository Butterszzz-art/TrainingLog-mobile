/* =============================================================
   FRIENDS & SOCIAL SHARING
   localStorage-first friends list, quick-share panel, and
   shared template/program inbox.
   ============================================================= */

(function () {
  'use strict';

  const _u = () => window.currentUser || localStorage.getItem('fitnessAppUser') || 'anon';
  const FRIENDS_KEY = () => 'friends_' + _u();
  const INBOX_KEY = () => 'sharedInbox_' + _u();
  const OUTBOX_KEY = () => 'sharedOutbox_' + _u();

  // ── Friends CRUD ────────────────────────────────────────────

  function getFriends() {
    try { return JSON.parse(localStorage.getItem(FRIENDS_KEY()) || '[]'); } catch { return []; }
  }

  function saveFriends(list) {
    localStorage.setItem(FRIENDS_KEY(), JSON.stringify(list));
  }

  function addFriend(username) {
    username = (username || '').trim().toLowerCase();
    if (!username) return false;
    if (username === _u().toLowerCase()) return false;
    const friends = getFriends();
    if (friends.find(f => f.username.toLowerCase() === username)) return false;
    friends.push({ username, addedAt: new Date().toISOString() });
    saveFriends(friends);
    return true;
  }

  function removeFriend(username) {
    const friends = getFriends().filter(f => f.username.toLowerCase() !== username.toLowerCase());
    saveFriends(friends);
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

    // Add friend
    html += '<div class="friends-card">'
      + '<h3>Friends</h3>'
      + '<div class="friends-add-row">'
      + '<input type="text" id="addFriendInput" placeholder="Username…">'
      + '<button class="friends-add-btn" onclick="addFriendFromInput()">+ Add</button>'
      + '</div>';

    // Import via share code
    html += '<div class="share-code-row" style="margin-top:0;margin-bottom:14px;">'
      + '<input type="text" id="importShareCode" class="share-code-input" placeholder="Paste a share code…">'
      + '<button class="share-code-copy" onclick="importFromShareCode()">Import</button>'
      + '</div>';

    if (!friends.length) {
      html += '<div class="friends-empty">No friends added yet. Enter a username above to connect.</div>';
    } else {
      html += '<div class="friends-list">';
      friends.forEach(f => {
        const initial = f.username.charAt(0).toUpperCase();
        html += '<div class="friend-item">'
          + '<div class="friend-avatar">' + initial + '</div>'
          + '<div class="friend-info">'
          + '<div class="friend-name">' + f.username + '</div>'
          + '<div class="friend-meta">Added ' + new Date(f.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</div>'
          + '</div>'
          + '<div class="friend-actions">'
          + '<button class="friend-share-btn" onclick="openQuickShare(null, \'' + f.username + '\')">Share</button>'
          + '<button class="friend-remove-btn" onclick="removeFriendUI(\'' + f.username + '\')">✕</button>'
          + '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
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
          + '<div class="friend-avatar">' + init + '</div>'
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

  window.addFriendFromInput = function () {
    const input = document.getElementById('addFriendInput');
    if (!input?.value?.trim()) return;
    const ok = addFriend(input.value);
    if (ok) {
      input.value = '';
      if (typeof nativeToast === 'function') nativeToast('Friend added!', 'success');
    } else {
      if (typeof nativeToast === 'function') nativeToast('Already a friend or invalid username', 'warn');
    }
    renderFriendsPanel();
  };

  window.removeFriendUI = function (username) {
    removeFriend(username);
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
  window.renderFriendsPanel = renderFriendsPanel;
  window.generateShareCode = generateShareCode;
  window.decodeShareCode = decodeShareCode;
  window.getFriends = getFriends;
})();
