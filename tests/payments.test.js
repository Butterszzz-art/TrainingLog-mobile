const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/payments.js'), 'utf8');

const PRODUCTS = [
  { identifier: 'com.pocketcoach.app.pro.monthly', priceString: '€9.99',
    introductoryPrice: { paymentMode: 2, numberOfPeriods: 1, subscriptionPeriod: { numberOfUnits: 1, unit: 1 } } },
  { identifier: 'com.pocketcoach.app.pro.annual', priceString: '€79.99', introductoryPrice: null },
  { identifier: 'com.pocketcoach.app.coach.monthly', priceString: '€17.99', introductoryPrice: null },
  { identifier: 'com.pocketcoach.app.coach.annual', priceString: '€149.99', introductoryPrice: null },
];

// Loads payments.js with a fake Capacitor bridge (StoreKit) and fake backend.
function setup({ platform = 'ios', native = {}, api = {} } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  const nativeCalls = [];
  const apiCalls = [];
  const toasts = [];
  const nativeImpl = {
    getProducts: async () => ({ products: PRODUCTS }),
    purchaseProduct: async () => ({ jwsRepresentation: 'signed.jws', productIdentifier: 'com.pocketcoach.app.pro.monthly' }),
    restorePurchases: async () => undefined,
    getPurchases: async () => ({ purchases: [] }),
    manageSubscriptions: async () => undefined,
    ...native,
  };
  const apiImpl = {
    'GET /api/iap/apple/account-token': () => ({ status: 200, body: { success: true, appAccountToken: 'uuid-1' } }),
    'POST /api/iap/apple/verify': () => ({ status: 200, body: { success: true, active: true, plan: 'pro' } }),
    ...api,
  };
  w.Capacitor = {
    getPlatform: () => platform,
    nativePromise: (plugin, method, options) => {
      nativeCalls.push({ plugin, method, options });
      return nativeImpl[method](options);
    },
  };
  w.SERVER_URL = 'https://api.test';
  w.getAuthHeaders = () => ({ Authorization: 'Bearer tok' });
  w.fetch = async (url, opts) => {
    const key = opts.method + ' ' + url.replace('https://api.test', '');
    apiCalls.push({ key, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers.Authorization });
    const r = apiImpl[key]();
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  w.showToast = (msg, type) => toasts.push([msg, type]);
  w.loadUserPlan = jest.fn(async () => { w.currentUserPlan = 'pro'; });
  w.checkoutWithStripe = jest.fn();
  w.eval(SRC);
  return { w, doc: w.document, nativeCalls, apiCalls, toasts, pay: w.pocketCoachPayments };
}

describe('App Store prices', () => {
  test('are null until StoreKit loads, then use the storefront currency and trial', async () => {
    const { pay, nativeCalls } = setup();
    await pay.loadAppleProducts();
    expect(nativeCalls[0]).toMatchObject({ plugin: 'NativePurchases', method: 'getProducts', options: { productType: 'subs' } });
    expect(nativeCalls[0].options.productIdentifiers).toHaveLength(4);
    expect(pay.applePrice('pro', 'monthly')).toEqual({
      headline: '€9.99', per: '/month', note: '', billed: '€9.99 per month', trial: '7-day free trial',
    });
    // Annual shows the billed yearly amount, not a per-month figure.
    expect(pay.applePrice('coach', 'annual')).toMatchObject({ headline: '€149.99', billed: '€149.99 per year', trial: '' });
  });

  test('missing products leave prices unavailable', async () => {
    const { pay } = setup({ native: { getProducts: async () => ({ products: [] }) } });
    await pay.loadAppleProducts();
    expect(pay.applePrice('pro', 'monthly')).toBeNull();
  });
});

describe('purchase on iOS', () => {
  test('buys with the account token, verifies the receipt and refreshes the plan', async () => {
    const { pay, nativeCalls, apiCalls, w, toasts } = setup();
    const result = await pay.purchase('pro', 'monthly');
    expect(apiCalls[0]).toMatchObject({ key: 'GET /api/iap/apple/account-token', auth: 'Bearer tok' });
    const buy = nativeCalls.find(c => c.method === 'purchaseProduct');
    expect(buy.options).toEqual({ productIdentifier: 'com.pocketcoach.app.pro.monthly', productType: 'subs', appAccountToken: 'uuid-1' });
    expect(apiCalls[1]).toMatchObject({ key: 'POST /api/iap/apple/verify', body: { signedTransaction: 'signed.jws' } });
    expect(result.active).toBe(true);
    expect(w.loadUserPlan).toHaveBeenCalled();
    expect(toasts.at(-1)[0]).toMatch(/Welcome to Pro/);
    expect(w.checkoutWithStripe).not.toHaveBeenCalled();
  });

  test('cancelling the Apple sheet does nothing', async () => {
    const { pay, apiCalls, toasts } = setup({ native: { purchaseProduct: async () => { throw new Error('User cancelled'); } } });
    expect(await pay.purchase('coach', 'annual')).toEqual({ cancelled: true });
    expect(apiCalls.map(c => c.key)).toEqual(['GET /api/iap/apple/account-token']);
    expect(toasts).toEqual([]);
  });

  test('Ask to Buy (pending) tells the user and grants nothing yet', async () => {
    const { pay, apiCalls, toasts } = setup({ native: { purchaseProduct: async () => { throw new Error('Transaction pending'); } } });
    expect(await pay.purchase('pro', 'annual')).toEqual({ pending: true });
    expect(apiCalls).toHaveLength(1);
    expect(toasts[0][0]).toMatch(/waiting for approval/);
  });

  test('backend errors are shown to the user', async () => {
    const { pay, toasts } = setup({
      api: { 'POST /api/iap/apple/verify': () => ({ status: 400, body: { success: false, error: { code: 'iap.verification_failed', message: 'Could not verify the purchase with Apple.' } } }) },
    });
    const result = await pay.purchase('pro', 'monthly');
    expect(result.error).toBeTruthy();
    expect(toasts.at(-1)).toEqual(['Could not verify the purchase with Apple.', 'error']);
  });
});

describe('restore', () => {
  test('re-verifies current App Store entitlements', async () => {
    const { pay, apiCalls, toasts } = setup({
      native: { getPurchases: async () => ({ purchases: [
        { productIdentifier: 'com.pocketcoach.app.pro.annual', jwsRepresentation: 'jws-a' },
        { productIdentifier: 'com.other.app.thing', jwsRepresentation: 'jws-x' },
      ] }) },
    });
    expect(await pay.restore()).toEqual({ restored: true });
    expect(apiCalls.map(c => c.body && c.body.signedTransaction)).toEqual(['jws-a']);
    expect(toasts.at(-1)[0]).toMatch(/restored/);
  });

  test('explains a subscription that belongs to another account', async () => {
    const { pay, toasts } = setup({
      native: { getPurchases: async () => ({ purchases: [{ productIdentifier: 'com.pocketcoach.app.pro.monthly', jwsRepresentation: 'jws-b' }] }) },
      api: { 'POST /api/iap/apple/verify': () => ({ status: 403, body: { success: false, error: { code: 'iap.account_mismatch', message: 'This subscription was bought from a different Pocket Coach account.' } } }) },
    });
    expect(await pay.restore()).toEqual({ restored: false });
    expect(toasts.at(-1)[0]).toMatch(/different Pocket Coach account/);
  });

  test('says so when there is nothing to restore', async () => {
    const { pay, apiCalls, toasts } = setup();
    expect((await pay.restore()).reason).toBe('none');
    expect(apiCalls).toEqual([]);
    expect(toasts[0][0]).toMatch(/No active App Store subscription/);
  });
});

describe('manage', () => {
  test('App Store subscribers get Apple’s subscription settings', async () => {
    const { pay, w, nativeCalls } = setup();
    w.currentSubSource = 'apple';
    await pay.manage();
    expect(nativeCalls.map(c => c.method)).toContain('manageSubscriptions');
  });

  test('web subscribers on iOS see where to manage it, with no link', async () => {
    const { pay, w, doc, nativeCalls } = setup();
    w.currentSubSource = 'stripe';
    await pay.manage();
    const notice = doc.getElementById('stripeManagedNotice');
    expect(notice.textContent.replace(/\s+/g, ' ')).toMatch(/sign in to Pocket Coach in a web browser/);
    expect(notice.querySelector('a')).toBeNull();
    expect(nativeCalls.map(c => c.method)).not.toContain('manageSubscriptions');
  });
});

describe('web and Android', () => {
  test('use Stripe and never touch StoreKit', async () => {
    const { pay, w, nativeCalls } = setup({ platform: 'android' });
    await pay.purchase('coach', 'monthly', { withdrawalWaiver: true });
    // The checkout sheet's 14-day withdrawal waiver is passed through to Stripe checkout.
    expect(w.checkoutWithStripe).toHaveBeenCalledWith('coach', 'monthly', { withdrawalWaiver: true });
    expect(await pay.restore()).toEqual({ restored: false, reason: 'not_applicable' });
    expect(nativeCalls).toEqual([]);
  });
});
