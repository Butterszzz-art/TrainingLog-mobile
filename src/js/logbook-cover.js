/**
 * logbook-cover.js
 * Lets the user personalise their logbook like a paper journal: a cover
 * colour (from a fixed palette, so text always stays readable) and their
 * own name for the book ("Arman's Lifting Log").
 *
 * Stored per account in localStorage as `logbookCover_${user}`:
 *   { color: 'forest', name: 'My Lifting Log' }
 * The colour is saved as a palette id, not a hex value, so the shades can
 * be tuned later without touching anyone's saved data. cloud-sync.js
 * syncs the key as a 'value' store, so the cover follows the account to
 * every device.
 *
 * Only the cover banner at the top of the Log tab and its accent take the
 * colour; sets, charts and the rest of the app keep the normal theme.
 */
(function (global) {
  'use strict';

  const NAME_MAX = 40;
  const DEFAULT_COLOR = 'forest';

  // Every cover has white text on it, so each `bg` must keep >= 4.5:1
  // contrast against #fff (checked in tests/logbookCover.test.js).
  const PALETTE = [
    { id: 'forest',   label: 'Forest',   bg: '#236b4e' },
    { id: 'navy',     label: 'Navy',     bg: '#1f3a68' },
    { id: 'oxblood',  label: 'Oxblood',  bg: '#7a1f2b' },
    { id: 'leather',  label: 'Leather',  bg: '#7a4a24' },
    { id: 'plum',     label: 'Plum',     bg: '#5b2a6e' },
    { id: 'teal',     label: 'Teal',     bg: '#11616b' },
    { id: 'slate',    label: 'Slate',    bg: '#3b4652' },
    { id: 'charcoal', label: 'Charcoal', bg: '#24272a' },
    { id: 'crimson',  label: 'Crimson',  bg: '#a3202f' },
    { id: 'ochre',    label: 'Ochre',    bg: '#8a5a12' },
    { id: 'olive',    label: 'Olive',    bg: '#4f5a1e' },
    { id: 'rose',     label: 'Rose',     bg: '#9c3b62' },
  ];

  function _user() {
    return global.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser')) || null;
  }

  function _key(user) {
    return user ? 'logbookCover_' + user : null;
  }

  function colorById(id) {
    return PALETTE.find(c => c.id === id) || PALETTE.find(c => c.id === DEFAULT_COLOR);
  }

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
    const host = document.getElementById('logbookCover');
    if (!host) return;
    const user = _user();
    if (!user) { host.hidden = true; host.textContent = ''; return; }

    const cover = getCover(user);
    const color = colorById(cover.color);
    host.hidden = false;
    host.textContent = '';
    host.style.setProperty('--logbook-cover', color.bg);

    const btn = _el('button', 'lb-cover');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Customise logbook cover: ' + cover.displayName);
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

  function closeEditor() {
    const existing = document.getElementById('lbCoverSheet');
    if (existing) existing.remove();
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
    colorField.appendChild(_el('span', 'mx-lbl', 'Cover colour'));
    const swatches = _el('div', 'lb-swatches');
    swatches.setAttribute('role', 'radiogroup');
    swatches.setAttribute('aria-label', 'Cover colour');
    PALETTE.forEach(c => {
      const sw = _el('button', 'lb-swatch');
      sw.type = 'button';
      sw.dataset.color = c.id;
      sw.style.background = c.bg;
      sw.setAttribute('role', 'radio');
      sw.setAttribute('aria-label', c.label);
      sw.title = c.label;
      sw.addEventListener('click', () => { chosen = c.id; repaint(); });
      swatches.appendChild(sw);
    });
    colorField.appendChild(swatches);
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
      preview.style.setProperty('--logbook-cover', colorById(chosen).bg);
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

  global.LogbookCover = { PALETTE, NAME_MAX, getCover, setCover, cleanName, colorById, openEditor: openLogbookCoverEditor };
  global.renderLogbookCover = renderLogbookCover;
  global.openLogbookCoverEditor = openLogbookCoverEditor;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderLogbookCover);
    else renderLogbookCover();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.LogbookCover;
  }
})(typeof window !== 'undefined' ? window : globalThis);
