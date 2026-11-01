/* =============================================================
   SIGN IN WITH APPLE (iOS)
   The login card shows a "Continue with Apple" button in the iPhone and
   iPad app. Apple's sheet (plugins/sign-in-with-apple) returns an
   identity token, Firebase signs in with it, and then:
   - an account that already has a username goes straight in;
   - a new one picks a username and accepts the same two consents as an
     email signup (POST /auth/signup-complete), then onboarding starts.
   Apple emails count as verified, so there's no verify-email step.

   Deleting the account first revokes the Apple sign-in, as Apple
   requires (revokeBeforeDelete, called from settings.js).

   Needs the Apple provider enabled in Firebase Authentication.
   Everything is a no-op outside the iOS app.
   ============================================================= */
(function (global) {
  'use strict';

  const PLUGIN = 'SignInWithApple';

  function _plugin() {
    const cap = global.Capacitor;
    if (!cap) return null;
    if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'ios') return null;
    if (typeof cap.isPluginAvailable === 'function' && !cap.isPluginAvailable(PLUGIN)) return null;
    return (cap.Plugins && cap.Plugins[PLUGIN]) || null;
  }

  function _firebaseReady() {
    return !!(global.firebaseAuth && global.firebaseAuth.isAvailable && global.firebaseAuth.isAvailable()
      && global.firebase && global.firebase.auth && global.firebase.auth.OAuthProvider);
  }

  function isAvailable() {
    return !!_plugin() && _firebaseReady();
  }

  /** Random nonce for one sign-in (Apple gets its hash, Firebase the raw value). */
  function makeNonce(length = 32) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';
    const bytes = new Uint8Array(length);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(bytes);
    else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  /** A username suggestion from Apple's name (letters, digits, _ . only). */
  function suggestUsername(givenName, familyName) {
    const base = [givenName, familyName].filter(Boolean).join('')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_.]/g, '').toLowerCase();
    return base.slice(0, 20);
  }

  function friendlyError(err) {
    const code = (err && err.code) || '';
    if (code === 'CANCELLED') return '';
    if (code === 'auth/account-exists-with-different-credential' || code === 'auth/email-already-in-use') {
      return 'That email already has a Pocket Coach account. Log in with your username and password.';
    }
    if (code === 'auth/operation-not-allowed') return 'Sign in with Apple isn’t switched on yet. Use your username and password for now.';
    if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
    return (err && err.message) || 'Sign in with Apple didn’t work. Please try again.';
  }

  function _store(token) {
    try {
      global.localStorage.setItem('token', token);
      global.localStorage.setItem('authToken', token);
    } catch { /* storage blocked */ }
  }

  /**
   * Shows Apple's sheet and signs in to Firebase.
   * Resolves { username, token } for an existing account,
   * { needsUsername: true, suggestion } for a new one, or null if cancelled.
   */
  async function signIn() {
    const plugin = _plugin();
    if (!plugin || !_firebaseReady()) throw new Error('Sign in with Apple is only available in the iPhone app.');
    const rawNonce = makeNonce();
    let apple;
    try {
      apple = await plugin.authorize({ rawNonce });
    } catch (err) {
      if (err && err.code === 'CANCELLED') return null;
      throw err;
    }
    const provider = new global.firebase.auth.OAuthProvider('apple.com');
    const credential = provider.credential({ idToken: apple.identityToken, rawNonce });
    const result = await global.firebase.auth().signInWithCredential(credential);
    const user = result.user;
    // A fresh token, so a username claim set at signup is in it.
    const tokenResult = await user.getIdTokenResult(true);
    const username = tokenResult.claims && tokenResult.claims.username;
    // Stored only once there's a username: a half-finished signup must not
    // look like a signed-in session on the next launch.
    if (username) {
      _store(tokenResult.token);
      return { username, token: tokenResult.token };
    }
    return { needsUsername: true, suggestion: suggestUsername(apple.givenName, apple.familyName) };
  }

  /** Claims a username for the Apple account just signed in. Resolves { username, token }. */
  async function completeSignup({ username, consents }) {
    await global.firebaseAuth.completeSignup({ username, consents });
    const user = global.firebase.auth().currentUser;
    if (!user) throw new Error('Not signed in.');
    const token = await user.getIdToken(true);
    _store(token);
    return { username, token };
  }

  function _isAppleAccount() {
    const user = global.firebase && global.firebase.auth && global.firebase.auth().currentUser;
    return !!(user && (user.providerData || []).some(p => p && p.providerId === 'apple.com'));
  }

  /**
   * Before deleting an Apple account: ask Apple for a fresh authorization
   * code and revoke the app's access with it. Never blocks the deletion.
   * Resolves true if revoked.
   */
  async function revokeBeforeDelete() {
    const plugin = _plugin();
    if (!plugin || !_firebaseReady() || !_isAppleAccount()) return false;
    try {
      const apple = await plugin.authorize({ rawNonce: makeNonce(), scopes: false });
      if (!apple || !apple.authorizationCode) return false;
      await global.firebase.auth().revokeAccessToken(apple.authorizationCode);
      return true;
    } catch (err) {
      console.warn('[AppleSignIn] revoke failed', err);
      return false;
    }
  }

  const api = { isAvailable, signIn, completeSignup, revokeBeforeDelete, makeNonce, suggestUsername, friendlyError };
  global.AppleSignIn = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
