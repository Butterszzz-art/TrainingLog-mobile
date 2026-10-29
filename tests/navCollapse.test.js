const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/nav-collapse.js'), 'utf8');

function setup({ stored = null } = {}) {
  const dom = new JSDOM(
    '<!doctype html><body><nav id="bottomNav">' +
      '<button class="bn-item" data-tab="homeTab"><span class="bn-icon"><svg id="homeIcon"></svg></span></button>' +
      '<button class="bn-item active" data-tab="logTab"><span class="bn-icon"><svg id="logIcon"></svg></span></button>' +
      '<button class="bn-fab"></button>' +
    '</nav></body>',
    { runScripts: 'outside-only', url: 'https://app.test/' }
  );
  const w = dom.window;
  if (stored) w.localStorage.setItem('bottomNavCollapsed', stored);
  w.requestAnimationFrame = (cb) => cb(); // run scroll handling synchronously
  w.eval(SRC);
  w.NavCollapse.init(); // the page runs this on DOMContentLoaded
  return { w, doc: w.document, nav: w.document.getElementById('bottomNav') };
}

function scrollTo(w, y) {
  Object.defineProperty(w, 'scrollY', { value: y, configurable: true });
  w.dispatchEvent(new w.Event('scroll'));
}

const collapsed = (doc) => doc.body.classList.contains('nav-collapsed');

describe('bottom nav corner bubble', () => {
  test('adds one bubble and starts expanded', () => {
    const { w, doc, nav } = setup();
    expect(nav.querySelectorAll('.bn-bubble')).toHaveLength(1);
    w.NavCollapse.init(); // idempotent
    expect(nav.querySelectorAll('.bn-bubble')).toHaveLength(1);
    expect(collapsed(doc)).toBe(false);
    expect(nav.querySelector('.bn-bubble').getAttribute('tabindex')).toBe('-1');
  });

  test('ignores the old saved hidden state and clears it', () => {
    const { w, doc } = setup({ stored: '1' });
    expect(collapsed(doc)).toBe(false);
    expect(w.localStorage.getItem('bottomNavCollapsed')).toBeNull();
  });

  test('scrolling down tucks the nav and shows the active tab icon', () => {
    const { w, doc, nav } = setup();
    scrollTo(w, 100);
    expect(collapsed(doc)).toBe(true);
    expect(nav.querySelector('.bn-bubble-icon #logIcon')).not.toBeNull();
    expect(nav.querySelector('.bn-item').getAttribute('tabindex')).toBe('-1');
    expect(nav.querySelector('.bn-bubble').hasAttribute('tabindex')).toBe(false);
  });

  test('scrolling down while still near the top does not tuck', () => {
    const { w, doc } = setup();
    scrollTo(w, 60);
    expect(collapsed(doc)).toBe(false);
  });

  test('a tiny downward scroll after scrolling up does not tuck', () => {
    const { w, doc, nav } = setup();
    scrollTo(w, 300);
    nav.querySelector('.bn-bubble').click(); // open it again mid-page
    scrollTo(w, 290);
    scrollTo(w, 300); // only 10px down
    expect(collapsed(doc)).toBe(false);
    scrollTo(w, 340); // 50px down
    expect(collapsed(doc)).toBe(true);
  });

  test('scrolling up keeps it tucked; tapping the bubble brings it back', () => {
    const { w, doc, nav } = setup();
    scrollTo(w, 300);
    scrollTo(w, 150);
    expect(collapsed(doc)).toBe(true);
    nav.querySelector('.bn-bubble').click();
    expect(collapsed(doc)).toBe(false);
    expect(nav.querySelector('.bn-item').hasAttribute('tabindex')).toBe(false);
  });

  test('reaching the top of the page brings the nav back', () => {
    const { w, doc } = setup();
    scrollTo(w, 300);
    expect(collapsed(doc)).toBe(true);
    scrollTo(w, 0);
    expect(collapsed(doc)).toBe(false);
  });
});
