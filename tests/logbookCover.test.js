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
    w.LogbookCover.setCover({ color: 'navy', name: '  Arman’s   Lifting Log ' });
    expect(JSON.parse(w.localStorage.getItem('logbookCover_arman'))).toEqual({ color: 'navy', name: 'Arman’s Lifting Log' });
    expect(doc.querySelector('.lb-cover-title').textContent).toBe('Arman’s Lifting Log');
    expect(doc.getElementById('logbookCover').style.getPropertyValue('--logbook-cover')).toBe('#1f3a68');
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
    doc.querySelector('.lb-swatch[data-color="oxblood"]').click();
    expect(doc.querySelector('.lb-swatch[data-color="oxblood"]').getAttribute('aria-checked')).toBe('true');
    const input = doc.getElementById('lbCoverName');
    input.value = 'Strength Journal';
    input.dispatchEvent(new w.Event('input'));
    expect(sheet.querySelector('.lb-cover-title').textContent).toBe('Strength Journal');
    sheet.querySelector('.mx-cta').click();
    expect(doc.getElementById('lbCoverSheet')).toBeNull();
    expect(w.LogbookCover.getCover()).toMatchObject({ color: 'oxblood', name: 'Strength Journal' });
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
});
