/* =============================================================
   ONBOARDING "MAKE IT YOURS" — first screen of the onboarding
   wizard (#obStep0 in index.html). New users pick:
     - their display name (Profiles: what others see in groups,
       the leaderboard and friends; they still log in as @username)
     - their logbook's name and colour (LogbookCover; the colour
       recolours the whole app as soon as a swatch is tapped)

   Saved when they press Continue, so the choices stick even if they
   leave onboarding early. A display name that can't reach the server
   (offline) is kept and retried on the next launch.
   Styles: css/onboarding-cover.css (.obc-*).
   ============================================================= */
(function (global) {
  'use strict';

  const PENDING_KEY = u => `pendingDisplayName_${u}`;

  function userId() {
    try { if (typeof currentUser !== 'undefined' && currentUser) return currentUser; } catch (_) { /* not defined yet */ }
    return localStorage.getItem('fitnessAppUser') || localStorage.getItem('username') || null;
  }

  const $ = id => document.getElementById(id);

  const state = { color: null, nameTouched: false, filledFor: null };

  function palette() { return (global.LogbookCover && global.LogbookCover.PALETTE) || []; }
  function clean(raw) {
    return global.LogbookCover ? global.LogbookCover.cleanName(raw) : String(raw || '').trim().slice(0, 40);
  }

  function possessive(name) {
    return /s$/i.test(name) ? `${name}’ Logbook` : `${name}’s Logbook`;
  }

  function suggestedLogbookName() {
    const dn = clean($('obcDisplayName')?.value) || userId() || '';
    return dn ? possessive(dn.split(' ')[0]) : 'My Logbook';
  }

  function paint() {
    const preview = $('obcPreview');
    if (!preview) return;
    const c = palette().find(p => p.id === state.color) || palette()[0];
    if (c) preview.style.background = c.bg;
    const dn = clean($('obcDisplayName')?.value) || userId() || '';
    const book = clean($('obcLogbookName')?.value) || suggestedLogbookName();
    $('obcPreviewName').textContent = book;
    $('obcPreviewBy').textContent = dn ? `by ${dn}` : '';
    document.querySelectorAll('#obcSwatches .obc-swatch').forEach(b => {
      const on = b.dataset.color === state.color;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
  }

  function pickColor(id) {
    state.color = id;
    // Preview the colour across the whole app right away.
    if (typeof global.applyAppAccent === 'function') global.applyAppAccent(id);
    paint();
  }

  function buildSwatches() {
    const host = $('obcSwatches');
    if (!host || host.childElementCount) return;
    palette().forEach(p => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'obc-swatch';
      b.dataset.color = p.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', p.label);
      b.title = p.label;
      b.style.setProperty('--obc-swatch', p.swatch);
      b.addEventListener('click', () => pickColor(p.id));
      host.appendChild(b);
    });
    // Arrow keys move through the radio group.
    host.addEventListener('keydown', e => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const ids = palette().map(p => p.id);
      const i = ids.indexOf(state.color);
      const next = ids[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length];
      pickColor(next);
      host.querySelector(`[data-color="${next}"]`)?.focus();
    });
  }

  // Fill the screen from what's saved (once per user, so going Back to
  // this screen keeps what they typed).
  function fill() {
    const u = userId();
    if (!$('obStep0') || state.filledFor === (u || '')) return;
    state.filledFor = u || '';
    buildSwatches();
    const cover = global.LogbookCover ? global.LogbookCover.getCover(u) : { color: 'forest', name: '' };
    const cached = u && global.Profiles?.get ? global.Profiles.get(u) : null;
    const dn = $('obcDisplayName');
    const book = $('obcLogbookName');
    dn.value = (cached && cached.displayName) || '';
    dn.placeholder = u || 'Your name';
    book.value = cover.name || '';
    book.placeholder = suggestedLogbookName();
    state.nameTouched = !!cover.name;
    state.color = cover.color;
    $('obcHandleHint').textContent = u
      ? `Shown in groups, on the leaderboard and to friends. You still log in as @${u}.`
      : 'Shown in groups, on the leaderboard and to friends.';
    paint();
  }

  function bind() {
    const dn = $('obcDisplayName');
    const book = $('obcLogbookName');
    if (!dn || dn.dataset.obcBound) return;
    dn.dataset.obcBound = '1';
    dn.addEventListener('input', () => {
      if (!state.nameTouched) book.placeholder = suggestedLogbookName();
      paint();
    });
    book.addEventListener('input', () => { state.nameTouched = !!book.value.trim(); paint(); });
    dn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); book.focus(); } });
    book.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); book.blur(); } });
  }

  async function pushDisplayName(u, name) {
    if (!global.Profiles?.setDisplayName) throw new Error('Profiles unavailable');
    await global.Profiles.setDisplayName(name);
    try { localStorage.removeItem(PENDING_KEY(u)); } catch (_) { /* blocked */ }
  }

  function saveOnboardingCover() {
    const u = userId();
    if (!u) return;
    const name = clean($('obcLogbookName')?.value) || suggestedLogbookName();
    if (global.LogbookCover) global.LogbookCover.setCover({ color: state.color, name }, u);

    const display = clean($('obcDisplayName')?.value);
    if (!display || display === u) return;
    try { localStorage.setItem(PENDING_KEY(u), display); } catch (_) { /* blocked */ }
    pushDisplayName(u, display).catch(err => console.warn('[Onboarding] display name not saved yet, will retry:', err && err.message));
  }

  // Retry a display name that couldn't be saved (e.g. offline at signup).
  function retryPending() {
    const u = userId();
    if (!u) return;
    let pending = null;
    try { pending = localStorage.getItem(PENDING_KEY(u)); } catch (_) { /* blocked */ }
    if (pending) pushDisplayName(u, pending).catch(() => { /* try again next launch */ });
  }

  function init() {
    bind();
    const overlay = $('onboardingOverlay');
    if (overlay) {
      // showOnboarding() reveals the overlay by removing [hidden].
      new MutationObserver(() => { if (!overlay.hasAttribute('hidden')) fill(); })
        .observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
      if (!overlay.hasAttribute('hidden')) fill();
    }
    // After sign-in has settled; harmless when nothing is pending.
    setTimeout(retryPending, 4000);
    document.addEventListener('traininglog:settings-ready', retryPending);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.saveOnboardingCover = saveOnboardingCover;
})(typeof window !== 'undefined' ? window : globalThis);
