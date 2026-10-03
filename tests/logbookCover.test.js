const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/logbook-cover.js'), 'utf8');

function setup({ user = 'arman', stored = null } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="logbookCover" hidden></div></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  if (user) w.localStorage.setItem('fitnessAppUser', user);
  if (stored) w.localStorage.setItem('logbookCover_' + user, JSON.stringify(stored));
  w.eval(SRC);
  w.renderLogbookCover(); // the page renders on DOMContentLoaded
  return { w, doc: w.document };
}

// WCAG relative luminance contrast against white.
function contrastWithWhite(hex) {
  const ch = i => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
  return 1.05 / (L + 0.05);
}

describe('logbook cover', () => {
  test('defaults to the forest cover and the username in the name', () => {
    const { w, doc } = setup();
    expect(w.LogbookCover.getCover()).toEqual({ color: 'forest', name: '', displayName: 'arman’s Logbook' });
    const host = doc.getElementById('logbookCover');
    expect(host.hidden).toBe(false);
    expect(host.querySelector('.lb-cover-title').textContent).toBe('arman’s Logbook');
  });

  test('saves a custom name and colour per account and re-renders', () => {
    const { w, doc } = setup();
    w.LogbookCover.setCover({ color: 'ocean', name: '  Arman’s   Lifting Log ' });
    expect(JSON.parse(w.localStorage.getItem('logbookCover_arman'))).toEqual({ color: 'ocean', name: 'Arman’s Lifting Log' });
    expect(doc.querySelector('.lb-cover-title').textContent).toBe('Arman’s Lifting Log');
  });

  test('the colour applies to the whole app via data-accent on <html>', () => {
    const { w, doc } = setup();
    expect(doc.documentElement.hasAttribute('data-accent')).toBe(false);
    w.LogbookCover.setCover({ color: 'plum' });
    expect(doc.documentElement.getAttribute('data-accent')).toBe('plum');
    w.LogbookCover.setCover({ color: 'forest' });
    expect(doc.documentElement.hasAttribute('data-accent')).toBe(false);
  });

  test('a saved colour is applied as soon as the script loads', () => {
    const { doc } = setup({ stored: { color: 'teal', name: '' } });
    expect(doc.documentElement.getAttribute('data-accent')).toBe('teal');
  });

  test('cover colours from before the app-wide change map to the nearest option', () => {
    const { w, doc } = setup({ stored: { color: 'navy', name: '' } });
    expect(w.LogbookCover.getCover().color).toBe('ocean');
    expect(doc.documentElement.getAttribute('data-accent')).toBe('ocean');
    ['oxblood', 'leather', 'slate', 'charcoal', 'crimson', 'ochre', 'olive', 'rose'].forEach(old => {
      expect(w.LogbookCover.PALETTE.map(c => c.id)).toContain(w.LogbookCover.colorById(old).id);
    });
  });

  test('signed out uses the default colour', () => {
    const { doc } = setup({ user: null });
    expect(doc.documentElement.hasAttribute('data-accent')).toBe(false);
  });

  test('unknown colours fall back to the default and names are capped', () => {
    const { w } = setup({ stored: { color: '#ff00ff', name: 'x'.repeat(100) } });
    const c = w.LogbookCover.getCover();
    expect(c.color).toBe('forest');
    expect(c.name).toHaveLength(w.LogbookCover.NAME_MAX);
  });

  test('a partial update keeps the other field', () => {
    const { w } = setup({ stored: { color: 'plum', name: 'Journal' } });
    w.LogbookCover.setCover({ name: 'New name' });
    expect(w.LogbookCover.getCover()).toMatchObject({ color: 'plum', name: 'New name' });
  });

  test('editor saves the chosen swatch and name', () => {
    const { w, doc } = setup();
    w.openLogbookCoverEditor();
    const sheet = doc.getElementById('lbCoverSheet');
    expect(sheet).not.toBeNull();
    doc.querySelector('.lb-swatch[data-color="indigo"]').click();
    expect(doc.querySelector('.lb-swatch[data-color="indigo"]').getAttribute('aria-checked')).toBe('true');
    // previews on the whole app while the sheet is open
    expect(doc.documentElement.getAttribute('data-accent')).toBe('indigo');
    const input = doc.getElementById('lbCoverName');
    input.value = 'Strength Journal';
    input.dispatchEvent(new w.Event('input'));
    expect(sheet.querySelector('.lb-cover-title').textContent).toBe('Strength Journal');
    sheet.querySelector('.mx-cta').click();
    expect(doc.getElementById('lbCoverSheet')).toBeNull();
    expect(w.LogbookCover.getCover()).toMatchObject({ color: 'indigo', name: 'Strength Journal' });
    expect(doc.documentElement.getAttribute('data-accent')).toBe('indigo');
  });

  test('closing the editor without saving puts the saved colour back', () => {
    const { w, doc } = setup({ stored: { color: 'teal', name: '' } });
    w.openLogbookCoverEditor();
    doc.querySelector('.lb-swatch[data-color="copper"]').click();
    expect(doc.documentElement.getAttribute('data-accent')).toBe('copper');
    doc.querySelector('#lbCoverSheet .mx-iconbtn').click();
    expect(doc.documentElement.getAttribute('data-accent')).toBe('teal');
    expect(w.LogbookCover.getCover().color).toBe('teal');
  });

  test('names render as text, not HTML', () => {
    const { w, doc } = setup();
    w.LogbookCover.setCover({ name: '<img src=x onerror=alert(1)>' });
    expect(doc.querySelector('.lb-cover-title img')).toBeNull();
  });

  test('hidden when signed out', () => {
    const { doc } = setup({ user: null });
    expect(doc.getElementById('logbookCover').hidden).toBe(true);
  });

  test('every palette colour keeps white text readable (>= 4.5:1)', () => {
    const { w } = setup();
    w.LogbookCover.PALETTE.forEach(c => {
      expect([c.id, contrastWithWhite(c.bg) >= 4.5]).toEqual([c.id, true]);
    });
  });

  // The palette's cover colours must match the ramps in css/tokens.css.
  test('every palette colour has a matching ramp in tokens.css', () => {
    const css = fs.readFileSync(path.join(__dirname, '../css/tokens.css'), 'utf8');
    const { w } = setup();
    w.LogbookCover.PALETTE.forEach(c => {
      const block = c.id === 'forest'
        ? css.slice(0, css.indexOf('[data-accent='))
        : (css.split(`:root[data-accent="${c.id}"] {`)[1] || '').split('}')[0];
      const m = /--green-50:\s*(#[0-9a-f]{6})/i.exec(block);
      expect([c.id, m && m[1].toLowerCase()]).toEqual([c.id, c.bg]);
    });
  });

  test('positive colours stay fixed so gains never take the accent', () => {
    const css = fs.readFileSync(path.join(__dirname, '../css/tokens.css'), 'utf8');
    const accents = css.slice(css.indexOf(':root[data-accent='));
    expect(accents).not.toMatch(/--positive-/);
    expect(css).toMatch(/--positive-text:\s*#6fae8b/);
  });

  test('accentColor returns hex or rgba, falling back to Forest without styles', () => {
    const { w } = setup();
    expect(w.accentColor('--green-60')).toBe('#2f8a63');
    expect(w.accentColor('--acc-52d68a')).toBe('#52d68a');
    expect(w.accentColor('--acc-3d9d73', 0.2)).toBe('rgba(61, 157, 115, 0.2)');
    w.document.documentElement.style.setProperty('--acc-3d9d73', '14, 155, 161');
    expect(w.accentColor('--acc-3d9d73')).toBe('#0e9ba1');
  });
});
