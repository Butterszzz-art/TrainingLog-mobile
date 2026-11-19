/* =============================================================
   TRAIN TOGETHER — get a coach or a friend in early
   People who train with someone keep showing up. This puts the two
   ways in front of new users instead of under Settings:
   - "Have a coach?": enter their coach code (coach-code.js redeemCode,
     POST /api/client/coach-code) — linked, Pro included;
   - "Bring a friend": share your invite link (AppLinks.inviteUrl with
     your referral code; GET /api/referral/stats when it isn't loaded).

   Used by onboarding's last step (rendered inline there) and the Home
   starter card (window.openTrainTogether() → sheet).
   hasPartner() tells the starter card the step is done.
   ============================================================= */
(function (global) {
  'use strict';

  const SHARED_KEY = u => `inviteShared_${u}`;
  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  function user() {
    return (typeof global.getActiveUsername === 'function' && global.getActiveUsername())
      || global.currentUser || localStorage.getItem('fitnessAppUser') || '';
  }

  function toast(msg, kind) {
    const t = global.nativeToast || global.showToast;
    if (typeof t === 'function') t(msg, kind);
  }

  function coachLinked() {
    const cp = global.currentCoachPro;
    if (cp && cp.coachUsername && cp.status !== 'revoked') return true;
    try { return typeof global.activeCoachName === 'function' && !!global.activeCoachName(); } catch { return false; }
  }

  function hasPartner(u = user()) {
    return coachLinked() || !!localStorage.getItem(SHARED_KEY(u));
  }

  async function referralCode() {
    if (global.currentReferralCode) return global.currentReferralCode;
    const u = user();
    if (!u || !global.SERVER_URL) return '';
    try {
      const res = await fetch(`${global.SERVER_URL}/api/referral/stats?username=${encodeURIComponent(u)}`, {
        headers: typeof global.getAuthHeaders === 'function' ? global.getAuthHeaders() : {},
      });
      const data = await res.json();
      if (data && data.referralCode) global.currentReferralCode = data.referralCode;
      return (data && data.referralCode) || '';
    } catch { return ''; }
  }

  async function copyText(text) {
    try { await global.navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return true;
  }

  /** Share (or copy) the invite link. Resolves true once it went out. */
  async function shareInvite() {
    const code = await referralCode();
    const links = global.AppLinks;
    const url = links ? links.inviteUrl(code) : 'https://pocketcoachcoms.org/';
    const text = 'I’m logging my training with Pocket Coach. Join me and we can keep each other going:';
    let sent = false;
    if (global.navigator && typeof global.navigator.share === 'function') {
      try {
        await global.navigator.share({ title: 'Train with me on Pocket Coach', text, url });
        sent = true;
      } catch (err) {
        if (err && err.name === 'AbortError') return false;
      }
    }
    if (!sent) {
      await copyText(`${text} ${url}`);
      toast('Invite link copied. Send it to a friend.', 'success');
      sent = true;
    }
    try { localStorage.setItem(SHARED_KEY(user()), new Date().toISOString()); } catch { /* ignore */ }
    document.dispatchEvent(new CustomEvent('tl:habit-changed'));
    return sent;
  }

  /** Link to a coach from a typed code. Resolves { ok, message }. */
  async function useCoachCode(raw) {
    const CC = global.CoachCode;
    if (!CC) return { ok: false, message: 'Coach codes aren’t available right now.' };
    const code = CC.cleanCode(raw);
    if (!code) return { ok: false, message: 'A coach code has 8 letters and numbers, like ABCD-EFGH.' };
    try {
      const data = await CC.redeemCode(code);
      document.dispatchEvent(new CustomEvent('tl:habit-changed'));
      return { ok: true, message: `You’re linked to @${data.coachUsername}. Pro is on.` };
    } catch (err) {
      return { ok: false, message: CC.redeemErrorText(err) };
    }
  }

  /** The two options as HTML (onboarding renders it inline). */
  function optionsHtml() {
    return `
      <div class="tt-option">
        <div class="tt-option-text">
          <span class="tt-option-title">Have a coach?</span>
          <span class="tt-option-sub">Enter their code to link up. Pro is included by them.</span>
        </div>
        <div class="tt-code-row">
          <input type="text" class="tt-code-input" data-tt-code maxlength="9" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH" aria-label="Coach code">
          <button type="button" class="tt-code-btn" data-tt-redeem>Link</button>
        </div>
        <p class="tt-msg" data-tt-msg role="status" hidden></p>
      </div>
      <div class="tt-option">
        <div class="tt-option-text">
          <span class="tt-option-title">Bring a friend</span>
          <span class="tt-option-sub">Send your invite link. Training with someone is the easiest way to keep showing up.</span>
        </div>
        <button type="button" class="tt-share-btn" data-tt-share>Send invite link</button>
      </div>`;
  }

  /** Wire the options inside `host`. */
  function bindOptions(host) {
    const input = host.querySelector('[data-tt-code]');
    const msg = host.querySelector('[data-tt-msg]');
    const btn = host.querySelector('[data-tt-redeem]');
    const say = (text, ok) => {
      msg.textContent = text;
      msg.hidden = !text;
      msg.classList.toggle('is-ok', !!ok);
    };
    if (coachLinked()) say('You’re linked to your coach.', true);
    input.addEventListener('input', () => {
      const shown = global.CoachCode ? global.CoachCode.displayCode(input.value) : input.value;
      if (shown !== input.value) input.value = shown;
    });
    const go = async () => {
      btn.disabled = true;
      const r = await useCoachCode(input.value);
      btn.disabled = false;
      say(r.message, r.ok);
      if (r.ok) input.value = '';
    };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    host.querySelector('[data-tt-share]').addEventListener('click', async e => {
      const b = e.currentTarget;
      b.disabled = true;
      const sent = await shareInvite();
      b.disabled = false;
      if (sent) b.textContent = 'Invite sent. Send another';
    });
  }

  function close() {
    document.querySelectorAll('.tt-backdrop').forEach(n => n.remove());
  }

  function open() {
    close();
    const overlay = document.createElement('div');
    overlay.className = 'mx-sheet-backdrop tt-backdrop';
    overlay.innerHTML = `
      <div class="mx-sheet tt-sheet" role="dialog" aria-modal="true" aria-labelledby="ttTitle">
        <div class="mx-sheet-head">
          <h3 class="pod-title mx-h3" id="ttTitle">Train with someone</h3>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-tt-close aria-label="Close">${CLOSE}</button>
        </div>
        <div class="tt-body">${optionsHtml()}</div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-tt-close]')) close(); });
    document.body.appendChild(overlay);
    bindOptions(overlay);
  }

  global.openTrainTogether = open;
  global.TrainTogether = { open, close, optionsHtml, bindOptions, shareInvite, useCoachCode, hasPartner };
})(typeof window !== 'undefined' ? window : globalThis);
