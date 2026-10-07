/* ── Weight story ────────────────────────────────────────────────────
 * Opens the story composer (src/js/workout-story.js) with the bodyweight
 * sticker (src/js/weight-sticker.js), plus two options under the
 * preview: the time range, and whether the actual weight is shown
 * (off by default — the change is the story, the number is private).
 */
(function () {
  'use strict';

  const PREF_KEY = 'weightStoryPrefs';
  const RANGE_LABELS = [['4w', '4 wk'], ['12w', '12 wk'], ['all', 'All']];

  const state = { range: '12w', showWeight: false, data: null };

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      if (p.range in window.WeightSticker.RANGES) state.range = p.range;
      state.showWeight = p.showWeight === true;
    } catch (_e) { /* defaults */ }
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ range: state.range, showWeight: state.showWeight })); } catch (_e) { /* ignore */ }
  }

  function readLog() {
    const user = typeof currentUser !== 'undefined' ? currentUser : window.currentUser;
    try { return JSON.parse(localStorage.getItem(`bodyweightLog_${user}`)) || []; } catch (_e) { return []; }
  }

  function inputs(range) {
    const goal = document.getElementById('macroGoal')?.value || null;
    const rate = document.getElementById('macroRate')?.value || 'moderate';
    const pref = typeof getBodyweightPreference === 'function' ? getBodyweightPreference() : {};
    return {
      range,
      goal,
      planKgPerWeek: window.weightTab?.plannedRate ? window.weightTab.plannedRate(goal || 'maintain', rate) : 0,
      unit: pref.unit === 'lb' ? 'lb' : 'kg',
    };
  }

  function build(range) {
    return window.WeightSticker.buildWeightStoryData(readLog(), inputs(range));
  }

  function draw(canvas) {
    window.WeightSticker.drawWeightSticker(canvas, state.data, { showWeight: state.showWeight });
  }

  function controls() {
    const wrap = document.createElement('div');
    wrap.className = 'wtstory-controls';

    const segs = document.createElement('div');
    segs.className = 'mx-segs';
    segs.setAttribute('role', 'group');
    segs.setAttribute('aria-label', 'Time range');
    RANGE_LABELS.forEach(([key, text]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.dataset.range = key;
      b.disabled = !build(key);
      b.classList.toggle('active', key === state.range);
      b.setAttribute('aria-pressed', String(key === state.range));
      b.addEventListener('click', () => {
        state.range = key;
        state.data = build(key);
        segs.querySelectorAll('button').forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-pressed', String(x === b));
        });
        savePrefs();
        window.StoryComposer.redraw();
      });
      segs.appendChild(b);
    });

    const toggle = document.createElement('label');
    toggle.className = 'wtstory-toggle';
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'mx-switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(state.showWeight));
    sw.addEventListener('click', () => {
      state.showWeight = !state.showWeight;
      sw.setAttribute('aria-checked', String(state.showWeight));
      savePrefs();
      window.StoryComposer.redraw();
    });
    const text = document.createElement('span');
    text.textContent = 'Show my weight';
    toggle.append(text, sw);

    wrap.append(segs, toggle);
    return wrap;
  }

  async function openWeightStoryModal() {
    if (!window.StoryComposer || !window.WeightSticker) return;
    loadPrefs();
    // Fall back to a range that has enough weigh-ins to draw a line.
    state.data = build(state.range);
    if (!state.data) {
      state.range = ['12w', 'all', '4w'].find((r) => build(r)) || state.range;
      state.data = build(state.range);
    }
    if (!state.data) {
      if (typeof window.showToast === 'function') window.showToast('Log at least two weigh-ins to share your progress.', 'warn');
      return;
    }
    // The headline uses the app's display face; wait for it so the first
    // paint isn't in the fallback font.
    try { await document.fonts?.load?.('400 100px Anton'); } catch (_e) { /* fallback font */ }
    window.StoryComposer.open({
      draw,
      fileBase: `pocket-coach-weight-${new Date().toISOString().slice(0, 10)}`,
      label: 'Share weight progress as a story',
      controls: controls(),
    });
  }

  window.openWeightStoryModal = openWeightStoryModal;
})();
