/* =============================================================
   SHARES — send a program or template to a friend
   Server inbox at /api/shares (backend src/routes/shares.js). Used by
   the Community → Share panel and the Friends quick-share sheet.

   Sharing used to write into the recipient's localStorage key on the
   sender's own phone, so nothing ever arrived. Now the item is stored
   on the server until the recipient saves or dismisses it.
   ============================================================= */

(function (global) {
  'use strict';

  const DEFAULT_SERVER = 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
  const POLL_MS = 2 * 60 * 1000;
  let _cache = { inbox: [], sent: [] };
  let _loadedFor = null;
  let _inflight = null;

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
      const err = new Error('Sign in to share with friends.');
      err.code = 'shares.signed_out';
      throw err;
    }
    const res = await fetch((global.SERVER_URL || DEFAULT_SERVER) + '/api/shares' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok || !data || data.success === false) {
      const err = new Error(data?.error?.message || 'Could not reach the server. Try again.');
      err.code = data?.error?.code || 'shares.network';
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function _updateBadge() {
    const badge = document.getElementById('commShareBadge');
    if (!badge) return;
    const n = _cache.inbox.length;
    badge.style.display = n > 0 ? '' : 'none';
    badge.textContent = n;
  }

  function _changed() {
    _updateBadge();
    document.dispatchEvent(new CustomEvent('pc:shares-changed', { detail: { ..._cache } }));
  }

  // Reloads the inbox and sent list. Resolves with the cache even on error
  // (the error is rethrown only when `throwOnError` is set).
  async function refresh({ throwOnError = false } = {}) {
    const user = _user();
    if (_loadedFor !== user) { _cache = { inbox: [], sent: [] }; _loadedFor = user; }
    if (!_inflight) {
      _inflight = api('GET', '')
        .then(data => { _cache = { inbox: data.inbox || [], sent: data.sent || [] }; _changed(); return _cache; })
        .finally(() => { _inflight = null; });
    }
    try {
      return await _inflight;
    } catch (err) {
      if (throwOnError) throw err;
      return _cache;
    }
  }

  function getInbox() { return _cache.inbox; }
  function getSent() { return _cache.sent; }

  // item: { type: 'program'|'template', name, data }
  async function send(to, item, note) {
    const res = await api('POST', '', { to, type: item.type, name: item.name, data: item.data, note: note || '' });
    _cache.sent = [res.share, ..._cache.sent];
    _changed();
    return res.share;
  }

  async function remove(id) {
    await api('DELETE', '/' + encodeURIComponent(id));
    _cache.inbox = _cache.inbox.filter(i => i.id !== id);
    _cache.sent = _cache.sent.filter(i => i.id !== id);
    _changed();
  }

  // Adds a shared program/template to this device's library (the same
  // stores the Programs tab and the template picker read).
  function saveToLibrary(item, from) {
    const user = _user();
    if (!item || !user) return false;
    const read = key => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
    const label = from ? `${item.name} (from @${from})` : item.name;
    if (item.type === 'template') {
      const key = `managedTemplates_${user}`;
      const list = read(key);
      list.unshift({ localId: `local_${Date.now()}`, name: label, data: item.data, source: 'community' });
      localStorage.setItem(key, JSON.stringify(list));
      _toast(`"${item.name}" added to your Templates!`, 'success');
    } else {
      const key = `programs_${user}`;
      const list = read(key);
      list.unshift({ ...item.data, id: `comm_${Date.now()}`, name: label, _sharedBy: from || '' });
      localStorage.setItem(key, JSON.stringify(list));
      _toast(`"${item.name}" added to your Programs!`, 'success');
    }
    return true;
  }

  // Save an inbox item, then remove it from the server inbox.
  async function accept(id) {
    const item = _cache.inbox.find(i => i.id === id);
    if (!item) return false;
    saveToLibrary(item, item.from);
    try { await remove(id); } catch (err) { _toast(err.message, 'error'); }
    return true;
  }

  async function dismiss(id) {
    try { await remove(id); return true; } catch (err) { _toast(err.message, 'error'); return false; }
  }

  function _poll() {
    if (document.visibilityState === 'hidden') return;
    if (!_authHeaders().Authorization || !_user()) return;
    refresh().catch(() => {});
  }

  if (typeof document !== 'undefined' && !global.__SHARES_NO_POLL) {
    setInterval(_poll, POLL_MS);
    document.addEventListener('visibilitychange', _poll);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(_poll, 3000));
    else setTimeout(_poll, 3000);
  }

  const Shares = { refresh, getInbox, getSent, send, remove, accept, dismiss, saveToLibrary };
  global.Shares = Shares;
  if (typeof module !== 'undefined' && module.exports) module.exports = Shares;
})(typeof window !== 'undefined' ? window : globalThis);
