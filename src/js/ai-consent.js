// AI data-sharing consent — Apple App Store Guideline 5.1.2(i): an app must
// say clearly when it shares personal data with a third-party AI service and
// get the user's explicit permission before doing so.
//
// Every AI feature talks to our server's /api/ai/* (and legacy /ai/*)
// routes, which forward the user's data to OpenRouter and the AI model
// providers it routes to (see privacy.html#ai). Rather than gate each
// of the ~15 call sites, this wraps window.fetch once: the first AI request
// on a device shows a consent sheet and waits for the answer. Agree → the
// request goes ahead. Decline → it resolves to a 403 JSON error, which every
// caller already handles as "AI unavailable" (deterministic fallbacks keep
// working). The choice can be changed in Settings → App → Privacy & Legal.
//
// The same wrapper is the app side of the Pro gate: every AI feature is Pro,
// so known-free accounts are stopped before any request (see "Pro gate").
//
// Must load before any script that calls an AI route.
(function () {
  'use strict';

  // v2: the provider changed from Anthropic to OpenRouter (2026-10-05), so
  // consent given to the old wording is asked for again. Bump this whenever
  // the consent sheet's description of who gets the data changes.
  var STORAGE_KEY = 'pc.aiConsent.v2'; // 'granted' | 'declined'
  var AI_ROUTE = /\/(api\/)?ai\//;
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var pendingPrompt = null;
  var lastDeclinedToast = 0;
  // The coach portal lives one level down (coach/index.html).
  var PRIVACY_URL = (/\/coach\//.test(location.pathname) ? '../' : '') + 'privacy.html#ai';

  function getConsent() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* storage unavailable — consent lasts for this session only */ }
    sessionConsent = value;
  }

  var sessionConsent = getConsent();

  function currentConsent() {
    return getConsent() || sessionConsent;
  }

  function isAiRequest(input) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    return AI_ROUTE.test(url);
  }

  function injectStyles() {
    if (document.getElementById('aiConsentStyles')) return;
    var style = document.createElement('style');
    style.id = 'aiConsentStyles';
    style.textContent = [
      '.ai-consent-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-end;justify-content:center;',
      'background:rgba(0,0,0,.55);padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));}',
      '.ai-consent-sheet{width:100%;max-width:440px;max-height:85vh;overflow:auto;border-radius:22px;padding:22px 20px 18px;',
      'background:var(--pod-bg,#131d16);color:var(--text-primary,#eef3ef);border:1px solid var(--pod-border,rgba(255,255,255,.08));',
      'font-family:var(--font-body,system-ui,sans-serif);box-shadow:0 20px 60px rgba(0,0,0,.5);}',
      '.ai-consent-sheet h3{margin:0 0 10px;font-size:19px;line-height:1.25;}',
      '.ai-consent-sheet p,.ai-consent-sheet li{margin:0 0 8px;font-size:14px;line-height:1.5;color:var(--text-secondary,#b9c6bd);}',
      '.ai-consent-sheet ul{margin:0 0 10px;padding-left:18px;}',
      '.ai-consent-sheet a{color:var(--green-90,#7fdc9b);}',
      '.ai-consent-actions{display:flex;flex-direction:column;gap:8px;margin-top:14px;}',
      '.ai-consent-actions button{min-height:46px;border-radius:14px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;margin:0;}',
      '.ai-consent-agree{border:0;background:var(--fill-btn-primary-mobile,#2f8f4e);color:var(--label-on-green,#fff);}',
      '.ai-consent-decline{background:transparent;color:var(--text-primary,#eef3ef);border:1px solid var(--pod-border,rgba(255,255,255,.18));}'
    ].join('');
    document.head.appendChild(style);
  }

  // Resolves true (agreed) or false (declined). Only one sheet at a time —
  // concurrent AI requests on first launch all wait on the same answer.
  function prompt() {
    if (pendingPrompt) return pendingPrompt;
    pendingPrompt = new Promise(function (resolve) {
      function show() {
        injectStyles();
        var overlay = document.createElement('div');
        overlay.className = 'ai-consent-overlay';
        overlay.innerHTML =
          '<div class="ai-consent-sheet" role="dialog" aria-modal="true" aria-labelledby="aiConsentTitle">'
          + '<h3 id="aiConsentTitle">Share your data with our AI provider?</h3>'
          + '<p>Pocket Coach\'s AI features — the AI coach, weekly briefs and reviews, program generator and import, macro, sleep and plateau insights, and rehab plans — run on AI models reached through <strong>OpenRouter</strong>. We currently use free models from Google, NVIDIA, Alibaba (Qwen) and Nex AGI.</p>'
          + '<p>To use them, the app sends the relevant parts of your data to OpenRouter and the model provider that answers:</p>'
          + '<ul><li>workouts, exercises and weights</li><li>bodyweight, nutrition, sleep and readiness scores</li><li>your goals, anything you type to the coach, and program files you import</li></ul>'
          + '<p><strong>Providers of free models may store your requests and use them to improve their models.</strong> Your password and payment details are never sent. '
          + 'See the <a href="' + PRIVACY_URL + '">Privacy Policy</a>.</p>'
          + '<p>You can change this any time in Settings → App → Privacy &amp; Legal.</p>'
          + '<div class="ai-consent-actions">'
          +   '<button type="button" class="ai-consent-agree">Allow AI features</button>'
          +   '<button type="button" class="ai-consent-decline">Not now</button>'
          + '</div></div>';
        function finish(agreed) {
          setConsent(agreed ? 'granted' : 'declined');
          overlay.remove();
          pendingPrompt = null;
          document.dispatchEvent(new CustomEvent('pc:ai-consent-changed', { detail: { granted: agreed } }));
          resolve(agreed);
        }
        overlay.querySelector('.ai-consent-agree').addEventListener('click', function () { finish(true); });
        overlay.querySelector('.ai-consent-decline').addEventListener('click', function () { finish(false); });
        document.body.appendChild(overlay);
        overlay.querySelector('.ai-consent-agree').focus();
      }
      if (document.body) show();
      else document.addEventListener('DOMContentLoaded', show, { once: true });
    });
    return pendingPrompt;
  }

  function declinedResponse() {
    var now = Date.now();
    if (now - lastDeclinedToast > 10000) {
      lastDeclinedToast = now;
      var msg = 'AI features are off. Turn them on in Settings → App → Privacy & Legal.';
      if (typeof window.showToast === 'function') window.showToast(msg);
    }
    return new Response(JSON.stringify({
      success: false,
      error: { code: 'ai.consent_required', message: 'AI data sharing is turned off.' }
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  /* ── Pro gate ───────────────────────────────────────────── */
  // Every AI feature is Pro. The server enforces it (403
  // plan.upgrade_required); this stops known-free accounts before a request
  // (or a consent prompt) happens. Admins (plan response `admin: true`) pass.
  // The upgrade sheet only opens when the user just tapped something, so
  // AI that loads on its own (e.g. the Home brief) quietly shows its fallback.
  var lastInteraction = 0;
  var lastUpgradePrompt = 0;
  ['pointerdown', 'keydown'].forEach(function (type) {
    document.addEventListener(type, function () { lastInteraction = Date.now(); }, true);
  });

  function storedPlan() {
    try { return localStorage.getItem('userPlan'); } catch (e) { return null; }
  }

  // True only when we know the account is free — if the plan hasn't loaded
  // yet, let the server decide rather than block a paying user.
  function knownFreeAccount() {
    if (typeof window.hasPaidAccess === 'function' && window.hasPaidAccess()) return false;
    var plan = window.currentUserPlanLoaded ? window.currentUserPlan : storedPlan();
    return plan === 'free';
  }

  function upgradeRequiredResponse() {
    var now = Date.now();
    if (now - lastInteraction < 5000 && now - lastUpgradePrompt > 3000) {
      lastUpgradePrompt = now;
      if (typeof window.showToast === 'function') window.showToast('AI features are part of Pocket Coach Pro.');
      if (typeof window.openUpgradeModal === 'function') window.openUpgradeModal('pro');
    }
    return new Response(JSON.stringify({
      success: false,
      error: { code: 'plan.upgrade_required', message: 'AI features are part of Pocket Coach Pro. Upgrade to use them.' }
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // The server is the source of truth: if it says upgrade (plan changed,
  // stale local state), prompt the same way.
  function sendAi(input, init) {
    return nativeFetch(input, init).then(function (res) {
      if (res.status !== 403) return res;
      return res.clone().json().then(function (body) {
        return body && body.error && body.error.code === 'plan.upgrade_required' ? upgradeRequiredResponse() : res;
      }, function () { return res; });
    });
  }

  if (nativeFetch) {
    window.fetch = function (input, init) {
      if (!isAiRequest(input)) return nativeFetch(input, init);
      if (knownFreeAccount()) return Promise.resolve(upgradeRequiredResponse());
      var consent = currentConsent();
      if (consent === 'granted') return sendAi(input, init);
      if (consent === 'declined') return Promise.resolve(declinedResponse());
      return prompt().then(function (agreed) {
        return agreed ? sendAi(input, init) : declinedResponse();
      });
    };
  }

  // Settings → App → Privacy & Legal toggle. Called each time the settings
  // markup is (re)rendered; binds once per element.
  function bindSettings(container) {
    var toggle = (container || document).querySelector('#aiConsentToggle');
    if (!toggle) return;
    toggle.checked = currentConsent() === 'granted';
    if (toggle.dataset.bound === 'true') return;
    toggle.dataset.bound = 'true';
    toggle.addEventListener('change', function () {
      setConsent(toggle.checked ? 'granted' : 'declined');
      var msg = toggle.checked ? 'AI features turned on.' : 'AI features turned off. No data will be sent to AI providers.';
      if (typeof window.showToast === 'function') window.showToast(msg);
    });
  }

  window.pocketCoachAIConsent = {
    get: currentConsent,
    set: setConsent,
    prompt: prompt,
    bindSettings: bindSettings
  };
})();
