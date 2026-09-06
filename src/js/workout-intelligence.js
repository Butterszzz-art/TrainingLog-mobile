/* =============================================================
   WORKOUT INTELLIGENCE
   - Progressive overload hints (shown when typing an exercise)
   - Workout history search (🔍 History sub-tab)
   - Water tracker widget
   ============================================================= */

(function initWorkoutIntelligence() {
  'use strict';

  /* ── Shared helpers ──────────────────────────────────────── */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') ||
      localStorage.getItem('Username') ||
      null;
  }

  function _loadWorkouts(username) {
    try { return JSON.parse(localStorage.getItem('workouts_' + username)) || []; }
    catch { return []; }
  }

  function _e1rm(weight, reps) {
    if (!weight || reps <= 0) return 0;
    if (reps === 1) return weight;
    return Math.round(weight * (1 + reps / 30) * 10) / 10;
  }

  function _esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ════════════════════════════════════════════════════════════
     1. PROGRESSIVE OVERLOAD HINTS
  ════════════════════════════════════════════════════════════ */

  /**
   * Find the most recent session where `exerciseName` was logged.
   * Returns { date, sets: [{reps, weight}], bestSet, totalVolume } or null.
   */
  function getLastExerciseSession(exerciseName, username) {
    if (!exerciseName || !username) return null;
    const query    = exerciseName.toLowerCase().trim();
    const workouts = _loadWorkouts(username);

    // Search from newest to oldest
    for (let i = workouts.length - 1; i >= 0; i--) {
      const w   = workouts[i];
      const log = Array.isArray(w.log) ? w.log : [];

      for (const entry of log) {
        const name = (entry.exercise || entry.name || '').toLowerCase().trim();
        if (!name.includes(query) && !query.includes(name)) continue;

        const repsArr    = Array.isArray(entry.repsArray)    ? entry.repsArray    : [];
        const weightsArr = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];

        const sets = repsArr.map((r, idx) => ({
          reps:   Number(r)               || 0,
          weight: Number(weightsArr[idx]) || 0,
        })).filter(s => s.reps > 0);

        if (!sets.length) continue;

        const bestSet = sets.reduce((best, s) =>
          _e1rm(s.weight, s.reps) > _e1rm(best.weight, best.reps) ? s : best
        , sets[0]);

        const totalVolume = sets.reduce((sum, s) => sum + s.weight * s.reps, 0);

        return {
          date:        w.date || '',
          sets,
          bestSet,
          totalVolume,
          unit:        entry.unit || 'kg',
          setCount:    sets.length,
        };
      }
    }
    return null;
  }

  // Strategy → visual treatment. Colour carries meaning here: green shades
  // for "add more", brass for "ease off / pay attention", neutral for "hold".
  const OVERLOAD_STRATEGY_META = {
    'increase':      { cls: 'is-increase', metric: 'weight', arrow: 'up' },
    'increase-reps': { cls: 'is-reps',     metric: 'reps',   arrow: 'up' },
    'maxed-out':     { cls: 'is-deload',   metric: 'reps',   arrow: 'up' },
    'reduce':        { cls: 'is-deload',   metric: 'weight', arrow: 'down' },
    'maintain':      { cls: 'is-maintain', metric: 'weight', arrow: 'flat' }
  };

  const ARROW_UP_SVG   = '<svg viewBox="0 0 12 12" fill="none"><path d="M6 10V2M6 2L2.5 5.5M6 2l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ARROW_DOWN_SVG = '<svg viewBox="0 0 12 12" fill="none"><path d="M6 2V10M6 10L2.5 6.5M6 10l3.5-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function _fmtNum(v) {
    const n = Math.round((Number(v) || 0) * 100) / 100;
    return String(n);
  }

  /**
   * Render (or clear) the overload hint below the exercise input.
   */
  function renderOverloadHint() {
    const hintEl   = document.getElementById('overloadHint');
    const inputEl  = document.getElementById('exercise');
    if (!hintEl || !inputEl) return;

    const exerciseName = (inputEl.value || '').trim();
    if (exerciseName.length < 3) { hintEl.innerHTML = ''; return; }

    const username = _user();
    if (!username) { hintEl.innerHTML = ''; return; }

    const session = getLastExerciseSession(exerciseName, username);
    if (!session || !session.bestSet) { hintEl.innerHTML = ''; return; }

    const workouts = _loadWorkouts(username);
    const recommendation = typeof window.suggestNextSession === 'function'
      ? window.suggestNextSession(exerciseName, workouts)
      : null;

    if (!recommendation || !Array.isArray(recommendation.sets) || !recommendation.sets.length) {
      hintEl.innerHTML = '';
      return;
    }

    hintEl.innerHTML = renderOverloadPod(recommendation, session);
  }

  function renderOverloadPod(recommendation, session) {
    const { bestSet, setCount, date, unit: sessionUnit } = session;
    const meta = OVERLOAD_STRATEGY_META[recommendation.strategy] || OVERLOAD_STRATEGY_META.maintain;

    const suggestedSet = recommendation.sets[0] || {};
    const previousSet   = (recommendation.previousSets && recommendation.previousSets[0]) || {};
    const unit = recommendation.unit || sessionUnit || 'kg';

    const isReps = meta.metric === 'reps';
    const number  = isReps ? suggestedSet.reps : suggestedSet.weight;
    const before  = isReps ? previousSet.reps  : previousSet.weight;
    const delta   = (Number(number) || 0) - (Number(before) || 0);
    const numberUnit = isReps ? 'reps' : unit;

    let deltaHtml = '';
    if (meta.arrow === 'up' && delta > 0) {
      deltaHtml = `<span class="ov-delta">${ARROW_UP_SVG}+${_fmtNum(delta)}${isReps ? ' / set' : ''}</span>`;
    } else if (meta.arrow === 'down' && delta < 0) {
      deltaHtml = `<span class="ov-delta">${ARROW_DOWN_SVG}−${_fmtNum(Math.abs(delta))}</span>`;
    }

    const sessions = Math.max(0, Number(recommendation.basedOnSessions) || 0);
    const meterPct = Math.min(96, 20 + sessions * 6);
    const relDate = _relativeDate(date);

    return `
      <div class="ov-pod ${meta.cls}">
        <div class="ov-accent"></div>
        <div class="ov-top">
          <span class="ov-live"></span>
          <span class="ov-eyebrow">Progressive overload</span>
          <span class="ov-sessions">${sessions} session${sessions === 1 ? '' : 's'}</span>
        </div>
        <div class="ov-body">
          <p class="ov-last">${relDate} you logged <b>${setCount}×${_esc(bestSet.reps)} @ ${_esc(bestSet.weight)} ${_esc(unit)}</b></p>
          <div class="ov-main">
            <span class="ov-number">${_fmtNum(number)}</span><span class="ov-unit">${_esc(numberUnit)}</span>
            ${deltaHtml}
          </div>
          <p class="ov-msg">${_esc(recommendation.message)}</p>
          <div class="ov-meter" style="--ov-fill:${meterPct}%"><i></i></div>
          <div class="ov-foot">
            <span class="ov-basis">Based on ${sessions} logged session${sessions === 1 ? '' : 's'}</span>
            <button class="ov-cta" type="button" onclick="if(typeof applySuggestedSetValuesForExercise==='function') applySuggestedSetValuesForExercise(true);">Use ${_fmtNum(number)}${isReps ? ' reps' : ''}</button>
          </div>
        </div>
      </div>
    `;
  }

  function _relativeDate(dateStr) {
    if (!dateStr) return 'Last time';
    try {
      const d    = new Date(dateStr);
      const now  = new Date();
      const days = Math.round((now - d) / 86400000);
      if (days === 0) return 'Today';
      if (days === 1) return 'Yesterday';
      if (days < 7)   return `${days}d ago`;
      if (days < 30)  return `${Math.floor(days / 7)}w ago`;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } catch { return 'Last time'; }
  }

  /* ════════════════════════════════════════════════════════════
     2. WORKOUT HISTORY SEARCH
  ════════════════════════════════════════════════════════════ */

  /**
   * Search all workouts for entries matching `query`.
   * Returns array of { date, exercise, sets, bestSet, unit }.
   */
  function searchWorkoutHistory(query, username) {
    if (!query || !username) return [];
    const q        = query.toLowerCase().trim();
    const workouts = _loadWorkouts(username);
    const results  = [];

    for (let i = workouts.length - 1; i >= 0; i--) {
      const w   = workouts[i];
      const log = Array.isArray(w.log) ? w.log : [];

      for (const entry of log) {
        const name = (entry.exercise || entry.name || '').trim();
        if (!name.toLowerCase().includes(q)) continue;

        const repsArr    = Array.isArray(entry.repsArray)    ? entry.repsArray    : [];
        const weightsArr = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
        const unit       = entry.unit || 'kg';

        const sets = repsArr.map((r, idx) => ({
          reps:   Number(r)               || 0,
          weight: Number(weightsArr[idx]) || 0,
        })).filter(s => s.reps > 0);

        if (!sets.length) continue;

        const bestSet = sets.reduce((best, s) =>
          _e1rm(s.weight, s.reps) > _e1rm(best.weight, best.reps) ? s : best
        , sets[0]);

        results.push({ date: w.date || '', exercise: name, sets, bestSet, unit });

        // Cap at 60 results
        if (results.length >= 60) return results;
      }
    }
    return results;
  }

  /** Render results into #historyResults */
  function renderHistoryResults(query) {
    const host = document.getElementById('historyResults');
    if (!host) return;

    if (!query || query.trim().length < 2) {
      host.innerHTML = '<div class="history-empty">Type an exercise name to search your history.</div>';
      return;
    }

    const username = _user();
    if (!username) {
      host.innerHTML = '<div class="history-empty">Log in to search your history.</div>';
      return;
    }

    const results = searchWorkoutHistory(query, username);

    if (!results.length) {
      host.innerHTML = `<div class="history-empty">No results for "<strong>${_esc(query)}</strong>".</div>`;
      return;
    }

    host.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'history-results';

    results.forEach(r => {
      const card = document.createElement('div');
      card.className = 'history-result-card';

      const setsHTML = r.sets
        .map(s => `<span class="history-set-chip">${s.reps} × ${s.weight} ${r.unit}</span>`)
        .join('');

      card.innerHTML = `
        <div class="history-result-header">
          <span class="history-result-name">${_esc(r.exercise)}</span>
          <span class="history-result-date">${r.date}</span>
        </div>
        <div class="history-result-sets">${setsHTML}</div>
        <div class="history-result-best">
          Best: ${r.bestSet.weight} ${r.unit} × ${r.bestSet.reps} reps
          · Est. 1RM ${_e1rm(r.bestSet.weight, r.bestSet.reps)} ${r.unit}
        </div>
      `;
      list.appendChild(card);
    });

    host.appendChild(list);
  }

  /* ════════════════════════════════════════════════════════════
     3. WATER TRACKER
  ════════════════════════════════════════════════════════════ */

  const WATER_KEY    = 'waterTracker_v1';
  const WATER_CIRCUMFERENCE = 2 * Math.PI * 30; // r=30, viewBox 76×76

  function _loadWater() {
    try {
      const raw   = JSON.parse(localStorage.getItem(WATER_KEY)) || {};
      const today = new Date().toDateString();
      // Reset if it's a new day
      if (raw.date !== today) return { date: today, ml: 0, targetMl: raw.targetMl || 2500 };
      return raw;
    } catch {
      return { date: new Date().toDateString(), ml: 0, targetMl: 2500 };
    }
  }

  function _saveWater(data) {
    localStorage.setItem(WATER_KEY, JSON.stringify(data));
  }

  function _updateWaterUI() {
    const data    = _loadWater();
    const pct     = Math.min(data.ml / data.targetMl, 1);
    const offset  = WATER_CIRCUMFERENCE * (1 - pct);

    const valEl   = document.getElementById('waterMlVal');
    const fillEl  = document.getElementById('waterRingFill');
    const textEl  = document.getElementById('waterProgressText');

    if (valEl)  valEl.textContent  = data.ml;
    if (fillEl) fillEl.style.strokeDashoffset = offset;
    if (textEl) textEl.innerHTML   =
      `<strong>${data.ml}</strong> / ${data.targetMl} ml · ${Math.round(pct * 100)}%`;
  }

  window.addWater = function addWater(ml) {
    const data = _loadWater();
    data.ml    = Math.min(data.ml + ml, 9999);
    _saveWater(data);
    _updateWaterUI();
  };

  window.addWaterCustom = function addWaterCustom() {
    const inp = document.getElementById('waterCustomInput');
    const ml  = parseInt(inp?.value, 10);
    if (!ml || ml <= 0) return;
    addWater(ml);
    if (inp) inp.value = '';
  };

  window.resetWater = function resetWater() {
    const data = _loadWater();
    data.ml    = 0;
    _saveWater(data);
    _updateWaterUI();
  };

  window.setWaterTarget = function setWaterTarget() {
    const inp = document.getElementById('waterTargetInput');
    const ml  = parseInt(inp?.value, 10);
    if (!ml || ml < 100) return;
    const data       = _loadWater();
    data.targetMl    = ml;
    _saveWater(data);
    _updateWaterUI();
    // Hide edit row
    const row = document.getElementById('waterTargetRow');
    if (row) row.classList.remove('visible');
  };

  window.toggleWaterTargetEdit = function toggleWaterTargetEdit() {
    const row     = document.getElementById('waterTargetRow');
    const inp     = document.getElementById('waterTargetInput');
    if (!row) return;
    const showing = row.classList.toggle('visible');
    if (showing && inp) {
      inp.value = _loadWater().targetMl || 2500;
      inp.focus();
    }
  };

  /* ── Boot ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', () => {

    /* ── Overload hint: listen on exercise input ── */
    setTimeout(() => {
      const exerciseInput = document.getElementById('exercise');
      if (exerciseInput) {
        // Debounced — only fires after 350ms pause
        let _hintTimer = null;
        exerciseInput.addEventListener('input', () => {
          clearTimeout(_hintTimer);
          _hintTimer = setTimeout(renderOverloadHint, 350);
        });
      }

      /* ── History search input ── */
      const searchInput = document.getElementById('historySearchInput');
      if (searchInput) {
        let _searchTimer = null;
        searchInput.addEventListener('input', e => {
          clearTimeout(_searchTimer);
          _searchTimer = setTimeout(() => renderHistoryResults(e.target.value), 300);
        });
        // Render empty state immediately
        renderHistoryResults('');
      }

      /* ── Water tracker initial paint ── */
      _updateWaterUI();

    }, 800);
  });

  /* ── Public API ───────────────────────────────────────────── */

  window.getLastExerciseSession  = getLastExerciseSession;
  window.renderOverloadHint      = renderOverloadHint;
  window.searchWorkoutHistory    = searchWorkoutHistory;
  window.renderHistoryResults    = renderHistoryResults;

})();
