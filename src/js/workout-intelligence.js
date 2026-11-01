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
    const gymKey = typeof window.getCurrentGymKey === 'function' ? window.getCurrentGymKey() : '';
    if (gymKey === null) return null;

    // Search from newest to oldest
    for (let i = workouts.length - 1; i >= 0; i--) {
      const w   = workouts[i];
      const log = Array.isArray(w.log) ? w.log : [];

      for (const entry of log) {
        const name = (entry.exercise || entry.name || '').toLowerCase().trim();
        if (!name.includes(query) && !query.includes(name)) continue;
        // Only sessions at the gym you're at now, on the usual machine.
        if (typeof window.isComparableEntry === 'function' && !window.isComparableEntry(entry, w, gymKey)) continue;

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

  function _fmtNum(v) {
    const n = Math.round((Number(v) || 0) * 100) / 100;
    return String(n);
  }

  // Latest recommendation the bubble is showing, so "Use" applies exactly
  // what the lifter saw. ✕ hides the tip for that exercise until the name
  // changes.
  let _shownRec = null;
  let _dismissedFor = '';

  function _weightSuggestionsOn() {
    try { return localStorage.getItem('autoIncrementEnabled') !== 'false'; }
    catch { return true; }
  }

  function _setBubbleLive(on) {
    const wrap = document.getElementById('exerciseBubble');
    if (wrap) wrap.classList.toggle('is-live', !!on);
  }

  function _clearHint(hintEl) {
    hintEl.innerHTML = '';
    _shownRec = null;
    _setBubbleLive(false);
  }

  /**
   * Render (or clear) the progression tip inside the silver bubble around
   * the exercise name. The weight/reps fields start at last time's numbers;
   * this only suggests what to add, and "Use" applies it.
   */
  function renderOverloadHint() {
    const hintEl   = document.getElementById('overloadHint');
    const inputEl  = document.getElementById('exercise');
    if (!hintEl || !inputEl) return;

    const exerciseName = (inputEl.value || '').trim();
    if (_dismissedFor && _dismissedFor !== exerciseName.toLowerCase()) _dismissedFor = '';
    if (exerciseName.length < 3 || !_weightSuggestionsOn()) { _clearHint(hintEl); return; }
    if (_dismissedFor === exerciseName.toLowerCase()) { _clearHint(hintEl); return; }

    const username = _user();
    if (!username) { _clearHint(hintEl); return; }

    const session = getLastExerciseSession(exerciseName, username);
    if (!session || !session.bestSet) { _clearHint(hintEl); return; }

    const workouts = _loadWorkouts(username);
    const recommendation = typeof window.suggestNextSession === 'function'
      ? window.suggestNextSession(exerciseName, workouts)
      : null;

    if (!recommendation || !Array.isArray(recommendation.sets) || !recommendation.sets.length) {
      _clearHint(hintEl);
      return;
    }

    _shownRec = recommendation;
    hintEl.innerHTML = renderOverloadTip(recommendation, session);
    _setBubbleLive(true);
  }

  function _plural(n, word) { return `${_fmtNum(n)} ${word}${Number(n) === 1 ? '' : 's'}`; }

  function renderOverloadTip(recommendation, session) {
    const { bestSet, setCount, date, unit: sessionUnit } = session;
    const unit = recommendation.unit || sessionUnit || 'kg';
    const next = recommendation.sets[0] || {};
    const prev = (recommendation.previousSets && recommendation.previousSets[0]) || {};
    const dW = (Number(next.weight) || 0) - (Number(prev.weight) || 0);
    const dR = (Number(next.reps) || 0) - (Number(prev.reps) || 0);
    const sessions = Math.max(0, Number(recommendation.basedOnSessions) || 0);
    const basis = _plural(sessions, 'session');

    let main, label, why, warn = false;
    switch (recommendation.strategy) {
      case 'increase':
        main = `+${_fmtNum(dW)} ${_esc(unit)} <span class="exb-or">or</span> +1 rep`;
        label = 'Linear progression';
        why = basis;
        break;
      case 'increase-reps':
        main = `+${_plural(Math.max(1, dR), 'rep')} per set`;
        label = 'Double progression';
        why = 'add weight once reps are up';
        break;
      case 'maxed-out':
        main = `+${_plural(Math.max(1, dR), 'rep')} per set`;
        label = 'Maxed out';
        why = 'no more weight on this machine';
        break;
      case 'reduce':
        main = `−${_fmtNum(Math.abs(dW))} ${_esc(unit)} <span class="exb-or">or</span> keep ${_fmtNum(prev.weight)}`;
        label = 'Ease off';
        why = 'high effort or missed reps last time';
        warn = true;
        break;
      default:
        main = `Keep ${_fmtNum(prev.weight)} ${_esc(unit)} × ${_fmtNum(prev.reps)}`;
        label = 'Hold steady';
        why = basis;
    }

    const ctx = typeof window.getSessionContext === 'function' ? window.getSessionContext() : null;
    const gymLabel = ctx && ctx.altGym ? String(ctx.gymName || '').trim() : '';
    const last = `${setCount}×${_esc(bestSet.reps)} @ ${_esc(bestSet.weight)} ${_esc(sessionUnit || unit)} · ${_esc(_relativeDate(date))}${gymLabel ? ' · ' + _esc(gymLabel) : ''}`;
    const canUse = recommendation.strategy !== 'maintain';

    return `
      <div class="exb-last">Last: ${last}</div>
      <div class="exb-rule"></div>
      <div class="exb-tip${warn ? ' is-warn' : ''}">
        <div class="exb-txt">
          <div class="exb-main">${main}</div>
          <div class="exb-why"><b>${_esc(label)}</b> · ${_esc(why)}</div>
        </div>
        ${canUse ? '<button class="exb-use" type="button" onclick="applyOverloadSuggestion()">Use</button>' : ''}
        <button class="exb-x" type="button" aria-label="Hide suggestion" onclick="dismissOverloadHint()">✕</button>
      </div>
    `;
  }

  /** "Use": put the suggested weight/reps into the set rows (and Quick Log). */
  function applyOverloadSuggestion() {
    const rec = _shownRec;
    if (!rec || !Array.isArray(rec.sets) || !rec.sets.length) return;
    const rows = document.querySelectorAll('#setInputsContainer .set-input-row').length || 1;
    for (let i = 0; i < rows; i++) {
      const set = rec.sets[i] || rec.sets[rec.sets.length - 1];
      const w = document.getElementById(`weight_${i}`);
      const r = document.getElementById(`reps_${i}`);
      if (w && set.weight != null) w.value = set.weight;
      if (r && set.reps != null) r.value = set.reps;
    }
    if (typeof window.syncQuickLogFromRow0 === 'function') window.syncQuickLogFromRow0();
    if (typeof window.updateAddButtonState === 'function') window.updateAddButtonState();
    dismissOverloadHint();
  }

  /** ✕: hide the tip for this exercise; the silver bubble goes back to a plain field. */
  function dismissOverloadHint() {
    const inputEl = document.getElementById('exercise');
    _dismissedFor = ((inputEl && inputEl.value) || '').trim().toLowerCase();
    const hintEl = document.getElementById('overloadHint');
    if (hintEl) _clearHint(hintEl);
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
    const barEl   = document.getElementById('waterVisBar');

    if (valEl)  valEl.textContent  = data.ml;
    if (fillEl) fillEl.style.strokeDashoffset = offset;
    if (barEl)  barEl.style.width = `${Math.round(pct * 100)}%`;
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
        // Switching gym changes which sessions count as "last time".
        document.addEventListener('tl:gym-changed', () => {
          clearTimeout(_hintTimer);
          _hintTimer = setTimeout(renderOverloadHint, 350);
        });
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
  window.applyOverloadSuggestion = applyOverloadSuggestion;
  window.dismissOverloadHint     = dismissOverloadHint;
  window.searchWorkoutHistory    = searchWorkoutHistory;
  window.renderHistoryResults    = renderHistoryResults;

})();
