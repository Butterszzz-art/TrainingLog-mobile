/**
 * session-context.js
 * Three niche quality-of-life features:
 *
 * 1. Vacation Mode   – pauses streak & program tracking, shows banner on home.
 * 2. Alt-Machine flag – per exercise: logged on different equipment than usual.
 * 3. Alt-Gym flag     – per session: logged at another gym, picked from the
 *                       gyms you've used before so visits compare with each other.
 *
 * All state lives in localStorage so it survives page reloads.
 */
(function () {
  'use strict';

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _user() {
    return window.currentUser || localStorage.getItem('fitnessAppUser') || '';
  }

  function _get(key) {
    try { return JSON.parse(localStorage.getItem(`${key}_${_user()}`)); } catch { return null; }
  }
  function _set(key, val) {
    localStorage.setItem(`${key}_${_user()}`, JSON.stringify(val));
  }

  // ── 1. VACATION MODE ────────────────────────────────────────────────────────

  const VACATION_KEY = 'vacationMode';

  function getVacationMode() {
    return _get(VACATION_KEY) || { active: false, since: null };
  }

  function setVacationMode(active) {
    const prev = getVacationMode();
    const now  = new Date().toISOString().slice(0, 10);
    _set(VACATION_KEY, {
      active,
      since: active ? (prev.since || now) : null,
      resumedOn: active ? null : now,
    });
    renderVacationBanner();
    // Refresh streak display if leaderboard helpers are loaded
    if (typeof window.renderPersonalStats === 'function') window.renderPersonalStats();
    if (typeof window.renderTodayProgramCard === 'function') window.renderTodayProgramCard();
  }

  /**
   * Returns true if a given ISO date string falls inside a vacation window.
   * Used by streak calculators to skip vacation days.
   */
  function isVacationDate(dateStr) {
    const v = getVacationMode();
    if (!v.since) return false;
    const d       = dateStr;
    const since   = v.since;
    const resumed = v.resumedOn || new Date().toISOString().slice(0, 10);
    return d >= since && d <= resumed;
  }

  function renderVacationBanner() {
    const el = document.getElementById('vacationModeBanner');
    if (!el) return;
    const v = getVacationMode();
    if (v.active) {
      el.style.display = 'flex';
      el.querySelector('.vm-since').textContent = `Since ${v.since}`;
    } else {
      el.style.display = 'none';
    }
  }

  function renderVacationCard() {
    const el = document.getElementById('vacationModeCard');
    if (!el) return;
    const v = getVacationMode();
    el.innerHTML = `
      <div class="vm-card ${v.active ? 'vm-card--active' : ''}">
        <div class="vm-card-left">
          <span class="vm-icon">${v.active ? '🏖️' : '🏋️'}</span>
          <div>
            <span class="vm-title">${v.active ? 'Vacation mode on' : 'Vacation mode'}</span>
            ${v.active
              ? `<span class="vm-sub">Streak &amp; program paused since ${v.since}</span>`
              : `<span class="vm-sub">Pause streak &amp; program tracking</span>`}
          </div>
        </div>
        <button class="vm-toggle ${v.active ? 'vm-toggle--on' : ''}"
                onclick="window.toggleVacationMode()">
          ${v.active ? 'Resume' : 'Go on vacation'}
        </button>
      </div>`;
  }

  function toggleVacationMode() {
    const v = getVacationMode();
    setVacationMode(!v.active);
    renderVacationCard();
  }

  // ── SICK MODE (pause progress tracking, keep logging available) ────────────

  const SICK_KEY = 'sickMode';

  function getSickMode() {
    return _get(SICK_KEY) || { active: false, since: null };
  }

  function setSickMode(active) {
    const prev = getSickMode();
    const now = new Date().toISOString().slice(0, 10);
    _set(SICK_KEY, {
      active,
      since: active ? (prev.since || now) : null,
      recoveredOn: active ? null : now,
    });
    renderSickBanner();
    if (typeof window.renderPersonalStats === 'function') window.renderPersonalStats();
    if (typeof window.renderTodayProgramCard === 'function') window.renderTodayProgramCard();
  }

  function isSickDate(dateStr) {
    const s = getSickMode();
    if (!s.since) return false;
    const recovered = s.recoveredOn || new Date().toISOString().slice(0, 10);
    return dateStr >= s.since && dateStr <= recovered;
  }

  function renderSickBanner() {
    const el = document.getElementById('sickModeBanner');
    if (!el) return;
    const s = getSickMode();
    if (s.active) {
      el.style.display = 'flex';
      const sinceEl = el.querySelector('.sm-since');
      if (sinceEl) sinceEl.textContent = 'Since ' + s.since;
    } else {
      el.style.display = 'none';
    }
  }

  function renderSickCard() {
    const el = document.getElementById('sickModeCard');
    if (!el) return;
    const s = getSickMode();
    const days = s.active && s.since ? Math.floor((Date.now() - new Date(s.since).getTime()) / 86400000) : 0;
    el.innerHTML = '<div class="sm-card ' + (s.active ? 'sm-card--active' : '') + '">'
      + '<div class="vm-card-left">'
      + '<span class="vm-icon">' + (s.active ? '🤒' : '💪') + '</span>'
      + '<div>'
      + '<span class="vm-title">' + (s.active ? 'Sick Mode — Day ' + days : 'Feeling unwell?') + '</span>'
      + '<span class="vm-sub">' + (s.active
        ? 'Streaks, XP & missions paused. Bodyweight & macros still tracked.'
        : 'Pause progress tracking while you recover') + '</span>'
      + '</div></div>'
      + '<button class="vm-toggle ' + (s.active ? 'sm-toggle--on' : '') + '" onclick="window.toggleSickMode()">'
      + (s.active ? 'I\'m better!' : 'I\'m sick') + '</button>'
      + '</div>';
  }

  function toggleSickMode() {
    const s = getSickMode();
    setSickMode(!s.active);
    renderSickCard();
  }

  window.getSickMode = getSickMode;
  window.setSickMode = setSickMode;
  window.toggleSickMode = toggleSickMode;
  window.isSickDate = isSickDate;
  window.renderSickCard = renderSickCard;
  window.renderSickBanner = renderSickBanner;

  // ── 2 & 3. ALT-MACHINE / ALT-GYM ─────────────────────────────────────────
  //
  // Alt Gym is a session flag: while it's on, every exercise logged is tagged
  // with the gym's name (`entry.sessionCtx`). Sessions at the same named gym
  // are compared with each other; the usual gym's numbers and PRs stay
  // separate. Alt Machine is per exercise — a toggle on the log form and in
  // each card's menu — and passed in to applySessionContext().
  // Comparison rules live in progressiveOverload.js (entryGymKey).

  const SESSION_CTX_KEY = 'sessionContext';
  const EMPTY_CTX = { altGym: false, gymName: '', date: null, askedDate: null };
  const MAX_SAVED_GYMS = 6;

  function _today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _gymKey(name) {
    return typeof window.normalizeGymName === 'function'
      ? window.normalizeGymName(name)
      : String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function getSessionContext() {
    const ctx = _get(SESSION_CTX_KEY);
    if (!ctx) return { ...EMPTY_CTX };
    // One session only. Left on from an earlier day (app closed before
    // "End workout")? Drop it rather than silently tagging today's lifts.
    if (ctx.altGym && ctx.date !== _today()) {
      _set(SESSION_CTX_KEY, { ...EMPTY_CTX });
      return { ...EMPTY_CTX };
    }
    return { altGym: !!ctx.altGym, gymName: ctx.gymName || '', date: ctx.date || null, askedDate: ctx.askedDate || null };
  }

  function _saveSessionContext(patch) {
    const ctx = { ...getSessionContext(), ...patch, date: _today() };
    _set(SESSION_CTX_KEY, ctx);
    return ctx;
  }

  function setSessionContext(patch) {
    _saveSessionContext(patch);
    renderSessionContextBar();
  }

  /** The gym being trained at: '' usual, a name key, or null (unnamed). */
  function getCurrentGymKey() {
    const ctx = getSessionContext();
    if (!ctx.altGym) return '';
    return _gymKey(ctx.gymName) || null;
  }

  /**
   * Tag a log entry before it's saved. `opts.altMachine` comes from the log
   * form. Removes any old tag when nothing applies.
   */
  function applySessionContext(entry, opts = {}) {
    if (!entry || typeof entry !== 'object') return entry;
    const ctx = getSessionContext();
    const altMachine = !!opts.altMachine;
    if (altMachine || ctx.altGym) {
      entry.sessionCtx = {
        altMachine,
        altGym:  !!ctx.altGym,
        gymName: ctx.altGym ? String(ctx.gymName || '').trim() : '',
      };
    } else {
      delete entry.sessionCtx;
    }
    return entry;
  }

  function _readArray(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  /**
   * Gyms you've logged at before, most recent first, built from the tags on
   * your own workouts (so nothing extra to keep in sync).
   * → [{ key, name, visits, lastDate }]
   */
  function getSavedGyms() {
    const user = _user();
    const byKey = new Map();
    const workouts = [..._readArray(`workoutHistory_${user}`), ..._readArray(`workouts_${user}`)];
    workouts.forEach(w => {
      const date = String(w?.date || '').slice(0, 10);
      (Array.isArray(w?.log) ? w.log : []).forEach(e => {
        const ctx = e?.sessionCtx || w?._sessionCtx;
        if (!ctx?.altGym) return;
        const name = String(ctx.gymName || '').trim();
        const key = _gymKey(name);
        if (!key) return;
        const g = byKey.get(key) || { key, name, dates: new Set(), lastDate: '' };
        g.dates.add(date);
        if (date >= g.lastDate) { g.lastDate = date; g.name = name; }
        byKey.set(key, g);
      });
    });
    return [...byKey.values()]
      .map(g => ({ key: g.key, name: g.name, visits: g.dates.size, lastDate: g.lastDate }))
      .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.name.localeCompare(b.name)));
  }

  function _noteText(ctx) {
    const name = String(ctx.gymName || '').trim();
    if (!name) return '⚠️ Pick or name the gym to compare with past visits. Until then these sets aren\'t compared, and your usual numbers and PRs are left alone.';
    const known = getSavedGyms().find(g => g.key === _gymKey(name));
    return known
      ? `📍 Comparing with your ${known.visits === 1 ? 'last visit' : known.visits + ' past visits'} to ${name}. Your usual gym's numbers and PRs aren't affected.`
      : `📍 First time at ${name} — today sets the baseline there. Your usual gym's numbers and PRs aren't affected.`;
  }

  function _markSelectedGym(bar, name) {
    const key = _gymKey(name);
    bar.querySelectorAll('.scb-gym-chip').forEach(chip => {
      const on = chip.dataset.gymKey === key;
      chip.classList.toggle('scb-chip--on', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function renderSessionContextBar() {
    const bar = document.getElementById('sessionContextBar');
    if (!bar) return;
    const ctx = getSessionContext();
    const gyms = ctx.altGym ? getSavedGyms().slice(0, MAX_SAVED_GYMS) : [];

    bar.innerHTML = `
      <div class="scb-wrap">
        <button type="button" class="scb-chip ${ctx.altGym ? 'scb-chip--on' : ''}"
                onclick="window.toggleAltGym()"
                aria-pressed="${ctx.altGym}"
                title="Training somewhere else? Sessions are compared per gym">
          <span class="scb-chip-icon">📍</span>
          <span class="scb-chip-label">Alt&nbsp;Gym</span>
          ${ctx.altGym ? '<span class="scb-chip-badge">ON</span>' : ''}
        </button>
      </div>
      ${ctx.altGym ? `
        ${gyms.length ? `
          <div class="scb-gyms" role="radiogroup" aria-label="Saved gyms">
            ${gyms.map(g => `
              <button type="button" class="scb-chip scb-gym-chip" role="radio" aria-checked="false"
                      data-gym-key="${_esc(g.key)}" data-gym-name="${_esc(g.name)}"
                      onclick="window.setAltGymName(this.dataset.gymName, true)">
                <span class="scb-chip-label">${_esc(g.name)}</span>
                <span class="scb-gym-visits">${g.visits}×</span>
              </button>`).join('')}
          </div>` : ''}
        <input class="scb-gym-input"
               id="altGymNameInput"
               type="text"
               aria-label="Gym name"
               placeholder="${gyms.length ? 'Or type a new gym' : 'Gym name'}"
               value="${_esc(ctx.gymName)}"
               oninput="window.setAltGymName(this.value)"
               maxlength="40" />
        <p class="scb-note"></p>` : ''}`;

    if (ctx.altGym) {
      // textContent, not innerHTML — the gym name is user input.
      bar.querySelector('.scb-note').textContent = _noteText(ctx);
      _markSelectedGym(bar, ctx.gymName);
    }
  }

  function toggleAltGym() {
    const ctx = getSessionContext();
    // Setting the gym by hand counts as answering "Where are you training?".
    setSessionContext({ altGym: !ctx.altGym, askedDate: _today() });
    document.dispatchEvent(new CustomEvent('tl:gym-changed', { detail: { gymName: ctx.gymName } }));
  }

  /**
   * Set the gym's name. While typing, only the note and chip highlight are
   * updated — re-rendering would rebuild the input and drop focus.
   */
  function setAltGymName(name, fromChip = false) {
    const ctx = _saveSessionContext({ gymName: String(name || '').slice(0, 40), askedDate: _today() });
    const bar = document.getElementById('sessionContextBar');
    if (!bar) return;
    if (fromChip) {
      const input = bar.querySelector('#altGymNameInput');
      if (input) input.value = ctx.gymName;
    }
    const note = bar.querySelector('.scb-note');
    if (note) note.textContent = _noteText(ctx);
    _markSelectedGym(bar, ctx.gymName);
    // "Last time" hints and pre-fill depend on the gym — refresh them.
    document.dispatchEvent(new CustomEvent('tl:gym-changed', { detail: { gymName: ctx.gymName } }));
  }

  /** Call after a workout is successfully saved to reset single-use flags. */
  function clearSessionContextAfterSave() {
    _set(SESSION_CTX_KEY, { ...EMPTY_CTX });
    renderSessionContextBar();
  }

  // ── "Where are you training?" — asked once when a workout starts ───────────

  const GYM_PROMPT_OFF_KEY = 'gymPromptOff';

  function isGymPromptEnabled() {
    return _get(GYM_PROMPT_OFF_KEY) !== true;
  }

  function setGymPromptEnabled(on) {
    _set(GYM_PROMPT_OFF_KEY, !on);
  }

  function _workoutInProgress() {
    try {
      const t = JSON.parse(localStorage.getItem('tl_workout_timer_v1'));
      return !!(t && typeof t.startTimeMs === 'number');
    } catch { return false; }
  }

  /** True when starting a workout now should ask where you're training. */
  function shouldAskGym() {
    if (!isGymPromptEnabled()) return false;
    if (window.coachLoggingClient) return false;   // coach logging for a client
    if (_workoutInProgress()) return false;        // already mid-workout
    if (document.getElementById('gymAskSheet')) return false;
    return getSessionContext().askedDate !== _today();
  }

  function _closeGymSheet() {
    const el = document.getElementById('gymAskSheet');
    if (el) el.remove();
    document.removeEventListener('keydown', _gymSheetKeydown, true);
  }

  function _gymSheetKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); _closeGymSheet(); }
  }

  /**
   * Run `fn` now, or — at the start of a workout — first ask which gym
   * you're at, then run it. Returns true if the question was shown.
   */
  function askGymThen(fn) {
    const run = () => { if (typeof fn === 'function') fn(); };
    if (!shouldAskGym()) { run(); return false; }

    const gyms = getSavedGyms().slice(0, MAX_SAVED_GYMS);
    const wrap = document.createElement('div');
    wrap.id = 'gymAskSheet';
    wrap.className = 'gym-ask-overlay';
    wrap.innerHTML = `
      <div class="gym-ask-sheet" role="dialog" aria-modal="true" aria-labelledby="gymAskTitle">
        <h2 class="gym-ask-title" id="gymAskTitle">Where are you training?</h2>
        <p class="gym-ask-sub">Sessions are compared with others at the same gym.</p>
        <button type="button" class="gym-ask-option gym-ask-option--usual" data-gym-choice="usual">
          <span class="gym-ask-name">My usual gym</span>
        </button>
        ${gyms.map(g => `
          <button type="button" class="gym-ask-option" data-gym-choice="saved" data-gym-name="${_esc(g.name)}">
            <span class="gym-ask-name">📍 ${_esc(g.name)}</span>
            <span class="gym-ask-meta">${g.visits} visit${g.visits === 1 ? '' : 's'}</span>
          </button>`).join('')}
        <form class="gym-ask-new" data-gym-choice="new">
          <label class="gym-ask-label" for="gymAskNewName">${gyms.length ? 'Somewhere else' : 'Somewhere else? Name it'}</label>
          <div class="gym-ask-new-row">
            <input id="gymAskNewName" type="text" maxlength="40" placeholder="Gym name" autocomplete="off" />
            <button type="submit" class="gym-ask-go">Start</button>
          </div>
        </form>
        <button type="button" class="gym-ask-skip" data-gym-choice="never">Always my usual gym — don't ask again</button>
      </div>`;
    document.body.appendChild(wrap);

    const choose = (altGym, gymName) => {
      _saveSessionContext({ altGym, gymName: altGym ? gymName : '', askedDate: _today() });
      _closeGymSheet();
      renderSessionContextBar();
      document.dispatchEvent(new CustomEvent('tl:gym-changed', { detail: { gymName: altGym ? gymName : '' } }));
      run();
    };

    wrap.addEventListener('click', e => {
      if (e.target === wrap) { _closeGymSheet(); return; }   // tap outside: cancel
      const btn = e.target.closest('button[data-gym-choice]');
      if (!btn) return;
      const choice = btn.dataset.gymChoice;
      if (choice === 'usual') choose(false, '');
      else if (choice === 'saved') choose(true, btn.dataset.gymName || '');
      else if (choice === 'never') { setGymPromptEnabled(false); choose(false, ''); }
    });
    wrap.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const name = String(wrap.querySelector('#gymAskNewName').value || '').trim().slice(0, 40);
      if (!name) { wrap.querySelector('#gymAskNewName').focus(); return; }
      choose(true, name);
    });
    document.addEventListener('keydown', _gymSheetKeydown, true);
    const first = wrap.querySelector('.gym-ask-option--usual');
    if (first) first.focus();
    return true;
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function initSessionContext() {
    renderVacationBanner();
    renderVacationCard();
    renderSickBanner();
    renderSickCard();
    renderSessionContextBar();
  }

  // Re-init whenever the user changes (e.g. after login)
  document.addEventListener('userChanged', initSessionContext);

  // ── Public API ──────────────────────────────────────────────────────────────

  window.getVacationMode          = getVacationMode;
  window.setVacationMode          = setVacationMode;
  window.toggleVacationMode       = toggleVacationMode;
  window.isVacationDate           = isVacationDate;
  window.renderVacationCard       = renderVacationCard;
  window.renderVacationBanner     = renderVacationBanner;

  window.getSessionContext        = getSessionContext;
  window.applySessionContext      = applySessionContext;
  window.toggleAltGym             = toggleAltGym;
  window.getCurrentGymKey         = getCurrentGymKey;
  window.getSavedGyms             = getSavedGyms;
  window.askGymThen               = askGymThen;
  window.shouldAskGym             = shouldAskGym;
  window.isGymPromptEnabled       = isGymPromptEnabled;
  window.setGymPromptEnabled      = setGymPromptEnabled;
  window.setAltGymName            = setAltGymName;
  window.clearSessionContextAfterSave = clearSessionContextAfterSave;
  window.renderSessionContextBar  = renderSessionContextBar;
  window.initSessionContext        = initSessionContext;
})();
