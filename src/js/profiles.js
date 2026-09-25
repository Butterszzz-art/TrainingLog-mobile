/**
 * profiles.js
 * Profile photos, display names and bios, shown anywhere the app puts a
 * person's avatar (community feed, leaderboard, friends, coach views,
 * settings).
 *
 * Render sites keep drawing their initials exactly as before and just add
 * `data-avatar-user="<username>"` to the avatar element. This file watches
 * the DOM for those elements, looks the usernames up in one batched request
 * (POST /api/profiles/lookup), and swaps the initials for the photo when
 * there is one the viewer is allowed to see. Nothing changes if the lookup
 * fails or the person has no photo: the initials simply stay.
 *
 * Add `data-avatar-open` as well to make tapping the avatar open that
 * person's profile card (photo, name, bio, report / hide photo).
 *
 * Profiles are cached in localStorage per username with the photo's version,
 * so the server only re-sends a photo after it changes.
 */
(function (global) {
  'use strict';

  const DEFAULT_SERVER = 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
  const CACHE_KEY = 'pcProfiles_v1';
  const HIDDEN_KEY = 'pcHiddenAvatars_v1';
  const CACHE_MAX = 80;
  const FRESH_MS = 10 * 60 * 1000;
  const LOOKUP_MAX = 100;
  const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,64}$/;
  const PHOTO_SIZE = 256;
  const PHOTO_MAX_BYTES = 140 * 1024;
  const BIO_MAX = 160;
  const NAME_MAX = 40;
  const VISIBILITY_LABELS = {
    everyone: 'Everyone',
    coach: 'My coach & clients only',
    private: 'Only me',
  };
  const REPORT_REASONS = [
    ['inappropriate', 'Inappropriate photo or bio'],
    ['impersonation', 'Pretending to be someone else'],
    ['spam', 'Spam or advertising'],
    ['other', 'Something else'],
  ];

  /* ── Helpers ─────────────────────────────────────────────── */

  function profileKey(username) {
    const s = String(username == null ? '' : username).trim();
    if (!USERNAME_RE.test(s) || /^\.+$/.test(s)) return null;
    return s.toLowerCase();
  }

  function initialsFor(name, count) {
    const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
    const n = count || 1;
    const s = words.length > 1 && n > 1
      ? words.map(w => w[0]).join('')
      : (words[0] || '?');
    return s.slice(0, n).toUpperCase();
  }

  function storage() {
    try { return global.localStorage || null; } catch { return null; }
  }

  function readJson(key, fallback) {
    const ls = storage();
    if (!ls) return fallback;
    try { return JSON.parse(ls.getItem(key)) || fallback; } catch { return fallback; }
  }

  function writeJson(key, value) {
    const ls = storage();
    if (!ls) return false;
    try { ls.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  function currentUser() {
    const fromHelper = typeof global.getActiveUsername === 'function' ? global.getActiveUsername() : '';
    const ls = storage();
    return (typeof fromHelper === 'string' && fromHelper)
      || (typeof global.currentUser === 'string' && global.currentUser)
      || (ls && (ls.getItem('fitnessAppUser') || ls.getItem('username')))
      || '';
  }

  function serverUrl() {
    return global.SERVER_URL || DEFAULT_SERVER;
  }

  function authHeaders() {
    if (typeof global.getAuthHeaders === 'function') {
      try { return global.getAuthHeaders() || {}; } catch { /* fall through */ }
    }
    const ls = storage();
    const token = ls && ls.getItem('token');
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  async function api(method, path, body) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders());
    if (!headers.Authorization) throw new Error('Not signed in');
    const res = await fetch(serverUrl() + '/api/profiles' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok || !data || data.success === false) {
      const err = new Error((data && data.error && data.error.message) || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ── Cache ───────────────────────────────────────────────── */

  // key -> { username, displayName, bio, avatarVersion, avatar, hidden, at }
  let _cache = null;
  function cache() {
    if (!_cache) _cache = readJson(CACHE_KEY, {});
    return _cache;
  }

  function persistCache() {
    const entries = Object.entries(cache());
    if (entries.length > CACHE_MAX) {
      entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      _cache = Object.fromEntries(entries.slice(0, CACHE_MAX));
    }
    if (writeJson(CACHE_KEY, _cache)) return;
    // Out of quota: keep only the most recent few rather than lose everything.
    const recent = Object.entries(_cache).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 20);
    _cache = Object.fromEntries(recent);
    writeJson(CACHE_KEY, _cache);
  }

  // Merges a lookup result into the cache. The server leaves `avatar` out
  // when our cached version is still current, so keep the one we have.
  function mergeProfile(key, incoming, now) {
    const prev = cache()[key] || {};
    const next = {
      username: incoming.username || prev.username || key,
      displayName: incoming.displayName || '',
      bio: incoming.bio || '',
      avatarVersion: incoming.avatarVersion || null,
      avatar: null,
      hidden: !!incoming.hidden,
      at: now || Date.now(),
    };
    if (!next.hidden && next.avatarVersion) {
      next.avatar = incoming.avatar || (prev.avatarVersion === next.avatarVersion ? prev.avatar : null);
    }
    cache()[key] = next;
    return next;
  }

  function clearCache() {
    _cache = {};
    const ls = storage();
    if (ls) { try { ls.removeItem(CACHE_KEY); ls.removeItem(HIDDEN_KEY); } catch { /* ignore */ } }
  }

  function getCached(username) {
    const key = profileKey(username);
    return key ? cache()[key] || null : null;
  }

  function hiddenSet() {
    return new Set(readJson(HIDDEN_KEY, []));
  }

  function isPhotoHiddenByMe(key) {
    return hiddenSet().has(key);
  }

  function setPhotoHiddenByMe(key, hide) {
    const set = hiddenSet();
    if (hide) set.add(key); else set.delete(key);
    writeJson(HIDDEN_KEY, [...set]);
    refresh(key);
  }

  /* ── Filling avatar elements ─────────────────────────────── */

  function paint(el) {
    const key = profileKey(el.getAttribute('data-avatar-user'));
    const entry = key ? cache()[key] : null;
    const src = entry && !entry.hidden && entry.avatar && !isPhotoHiddenByMe(key) ? entry.avatar : null;
    const img = el.querySelector(':scope > img.pc-avatar-img');

    if (src) {
      if (img && img.getAttribute('src') === src) return;
      if (!el.hasAttribute('data-avatar-initials')) el.setAttribute('data-avatar-initials', el.textContent);
      const next = document.createElement('img');
      next.className = 'pc-avatar-img';
      next.alt = '';
      next.decoding = 'async';
      next.src = src;
      el.textContent = '';
      el.appendChild(next);
      el.classList.add('has-photo');
    } else if (img) {
      el.textContent = el.getAttribute('data-avatar-initials') || initialsFor(entry?.displayName || key);
      el.classList.remove('has-photo');
    }
  }

  function elementsFor(key) {
    return [...document.querySelectorAll('[data-avatar-user]')]
      .filter(el => profileKey(el.getAttribute('data-avatar-user')) === key);
  }

  function refresh(key) {
    if (typeof document === 'undefined') return;
    (key ? elementsFor(key) : document.querySelectorAll('[data-avatar-user]')).forEach(paint);
  }

  const _queue = new Set();
  const _inFlight = new Set();
  let _timer = null;

  function request(key) {
    if (!key || _inFlight.has(key)) return;
    const entry = cache()[key];
    if (entry && Date.now() - (entry.at || 0) < FRESH_MS) return;
    _queue.add(key);
    if (!_timer) _timer = setTimeout(flush, 60);
  }

  async function flush() {
    _timer = null;
    const keys = [..._queue].slice(0, LOOKUP_MAX);
    keys.forEach(k => { _queue.delete(k); _inFlight.add(k); });
    if (_queue.size) _timer = setTimeout(flush, 60);
    if (!keys.length) return;

    const have = {};
    keys.forEach(k => { const e = cache()[k]; if (e && e.avatar && e.avatarVersion) have[k] = e.avatarVersion; });
    try {
      const data = await api('POST', '/lookup', { usernames: keys, have });
      const now = Date.now();
      keys.forEach(k => mergeProfile(k, (data.profiles || {})[k] || { username: k, hidden: true }, now));
      persistCache();
      keys.forEach(refresh);
    } catch {
      // Offline, signed out or the endpoint is unavailable: keep initials and
      // whatever is cached; try again on the next render.
    } finally {
      keys.forEach(k => _inFlight.delete(k));
    }
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    const els = root.matches('[data-avatar-user]') ? [root] : [];
    els.push(...root.querySelectorAll('[data-avatar-user]'));
    els.forEach(el => {
      paint(el);
      request(profileKey(el.getAttribute('data-avatar-user')));
    });
  }

  /* ── Profile card (someone else's profile) ───────────────── */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function openSheet(label) {
    closeSheet();
    const backdrop = el('div', 'mx-sheet-backdrop pc-profile-backdrop');
    backdrop.id = 'pcProfileSheet';
    const sheet = el('div', 'mx-sheet pc-profile-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', label);
    backdrop.appendChild(sheet);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeSheet(); });
    document.body.appendChild(backdrop);
    return sheet;
  }

  function closeSheet() {
    const existing = document.getElementById('pcProfileSheet');
    if (existing) existing.remove();
  }

  function sheetHead(sheet, title) {
    const head = el('div', 'mx-sheet-head');
    head.appendChild(el('h3', 'pod-title mx-h3', title));
    const close = el('button', 'mx-iconbtn mx-iconbtn--ghost pc-sheet-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeSheet);
    head.appendChild(close);
    sheet.appendChild(head);
  }

  function bigAvatar(username, entry, photo) {
    const av = el('div', 'pc-avatar-lg', initialsFor(entry?.displayName || username, 2));
    if (photo) {
      av.textContent = '';
      const img = el('img', 'pc-avatar-img');
      img.alt = '';
      img.src = photo;
      av.appendChild(img);
      av.classList.add('has-photo');
    }
    return av;
  }

  async function openProfileCard(username) {
    const key = profileKey(username);
    if (!key) return;
    if (key === profileKey(currentUser())) return openEditor();

    // Always refresh when someone deliberately opens a card.
    if (cache()[key]) cache()[key].at = 0;
    request(key);
    if (_timer) { clearTimeout(_timer); await flush(); }

    const entry = cache()[key] || { username, hidden: true };
    const sheet = openSheet('Profile of ' + (entry.username || username));
    sheetHead(sheet, 'Profile');

    const hiddenByMe = isPhotoHiddenByMe(key);
    const top = el('div', 'pc-profile-top');
    top.appendChild(bigAvatar(entry.username || username, entry, !entry.hidden && !hiddenByMe ? entry.avatar : null));
    const names = el('div', 'pc-profile-names');
    names.appendChild(el('div', 'pc-profile-display', entry.displayName || entry.username || username));
    names.appendChild(el('div', 'pc-profile-handle', '@' + (entry.username || username)));
    top.appendChild(names);
    sheet.appendChild(top);

    if (entry.hidden) {
      sheet.appendChild(el('p', 'mx-para pc-profile-private', 'This profile is private.'));
      return;
    }
    if (entry.bio) sheet.appendChild(el('p', 'mx-para pc-profile-bio', entry.bio));

    const actions = el('div', 'pc-profile-actions');
    if (entry.avatar || hiddenByMe) {
      const hideBtn = el('button', 'mx-outline mx-outline--block', hiddenByMe ? 'Show their photo' : 'Hide their photo');
      hideBtn.type = 'button';
      hideBtn.addEventListener('click', () => {
        setPhotoHiddenByMe(key, !hiddenByMe);
        openProfileCard(username);
      });
      actions.appendChild(hideBtn);
    }
    const reportBtn = el('button', 'mx-outline mx-outline--block mx-outline--danger', 'Report profile');
    reportBtn.type = 'button';
    reportBtn.addEventListener('click', () => openReport(entry.username || username));
    actions.appendChild(reportBtn);
    sheet.appendChild(actions);
  }

  function openReport(username) {
    const sheet = openSheet('Report ' + username);
    sheetHead(sheet, 'Report @' + username);
    sheet.appendChild(el('p', 'mx-para', 'What’s wrong with this profile? Reports are reviewed and the photo or bio is removed if it breaks the rules.'));

    const list = el('div', 'pc-report-reasons');
    let chosen = null;
    REPORT_REASONS.forEach(([value, label]) => {
      const row = el('label', 'pc-report-reason');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'pcReportReason';
      radio.value = value;
      radio.addEventListener('change', () => { chosen = value; send.disabled = false; });
      row.appendChild(radio);
      row.appendChild(el('span', null, label));
      list.appendChild(row);
    });
    sheet.appendChild(list);

    const noteField = el('div', 'mx-field');
    noteField.appendChild(el('label', 'mx-lbl', 'Details (optional)'));
    const noteWell = el('div', 'mx-well mx-well--area');
    const note = el('textarea');
    note.maxLength = 300;
    note.rows = 3;
    noteWell.appendChild(note);
    noteField.appendChild(noteWell);
    sheet.appendChild(noteField);

    const status = el('p', 'pc-status');
    const send = el('button', 'mx-cta', 'Send report');
    send.type = 'button';
    send.disabled = true;
    send.addEventListener('click', async () => {
      send.disabled = true;
      status.textContent = 'Sending…';
      try {
        await api('POST', '/' + encodeURIComponent(username) + '/report', { reason: chosen, note: note.value });
        sheet.textContent = '';
        sheetHead(sheet, 'Thanks');
        sheet.appendChild(el('p', 'mx-para', 'Your report was sent. You can also hide this person’s photo from their profile card.'));
      } catch (err) {
        status.textContent = err.message || 'Could not send the report.';
        send.disabled = false;
      }
    });
    sheet.appendChild(send);
    sheet.appendChild(status);
  }

  /* ── Profile editor (your own profile) ───────────────────── */

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t an image we can read.')); };
      img.src = url;
    });
  }

  // Centre-crops to a square and shrinks to PHOTO_SIZE, lowering JPEG quality
  // until it fits PHOTO_MAX_BYTES. Output is always a JPEG data URL, which
  // also strips any EXIF metadata (location etc.) from the original photo.
  async function resizePhoto(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Choose an image file.');
    const img = await loadImage(file);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('That image looks empty.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#121b17';
    ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    for (const q of [0.85, 0.75, 0.6, 0.45]) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (Math.ceil((url.length - url.indexOf(',') - 1) * 3 / 4) <= PHOTO_MAX_BYTES) return url;
    }
    throw new Error('That photo is too detailed to upload. Try another one.');
  }

  async function openEditor() {
    const me = currentUser();
    const key = profileKey(me);
    if (!key) return;

    const sheet = openSheet('Edit your profile');
    sheetHead(sheet, 'Your profile');
    const status = el('p', 'pc-status', 'Loading…');
    sheet.appendChild(status);

    let profile;
    try {
      profile = (await api('GET', '/me')).profile;
      status.textContent = '';
    } catch (err) {
      status.textContent = err.status === 503
        ? 'Profiles aren’t available on this account yet.'
        : (err.message === 'Not signed in' ? 'Sign in to edit your profile.' : 'Couldn’t load your profile. Check your connection and try again.');
      return;
    }

    let pendingPhoto;              // undefined = unchanged, null = remove, string = new photo
    const state = { photo: profile.avatar || null };

    const top = el('div', 'pc-editor-photo');
    let preview = bigAvatar(me, profile, state.photo);
    top.appendChild(preview);
    const photoBtns = el('div', 'pc-editor-photo-btns');
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    const choose = el('button', 'mx-outline', state.photo ? 'Change photo' : 'Add photo');
    choose.type = 'button';
    choose.addEventListener('click', () => file.click());
    const remove = el('button', 'mx-outline mx-outline--danger', 'Remove');
    remove.type = 'button';
    remove.hidden = !state.photo;
    const repaint = () => {
      const next = bigAvatar(me, { displayName: nameInput.value }, state.photo);
      preview.replaceWith(next);
      preview = next;
      choose.textContent = state.photo ? 'Change photo' : 'Add photo';
      remove.hidden = !state.photo;
    };
    remove.addEventListener('click', () => { state.photo = null; pendingPhoto = null; repaint(); });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      status.textContent = 'Preparing photo…';
      try {
        const url = await resizePhoto(f);
        state.photo = url;
        pendingPhoto = url;
        status.textContent = '';
        repaint();
      } catch (err) {
        status.textContent = err.message;
      }
    });
    photoBtns.append(choose, remove, file);
    top.appendChild(photoBtns);
    sheet.appendChild(top);

    const nameField = el('div', 'mx-field');
    const nameLbl = el('label', 'mx-lbl', 'Display name');
    nameLbl.htmlFor = 'pcEditName';
    const nameWell = el('div', 'mx-well mx-well--text');
    const nameInput = el('input');
    nameInput.id = 'pcEditName';
    nameInput.maxLength = NAME_MAX;
    nameInput.placeholder = me;
    nameInput.value = profile.displayName || '';
    nameWell.appendChild(nameInput);
    nameField.append(nameLbl, nameWell);
    sheet.appendChild(nameField);

    const bioField = el('div', 'mx-field');
    const bioLbl = el('label', 'mx-lbl', 'Bio');
    bioLbl.htmlFor = 'pcEditBio';
    const bioWell = el('div', 'mx-well mx-well--area');
    const bioInput = el('textarea');
    bioInput.id = 'pcEditBio';
    bioInput.rows = 3;
    bioInput.maxLength = BIO_MAX;
    bioInput.placeholder = 'e.g. Powerlifter, 3 years training. Chasing a 200 kg deadlift.';
    bioInput.value = profile.bio || '';
    bioWell.appendChild(bioInput);
    const counter = el('div', 'pc-counter');
    const count = () => { counter.textContent = bioInput.value.length + ' / ' + BIO_MAX; };
    bioInput.addEventListener('input', count);
    count();
    bioField.append(bioLbl, bioWell, counter);
    sheet.appendChild(bioField);

    const visField = el('div', 'mx-field');
    const visLbl = el('label', 'mx-lbl', 'Who can see my photo and bio');
    visLbl.htmlFor = 'pcEditVis';
    const visWell = el('div', 'mx-well mx-well--text mx-well--sel');
    const visSel = el('select');
    visSel.id = 'pcEditVis';
    Object.entries(VISIBILITY_LABELS).forEach(([value, label]) => {
      const opt = el('option', null, label);
      opt.value = value;
      opt.selected = (profile.visibility || 'everyone') === value;
      visSel.appendChild(opt);
    });
    visWell.appendChild(visSel);
    visField.append(visLbl, visWell);
    visField.appendChild(el('div', 'pc-hint', 'Anyone who can’t see it just sees your username and initials.'));
    sheet.appendChild(visField);

    const save = el('button', 'mx-cta', 'Save profile');
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        const saved = (await api('PUT', '/me', {
          displayName: nameInput.value,
          bio: bioInput.value,
          visibility: visSel.value,
        })).profile;
        let version = saved.avatarVersion;
        if (pendingPhoto) version = (await api('PUT', '/me/avatar', { image: pendingPhoto })).avatarVersion;
        else if (pendingPhoto === null) version = (await api('DELETE', '/me/avatar')).avatarVersion;

        mergeProfile(key, { ...saved, avatarVersion: version, avatar: state.photo || undefined });
        persistCache();
        refresh(key);
        if (typeof global.renderSettingsHero === 'function') global.renderSettingsHero();
        closeSheet();
        if (typeof global.showToast === 'function') global.showToast('Profile saved');
      } catch (err) {
        status.textContent = err.message || 'Could not save your profile.';
        save.disabled = false;
      }
    });
    sheet.appendChild(save);
    sheet.appendChild(el('p', 'pc-hint', 'Photos are cropped to a square and shrunk before upload. Keep it respectful: profiles can be reported and removed.'));
  }

  /* ── Wiring ──────────────────────────────────────────────── */

  function init() {
    if (typeof document === 'undefined' || !document.body) return;
    scan(document.body);
    if (typeof MutationObserver === 'function') {
      new MutationObserver(records => {
        records.forEach(r => {
          if (r.type === 'attributes') scan(r.target);
          else r.addedNodes.forEach(scan);
        });
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-avatar-user'] });
    }
    document.addEventListener('click', e => {
      const target = e.target && e.target.closest && e.target.closest('[data-avatar-open]');
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      openProfileCard(target.getAttribute('data-avatar-user'));
    }, true);
  }

  const api_ = {
    openEditor,
    openProfileCard,
    refresh,
    get: getCached,
    clearCache,
    profileKey,
    initialsFor,
  };
  global.Profiles = api_;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign({}, api_, {
      _mergeProfile: mergeProfile,
      _cache: () => cache(),
      _resetCache: () => { _cache = null; },
      _paint: paint,
      _flush: flush,
      _request: request,
      _setPhotoHiddenByMe: setPhotoHiddenByMe,
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
