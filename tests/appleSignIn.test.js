// Sign in with Apple (src/js/apple-sign-in.js), with fake Capacitor and
// Firebase. Runs in Jest's node environment.
const memory = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: k => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: k => memory.delete(k),
    clear: () => memory.clear(),
  },
});

function setup({ platform = 'ios', claims = {}, authorize, providers = ['apple.com'] } = {}) {
  jest.resetModules();
  memory.clear();
  const user = {
    providerData: providers.map(providerId => ({ providerId })),
    getIdTokenResult: jest.fn(async () => ({ token: 'fresh-token', claims })),
    getIdToken: jest.fn(async () => 'claimed-token'),
  };
  const auth = {
    currentUser: user,
    signInWithCredential: jest.fn(async () => ({ user })),
    revokeAccessToken: jest.fn(async () => {}),
  };
  const credential = jest.fn(opts => ({ apple: opts }));
  globalThis.firebase = Object.assign(() => {}, { auth: Object.assign(() => auth, { OAuthProvider: jest.fn(() => ({ credential })) }) });
  globalThis.firebaseAuth = { isAvailable: () => true, completeSignup: jest.fn(async () => ({})) };
  const plugin = {
    authorize: authorize || jest.fn(async () => ({ identityToken: 'apple-id-token', authorizationCode: 'code-1', givenName: 'Zoë', familyName: 'De Vries' })),
  };
  globalThis.Capacitor = {
    getPlatform: () => platform,
    isPluginAvailable: n => n === 'SignInWithApple',
    Plugins: { SignInWithApple: plugin },
  };
  const AppleSignIn = require('../src/js/apple-sign-in.js');
  return { AppleSignIn, auth, plugin, credential, user };
}

afterEach(() => {
  delete globalThis.Capacitor;
  delete globalThis.firebase;
  delete globalThis.firebaseAuth;
});

test('helpers', () => {
  const { AppleSignIn } = setup();
  const nonce = AppleSignIn.makeNonce();
  expect(nonce).toHaveLength(32);
  expect(AppleSignIn.makeNonce()).not.toBe(nonce);
  expect(AppleSignIn.suggestUsername('Zoë', 'De Vries')).toBe('zoedevries');
  expect(AppleSignIn.suggestUsername(null, null)).toBe('');
  expect(AppleSignIn.friendlyError({ code: 'CANCELLED' })).toBe('');
  expect(AppleSignIn.friendlyError({ code: 'auth/account-exists-with-different-credential' })).toMatch(/already has a Pocket Coach account/);
});

test('only offered in the iOS app', () => {
  expect(setup({ platform: 'android' }).AppleSignIn.isAvailable()).toBe(false);
  expect(setup({ platform: 'ios' }).AppleSignIn.isAvailable()).toBe(true);
});

test('existing account: signs in and stores the token', async () => {
  const { AppleSignIn, plugin, credential, auth } = setup({ claims: { username: 'zoe' } });
  const res = await AppleSignIn.signIn();
  const { rawNonce } = plugin.authorize.mock.calls[0][0];
  expect(credential).toHaveBeenCalledWith({ idToken: 'apple-id-token', rawNonce });
  expect(auth.signInWithCredential).toHaveBeenCalled();
  expect(res).toEqual({ username: 'zoe', token: 'fresh-token' });
  expect(localStorage.getItem('token')).toBe('fresh-token');
});

test('new account: asks for a username, stores nothing yet', async () => {
  const { AppleSignIn } = setup({ claims: {} });
  expect(await AppleSignIn.signIn()).toEqual({ needsUsername: true, suggestion: 'zoedevries' });
  expect(localStorage.getItem('token')).toBeNull();
});

test('completeSignup claims the username and refreshes the token', async () => {
  const { AppleSignIn, user } = setup();
  const consents = { ageConfirmed: true, healthData: true };
  const res = await AppleSignIn.completeSignup({ username: 'zoe', consents });
  expect(globalThis.firebaseAuth.completeSignup).toHaveBeenCalledWith({ username: 'zoe', consents });
  expect(user.getIdToken).toHaveBeenCalledWith(true);
  expect(res).toEqual({ username: 'zoe', token: 'claimed-token' });
});

test('cancelling the Apple sheet resolves null', async () => {
  const authorize = jest.fn(async () => { throw Object.assign(new Error('x'), { code: 'CANCELLED' }); });
  const { AppleSignIn, auth } = setup({ authorize });
  expect(await AppleSignIn.signIn()).toBeNull();
  expect(auth.signInWithCredential).not.toHaveBeenCalled();
});

test('account deletion revokes Apple sign-in with a fresh code', async () => {
  const { AppleSignIn, auth, plugin } = setup();
  expect(await AppleSignIn.revokeBeforeDelete()).toBe(true);
  expect(plugin.authorize.mock.calls[0][0].scopes).toBe(false);
  expect(auth.revokeAccessToken).toHaveBeenCalledWith('code-1');
});

test('no revoke for email accounts, and a failed revoke never throws', async () => {
  let { AppleSignIn, plugin } = setup({ providers: ['password'] });
  expect(await AppleSignIn.revokeBeforeDelete()).toBe(false);
  expect(plugin.authorize).not.toHaveBeenCalled();

  ({ AppleSignIn } = setup({ authorize: jest.fn(async () => { throw new Error('boom'); }) }));
  expect(await AppleSignIn.revokeBeforeDelete()).toBe(false);
});
