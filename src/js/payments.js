// Payment rail — Stripe for every platform and region.
//
// Both storefronts we ship to permit linking OUT of the app to a third-party
// processor (Stripe) instead of Apple's own In-App Purchase — under
// different rules:
//   - US: since the Epic v. Apple injunction (April 2025) Apple's US
//     storefront guidelines allow buttons/links to an external purchase
//     page with no entitlement and no Apple commission.
//   - EU: requires applying for, and being granted, Apple's StoreKit
//     External Purchase Link Entitlement (DMA terms). Once granted, Apple
//     requires ITS OWN system disclosure sheet (StoreKit ExternalPurchase /
//     ExternalPurchaseLink APIs), which a plain webview can't call — the EU
//     launch needs a small native plugin on top of this file. Until then,
//     release to the US storefront only in App Store Connect.
//
// Rather than branch per-region (which needs Apple's native Storefront API,
// not device locale), this ships ONE conservative disclosure screen for
// every iOS purchase: tell the user plainly they're leaving the app to pay
// elsewhere, then hand off to Safari.
//
// How the hand-off works: Capacitor's iOS WebView refuses to load any
// top-level URL outside the app's own origin (capacitor.config.json has no
// server.allowNavigation) and passes it to UIApplication.open() instead —
// i.e. the user's default browser, not an in-app browser sheet. So a plain
// `location.href = stripeUrl` is already a genuine external link. Don't add
// @capacitor/browser for this: it opens SFSafariViewController, which is an
// in-app browser and doesn't meet the EU "default browser" requirement.
//
// Other territories: external purchase links are still prohibited in most
// of them — expanding there needs real Apple IAP or excluding them.
//
// Both rails converge server-side on the same users/{uid} fields via
// applyEntitlement() — see traininglog-backend's IAP-SETUP.md.
(function () {
  'use strict';

  function getPlatform() {
    if (typeof window.Capacitor !== 'undefined' && typeof window.Capacitor.getPlatform === 'function') {
      return window.Capacitor.getPlatform();
    }
    return 'web';
  }

  // True on iOS: there, Stripe checkout must be preceded by the external
  // purchase disclosure. This app never uses StoreKit.
  function needsExternalPurchaseFlow() {
    return getPlatform() === 'ios';
  }

  // Entry point — call this instead of checkoutWithStripe() directly so the
  // disclosure step always runs first on iOS.
  async function purchase(plan, billing) {
    if (needsExternalPurchaseFlow()) {
      return showExternalPurchaseDisclosure(plan, billing);
    }
    if (typeof window.checkoutWithStripe !== 'function') {
      throw new Error('Stripe checkout is not available.');
    }
    return window.checkoutWithStripe(plan, billing);
  }

  // Stripe subscriptions are tied to the account, not a device or an Apple
  // ID — there's nothing to "restore".
  async function restore() {
    return { restored: false, reason: 'not_applicable' };
  }

  // Stripe owns subscription management on every platform — the billing
  // portal opens in Safari on iOS the same way checkout does.
  function manage() {
    if (typeof window.openManageBilling === 'function') {
      window.openManageBilling();
    }
  }

  // The user finishes paying in Safari and comes back to the app by hand, so
  // re-read their plan the next time the app is foregrounded.
  function refreshPlanOnReturn() {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      if (typeof window.loadUserPlan === 'function') window.loadUserPlan();
    }
    document.addEventListener('visibilitychange', onVisible);
  }

  function showExternalPurchaseDisclosure(plan, billing) {
    const existing = document.getElementById('externalPurchaseDisclosure');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'payment-method-modal';
    modal.id = 'externalPurchaseDisclosure';
    modal.innerHTML = `
      <div class="payment-method-inner" role="dialog" aria-modal="true" aria-labelledby="externalPurchaseTitle">
        <h3 id="externalPurchaseTitle">You're leaving Pocket Coach</h3>
        <p class="payment-sub">
          Payment is completed on our website in your browser, outside the
          App Store. Apple is not responsible for the privacy or security of
          that purchase. Your subscription is billed and managed there, not
          through your Apple ID, and App Store refunds and purchase history
          don't apply to it.
        </p>
        <button class="pay-btn pay-stripe" id="externalPurchaseContinueBtn">
          Continue to payment
        </button>
        <button class="close-payment-modal" aria-label="Cancel" onclick="this.closest('.payment-method-modal').remove()">
          <span class="ui-icon">${(window.ICONS && window.ICONS.x) || '✕'}</span>
        </button>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('externalPurchaseContinueBtn').addEventListener('click', async () => {
      modal.remove();
      await window.checkoutWithStripe(plan, billing, { external: true });
    });
  }

  window.pocketCoachPayments = {
    getPlatform,
    needsExternalPurchaseFlow,
    usesAppleIAP: needsExternalPurchaseFlow, // alias so old call sites don't silently break
    purchase,
    restore,
    manage,
    refreshPlanOnReturn
  };
})();
