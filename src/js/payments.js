// Payment rails.
//
//   iOS (iPhone/iPad) — Apple In-App Purchase, in every storefront. Apple
//     Guideline 3.1.1 requires digital subscriptions unlocked in the app to
//     use StoreKit, and the EU/UK have no general exemption. The app shows
//     Apple's localized prices (EUR in the EU), never ours, and never
//     mentions or links to the website's checkout.
//   Web and Android — Stripe checkout and billing portal (index.html's
//     checkoutWithStripe / openManageBilling).
//
// StoreKit is reached through the @capgo/native-purchases plugin. This app has
// no bundler, so instead of importing the plugin's JS wrapper it calls the
// native side directly with Capacitor.nativePromise('NativePurchases', …).
//
// Purchase flow (backend: traininglog-backend src/routes/appleIap.js):
//   1. GET  /api/iap/apple/account-token → a UUID tied to this account
//   2. StoreKit purchase with that UUID as appAccountToken
//   3. POST /api/iap/apple/verify with the signed transaction → plan granted
// Renewals/expiries/refunds reach the backend as App Store Server
// Notifications, matched to the account by the same token.
(function () {
  'use strict';

  // Must match PRODUCT_PLAN_MAP in the backend and the products created in
  // App Store Connect (one subscription group).
  const APPLE_PRODUCTS = {
    pro:   { monthly: 'com.pocketcoach.app.pro.monthly',   annual: 'com.pocketcoach.app.pro.annual' },
    coach: { monthly: 'com.pocketcoach.app.coach.monthly', annual: 'com.pocketcoach.app.coach.annual' },
  };
  const ALL_PRODUCT_IDS = Object.values(APPLE_PRODUCTS).flatMap(p => Object.values(p));
  // SKProductDiscount.paymentMode / SubscriptionPeriod.unit from StoreKit.
  const PAYMENT_MODE_FREE_TRIAL = 2;
  const PERIOD_UNITS = ['day', 'week', 'month', 'year'];

  function getPlatform() {
    if (typeof window.Capacitor !== 'undefined' && typeof window.Capacitor.getPlatform === 'function') {
      return window.Capacitor.getPlatform();
    }
    return 'web';
  }

  function usesAppleIAP() {
    return getPlatform() === 'ios';
  }

  function toast(message, type) {
    if (typeof window.showToast === 'function') window.showToast(message, type);
  }

  function native(method, options) {
    const cap = window.Capacitor;
    if (!cap || typeof cap.nativePromise !== 'function') {
      return Promise.reject(new Error('In-app purchases are only available in the iOS app.'));
    }
    return cap.nativePromise('NativePurchases', method, options || {});
  }

  async function api(method, path, body) {
    const headers = Object.assign({ 'Content-Type': 'application/json' },
      typeof window.getAuthHeaders === 'function' ? window.getAuthHeaders() : {});
    const res = await fetch((window.SERVER_URL || '') + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok || !data || data.success === false) {
      const err = new Error((data && data.error && data.error.message) || 'Something went wrong. Please try again.');
      err.code = data && data.error && data.error.code;
      throw err;
    }
    return data;
  }

  async function refreshPlan() {
    if (typeof window.loadUserPlan === 'function') await window.loadUserPlan();
    if (typeof window.renderSubscriptionPanel === 'function') window.renderSubscriptionPanel();
    document.dispatchEvent(new CustomEvent('pc:plan-changed', { detail: { plan: window.currentUserPlan } }));
  }

  /* ── Apple products & prices ─────────────────────────────── */

  let appleProducts = null; // productId -> StoreKit product
  let productsLoading = null;

  function loadAppleProducts() {
    if (!usesAppleIAP()) return Promise.resolve(null);
    if (appleProducts) return Promise.resolve(appleProducts);
    if (!productsLoading) {
      productsLoading = native('getProducts', { productIdentifiers: ALL_PRODUCT_IDS, productType: 'subs' })
        .then(({ products }) => {
          const byId = {};
          (products || []).forEach(p => { byId[p.identifier] = p; });
          if (Object.keys(byId).length) appleProducts = byId;
          return appleProducts;
        })
        .catch(err => {
          console.warn('[payments] Could not load App Store products:', err && err.message);
          return null;
        })
        .finally(() => { productsLoading = null; });
    }
    return productsLoading;
  }

  function trialText(product) {
    const intro = product && product.introductoryPrice;
    if (!intro || intro.paymentMode !== PAYMENT_MODE_FREE_TRIAL) return '';
    const period = intro.subscriptionPeriod || {};
    const unit = PERIOD_UNITS[period.unit] || period.unitString || 'day';
    const count = (period.numberOfUnits || 1) * (intro.numberOfPeriods || 1);
    const days = unit === 'week' ? count * 7 : unit === 'day' ? count : 0;
    return days ? days + '-day free trial' : count + '-' + unit + ' free trial';
  }

  // Display price for a plan in the App Store's currency, or null until the
  // products have loaded (or if they're missing from App Store Connect).
  // The billed amount is the headline — Apple requires it to be the most
  // prominent price, so annual plans aren't shown as a per-month figure.
  function applePrice(plan, billing) {
    const id = APPLE_PRODUCTS[plan] && APPLE_PRODUCTS[plan][billing];
    const product = appleProducts && appleProducts[id];
    if (!product) return null;
    const per = billing === 'annual' ? 'year' : 'month';
    return {
      headline: product.priceString,
      per: '/' + per,
      note: '',
      billed: product.priceString + ' per ' + per,
      trial: trialText(product),
    };
  }

  /* ── Purchase / restore / manage ─────────────────────────── */

  let busy = false;

  async function purchaseViaApple(plan, billing) {
    if (busy) return { busy: true };
    const productIdentifier = APPLE_PRODUCTS[plan] && APPLE_PRODUCTS[plan][billing];
    if (!productIdentifier) throw new Error('Unknown plan.');
    busy = true;
    try {
      const { appAccountToken } = await api('GET', '/api/iap/apple/account-token');
      let transaction;
      try {
        transaction = await native('purchaseProduct', { productIdentifier, productType: 'subs', appAccountToken });
      } catch (err) {
        const msg = String((err && err.message) || err);
        if (/cancel/i.test(msg)) return { cancelled: true };
        if (/pending/i.test(msg)) {
          toast('Your purchase is waiting for approval. Your plan unlocks as soon as it’s approved.');
          return { pending: true };
        }
        throw err;
      }
      if (!transaction || !transaction.jwsRepresentation) {
        throw new Error('The App Store didn’t return a receipt. Try Restore Purchases.');
      }
      const result = await api('POST', '/api/iap/apple/verify', { signedTransaction: transaction.jwsRepresentation });
      await refreshPlan();
      if (result.active) toast('Welcome to ' + (plan === 'coach' ? 'Coach' : 'Pro') + '!', 'success');
      return result;
    } finally {
      busy = false;
    }
  }

  // Entry point for every "buy" button.
  async function purchase(plan, billing) {
    if (usesAppleIAP()) {
      try {
        return await purchaseViaApple(plan, billing);
      } catch (err) {
        toast(err.message || 'Purchase failed. Please try again.', 'error');
        return { error: err };
      }
    }
    if (typeof window.checkoutWithStripe !== 'function') {
      throw new Error('Stripe checkout is not available.');
    }
    return window.checkoutWithStripe(plan, billing);
  }

  // Apple requires a Restore Purchases option for subscriptions. Re-sends
  // every current App Store entitlement to the backend. (Stripe subscriptions
  // belong to the account, so there's nothing to restore off iOS.)
  async function restore() {
    if (!usesAppleIAP()) return { restored: false, reason: 'not_applicable' };
    if (busy) return { restored: false, reason: 'busy' };
    busy = true;
    try {
      try { await native('restorePurchases'); } catch { /* sync is best-effort; entitlements below are still current */ }
      const { purchases } = await native('getPurchases', { productType: 'subs', onlyCurrentEntitlements: true });
      const ours = (purchases || []).filter(p => p.jwsRepresentation && ALL_PRODUCT_IDS.includes(p.productIdentifier));
      if (!ours.length) {
        toast('No active App Store subscription found for this Apple ID.');
        return { restored: false, reason: 'none' };
      }
      let restored = false;
      let mismatch = null;
      for (const p of ours) {
        try {
          const result = await api('POST', '/api/iap/apple/verify', { signedTransaction: p.jwsRepresentation });
          if (result.active) restored = true;
        } catch (err) {
          if (err.code === 'iap.account_mismatch') mismatch = err;
          else throw err;
        }
      }
      await refreshPlan();
      if (restored) toast('Your subscription has been restored.', 'success');
      else if (mismatch) toast(mismatch.message, 'error');
      else toast('Your App Store subscription has expired.');
      return { restored };
    } catch (err) {
      toast(err.message || 'Could not restore purchases.', 'error');
      return { restored: false, error: err };
    } finally {
      busy = false;
    }
  }

  function showStripeManagedNotice() {
    document.getElementById('stripeManagedNotice')?.remove();
    const modal = document.createElement('div');
    modal.className = 'payment-method-modal';
    modal.id = 'stripeManagedNotice';
    modal.innerHTML = `
      <div class="payment-method-inner" role="dialog" aria-modal="true" aria-labelledby="stripeManagedTitle">
        <h3 id="stripeManagedTitle">Subscription</h3>
        <p class="payment-sub">You subscribed outside the App Store, so this subscription isn’t
          managed through your Apple ID. To change or cancel it, sign in to Pocket Coach in a web
          browser and open Progress → Tools → Subscription.</p>
        <button class="close-payment-modal" aria-label="Close" onclick="this.closest('.payment-method-modal').remove()">
          <span class="ui-icon">${(window.ICONS && window.ICONS.x) || '✕'}</span>
        </button>
      </div>`;
    document.body.appendChild(modal);
  }

  // Opens wherever this subscription is managed.
  async function manage() {
    if (!usesAppleIAP()) {
      if (typeof window.openManageBilling === 'function') window.openManageBilling();
      return;
    }
    if (window.currentSubSource === 'stripe') {
      showStripeManagedNotice();
      return;
    }
    try {
      await native('manageSubscriptions');
    } catch (err) {
      toast(err.message || 'Could not open subscription settings.', 'error');
      return;
    }
    // Changes made in Apple's sheet reach the backend as server
    // notifications; re-read the plan when the app is foregrounded again.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      refreshPlan();
    };
    document.addEventListener('visibilitychange', onVisible);
  }

  if (usesAppleIAP()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => loadAppleProducts());
    else loadAppleProducts();
  }

  window.pocketCoachPayments = {
    getPlatform,
    usesAppleIAP,
    loadAppleProducts,
    applePrice,
    purchase,
    restore,
    manage,
    APPLE_PRODUCTS,
  };
})();
