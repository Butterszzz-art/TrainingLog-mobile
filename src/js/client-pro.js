// Client Pro (PAY2-9): Pro included by the user's coach. The backend
// (src/clientPro.js) sends clientPro in GET /api/user/plan:
//   { active, coachUid, coachName, grantedAt, regrantedAt, revokedAt, revokedReason }
//
// Two one-time messages, both shown after the plan loads (never during a
// logging action):
//   1. Client Pro starts while the user pays for their own Pro subscription:
//      "Your coach now includes Pro. You can cancel your own subscription…"
//      with a button to their billing (Stripe portal / Apple). Never cancels
//      anything itself. Passes and lifetime: no notice.
//   2. Client Pro ends and nothing else gives Pro: "Your coach's Pro access
//      has ended…" with plans (annual pre-selected) and an equal "Continue
//      with Free". Once per revocation. If it ended because the coach's own
//      plan lapsed, wait 7 days first — a coach's card retry usually brings
//      it back, and the sheet shouldn't flicker.
(function (root) {
  'use strict';

  var COACH_LAPSE_GRACE_MS = 7 * 86400000;
  var SEEN_KEY = 'pc.clientPro.seen';

  function doublePayKey(cp, planSource) {
    if (!cp || !cp.active) return null;
    if (planSource !== 'stripe_sub' && planSource !== 'apple_sub') return null;
    return 'double:' + cp.coachUid + ':' + (cp.regrantedAt || cp.grantedAt || '');
  }

  function endSheetKey(cp, plan, now) {
    if (!cp || cp.active || !cp.revokedAt || plan !== 'free') return null;
    var revoked = new Date(cp.revokedAt);
    if (isNaN(revoked.getTime())) return null;
    if (cp.revokedReason === 'coach_plan_lapsed' && (now || new Date()) - revoked < COACH_LAPSE_GRACE_MS) return null;
    return 'end:' + cp.coachUid + ':' + cp.revokedAt;
  }

  // Pure: which message (if any) to show now. seen = keys already shown.
  function nextMessage(opts) {
    var o = opts || {};
    var seen = o.seen || {};
    var k = doublePayKey(o.clientPro, o.planSource);
    if (k && !seen[k]) return { type: 'double-pay', key: k };
    k = endSheetKey(o.clientPro, o.plan, o.now);
    if (k && !seen[k]) return { type: 'ended', key: k };
    return null;
  }

  function readSeen() {
    try { return JSON.parse(root.localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function markSeen(key) {
    var seen = readSeen();
    seen[key] = Date.now();
    try { root.localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) { /* storage off: may show again */ }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showDoublePayNotice(cp, planSource) {
    var doc = root.document;
    var overlay = doc.createElement('div');
    overlay.className = 'payment-method-modal';
    var apple = planSource === 'apple_sub';
    overlay.innerHTML = '<div class="upg-sheet" role="dialog" aria-modal="true" aria-labelledby="cpDoubleTitle">'
      + '<div class="upg-head"><span class="mx-kicker">Pocket Coach</span>'
      + '<h3 class="upg-title" id="cpDoubleTitle">Your coach now includes Pro</h3>'
      + '<p class="mx-sub">' + (cp.coachName ? esc(cp.coachName) + ' includes Pro for you. ' : '')
      + 'You can cancel your own subscription so you don’t pay twice.</p></div>'
      + '<div class="cp-actions">'
      + '<button type="button" class="mx-cta cp-manage">' + (apple ? 'Manage in App Store' : 'Manage subscription') + '</button>'
      + '<button type="button" class="mx-outline mx-outline--block cp-close">Keep it for now</button>'
      + '</div></div>';
    function close() { overlay.remove(); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.cp-close').addEventListener('click', close);
    overlay.querySelector('.cp-manage').addEventListener('click', function () {
      close();
      if (apple && root.pocketCoachPayments && typeof root.pocketCoachPayments.manage === 'function') root.pocketCoachPayments.manage();
      else if (typeof root.openManageBilling === 'function') root.openManageBilling();
    });
    doc.body.appendChild(overlay);
  }

  function showEndedSheet() {
    if (typeof root.openUpgradeModal !== 'function') return;
    root.openUpgradeModal('pro', {
      heading: 'Your coach’s Pro access has ended',
      sub: 'All your data is still here. Keep Pro, or carry on with Free.',
      annual: true,
      continueFree: true,
    });
  }

  // Called after loadUserPlan succeeds.
  function check() {
    var msg = nextMessage({
      clientPro: root.currentClientPro,
      planSource: root.currentPlanSource,
      plan: root.currentUserPlan,
      seen: readSeen(),
    });
    if (!msg) return;
    // The plan loads at launch/login, not during logging. Still, never stack
    // on another sheet; try again on the next plan load.
    if (root.document.querySelector('.payment-method-modal, .ai-consent-overlay')) return;
    markSeen(msg.key);
    if (msg.type === 'double-pay') showDoublePayNotice(root.currentClientPro, root.currentPlanSource);
    else showEndedSheet();
  }

  var api = { nextMessage: nextMessage, doublePayKey: doublePayKey, endSheetKey: endSheetKey, check: check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) root.PocketCoachClientPro = api;
})(typeof window !== 'undefined' ? window : {});
