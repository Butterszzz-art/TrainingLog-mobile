// Monthly AI uses ("credits") for the signed-in account.
//
// The server meters AI (traininglog-backend-sync src/aiMeter.js). GET
// /api/user/plan returns ai { used, limit, resetsAt }; after each AI call
// the response header X-AI-Remaining says how many are left, so the counter
// updates without refetching the plan (ai-consent.js forwards it here).
//
// Any element with data-ai-usage shows the counter line:
//   free: "3 of 5 free AI uses left this month"
//   paid: nothing until 80% used, then "120 of 150 AI uses this month"
(function (root) {
  'use strict';

  var state = null; // { used, limit, resetsAt }

  function isPaid() {
    return !!(root && typeof root.hasPaidAccess === 'function' && root.hasPaidAccess());
  }

  // Pure: the counter text for a usage snapshot ('' = show nothing).
  function usageLabel(usage, paid) {
    if (!usage || !(usage.limit > 0)) return '';
    var used = Math.max(0, Math.min(usage.limit, Number(usage.used) || 0));
    if (!paid) {
      var left = usage.limit - used;
      return left + ' of ' + usage.limit + ' free AI uses left this month';
    }
    if (used / usage.limit < 0.8) return '';
    return used + ' of ' + usage.limit + ' AI uses this month';
  }

  function remaining() {
    return state ? Math.max(0, state.limit - (state.used || 0)) : null;
  }

  function render() {
    if (!root || !root.document) return;
    var text = usageLabel(state, isPaid());
    var els = root.document.querySelectorAll('[data-ai-usage]');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = text;
      els[i].hidden = !text;
    }
  }

  function set(usage) {
    state = usage && usage.limit > 0
      ? { used: Number(usage.used) || 0, limit: Number(usage.limit), resetsAt: usage.resetsAt || null }
      : null;
    render();
  }

  // From the X-AI-Remaining header after an AI call.
  function setRemaining(n) {
    var left = Number(n);
    if (!state || !isFinite(left)) return;
    state.used = Math.max(0, state.limit - left);
    render();
  }

  var api = {
    usageLabel: usageLabel, set: set, setRemaining: setRemaining, render: render,
    remaining: remaining, get: function () { return state; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.PocketCoachAiUsage = api;
    if (root.document) {
      root.document.addEventListener('pc:ai-remaining', function (e) { setRemaining(e.detail && e.detail.remaining); });
      root.document.addEventListener('DOMContentLoaded', render);
    }
  }
})(typeof window !== 'undefined' ? window : null);
