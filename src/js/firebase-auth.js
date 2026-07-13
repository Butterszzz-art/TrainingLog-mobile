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
    return window.SERVER_URL || 'https://traininglog-backend.onrender.com';
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
  async function signup({ username, email, password, referredBy }) {
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
    const complete = await postJson('/auth/signup-complete', { username, referredBy }, idToken);
    if (!complete.ok) {
      const message = complete.data?.error?.message || 'Could not complete signup.';
      if (complete.data?.error?.code === 'auth.username_taken') {
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

  // Retry only the username-claim step (after a 409 race in signup).
  async function completeSignup({ username, referredBy }) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not signed in.');
    const idToken = await user.getIdToken();
    const complete = await postJson('/auth/signup-complete', { username, referredBy }, idToken);
    if (!complete.ok) throw new Error(complete.data?.error?.message || 'Could not complete signup.');
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
          // No Firebase account for this username — may be a legacy account.
          const err = new Error('No account found for that username.');
          err.tryLegacy = true;
          throw err;
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
    resendVerification,
    reloadAndGetToken,
    logout
  };
})();
