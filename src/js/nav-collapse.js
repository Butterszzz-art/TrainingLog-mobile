/**
 * nav-collapse.js
 * Tucks the bottom nav into a round button in the bottom-right corner
 * while the user scrolls down a page, and rolls it back out on tap.
 *
 * - Scrolling down past the top of the page (by more than SCROLL_MIN px)
 *   collapses the capsule into a 52px bubble showing the current tab's
 *   icon. Scrolling up does NOT bring it back; tapping the bubble does,
 *   and so does returning to the very top of the page.
 * - The state lives on <body> as `.nav-collapsed` so CSS can animate the
 *   capsule into the bubble (css/nav.css).
 * - Not persisted: every launch starts with the full nav.
 */
(function (global) {
  'use strict';

  const OLD_STORAGE_KEY = 'bottomNavCollapsed'; // from the swipe-to-hide version
  const SCROLL_MIN = 24;   // px of continuous downward scroll before tucking
  const TOP_ZONE = 8;      // within this many px of the top, the nav comes back
  const START_ZONE = 80;   // never tuck while still near the top of the page

  const MENU_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>';

  function _nav() { return document.getElementById('bottomNav'); }

  function isCollapsed() {
    return document.body.classList.contains('nav-collapsed');
  }

  // Copy the active tab's icon into the bubble so it shows where you are.
  function _syncBubbleIcon(nav) {
    const slot = nav.querySelector('.bn-bubble-icon');
    if (!slot) return;
    const icon = nav.querySelector('.bn-item.active .bn-icon');
    slot.innerHTML = icon ? icon.innerHTML : MENU_ICON;
  }

  function setCollapsed(collapsed) {
    const nav = _nav();
    if (!nav) return;
    collapsed = !!collapsed;
    if (collapsed === isCollapsed()) return;
    if (collapsed) _syncBubbleIcon(nav);
    document.body.classList.toggle('nav-collapsed', collapsed);

    const bubble = nav.querySelector('.bn-bubble');
    if (bubble) {
      bubble.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (collapsed) bubble.removeAttribute('tabindex');
      else bubble.setAttribute('tabindex', '-1');
    }
    // Keep keyboard / screen-reader focus off buttons that are tucked away.
    nav.querySelectorAll('.bn-item, .bn-fab').forEach(btn => {
      if (collapsed) btn.setAttribute('tabindex', '-1');
      else btn.removeAttribute('tabindex');
    });
  }

  function collapse() { setCollapsed(true); }
  function expand() { setCollapsed(false); }
  function toggle() { setCollapsed(!isCollapsed()); }

  function _bindScroll() {
    let lastY = global.scrollY || 0;
    let downRun = 0;
    let ticking = false;

    function onFrame() {
      ticking = false;
      const y = Math.max(0, global.scrollY || 0);
      const dy = y - lastY;
      lastY = y;

      if (y <= TOP_ZONE) { downRun = 0; expand(); return; }
      if (dy > 0) {
        downRun += dy;
        if (downRun > SCROLL_MIN && y > START_ZONE) collapse();
      } else if (dy < 0) {
        downRun = 0;
      }
    }

    global.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      global.requestAnimationFrame(onFrame);
    }, { passive: true });
  }

  function init() {
    const nav = _nav();
    if (!nav || nav.querySelector('.bn-bubble')) return;

    try { global.localStorage.removeItem(OLD_STORAGE_KEY); } catch { /* storage blocked */ }

    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'bn-bubble';
    bubble.setAttribute('aria-label', 'Show navigation');
    bubble.setAttribute('aria-expanded', 'true');
    bubble.setAttribute('tabindex', '-1');
    bubble.innerHTML = '<span class="bn-bubble-icon"></span>';
    bubble.addEventListener('click', (e) => {
      e.stopPropagation();
      expand();
    });
    nav.appendChild(bubble);

    _bindScroll();
  }

  global.NavCollapse = { init, collapse, expand, toggle, isCollapsed, setCollapsed };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.NavCollapse;
  }
})(typeof window !== 'undefined' ? window : globalThis);
