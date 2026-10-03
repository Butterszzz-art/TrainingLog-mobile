/**
 * logbook-cover.js
 * Lets the user personalise their logbook like a paper journal: an app
 * colour and their own name for the book ("Arman's Lifting Log").
 *
 * Stored per account in localStorage as `logbookCover_${user}`:
 *   { color: 'forest', name: 'My Lifting Log' }
 * The colour is saved as a palette id, not a hex value, so the shades can
 * be tuned later without touching anyone's saved data. cloud-sync.js
 * syncs the key as a 'value' store, so the colour follows the account to
 * every device.
 *
 * The colour is app-wide: applyAppAccent() sets data-accent on <html>,
 * and css/tokens.css swaps the whole green ramp for that hue. The cover
 * banner uses the ramp's --green-50 shade. Success, warning and error
 * colours stay fixed, which is why there is no red, rose or gold option.
 *
 * This file is loaded in <head> so the colour is on <html> before the
 * first paint.
 */
(function (global) {
  'use strict';

  const NAME_MAX = 40;
  const DEFAULT_COLOR = 'forest';

  // Every cover has white text on it, so each `bg` must keep >= 4.5:1
  // contrast against #fff (checked in tests/logbookCover.test.js).
  // Every cover has white text on it, so each `bg` must keep >= 4.5:1
  // contrast against #fff (checked in tests/logbookCover.test.js).
  // `bg` mirrors --green-50 of the matching data-accent block in
  // css/tokens.css; `swatch` is its --green-70, for the picker.
  const PALETTE = [
    { id: 'forest', label: 'Forest', bg: '#236b4e', swatch: '#3d9d73' },
    { id: 'teal',   label: 'Teal',   bg: '#00696e', swatch: '#0e9ba1' },
    { id: 'ocean',  label: 'Ocean',  bg: '#2a618b', swatch: '#438fca' },
    { id: 'indigo', label: 'Indigo', bg: '#4c5693', swatch: '#7280d5' },
    { id: 'plum',   label: 'Plum',   bg: '#754978', swatch: '#ac6faf' },
    { id: 'copper', label: 'Copper', bg: '#824d2d', swatch: '#be7347' },
  ];

  // Cover colours from before the colour went app-wide, mapped to the
  // nearest current option so nobody's saved choice is lost.
  const LEGACY = {
    navy: 'ocean', oxblood: 'plum', leather: 'copper', slate: 'ocean',
    charcoal: 'forest', crimson: 'plum', ochre: 'copper', olive: 'forest', rose: 'plum',
  };

  function _user() {
    return global.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser')) || null;
  }

  function _key(user) {
    return user ? 'logbookCover_' + user : null;
  }

  function colorById(id) {
    if (LEGACY[id]) id = LEGACY[id];
    return PALETTE.find(c => c.id === id) || PALETTE.find(c => c.id === DEFAULT_COLOR);
  }

  // Puts the colour on <html> (Forest is the stylesheet default, so it
  // clears the attribute). With no signed-in user it falls back to Forest.
  function applyAppAccent(id) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (id === undefined) id = _user() ? getCover().color : DEFAULT_COLOR;
    const color = colorById(id).id;
    const root = document.documentElement;
    if (color === DEFAULT_COLOR) root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', color);
  }

  // Reads a ramp token for canvas drawing (charts, share images), which
  // can't use CSS variables. Takes a --green-* token or an --acc-* channel
  // list and returns #rrggbb, or rgba() when `alpha` is given. Outside a
  // browser it falls back to the Forest value (an --acc-* name is its
  // own Forest hex).
  function accentColor(token, alpha) {
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(token).trim(); } catch { v = ''; }
    let rgb = null;
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) {
      const n = parseInt(hex[1], 16);
      rgb = [n >> 16, (n >> 8) & 255, n & 255];
    } else if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(v)) {
      rgb = v.split(',').map(Number);
    } else {
      const fallback = FOREST_TOKENS[token] || (/^--acc-([0-9a-f]{6})$/.exec(token) || [])[1] || '2f8a63';
      const n = parseInt(fallback.replace('#', ''), 16);
      rgb = [n >> 16, (n >> 8) & 255, n & 255];
    }
    if (alpha != null) return 'rgba(' + rgb.join(', ') + ', ' + alpha + ')';
    return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
  }
  const FOREST_TOKENS = {
    '--green-100': '#8ec2a4', '--green-90': '#6fae8b', '--green-70': '#3d9d73', '--green-60': '#2f8a63',
    '--green-50': '#236b4e', '--green-30': '#17472f', '--green-20': '#143c2b',
  };

  // Trims, collapses whitespace, drops control characters and caps length.
  function cleanName(raw) {
    return String(raw == null ? '' : raw)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NAME_MAX);
  }

  function defaultName(user) {
    return user ? user + '’s Logbook' : 'My Logbook';
  }

  function getCover(user = _user()) {
    let saved = null;
    const key = _key(user);
    if (key) {
      try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { saved = null; }
    }
    const color = colorById(saved && saved.color).id;
    const name = cleanName(saved && saved.name);
    return { color, name, displayName: name || defaultName(user) };
  }

  function setCover({ color, name } = {}, user = _user()) {
    const key = _key(user);
    if (!key) return null;
    const current = getCover(user);
    const next = {
      color: color !== undefined ? colorById(color).id : current.color,
      name: name !== undefined ? cleanName(name) : current.name,
    };
    localStorage.setItem(key, JSON.stringify(next));
    applyAppAccent(next.color);
    renderLogbookCover();
    if (typeof global.renderSettingsHero === 'function') global.renderSettingsHero();
    return getCover(user);
  }

  /* ── Cover banner on the Log tab ─────────────────────────── */

  function _el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderLogbookCover() {
    if (typeof document === 'undefined') return;
    try { applyAppAccent(); } catch { /* storage unavailable: keep Forest */ }
    const host = document.getElementById('logbookCover');
    if (!host) return;
    const user = _user();
    if (!user) { host.hidden = true; host.textContent = ''; return; }

    const cover = getCover(user);
    const color = colorById(cover.color);
    host.hidden = false;
    host.textContent = '';

    const btn = _el('button', 'lb-cover');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Customise logbook and app colour: ' + cover.displayName);
    btn.appendChild(_el('span', 'lb-cover-spine'));
    const text = _el('span', 'lb-cover-text');
    text.appendChild(_el('span', 'lb-cover-kicker', 'Logbook'));
    text.appendChild(_el('span', 'lb-cover-title', cover.displayName));
    btn.appendChild(text);
    btn.appendChild(_el('span', 'lb-cover-edit', 'Edit'));
    btn.addEventListener('click', () => openLogbookCoverEditor());
    host.appendChild(btn);
  }

  /* ── Editor sheet ────────────────────────────────────────── */

  // Closing without saving puts the saved colour back, since the sheet
  // previews the chosen colour on the whole app while it is open.
  function closeEditor() {
    const existing = document.getElementById('lbCoverSheet');
    if (existing) existing.remove();
    applyAppAccent();
  }

  function openLogbookCoverEditor() {
    const user = _user();
    if (!user || typeof document === 'undefined') return;
    closeEditor();

    const cover = getCover(user);
    let chosen = cover.color;

    const backdrop = _el('div', 'mx-sheet-backdrop');
    backdrop.id = 'lbCoverSheet';
    const sheet = _el('div', 'mx-sheet lb-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Customise your logbook');
    backdrop.appendChild(sheet);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeEditor(); });

    const head = _el('div', 'mx-sheet-head');
    head.appendChild(_el('h3', 'pod-title mx-h3', 'Your logbook'));
    const close = _el('button', 'mx-iconbtn mx-iconbtn--ghost', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeEditor);
    head.appendChild(close);
    sheet.appendChild(head);

    // Live preview of the cover
    const preview = _el('div', 'lb-cover lb-cover--preview');
    preview.appendChild(_el('span', 'lb-cover-spine'));
    const pText = _el('span', 'lb-cover-text');
    pText.appendChild(_el('span', 'lb-cover-kicker', 'Logbook'));
    const pTitle = _el('span', 'lb-cover-title');
    pText.appendChild(pTitle);
    preview.appendChild(pText);
    sheet.appendChild(preview);

    const nameField = _el('div', 'mx-field');
    const nameLbl = _el('label', 'mx-lbl', 'Logbook name');
    nameLbl.htmlFor = 'lbCoverName';
    const nameWell = _el('div', 'mx-well mx-well--text');
    const nameInput = _el('input');
    nameInput.id = 'lbCoverName';
    nameInput.maxLength = NAME_MAX;
    nameInput.placeholder = defaultName(user);
    nameInput.value = cover.name;
    nameInput.autocomplete = 'off';
    nameWell.appendChild(nameInput);
    nameField.append(nameLbl, nameWell);
    sheet.appendChild(nameField);

    const colorField = _el('div', 'mx-field');
    colorField.appendChild(_el('span', 'mx-lbl', 'App colour'));
    const swatches = _el('div', 'lb-swatches');
    swatches.setAttribute('role', 'radiogroup');
    swatches.setAttribute('aria-label', 'App colour');
    PALETTE.forEach(c => {
      const sw = _el('button', 'lb-swatch');
      sw.type = 'button';
      sw.dataset.color = c.id;
      sw.style.background = 'linear-gradient(135deg, ' + c.swatch + ', ' + c.bg + ')';
      sw.setAttribute('role', 'radio');
      sw.setAttribute('aria-label', c.label);
      sw.title = c.label;
      sw.addEventListener('click', () => { chosen = c.id; repaint(); });
      swatches.appendChild(sw);
    });
    colorField.appendChild(swatches);
    colorField.appendChild(_el('p', 'lb-hint', 'Changes buttons, charts and highlights across the app. Gains and PRs always stay green.'));
    sheet.appendChild(colorField);

    const save = _el('button', 'mx-cta', 'Save');
    save.type = 'button';
    save.addEventListener('click', () => {
      setCover({ color: chosen, name: nameInput.value }, user);
      closeEditor();
      if (typeof global.showToast === 'function') global.showToast('Logbook updated');
    });
    sheet.appendChild(save);

    function repaint() {
      applyAppAccent(chosen);
      pTitle.textContent = cleanName(nameInput.value) || defaultName(user);
      swatches.querySelectorAll('.lb-swatch').forEach(sw => {
        const on = sw.dataset.color === chosen;
        sw.classList.toggle('is-selected', on);
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    nameInput.addEventListener('input', repaint);
    repaint();

    document.body.appendChild(backdrop);
    try { nameInput.focus({ preventScroll: true }); } catch { /* older webviews */ }
  }

  global.LogbookCover = { PALETTE, NAME_MAX, getCover, setCover, cleanName, colorById, applyAppAccent, accentColor, openEditor: openLogbookCoverEditor };
  global.applyAppAccent = applyAppAccent;
  global.accentColor = accentColor;
  global.renderLogbookCover = renderLogbookCover;
  global.openLogbookCoverEditor = openLogbookCoverEditor;

  if (typeof document !== 'undefined') {
    try { applyAppAccent(); } catch { /* storage unavailable: keep Forest */ }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderLogbookCover);
    else renderLogbookCover();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.LogbookCover;
  }
})(typeof window !== 'undefined' ? window : globalThis);
