/* =============================================================
   ANIMATIONS PATCH (JS)
   Drop-in animation layer for Pocket Coach.
   Add to index.html as the LAST script before </body>:
     <script src="animations-patch.js"></script>
   Pairs with css/animations.css. Wraps existing globals —
   does not modify tabs.css / log.css / native-ui.js logic.
   ============================================================= */
(function () {
  'use strict';

  if (window.__pcAnimPatchApplied) return;
  window.__pcAnimPatchApplied = true;

  function onAnimEnd(el, cls) {
    el.addEventListener('animationend', function handler(e) {
      if (e.target !== el) return;
      el.classList.remove(cls);
      el.removeEventListener('animationend', handler);
    });
  }

  // ── showTab: spring the newly active panel + nav pill ────────────────
  if (typeof window.showTab === 'function') {
    const _origShowTab = window.showTab;
    window.showTab = function () {
      // _origShowTab runs fully synchronously (classList changes + a
      // synchronous switch/render), so the newly-active panel and nav
      // pill are already in the DOM by the time it returns — no need to
      // wait a frame, which also keeps this working while the tab is
      // backgrounded/throttled.
      _origShowTab.apply(this, arguments);

      const panel = document.querySelector('.tab-content.active');
      if (panel) {
        panel.classList.remove('tab-anim-enter');
        void panel.offsetWidth; // restart animation
        panel.classList.add('tab-anim-enter');
        onAnimEnd(panel, 'tab-anim-enter');
      }
      const pill = document.querySelector('#bottomNav .bn-item.active');
      if (pill) {
        pill.classList.remove('nav-spring');
        void pill.offsetWidth;
        pill.classList.add('nav-spring');
        onAnimEnd(pill, 'nav-spring');
      }
    };
  }

  // ── showToast: play a collapse-out before the toast is fully hidden ──
  if (typeof window.showToast === 'function') {
    const _origShowToast = window.showToast;
    let hideTimer = null;
    let cleanupTimer = null;

    window.showToast = function (msg, type, duration) {
      duration = duration || 3000;
      _origShowToast(msg, type, duration);

      const el = document.getElementById('nativeToast');
      if (!el) return;

      el.classList.remove('native-toast--hiding');
      if (hideTimer) clearTimeout(hideTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);

      hideTimer = setTimeout(function () {
        el.classList.remove('native-toast--show');
        el.classList.add('native-toast--hiding');
        cleanupTimer = setTimeout(function () {
          el.classList.remove('native-toast--hiding');
        }, 240);
      }, duration);
    };
  }

  // ── Set rows: spring in on add, collapse out before removal ──────────
  const setContainer = document.getElementById('setInputsContainer');
  if (setContainer) {
    // Entrance
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          const rows = node.classList && node.classList.contains('set-input-row')
            ? [node]
            : (node.querySelectorAll ? node.querySelectorAll('.set-input-row') : []);
          rows.forEach(function (row) {
            row.classList.remove('row-entering');
            void row.offsetWidth;
            row.classList.add('row-entering');
            onAnimEnd(row, 'row-entering');
          });
        });
      });
    }).observe(setContainer, { childList: true });

    // Exit — intercept the × click, play the collapse animation, then let
    // the real removeSet() handler run on a synthetic follow-up click.
    setContainer.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('.set-remove-btn');
      if (!btn) return;

      if (btn.dataset.pcExiting === '1') {
        delete btn.dataset.pcExiting;
        return; // let this click through to the real onclick handler
      }

      const row = btn.closest('.set-input-row');
      if (!row) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      row.classList.add('row-exiting');

      // Proceed exactly once, from whichever fires first: the real
      // animationend, or a fallback timer. Without the fallback, a
      // backgrounded/throttled tab (animations paused) would mean
      // animationend never fires and the set can never be removed.
      let settled = false;
      const proceed = function () {
        if (settled) return;
        settled = true;
        row.removeEventListener('animationend', onEnd);
        clearTimeout(fallback);
        btn.dataset.pcExiting = '1';
        btn.click();
      };
      function onEnd(ev) {
        if (ev.target !== row) return;
        proceed();
      }
      row.addEventListener('animationend', onEnd);
      const fallback = setTimeout(proceed, 350); // exit animation is 220ms
    }, true);
  }

  // ── PR badges: pop + glow whenever a PR label enters the DOM ─────────
  const PR_SELECTOR = '.pr-modal-item-type, .pr-modal-trophy, .pr-board-medal, ' +
    '[class*="pr-badge"], [class*="pr-tag"], [class*="pr-flag"]';

  function tagIfPrBadge(el) {
    if (!el || el.nodeType !== 1 || el.classList.contains('pc-pr-badge')) return;
    if (el.matches && el.matches(PR_SELECTOR)) {
      el.classList.add('pc-pr-badge');
      return;
    }
    // Fallback: short leaf elements whose own text is exactly a PR callout.
    if (!el.children.length) {
      const text = (el.textContent || '').trim();
      if (text.length <= 24 && (/\bPR\b/.test(text) || text.indexOf('🏆') !== -1)) {
        el.classList.add('pc-pr-badge');
      }
    }
  }

  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        tagIfPrBadge(node);
        if (node.querySelectorAll) {
          node.querySelectorAll(PR_SELECTOR).forEach(tagIfPrBadge);
        }
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
