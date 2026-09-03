// Payment rail abstraction — skeleton.
//
// Why this exists: Apple App Store Guideline 3.1.1 requires digital
// subscriptions that unlock features *inside* the app to go through
// StoreKit on iOS, not an external processor. The Stripe checkout that
// already exists in this file (checkoutWithStripe/openManageBilling in
// index.html) is fine for web and Android but cannot be the purchase path
// inside the iOS build. This module is the single place that decides which
// rail to use, so every call site (pricing.html, the upgrade modal, the
// Settings subscription panel) asks *this* which rail applies instead of
// each hardcoding "call Stripe".
//
// Both rails converge server-side on the same users/{uid} fields via
// applyEntitlement() in traininglog-backend-sync/server.js — see that
// repo's IAP-SETUP.md for the full picture and the remaining manual setup.
//
// Status: the web/Android (Stripe) path is real and already shipped. The
// iOS (Apple IAP) path is NOT implemented yet — purchaseViaIAP/restoreViaIAP
// below are stubs that surface a clear "not available yet" message rather
// than silently failing or (worse) falling back to Stripe checkout inside
// an iOS build, which is exactly the App Store guideline violation this
// exists to avoid. Wiring them up needs: the ios/ native project to exist,
// a Capacitor IAP plugin installed, and the App Store Connect product setup
// in IAP-SETUP.md.
(function () {
  'use strict';

  function getPlatform() {
    // Capacitor's own platform detection — 'ios' | 'android' | 'web'.
    // Falls back to 'web' outside a Capacitor shell (plain browser/PWA).
    if (typeof window.Capacitor !== 'undefined' && typeof window.Capacitor.getPlatform === 'function') {
      return window.Capacitor.getPlatform();
    }
    return 'web';
  }

  function usesAppleIAP() {
    return getPlatform() === 'ios';
  }

  // Purchase entry point — call this instead of checkoutWithStripe() directly
  // from any new UI, so it automatically routes to the correct rail. Existing
  // Stripe call sites (openCheckout's "Pay with Card" button) are left as-is
  // for web/Android and gated off on iOS — see index.html's openCheckout().
  async function purchase(plan, billing) {
    if (usesAppleIAP()) return purchaseViaIAP(plan, billing);
    if (typeof window.checkoutWithStripe !== 'function') {
      throw new Error('Stripe checkout is not available.');
    }
    return window.checkoutWithStripe(plan, billing);
  }

  async function restore() {
    if (usesAppleIAP()) return restoreViaIAP();
    // Stripe has no client-side "restore" concept — a subscription is tied
    // to the account, not the device, so there's nothing to restore.
    return { restored: false, reason: 'not_applicable' };
  }

  // Opens whatever subscription-management surface applies to this platform.
  // Apple doesn't allow deep-linking out to a third-party billing portal for
  // an App-Store-purchased subscription, so iOS gets Apple's own management
  // screen instead of Stripe's billing portal.
  function manage() {
    if (usesAppleIAP()) {
      window.location.href = 'itms-apps://apps.apple.com/account/subscriptions';
      return;
    }
    if (typeof window.openManageBilling === 'function') {
      window.openManageBilling();
    }
  }

  // ── Apple IAP stubs — NOT implemented, see the file header ────────────────
  async function purchaseViaIAP(_plan, _billing) {
    const message = 'In-app purchases are coming soon on iOS.';
    if (typeof window.nativeToast === 'function') window.nativeToast(message, 'error');
    else if (typeof window.showToast === 'function') window.showToast(message);
    throw new Error('Apple IAP purchase path is not implemented yet — see payments.js and IAP-SETUP.md.');
  }

  async function restoreViaIAP() {
    const message = 'Restore purchases is coming soon on iOS.';
    if (typeof window.nativeToast === 'function') window.nativeToast(message, 'error');
    else if (typeof window.showToast === 'function') window.showToast(message);
    return { restored: false, reason: 'not_implemented' };
  }

  window.pocketCoachPayments = {
    getPlatform,
    usesAppleIAP,
    purchase,
    restore,
    manage
  };
})();
