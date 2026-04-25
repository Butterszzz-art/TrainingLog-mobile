/* =============================================================
   UI DECLUTTER
   – Log sub-tab switching (📝 Log / ⏱️ Rest / 📋 Templates / 🏆 Streaks)
   – Rest timer preset helper
   ============================================================= */

(function initUiDeclutter() {
  'use strict';

  /* ── Log sub-tab switching ───────────────────────────────────── */

  function initLogSubtabs() {
    const nav = document.getElementById('logSubtabNav');
    if (!nav) return;

    nav.addEventListener('click', function (e) {
      const btn = e.target.closest('.log-subtab');
      if (!btn) return;

      const target = btn.dataset.logSubtab;
      if (!target) return;

      // Update buttons
      nav.querySelectorAll('.log-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update panels
      document.querySelectorAll('.log-subview').forEach(panel => {
        panel.classList.remove('active');
      });

      const targetPanel = document.getElementById('logSub_' + target);
      if (targetPanel) targetPanel.classList.add('active');
    });
  }

  /* ── Rest timer preset helper ────────────────────────────────── */

  /**
   * Fill the rest-timer minute/second inputs and immediately start the timer.
   * @param {number} minutes
   * @param {number} seconds
   */
  window.setRestPreset = function setRestPreset(minutes, seconds) {
    const minInput = document.getElementById('restMinutes');
    const secInput = document.getElementById('restSeconds');
    if (minInput) minInput.value = minutes;
    if (secInput) secInput.value = seconds;

    // Highlight active preset button
    document.querySelectorAll('.rest-preset-btn').forEach(btn => {
      btn.classList.remove('active-preset');
    });
    const clicked = document.activeElement;
    if (clicked && clicked.classList.contains('rest-preset-btn')) {
      clicked.classList.add('active-preset');
    }

    // Delegate to existing startRestTimer function
    if (typeof window.startRestTimer === 'function') {
      window.startRestTimer();
    }
  };

  /* ── Boot ────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    initLogSubtabs();
  });

  // Expose so login/tab-show flows can re-init if needed
  window.initLogSubtabs = initLogSubtabs;

})();
