/*
  Coach Pro codes, under Settings › Account.
  - Athletes: enter a coach's code → linked to that coach, Pro included.
  - Coaches (Coach plan): see, copy and replace their own code.
  Backend: GET /api/coach/code, POST /api/coach/code/regenerate,
  POST /api/client/coach-code; the athlete's status comes back on
  GET /api/user/plan as coachPro (stored by loadUserPlan in index.html).
*/
(function (root) {
  'use strict';

  const base = () => String(root.SERVER_URL || '').replace(/\/$/, '');
  const headers = () => (typeof root.getAuthHeaders === 'function' ? root.getAuthHeaders() : {});
  const $ = id => root.document.getElementById(id);

  function toast(msg, kind) {
    if (typeof root.nativeToast === 'function') root.nativeToast(msg, kind);
    else if (typeof root.showToast === 'function') root.showToast(msg, kind);
  }

  async function api(method, path, body) {
    const res = await fetch(base() + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.success === false) {
      const err = new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // "abcd efgh" → "ABCD-EFGH" while typing; null when it isn't 8 characters.
  function cleanCode(value) {
    const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return raw.length === 8 ? raw : null;
  }
  function displayCode(raw) {
    const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
  }

  function statusText(coachPro) {
    if (!coachPro || !coachPro.coachUsername) return null;
    const who = '@' + coachPro.coachUsername;
    if (coachPro.status === 'active') return `Pro is included by your coach ${who}.`;
    if (coachPro.status === 'paused') return `Pro from ${who} is paused: their Coach plan isn't active. It comes back when they renew.`;
    return null; // revoked: show the normal prompt
  }

  // ── athlete side ────────────────────────────────────────────────
  function renderRedeem() {
    const status = $('coachCodeStatus');
    if (!status) return;
    const text = statusText(root.currentCoachPro);
    status.textContent = text || 'Got a code from your coach? Enter it to get Pro, included by them.';
    const btn = $('coachCodeRedeemBtn');
    if (btn) btn.textContent = text ? 'Change' : 'Use code';
  }

  let redeeming = false;
  async function redeem() {
    const input = $('coachCodeInput');
    const btn = $('coachCodeRedeemBtn');
    if (!input || redeeming) return;
    const code = cleanCode(input.value);
    if (!code) { toast('A coach code has 8 letters and numbers, like ABCD-EFGH.', 'error'); input.focus(); return; }
    redeeming = true;
    if (btn) btn.disabled = true;
    try {
      const data = await api('POST', '/api/client/coach-code', { code });
      input.value = '';
      root.currentCoachPro = { status: 'active', coachUsername: data.coachUsername };
      toast(`You're linked to @${data.coachUsername}. Pro is on.`, 'success');
      if (typeof root.loadUserPlan === 'function') await root.loadUserPlan();
      refreshAccount();
      if (typeof root.renderYourCoachSection === 'function') root.renderYourCoachSection();
    } catch (err) {
      toast(err.status === 429 ? 'Too many tries. Wait a few minutes and try again.' : (err.message || 'Could not use that code.'), 'error');
    } finally {
      redeeming = false;
      if (btn) btn.disabled = false;
    }
  }

  // ── coach side ──────────────────────────────────────────────────
  async function renderOwn() {
    const group = $('coachCodeOwnGroup');
    if (!group) return;
    const isCoach = typeof root.hasCoachAccess === 'function' && root.hasCoachAccess();
    group.hidden = !isCoach;
    if (!isCoach) return;
    const field = $('coachCodeOwn');
    if (field && !field.value) field.value = 'Loading…';
    try {
      const data = await api('GET', '/api/coach/code');
      if (field) field.value = data.display || displayCode(data.code);
    } catch (err) {
      if (field) field.value = '';
      if (err.status === 403) group.hidden = true; // not on the Coach plan after all
    }
  }

  function copyOwn() {
    const field = $('coachCodeOwn');
    const value = field && field.value;
    if (!value || value === 'Loading…') return;
    const done = () => toast('Coach code copied', 'success');
    if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(value).then(done).catch(() => { field.select(); done(); });
    else { field.select(); root.document.execCommand && root.document.execCommand('copy'); done(); }
  }

  async function newCode() {
    const ok = typeof root.confirm === 'function'
      ? root.confirm('Make a new coach code? The old one stops working. Clients who already joined keep Pro.')
      : true;
    if (!ok) return;
    try {
      const data = await api('POST', '/api/coach/code/regenerate');
      const field = $('coachCodeOwn');
      if (field) field.value = data.display || displayCode(data.code);
      toast('New coach code ready', 'success');
    } catch (err) {
      toast(err.message || 'Could not make a new code.', 'error');
    }
  }

  function refreshAccount() {
    renderRedeem();
    if (typeof root.refreshSettingsPageValues === 'function') root.refreshSettingsPageValues();
    if (typeof root.renderSubscriptionPanel === 'function') root.renderSubscriptionPanel();
  }

  let bound = false;
  function bind() {
    if (bound) return;
    const btn = $('coachCodeRedeemBtn');
    if (!btn) return;
    bound = true;
    btn.addEventListener('click', redeem);
    const input = $('coachCodeInput');
    input.addEventListener('input', () => {
      const shown = displayCode(input.value);
      if (shown !== input.value) input.value = shown;
    });
    // Enter would submit the settings form; use the code instead.
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); redeem(); } });
    $('coachCodeCopyBtn')?.addEventListener('click', copyOwn);
    $('coachCodeNewBtn')?.addEventListener('click', newCode);
  }

  // Called each time Settings › Account opens.
  function renderCoachCodePanel() {
    if (!root.document) return;
    bind();
    renderRedeem();
    renderOwn();
  }

  root.renderCoachCodePanel = renderCoachCodePanel;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { cleanCode, displayCode, statusText };
  }
})(typeof window !== 'undefined' ? window : globalThis);
