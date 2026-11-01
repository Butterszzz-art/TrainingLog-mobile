/* =============================================================
   PHONE PUSH NOTIFICATIONS (iOS)
   The in-app inbox (notifications.js) only updates while the app is
   open. This adds the iPhone/iPad side: with the user's permission the
   phone gets an APNs device token, which is sent to the backend
   (POST /api/notifications/push-token). From then on every in-app
   notification is also pushed to the phone (backend src/push.js), so
   mute switches and blocks apply to pushes too.

   When we ask: the first time the notifications sheet opens, and once
   on the second launch after signing in. Never on the very first launch.
   Settings in the notifications sheet has a "Phone notifications" row.

   Tapping a push opens the matching inbox item. A push that arrives
   while the app is open just refreshes the bell.

   Uses @capacitor/push-notifications. Everything is a no-op outside
   the iOS app.
   ============================================================= */
(function (global) {
  'use strict';

  const DEFAULT_SERVER = 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
  const PLUGIN = 'PushNotifications';
  const TOKEN_KEY = 'tl_push_token';        // { token, user } last sent to the server
  const ASKED_KEY = 'tl_push_asked';        // we already showed the iOS prompt
  const LAUNCHES_KEY = 'tl_push_launches';  // signed-in launches, for the second-launch ask

  function _store() {
    try { return global.localStorage || null; } catch { return null; }
  }
  function _get(key) {
    const s = _store();
    try { return s ? s.getItem(key) : null; } catch { return null; }
  }
  function _set(key, value) {
    const s = _store();
    try { if (s) value === null ? s.removeItem(key) : s.setItem(key, value); } catch { /* storage full or blocked */ }
  }
  function _readJSON(key) {
    try { return JSON.parse(_get(key) || 'null'); } catch { return null; }
  }

  function _plugin() {
    const cap = global.Capacitor;
    if (!cap) return null;
    if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'ios') return null;
    if (typeof cap.isPluginAvailable === 'function' && !cap.isPluginAvailable(PLUGIN)) return null;
    return (cap.Plugins && cap.Plugins[PLUGIN]) || null;
  }

  function _user() {
    return global.currentUser
      || (typeof global.getActiveUsername === 'function' && global.getActiveUsername())
      || _get('fitnessAppUser') || '';
  }

  function _authHeaders() {
    if (typeof global.getAuthHeaders === 'function') {
      try { return global.getAuthHeaders() || {}; } catch { /* fall through */ }
    }
    const token = _get('token');
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function _api(method, body, { keepalive = false } = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, _authHeaders());
    if (!headers.Authorization) return Promise.resolve(null);
    return fetch((global.SERVER_URL || DEFAULT_SERVER) + '/api/notifications/push-token', {
      method,
      headers,
      body: JSON.stringify(body),
      keepalive,
    }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  }

  /**
   * Which inbox item a tapped push belongs to: the newest one of the same
   * type (the push carries the type, the inbox carries the details).
   * Pure, for tests.
   */
  function matchItem(items, data) {
    const type = data && data.type;
    if (!type || !Array.isArray(items)) return null;
    return items.find(n => n && n.type === type) || null;
  }

  /** Whether to show the iOS prompt on this launch. Pure, for tests. */
  function shouldAskOnLaunch({ permission, asked, launches, signedIn }) {
    if (!signedIn || asked) return false;
    if (permission !== 'prompt' && permission !== 'prompt-with-rationale') return false;
    return launches >= 2;
  }

  let _listening = false;
  let _registering = null;

  function _sendToken(token) {
    const user = _user();
    if (!token || !user) return;
    const last = _readJSON(TOKEN_KEY);
    // Re-sent on every launch: cheap, and it heals a token the server dropped.
    _api('POST', { token, platform: 'ios' }).then(res => {
      if (res && res.success) _set(TOKEN_KEY, JSON.stringify({ token, user }));
    });
    if (last && last.token !== token) _set(TOKEN_KEY, null);
  }

  async function _onTap(action) {
    const data = (action && action.notification && action.notification.data) || {};
    const N = global.Notifications;
    if (!N) return;
    try { await N.refresh(); } catch { /* offline: open what we have */ }
    const item = matchItem(N.getItems ? N.getItems() : [], data);
    if (item && typeof N.open === 'function') N.open(item);
    else if (typeof N.openSheet === 'function') N.openSheet();
  }

  function _listen(plugin) {
    if (_listening || typeof plugin.addListener !== 'function') return;
    _listening = true;
    plugin.addListener('registration', t => _sendToken(t && t.value));
    plugin.addListener('registrationError', err => console.warn('Push registration failed', err));
    plugin.addListener('pushNotificationReceived', () => {
      if (global.Notifications && typeof global.Notifications.refresh === 'function') {
        global.Notifications.refresh().catch(() => {});
      }
    });
    plugin.addListener('pushNotificationActionPerformed', a => { _onTap(a); });
  }

  async function permission() {
    const plugin = _plugin();
    if (!plugin) return 'unavailable';
    try {
      const res = await plugin.checkPermissions();
      return (res && res.receive) || 'prompt';
    } catch {
      return 'unavailable';
    }
  }

  /** Registers with APNs if the user already allowed it. Never prompts. */
  async function registerIfAllowed() {
    const plugin = _plugin();
    if (!plugin || !_user()) return false;
    _listen(plugin);
    if ((await permission()) !== 'granted') return false;
    if (!_registering) {
      _registering = Promise.resolve(plugin.register()).catch(err => {
        console.warn('Push register failed', err);
      }).finally(() => { _registering = null; });
    }
    await _registering;
    return true;
  }

  /**
   * Shows the iOS permission prompt (once; iOS itself never shows it again)
   * and registers when allowed. Returns the resulting permission.
   */
  async function enable() {
    const plugin = _plugin();
    if (!plugin) return 'unavailable';
    _listen(plugin);
    let state = await permission();
    if (state === 'prompt' || state === 'prompt-with-rationale') {
      _set(ASKED_KEY, '1');
      try {
        state = ((await plugin.requestPermissions()) || {}).receive || 'denied';
      } catch {
        state = 'denied';
      }
    }
    if (state === 'granted') await registerIfAllowed();
    return state;
  }

  /** Asks only if we never have. Used by the notifications sheet. */
  async function askOnce() {
    if (_get(ASKED_KEY)) return permission();
    return enable();
  }

  /** On sign-out: stop this phone getting the account's pushes. */
  function unregister() {
    const last = _readJSON(TOKEN_KEY);
    if (last && last.token) _api('DELETE', { token: last.token }, { keepalive: true });
    _set(TOKEN_KEY, null);
  }

  /** Opens the iOS Settings page for this app (to turn pushes back on). */
  // Capacitor hands navigations to non-web schemes to iOS, which opens Settings.
  function openSystemSettings() {
    try { global.location.href = 'app-settings:'; } catch { /* not on iOS */ }
  }

  async function start() {
    if (!_plugin() || !_user()) return;
    const launches = (Number(_get(LAUNCHES_KEY)) || 0) + 1;
    _set(LAUNCHES_KEY, String(launches));
    const state = await permission();
    if (state === 'granted') return registerIfAllowed();
    if (shouldAskOnLaunch({ permission: state, asked: !!_get(ASKED_KEY), launches, signedIn: true })) {
      // Let the app settle first so the prompt doesn't cover the loading screen.
      setTimeout(() => { enable(); }, 4000);
    }
  }

  const api = {
    isAvailable: () => !!_plugin(),
    permission, enable, askOnce, registerIfAllowed, unregister, openSystemSettings, start,
    matchItem, shouldAskOnLaunch,
  };
  global.PushNotify = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (global.document && !global.__PUSH_NO_AUTOSTART) {
    const go = () => setTimeout(start, 2500);
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})(typeof window !== 'undefined' ? window : globalThis);
