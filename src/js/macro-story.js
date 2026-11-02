/* ── Macro story ─────────────────────────────────────────────────────
 * Opens the story composer (src/js/workout-story.js) with today's
 * macros sticker (src/js/macro-sticker.js). Under the preview the user
 * picks which of today's meals was their pre-workout meal (or none).
 * A meal card timed "Pre-workout" is picked by default.
 */
(function () {
  'use strict';

  const PREF_KEY = 'macroStoryPreMeal';
  const state = { options: [], key: null, progress: null, targets: null };

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_e) { return fallback; }
  }

  function user() {
    try { return typeof currentUser !== 'undefined' ? currentUser : window.currentUser; } catch (_e) { return window.currentUser; }
  }

  // Same day boundary as the Macros tab's running totals.
  function today() {
    return (typeof window.getTodayDateString === 'function' && window.getTodayDateString()) || new Date().toISOString().slice(0, 10);
  }

  // The pick is remembered for the rest of the day only.
  function loadPick() {
    const p = readJSON(PREF_KEY, null);
    return p && p.date === today() ? p.key : undefined;
  }

  function savePick(key) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ date: today(), key })); } catch (_e) { /* ignore */ }
  }

  function data() {
    const preMeal = state.options.find((o) => o.key === state.key) || null;
    return window.MacroSticker.buildMacroStoryData(state.progress, { targets: state.targets, preMeal });
  }

  function draw(canvas) {
    window.MacroSticker.drawMacroSticker(canvas, data());
  }

  function controls() {
    const wrap = document.createElement('div');
    wrap.className = 'wtstory-controls mcstory-controls';

    const label = document.createElement('span');
    label.className = 'mcstory-label';
    label.textContent = 'Pre-workout meal';
    wrap.appendChild(label);

    if (!state.options.length) {
      const hint = document.createElement('span');
      hint.className = 'mcstory-hint';
      hint.textContent = 'Log a meal, or time a meal card "Pre-workout", to add it here.';
      wrap.appendChild(hint);
      return wrap;
    }

    const segs = document.createElement('div');
    segs.className = 'mx-segs mcstory-segs';
    segs.setAttribute('role', 'group');
    segs.setAttribute('aria-label', 'Pre-workout meal');
    [{ key: null, label: 'None' }, ...state.options].forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.label;
      const on = o.key === state.key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => {
        state.key = o.key;
        savePick(o.key);
        segs.querySelectorAll('button').forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-pressed', String(x === b));
        });
        window.StoryComposer.redraw();
      });
      segs.appendChild(b);
    });
    wrap.appendChild(segs);
    return wrap;
  }

  async function openMacroStoryModal() {
    if (!window.StoryComposer || !window.MacroSticker) return;
    // Rolls the day over first, so yesterday's totals never show as today's.
    try { window.checkMacroReset?.(); } catch (_e) { /* not ready */ }

    const date = today();
    state.progress = localStorage.getItem('dailyMacroDate') === date ? readJSON('dailyMacroProgress', null) : null;
    try {
      state.targets = typeof window.getAdaptiveMacroTargets === 'function' ? window.getAdaptiveMacroTargets() : null;
    } catch (_e) { state.targets = null; }

    if (!data()) {
      if (typeof window.showToast === 'function') window.showToast('Log some food today to share your macros.', 'warn');
      return;
    }

    state.options = window.MacroSticker.preWorkoutOptions(
      readJSON(`foodLog_${user()}`, []),
      readJSON('dailyMacroMeals', []),
      date,
    );
    const saved = loadPick();
    if (saved === null || state.options.some((o) => o.key === saved)) state.key = saved;
    else state.key = state.options.find((o) => o.key.startsWith('card:'))?.key || null;

    try { await document.fonts?.load?.('400 100px Anton'); } catch (_e) { /* fallback font */ }
    window.StoryComposer.open({
      draw,
      fileBase: `pocket-coach-macros-${date}`,
      label: 'Share today\'s macros as a story',
      controls: controls(),
    });
  }

  window.openMacroStoryModal = openMacroStoryModal;
})();
