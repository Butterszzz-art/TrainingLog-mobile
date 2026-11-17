// Firebase Auth client flows — Phase 1 of the Firebase Auth migration.
// Exposes window.firebaseAuth.{isAvailable, signup, login, resendVerification,
// reloadAndGetToken, logout}. startLogin/startSignup in index.html call these
// when window.FIREBASE_ENABLED is true, and fall back to legacy /login and
// /register otherwise.
//
// Account model (per migration plan): username (login identifier, unique),
// email (new — Firebase Auth identity + verification), password (owned by
// Firebase, never stored in our own database).
(function () {
  'use strict';

  function available() {
    return Boolean(window.FIREBASE_ENABLED) && typeof firebase !== 'undefined' && firebase.auth;
  }

  function serverUrl() {
    return window.SERVER_URL || 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
  }

  // Keep the stored token fresh: Firebase ID tokens expire hourly, and every
  // existing fetch in the app reads localStorage('token'/'authToken').
  function watchTokenRefresh() {
    firebase.auth().onIdTokenChanged(async (user) => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        localStorage.setItem('token', token);
        localStorage.setItem('authToken', token);
      } catch (err) {
        console.warn('[Firebase] Token refresh failed:', err.message);
      }
    });
  }
  if (available()) watchTokenRefresh();

  // ── Fresh tokens on every API call ─────────────────────────────────────────
  // onIdTokenChanged above only refreshes the token while JavaScript runs.
  // iOS suspends the WebView in the background (and often kills the app), so
  // after an hour away the stored token has expired and the timer that would
  // have refreshed it never ran. Every API call in the app sends that stored
  // token as-is, so they all failed with 401 until the SDK caught up:
  // "Failed to save template to server", daily logs not saving, sync stalling.
  //
  // Instead of changing ~190 call sites, wrap fetch: for requests to our API
  // that carry the stored token, swap in a current one (getIdToken() only hits
  // the network when the token is near expiry), and if the server still says
  // 401, force a refresh and retry once.
  const TOKEN_WAIT_MS = 8000;

  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      promise,
      new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })
    ]).finally(() => clearTimeout(timer));
  }

  // Never throws and never waits more than TOKEN_WAIT_MS: on iOS the SDK's
  // session restore can stall, and a request with the old token is still
  // better than a request that never goes out.
  async function freshToken(forceRefresh) {
    try {
      return await withTimeout(currentToken({ forceRefresh }), TOKEN_WAIT_MS);
    } catch (err) {
      console.warn('[Firebase] Could not get a fresh token:', err?.message || err);
      return null;
    }
  }

  function isApiUrl(url) {
    const base = serverUrl().replace(/\/+$/, '');
    return typeof url === 'string' && (url === base || url.startsWith(base + '/') || url.startsWith(base + '?'));
  }

  function readAuthHeader(headers) {
    if (!headers) return null;
    if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get('Authorization');
    if (Array.isArray(headers)) {
      const pair = headers.find(([k]) => String(k).toLowerCase() === 'authorization');
      return pair ? pair[1] : null;
    }
    const key = Object.keys(headers).find(k => k.toLowerCase() === 'authorization');
    return key ? headers[key] : null;
  }

  function withAuthHeader(headers, token) {
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      const copy = new Headers(headers);
      copy.set('Authorization', `Bearer ${token}`);
      return copy;
    }
    const entries = Array.isArray(headers) ? headers : Object.entries(headers || {});
    const out = {};
    entries.forEach(([k, v]) => { if (String(k).toLowerCase() !== 'authorization') out[k] = v; });
    out.Authorization = `Bearer ${token}`;
    return out;
  }

  // Only replace the token the app stored for the signed-in user, so a call
  // that deliberately sends some other token is left alone.
  function sendsStoredToken(authHeader) {
    if (typeof authHeader !== 'string' || !/^Bearer\s+/i.test(authHeader)) return false;
    const sent = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!sent || sent === 'null' || sent === 'undefined') return true; // signed in, token not stored yet
    return sent === localStorage.getItem('token') || sent === localStorage.getItem('authToken');
  }

  function installFetchAuth() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || window.fetch.__pcAuth) return;
    const nativeFetch = window.fetch.bind(window);

    const authFetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && typeof input.href === 'string' ? input.href : null);
      const authHeader = url && init ? readAuthHeader(init.headers) : null;
      if (!available() || !isApiUrl(url) || !sendsStoredToken(authHeader)) {
        return nativeFetch(input, init);
      }

      const token = await freshToken(false);
      const first = token ? { ...init, headers: withAuthHeader(init.headers, token) } : init;
      const res = await nativeFetch(input, first);
      if (res.status !== 401) return res;

      // Expired or revoked between the check and the server: mint a new one.
      const retryToken = await freshToken(true);
      if (!retryToken || retryToken === token) return res;
      return nativeFetch(input, { ...init, headers: withAuthHeader(init.headers, retryToken) });
    };
    authFetch.__pcAuth = true;
    window.fetch = authFetch;
  }
  if (available()) installFetchAuth();

  // Coming back to the app: refresh now rather than on the first request, so
  // the token is already good by the time the user taps Save.
  function refreshOnResume() {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') freshToken(false);
    });
    const appPlugin = window.Capacitor?.Plugins?.App;
    if (appPlugin && typeof appPlugin.addListener === 'function') {
      try {
        appPlugin.addListener('appStateChange', state => { if (state?.isActive) freshToken(false); });
      } catch { /* not running natively */ }
    }
  }
  if (available()) refreshOnResume();

  async function postJson(path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${serverUrl()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  function friendlyAuthError(err) {
    const code = err?.code || '';
    if (code === 'auth/email-already-in-use') return 'That email already has an account. Try logging in.';
    if (code === 'auth/invalid-email') return 'That email address doesn’t look valid.';
    if (code === 'auth/weak-password') return 'Password is too weak — use at least 6 characters.';
    if (code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
      return 'Invalid username or password.';
    }
    if (code === 'auth/too-many-requests') return 'Too many attempts — please wait a few minutes.';
    if (code === 'auth/network-request-failed') return 'Network error — check your connection.';
    return err?.message || 'Authentication failed. Please try again.';
  }

  // Signup: availability check → create Firebase account → send verification
  // email → /auth/signup-complete (claims username, sets custom claims).
  // Returns { needsVerification: true } — the server rejects all protected
  // routes until the email is verified, so the UI must show the verify screen.
  //
  // The old Airtable legacy-account "reclaim" path (matching a username
  // against a pre-Firebase account and verifying its old password) was
  // retired once migration completed — every account now lives in Firebase
  // from the start, so there's nothing left to reclaim.
  async function signup({ username, email, password, referredBy, consents }) {
    if (!available()) throw new Error('Firebase is not configured.');

    const availRes = await fetch(
      `${serverUrl()}/auth/username-available?username=${encodeURIComponent(username)}`
    );
    const avail = await availRes.json().catch(() => ({}));
    if (availRes.ok && avail.available === false) {
      throw new Error('That username is already taken.');
    }

    let cred;
    try {
      cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }

    try {
      await cred.user.sendEmailVerification();
    } catch (err) {
      console.warn('[Firebase] sendEmailVerification failed (resend available):', err.message);
    }

    const idToken = await cred.user.getIdToken();
    const complete = await postJson('/auth/signup-complete', { username, referredBy, consents }, idToken);
    if (!complete.ok) {
      const code = complete.data?.error?.code;
      const message = complete.data?.error?.message || 'Could not complete signup.';
      if (code === 'auth.username_taken') {
        // Auth account exists but the username was taken in a race — the UI
        // should prompt for a different username and call completeSignup again.
        const err = new Error(message);
        err.retryUsernameOnly = true;
        throw err;
      }
      throw new Error(message);
    }

    return { username, email, needsVerification: !cred.user.emailVerified };
  }

  // Retry only the username-claim step, after a 409 race in signup (someone
  // else claimed the username between the availability check and now).
  async function completeSignup({ username, referredBy, consents }) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not signed in.');
    const idToken = await user.getIdToken();
    const complete = await postJson('/auth/signup-complete', { username, referredBy, consents }, idToken);
    if (!complete.ok) {
      throw new Error(complete.data?.error?.message || 'Could not complete signup.');
    }
    return { username };
  }

  // Login by username (or email — detected by '@'). Username→email resolution
  // is a required step: Firebase authenticates by email under the hood.
  async function login({ usernameOrEmail, password }) {
    if (!available()) throw new Error('Firebase is not configured.');

    let email = usernameOrEmail;
    let username = null;
    if (!usernameOrEmail.includes('@')) {
      username = usernameOrEmail;
      const resolved = await postJson('/auth/email-for-username', { username: usernameOrEmail });
      if (!resolved.ok) {
        if (resolved.status === 404) {
          throw new Error('No account found for that username.');
        }
        throw new Error(resolved.data?.error?.message || 'Could not look up username.');
      }
      email = resolved.data.email;
    }

    let cred;
    try {
      cred = await firebase.auth().signInWithEmailAndPassword(email, password);
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }

    const idToken = await cred.user.getIdToken();
    localStorage.setItem('token', idToken);
    localStorage.setItem('authToken', idToken);

    if (!username) {
      // Logged in by email — recover the username from the custom claim
      const decoded = await cred.user.getIdTokenResult();
      username = decoded.claims.username || null;
    }

    return {
      token: idToken,
      username,
      emailVerified: cred.user.emailVerified,
      needsVerification: !cred.user.emailVerified
    };
  }

  // Sends a password-reset email. Same username→email resolution as login()
  // since Firebase's reset flow is email-based but this app logs in by username.
  async function resetPassword(usernameOrEmail) {
    if (!available()) throw new Error('Firebase is not configured.');

    let email = usernameOrEmail;
    if (!usernameOrEmail.includes('@')) {
      const resolved = await postJson('/auth/email-for-username', { username: usernameOrEmail });
      if (!resolved.ok) {
        if (resolved.status === 404) {
          throw new Error('No account found for that username.');
        }
        throw new Error(resolved.data?.error?.message || 'Could not look up username.');
      }
      email = resolved.data.email;
    }

    try {
      await firebase.auth().sendPasswordResetEmail(email);
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
    return { email };
  }

  async function resendVerification() {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not signed in.');
    await user.sendEmailVerification();
  }

  // After the user clicks the email link: reload the account, mint a fresh
  // token (email_verified flips to true), and return it.
  async function reloadAndGetToken() {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not signed in.');
    await user.reload();
    if (!firebase.auth().currentUser.emailVerified) return { verified: false };
    const token = await firebase.auth().currentUser.getIdToken(true);
    localStorage.setItem('token', token);
    localStorage.setItem('authToken', token);
    return { verified: true, token };
  }

  // Waits for Firebase to restore the saved session (currentUser is null
  // until it has), then returns a valid ID token — getIdToken() mints a new
  // one if the stored one has expired. Returns null when nobody is signed in.
  // forceRefresh: true mints a new token even if the current one looks valid.
  async function currentToken({ forceRefresh = false } = {}) {
    if (!available()) return null;
    const auth = firebase.auth();
    const user = auth.currentUser || await new Promise(resolve => {
      const unsubscribe = auth.onAuthStateChanged(u => { unsubscribe(); resolve(u); });
    });
    if (!user) return null;
    const token = await user.getIdToken(forceRefresh);
    localStorage.setItem('token', token);
    localStorage.setItem('authToken', token);
    return token;
  }

  async function logout() {
    if (available()) {
      try { await firebase.auth().signOut(); } catch { /* non-critical */ }
    }
  }

  window.firebaseAuth = {
    isAvailable: available,
    signup,
    completeSignup,
    login,
    resetPassword,
    resendVerification,
    reloadAndGetToken,
    currentToken,
    logout
  };
})();
