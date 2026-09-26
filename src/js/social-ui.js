/* =============================================================
   SOCIAL UI helpers
   Shared by leaderboard.js, community.js and community-feed.js.
   - sxPlaceThumb(seg): slides a segmented control's thumb under its
     .active button. Re-runs itself when the control is resized (e.g.
     when its tab goes from display:none to visible).
   - sxRing(pct, label): markup for the progress ring.
   ============================================================= */

(function () {
  'use strict';

  const _observed = new WeakSet();
  const _ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(entries => entries.forEach(e => place(e.target)))
    : null;

  function place(seg) {
    if (!seg) return;
    const thumb = seg.querySelector(':scope > .sx-seg-thumb');
    const on = seg.querySelector(':scope > button.active');
    if (!thumb) return;
    if (_ro && !_observed.has(seg)) { _observed.add(seg); _ro.observe(seg); }
    if (!on || !on.offsetWidth) { thumb.style.opacity = on ? thumb.style.opacity : '0'; return; }
    thumb.style.opacity = '1';
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  }

  const C = 2 * Math.PI * 40;

  function ring(pct, centre, done) {
    const p = Math.max(0, Math.min(1, pct || 0));
    return `
      <div class="sx-ring ${done ? 'is-done' : ''}">
        <svg viewBox="0 0 96 96" aria-hidden="true">
          <circle class="sx-ring-trk" cx="48" cy="48" r="40"/>
          <circle class="sx-ring-arc" cx="48" cy="48" r="40" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-offset="${(C * (1 - p)).toFixed(1)}"/>
        </svg>
        <div class="sx-ring-ctr">${centre}</div>
      </div>`;
  }

  // Animate any freshly rendered rings inside `root` from empty to value.
  function fillRings(root) {
    if (!root) return;
    const arcs = root.querySelectorAll('.sx-ring-arc[data-offset]');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      arcs.forEach(a => { a.style.strokeDashoffset = a.dataset.offset; });
    }));
  }

  function icon(name) {
    const svg = (typeof ICONS !== 'undefined' && ICONS[name]) || '';
    return `<span class="ui-icon" data-icon="${name}">${svg}</span>`;
  }

  window.sxPlaceThumb = place;
  window.sxRing = ring;
  window.sxFillRings = fillRings;
  window.sxIcon = icon;
  window.addEventListener('resize', () => document.querySelectorAll('.sx-seg').forEach(place));
})();
