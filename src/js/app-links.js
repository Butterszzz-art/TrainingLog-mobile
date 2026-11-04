/* =============================================================
   APP LINKS — one place for links between the website and the app
   - Invite / referral links. Shared as
     https://pocketcoachcoms.org/invite/?ref=CODE. On an iPhone with the
     app installed the link opens the app (Universal Links, see
     /.well-known/apple-app-site-association and the Associated Domains
     entitlement in scripts/ios/add-capabilities.rb); otherwise
     invite/index.html sends the browser to /#signup?ref=CODE.
     Either way the code is kept here until sign-up sends it as
     referredBy, and the login screen opens on "New log?".
   - Coach dashboard link. The dashboard (coach/) is web-only; in the
     iOS app window.open() hands the URL to Safari.
   Pure helpers are exported for tests (tests/appLinks.test.js).
   ============================================================= */

(function (root) {
  'use strict';

  const SITE = 'https://pocketcoachcoms.org';
  const REF_KEY = 'pc_pending_ref';
  const REF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;

  // ── pure helpers ─────────────────────────────────────────────────

  function cleanCode(value) {
    const code = String(value == null ? '' : value).trim();
    return CODE_RE.test(code) ? code : '';
  }

  // { ref, signup } from any link form: /invite/?ref=X, ?ref=X, #signup?ref=X.
  function parseLink(href) {
    let url;
    try { url = new URL(String(href || ''), SITE); } catch { return { ref: '', signup: false }; }
    const hash = url.hash.replace(/^#/, '');
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
    const ref = cleanCode(url.searchParams.get('ref')) || cleanCode(new URLSearchParams(hashQuery).get('ref'));
    const signup = /^\/invite\/?$/.test(url.pathname) || /^signup\b/.test(hash) || !!ref;
    return { ref, signup };
  }

  function inviteUrl(code) {
    const c = cleanCode(code);
    return c ? SITE + '/invite/?ref=' + encodeURIComponent(c) : SITE + '/';
  }

  function readPending(store, now) {
    try {
      const saved = JSON.parse(store.getItem(REF_KEY) || 'null');
      if (!saved || !cleanCode(saved.code)) return '';
      if (!(now - Number(saved.at) < REF_MAX_AGE_MS)) { store.removeItem(REF_KEY); return ''; }
      return saved.code;
    } catch { return ''; }
  }

  const api = { parseLink, inviteUrl, cleanCode, readPending, REF_KEY, SITE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  // ── browser side ─────────────────────────────────────────────────

  const store = root.localStorage;
  const signedIn = () => !!(root.currentUser || store.getItem('fitnessAppUser'));

  function showSignup() {
    if (signedIn() || typeof root._switchLoginTab !== 'function') return;
    root._switchLoginTab('signup');
  }

  // Keep the code from a link and show sign-up when nobody is signed in.
  function capture(href) {
    const link = parseLink(href);
    if (link.ref && !signedIn()) {
      try { store.setItem(REF_KEY, JSON.stringify({ code: link.ref, at: Date.now() })); } catch { /* storage full */ }
    }
    if (link.signup) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', showSignup, { once: true });
      else showSignup();
    }
    return link;
  }

  function pendingReferral() { return readPending(store, Date.now()); }
  function clearReferral() { try { store.removeItem(REF_KEY); } catch { /* ignore */ } }

  function openCoachDashboard() {
    root.open(SITE + '/coach/', '_blank', 'noopener');
  }

  // Native: links that open the app arrive through @capacitor/app.
  function listenNative() {
    const cap = root.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
    const App = cap.Plugins && cap.Plugins.App;
    if (!App || typeof App.addListener !== 'function') return;
    App.addListener('appUrlOpen', e => capture(e && e.url));
    if (typeof App.getLaunchUrl === 'function') {
      App.getLaunchUrl().then(r => { if (r && r.url) capture(r.url); }).catch(() => {});
    }
  }

  capture(root.location.href);
  listenNative();

  root.AppLinks = { ...api, capture, pendingReferral, clearReferral, openCoachDashboard };
})(typeof window !== 'undefined' ? window : null);
