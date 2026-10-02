/**
 * nav-collapse.js
 * Lets the user slide the bottom nav down out of the way and back up.
 *
 * A small handle tab sits on the nav's top edge. Tapping it (or swiping
 * down on the nav) slides the capsule off the bottom of the screen, leaving
 * only the handle peeking up; tapping the handle again (or swiping up on
 * it) slides the nav back. The state lives on <body> as `.nav-collapsed`
 * so other fixed elements (AI coach FAB, workout focus bar, content
 * padding) can follow it in CSS — see css/nav.css.
 *
 * The choice is a per-device preference, kept in localStorage as
 * `bottomNavCollapsed` = '1'.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'bottomNavCollapsed';
  const SWIPE_MIN = 24; // px of vertical travel before a drag counts

  const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

  function _load() {
    try { return global.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  }

  function _save(collapsed) {
    try {
      if (collapsed) global.localStorage.setItem(STORAGE_KEY, '1');
      else global.localStorage.removeItem(STORAGE_KEY);
    } catch { /* private mode / blocked storage — state just won't persist */ }
  }

  function _nav() { return document.getElementById('bottomNav'); }

  function isCollapsed() {
    return document.body.classList.contains('nav-collapsed');
  }

  function setCollapsed(collapsed, { persist = true } = {}) {
    const nav = _nav();
    if (!nav) return;
    collapsed = !!collapsed;
    document.body.classList.toggle('nav-collapsed', collapsed);

    const handle = nav.querySelector('.bn-collapse-handle');
    if (handle) {
      handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      handle.setAttribute('aria-label', collapsed ? 'Show navigation' : 'Hide navigation');
    }
    // Keep keyboard / screen-reader focus off buttons that are off-screen.
    nav.querySelectorAll('.bn-item, .bn-fab').forEach(btn => {
      if (collapsed) btn.setAttribute('tabindex', '-1');
      else btn.removeAttribute('tabindex');
    });
    if (persist) _save(collapsed);
  }

  function collapse() { setCollapsed(true); }
  function expand() { setCollapsed(false); }
  function toggle() { setCollapsed(!isCollapsed()); }

  // Vertical swipe detection: down on the nav collapses, up on the handle
  // (all that's visible while collapsed) expands.
  function _bindSwipe(nav) {
    let startX = 0, startY = 0, tracking = false;
    nav.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    nav.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dy) < SWIPE_MIN || Math.abs(dy) < Math.abs(dx)) return;
      if (dy > 0 && !isCollapsed()) collapse();
      else if (dy < 0 && isCollapsed()) expand();
    }, { passive: true });
    nav.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
  }

  function init() {
    const nav = _nav();
    if (!nav || nav.querySelector('.bn-collapse-handle')) return;

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'bn-collapse-handle';
    handle.innerHTML = '<span class="bn-collapse-tab">' + CHEVRON + '</span>';
    handle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
    nav.appendChild(handle);

    _bindSwipe(nav);
    setCollapsed(_load(), { persist: false });
  }

  global.NavCollapse = { init, collapse, expand, toggle, isCollapsed, setCollapsed, STORAGE_KEY };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.NavCollapse;
  }
})(typeof window !== 'undefined' ? window : globalThis);
