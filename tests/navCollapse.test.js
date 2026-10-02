const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/nav-collapse.js'), 'utf8');

function setup({ stored = null } = {}) {
  const dom = new JSDOM(
    '<!doctype html><body><nav id="bottomNav"><button class="bn-item" data-tab="homeTab"></button><button class="bn-fab"></button></nav></body>',
    { runScripts: 'outside-only', url: 'https://app.test/' }
  );
  const w = dom.window;
  if (stored) w.localStorage.setItem('bottomNavCollapsed', stored);
  w.eval(SRC);
  w.NavCollapse.init(); // the page runs this on DOMContentLoaded
  return { w, doc: w.document, nav: w.document.getElementById('bottomNav') };
}

function swipe(w, el, fromY, toY) {
  const touch = (y) => ({ clientX: 100, clientY: y });
  const start = new w.Event('touchstart');
  start.touches = [touch(fromY)];
  el.dispatchEvent(start);
  const end = new w.Event('touchend');
  end.changedTouches = [touch(toY)];
  el.dispatchEvent(end);
}

describe('bottom nav collapse', () => {
  test('adds one handle and starts expanded', () => {
    const { w, doc, nav } = setup();
    expect(nav.querySelectorAll('.bn-collapse-handle')).toHaveLength(1);
    w.NavCollapse.init(); // idempotent
    expect(nav.querySelectorAll('.bn-collapse-handle')).toHaveLength(1);
    expect(doc.body.classList.contains('nav-collapsed')).toBe(false);
    expect(nav.querySelector('.bn-collapse-handle').getAttribute('aria-expanded')).toBe('true');
  });

  test('tapping the handle slides it down and back up, and persists', () => {
    const { w, doc, nav } = setup();
    const handle = nav.querySelector('.bn-collapse-handle');
    handle.click();
    expect(doc.body.classList.contains('nav-collapsed')).toBe(true);
    expect(handle.getAttribute('aria-label')).toBe('Show navigation');
    expect(nav.querySelector('.bn-item').getAttribute('tabindex')).toBe('-1');
    expect(w.localStorage.getItem('bottomNavCollapsed')).toBe('1');

    handle.click();
    expect(doc.body.classList.contains('nav-collapsed')).toBe(false);
    expect(nav.querySelector('.bn-item').hasAttribute('tabindex')).toBe(false);
    expect(w.localStorage.getItem('bottomNavCollapsed')).toBeNull();
  });

  test('restores the collapsed state on load', () => {
    const { doc } = setup({ stored: '1' });
    expect(doc.body.classList.contains('nav-collapsed')).toBe(true);
  });

  test('swipe down collapses, swipe up expands, small drags are ignored', () => {
    const { w, doc, nav } = setup();
    swipe(w, nav, 500, 510);
    expect(doc.body.classList.contains('nav-collapsed')).toBe(false);
    swipe(w, nav, 500, 560);
    expect(doc.body.classList.contains('nav-collapsed')).toBe(true);
    swipe(w, nav, 560, 500);
    expect(doc.body.classList.contains('nav-collapsed')).toBe(false);
  });
});
