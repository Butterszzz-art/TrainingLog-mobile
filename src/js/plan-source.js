// Plain-words description of where a user's plan comes from, for the
// Subscription panel: "Pro via Prep Pass, until 14 Feb", "Pro trial, 9 days
// left", "Founder Lifetime". Source values come from GET /api/user/plan
// (planSource / planExpiresAt) — see src/entitlements.js in the backend.
(function (root) {
  'use strict';

  var SUBSCRIPTION_SOURCES = { stripe_sub: true, apple_sub: true };

  function formatDay(date, locale) {
    try {
      return date.toLocaleDateString(locale || undefined, { day: 'numeric', month: 'short' });
    } catch (e) {
      return date.toISOString().slice(0, 10);
    }
  }

  function daysLeft(expires, now) {
    return Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / 86400000));
  }

  // opts: { plan, source, expiresAt (ISO|null), subStatus, now?, locale? }
  // Returns { status: string, isSubscription: boolean }.
  function describePlanSource(opts) {
    var o = opts || {};
    var plan = o.plan || 'free';
    var now = o.now ? new Date(o.now) : new Date();
    var expires = o.expiresAt ? new Date(o.expiresAt) : null;
    if (expires && isNaN(expires.getTime())) expires = null;
    var name = plan === 'coach' ? 'Coach' : 'Pro';
    var until = expires ? ', until ' + formatDay(expires, o.locale) : '';
    var source = o.source || null;

    if (plan === 'free') {
      return { status: 'No active subscription', isSubscription: false };
    }
    if (!source || SUBSCRIPTION_SOURCES[source]) {
      var s = o.subStatus || 'none';
      var text = s === 'trialing' ? 'Free trial active'
        : s === 'past_due' ? 'Payment issue'
        : 'Active subscription';
      return { status: text, isSubscription: true };
    }
    switch (source) {
      case 'prep_pass': return { status: name + ' via Prep Pass' + until, isSubscription: false };
      case 'meet_pass': return { status: name + ' via Meet Pass' + until, isSubscription: false };
      case 'founder_lifetime': return { status: 'Founder Lifetime', isSubscription: false };
      case 'reverse_trial':
      case 'moment_trial': {
        if (!expires) return { status: name + ' trial', isSubscription: false };
        var n = daysLeft(expires, now);
        return { status: name + ' trial, ' + n + (n === 1 ? ' day' : ' days') + ' left', isSubscription: false };
      }
      case 'referral': return { status: name + ' from referrals' + until, isSubscription: false };
      case 'coach_client': return { status: name + ', included by your coach', isSubscription: false };
      default: return { status: name + until, isSubscription: false };
    }
  }

  var api = { describePlanSource: describePlanSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PlanSource = api;
})(typeof window !== 'undefined' ? window : null);
