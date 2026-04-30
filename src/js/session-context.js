/**
 * session-context.js
 * Three niche quality-of-life features:
 *
 * 1. Vacation Mode   – pauses streak & program tracking, shows banner on home.
 * 2. Alt-Machine flag – per-workout marker that equipment differs from usual.
 * 3. Alt-Gym flag     – per-workout marker for a different gym location.
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
            <span class="vm-title">${v.active ? 'Vacation Mode On' : 'Vacation Mode'}</span>
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

  // ── 2 & 3. ALT-MACHINE / ALT-GYM (per-session flags) ──────────────────────

  const SESSION_CTX_KEY = 'sessionContext';

  function getSessionContext() {
    return _get(SESSION_CTX_KEY) || { altMachine: false, altGym: false, gymName: '' };
  }

  function setSessionContext(patch) {
    const ctx = { ...getSessionContext(), ...patch };
    _set(SESSION_CTX_KEY, ctx);
    renderSessionContextBar();
  }

  /** Attach session context metadata to a workout before saving. */
  function applySessionContext(workoutObj) {
    const ctx = getSessionContext();
    if (ctx.altMachine || ctx.altGym) {
      workoutObj._sessionCtx = {
        altMachine: ctx.altMachine || false,
        altGym:     ctx.altGym    || false,
        gymName:    ctx.gymName   || '',
      };
    }
    return workoutObj;
  }

  function renderSessionContextBar() {
    const bar = document.getElementById('sessionContextBar');
    if (!bar) return;
    const ctx = getSessionContext();

    bar.innerHTML = `
      <div class="scb-wrap">
        <!-- Alt Machine toggle -->
        <button class="scb-chip ${ctx.altMachine ? 'scb-chip--on' : ''}"
                onclick="window.toggleAltMachine()"
                title="Mark this session as using different equipment than usual">
          <span class="scb-chip-icon">🔧</span>
          <span class="scb-chip-label">Alt&nbsp;Machine</span>
          ${ctx.altMachine ? '<span class="scb-chip-badge">ON</span>' : ''}
        </button>

        <!-- Alt Gym toggle + name input -->
        <button class="scb-chip ${ctx.altGym ? 'scb-chip--on' : ''}"
                onclick="window.toggleAltGym()"
                title="Mark this session as being at a different gym">
          <span class="scb-chip-icon">📍</span>
          <span class="scb-chip-label">Alt&nbsp;Gym</span>
          ${ctx.altGym ? '<span class="scb-chip-badge">ON</span>' : ''}
        </button>

        ${ctx.altGym ? `
          <input class="scb-gym-input"
                 id="altGymNameInput"
                 type="text"
                 placeholder="Gym name (optional)"
                 value="${ctx.gymName || ''}"
                 oninput="window.setAltGymName(this.value)"
                 maxlength="40" />
        ` : ''}
      </div>
      ${ctx.altMachine || ctx.altGym ? `
        <p class="scb-note">
          ⚠️ This session will be tagged
          ${[ctx.altMachine ? 'alt machine' : '', ctx.altGym ? `alt gym${ctx.gymName ? ' (' + ctx.gymName + ')' : ''}` : ''].filter(Boolean).join(' + ')}.
          Progression comparisons will exclude it.
        </p>` : ''}`;
  }

  function toggleAltMachine() {
    const ctx = getSessionContext();
    setSessionContext({ altMachine: !ctx.altMachine });
  }

  function toggleAltGym() {
    const ctx = getSessionContext();
    setSessionContext({ altGym: !ctx.altGym });
  }

  function setAltGymName(name) {
    setSessionContext({ gymName: name });
  }

  /** Call after a workout is successfully saved to reset single-use flags. */
  function clearSessionContextAfterSave() {
    setSessionContext({ altMachine: false, altGym: false, gymName: '' });
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function initSessionContext() {
    renderVacationBanner();
    renderVacationCard();
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
  window.toggleAltMachine         = toggleAltMachine;
  window.toggleAltGym             = toggleAltGym;
  window.setAltGymName            = setAltGymName;
  window.clearSessionContextAfterSave = clearSessionContextAfterSave;
  window.renderSessionContextBar  = renderSessionContextBar;
  window.initSessionContext        = initSessionContext;
})();
