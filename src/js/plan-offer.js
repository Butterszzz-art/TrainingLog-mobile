// What a plan card in the upgrade sheet offers this user (pure).
//
//   current     — they already pay for exactly this plan and billing cycle.
//   switch      — they pay for another plan/cycle in this store: change the
//                 running subscription (Stripe price swap, or an App Store
//                 upgrade in the same subscription group). Never a second one.
//   other-store — their subscription is in the other store (App Store vs web),
//                 so it's changed there, not bought again here.
//   new         — no subscription: a normal purchase, with the free trial only
//                 when the account (web) or Apple ID (iOS) can still get it.
//
// subscription: GET /api/user/plan's `subscription` ({ store, plan, billing })
// or null. store: 'apple' on iOS, 'stripe' elsewhere.
(function (root) {
  'use strict';

  function offerFor(opts) {
    var o = opts || {};
    var sub = o.subscription;
    if (sub && sub.store && sub.plan && sub.plan !== 'free') {
      if (sub.store !== o.store) return { state: 'other-store', trial: false };
      if (sub.plan === o.plan && (!sub.billing || sub.billing === o.billing)) return { state: 'current', trial: false };
      return { state: 'switch', trial: false };
    }
    return { state: 'new', trial: o.trialEligible === true };
  }

  function ctaLabel(offer, planName) {
    switch (offer.state) {
      case 'current': return 'Current plan';
      case 'switch': return 'Switch to ' + planName;
      case 'other-store': return 'Change plan';
      default: return offer.trial ? 'Start Free Trial' : 'Subscribe';
    }
  }

  var api = { offerFor: offerFor, ctaLabel: ctaLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PlanOffer = api;
})(typeof window !== 'undefined' ? window : null);
