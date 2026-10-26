/* =============================================================
   PERSONAL RECORDS TRACKER
   - Detects new PRs (best weight, best e1RM, best volume) after every log entry
   - Shows a celebration modal
   - Renders a PR board in #prBoard
   ============================================================= */

(function initPRTracker() {
  'use strict';

  const PR_KEY_PREFIX = 'prBoard_';

  /* ── Helpers ─────────────────────────────────────────────── */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') ||
      localStorage.getItem('Username') ||
      null;
  }

  function _prKey(username) { return PR_KEY_PREFIX + username; }

  function _loadPRs(username) {
    try { return JSON.parse(localStorage.getItem(_prKey(username))) || {}; }
    catch { return {}; }
  }

  function _savePRs(username, prs) {
    localStorage.setItem(_prKey(username), JSON.stringify(prs));
  }

  /** Epley formula: estimated 1-rep max */
  function _e1rm(weight, reps) {
    if (!weight || !reps || reps <= 0) return 0;
    if (reps === 1) return weight;
    return Math.round(weight * (1 + reps / 30) * 10) / 10;
  }

  /** Total volume for a set */
  function _volume(weight, reps) { return (weight || 0) * (reps || 0); }

  /* ── Load workouts from localStorage ─────────────────────── */

  function _loadWorkouts(username) {
    try { return JSON.parse(localStorage.getItem('workouts_' + username)) || []; }
    catch { return []; }
  }

  /* ── Scan most recent workout for new PRs ─────────────────── */

  /**
   * Called after a workout is saved.
   * Returns an array of new PR objects (empty if none).
   */
  function checkLatestWorkoutForPRs(username) {
    if (!username) return [];
    const workouts = _loadWorkouts(username);
    if (!workouts.length) return [];

    // Most recent workout
    const latest = workouts[workouts.length - 1];
    const log = Array.isArray(latest.log) ? latest.log : [];
    if (!log.length) return [];

    const prs = _loadPRs(username);
    const newPRs = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const entry of log) {
      const name = (entry.exercise || entry.name || '').trim();
      if (!name) continue;

      const repsArr    = Array.isArray(entry.repsArray)    ? entry.repsArray    : [];
      const weightsArr = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
      const setTypeArr = Array.isArray(entry.setTypeArray)  ? entry.setTypeArray : [];

      const existing = prs[name] || { weight: 0, e1rm: 0, volume: 0 };
      let updated = false;
      const setDetails = [];

      for (let i = 0; i < repsArr.length; i++) {
        // Skip back-off sets — they're intentionally lighter than the top
        // set and shouldn't trigger a PR celebration.
        if (setTypeArr[i] === 'backoff') continue;
        const reps   = Number(repsArr[i])    || 0;
        const weight = Number(weightsArr[i]) || 0;
        if (!reps || !weight) continue;

        const e1rm   = _e1rm(weight, reps);
        const vol    = _volume(weight, reps);
        setDetails.push({ reps, weight, e1rm, vol });

        if (weight > (existing.weight || 0)) {
          existing.weight = weight;
          existing.weightReps = reps;
          existing.weightDate = today;
          updated = true;
        }
        if (e1rm > (existing.e1rm || 0)) {
          existing.e1rm = e1rm;
          existing.e1rmReps = reps;
          existing.e1rmWeight = weight;
          existing.e1rmDate = today;
          updated = true;
        }
        if (vol > (existing.volume || 0)) {
          existing.volume = vol;
          existing.volumeDate = today;
          updated = true;
        }
      }

      if (updated && setDetails.length) {
        prs[name] = existing;
        // Find the best set to display
        const bestSet = setDetails.reduce((best, s) => s.e1rm > best.e1rm ? s : best, setDetails[0]);
        newPRs.push({
          exercise: name,
          weight:   existing.weight,
          reps:     existing.weightReps || bestSet.reps,
          e1rm:     existing.e1rm,
        });
      }
    }

    if (newPRs.length) {
      _savePRs(username, prs);
      showPRCelebration(newPRs);
    }

    return newPRs;
  }

  /* ── Celebration Modal ────────────────────────────────────── */

  const PR_CARD_MS = 6000;

  // A compact card at the top of the screen (below the rest timer when it's
  // showing). No backdrop, so the Log button stays usable; tap it to skip.
  function showPRCelebration(prs) {
    document.getElementById('_prModal')?._close?.();
    document.getElementById('_prModal')?.remove();
    window.holdToastsForSpotlight?.();

    const overlay = document.createElement('div');
    overlay.className = 'pr-modal-overlay';
    overlay.id = '_prModal';

    const shown = prs.slice(0, 3);
    const itemsHTML = shown.map(pr => `
      <div class="pr-modal-item">
        <span class="pr-modal-item-name">${_esc(pr.exercise)}</span>
        <span class="pr-modal-item-detail">${pr.weight} kg × ${pr.reps}
          · e1RM <strong>${pr.e1rm} kg</strong></span>
      </div>
    `).join('');
    const more = prs.length - shown.length;

    overlay.innerHTML = `
      <div class="pr-modal" role="status" aria-live="polite" tabindex="0">
        <span class="pr-modal-trophy" aria-hidden="true">🏆</span>
        <div class="pr-modal-body">
          <div class="pr-modal-head">
            <span class="pr-modal-headline">New PR${prs.length > 1 ? 's' : ''}</span>
            <span class="pr-modal-skip">Tap to skip</span>
          </div>
          <div class="pr-modal-items">${itemsHTML}</div>
          ${more > 0 ? `<div class="pr-modal-more">+${more} more</div>` : ''}
        </div>
        <span class="pr-modal-meter" aria-hidden="true"><span></span></span>
      </div>
    `;

    const top = typeof window.notifyTopOffset === 'function' ? window.notifyTopOffset() : 0;
    if (top) overlay.style.setProperty('--pr-top', top + 'px');

    let timer = null;
    const close = () => {
      if (overlay._closed) return;
      overlay._closed = true;
      clearTimeout(timer);
      overlay.classList.remove('visible');
      setTimeout(() => {
        overlay.remove();
        window.flushToastQueue?.();
      }, 250);
    };
    overlay._close = close;

    const card = overlay.querySelector('.pr-modal');
    card.addEventListener('click', close);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); close(); }
    });
    card.style.setProperty('--pr-card-ms', PR_CARD_MS + 'ms');

    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('visible'));
    });

    timer = setTimeout(close, PR_CARD_MS);
  }

  /* ── PR Board rendering ───────────────────────────────────── */

  function renderPRBoard(containerId) {
    const host = document.getElementById(containerId || 'prBoard');
    if (!host) return;

    const username = _user();
    if (!username) {
      host.innerHTML = '<div class="pr-board-empty">Log in to see your PRs.</div>';
      return;
    }

    const prs = _loadPRs(username);
    const entries = Object.entries(prs);

    const wrap = document.createElement('div');
    wrap.className = 'pr-board-wrap';

    const header = document.createElement('div');
    header.className = 'pr-board-header';
    header.innerHTML = `
      <h3 class="pr-board-title">🏆 Personal Records</h3>
      <span class="pr-board-count">${entries.length} exercise${entries.length !== 1 ? 's' : ''}</span>
    `;
    wrap.appendChild(header);

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'pr-board-empty';
      empty.textContent = 'No PRs yet — log your first workout to start tracking!';
      wrap.appendChild(empty);
    } else {
      // Sort by est. 1RM descending
      entries.sort((a, b) => (b[1].e1rm || 0) - (a[1].e1rm || 0));

      const list = document.createElement('div');
      list.className = 'pr-board-list';

      entries.forEach(([name, data], i) => {
        const medals = ['🥇', '🥈', '🥉'];
        const medal  = medals[i] || '🎖️';
        const card   = document.createElement('div');
        card.className = 'pr-board-card';
        card.innerHTML = `
          <span class="pr-board-medal">${medal}</span>
          <div class="pr-board-info">
            <div class="pr-board-exercise">${_esc(name)}</div>
            <div class="pr-board-stats">
              Best set: ${data.weight || 0} kg × ${data.weightReps || 0} reps
              ${data.weightDate ? '· ' + data.weightDate : ''}
            </div>
          </div>
          <div>
            <span class="pr-board-rm">${data.e1rm || 0} kg</span>
            <span class="pr-board-rm-label">est. 1RM</span>
          </div>
        `;
        list.appendChild(card);
      });

      wrap.appendChild(list);
    }

    host.innerHTML = '';
    host.appendChild(wrap);
  }

  /* ── Hook into addLogEntry ────────────────────────────────── */

  function _hookAddLogEntry() {
    const orig = window.addLogEntry;
    if (typeof orig !== 'function' || orig.__prHooked) return;

    window.addLogEntry = function () {
      orig.apply(this, arguments);
      // Give localStorage a moment to write, then scan
      setTimeout(() => {
        const username = _user();
        if (username) checkLatestWorkoutForPRs(username);
      }, 600);
    };
    window.addLogEntry.__prHooked = true;
  }

  /* ── Helpers ─────────────────────────────────────────────── */

  function _esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Public API ───────────────────────────────────────────── */

  window.checkLatestWorkoutForPRs = checkLatestWorkoutForPRs;
  window.renderPRBoard            = renderPRBoard;
  window.showPRCelebration        = showPRCelebration;

  /* ── Boot ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', () => {
    // Hook as soon as addLogEntry is defined (it may load after this script)
    setTimeout(_hookAddLogEntry, 2500);
  });

})();
