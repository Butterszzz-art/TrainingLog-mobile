/**
 * session-context.js
 * Three niche quality-of-life features:
 *
 * 1. Vacation Mode   – pauses streak & program tracking, shows banner on home.
 * 2. Alt-Machine flag – tags exercises logged on different equipment than usual.
 * 3. Alt-Gym flag     – tags exercises logged at a different gym.
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

  // ── 2 & 3. ALT-MACHINE / ALT-GYM (per-session flags) ──────────────────────
  //
  // While a flag is on, every exercise logged gets a `sessionCtx` tag. Tagged
  // entries are skipped by "last time", progression and PR checks (see
  // isAltSessionEntry in progressiveOverload.js) but still count for volume,
  // streaks and history.

  const SESSION_CTX_KEY = 'sessionContext';
  const EMPTY_CTX = { altMachine: false, altGym: false, gymName: '', date: null };

  function _today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function _escapeAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getSessionContext() {
    const ctx = _get(SESSION_CTX_KEY);
    if (!ctx) return { ...EMPTY_CTX };
    // Flags are for one session. If they were set on an earlier day and never
    // cleared (app closed before "End workout"), drop them rather than
    // silently tagging today's lifts.
    if ((ctx.altMachine || ctx.altGym) && ctx.date !== _today()) {
      _set(SESSION_CTX_KEY, { ...EMPTY_CTX });
      return { ...EMPTY_CTX };
    }
    return { ...EMPTY_CTX, ...ctx };
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

  /**
   * Tag a log entry with the current flags before it's saved. Removes any old
   * tag when no flag is on, so a re-saved entry never keeps a stale one.
   */
  function applySessionContext(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const ctx = getSessionContext();
    if (ctx.altMachine || ctx.altGym) {
      entry.sessionCtx = {
        altMachine: !!ctx.altMachine,
        altGym:     !!ctx.altGym,
        gymName:    ctx.altGym ? (ctx.gymName || '').trim() : '',
      };
    } else {
      delete entry.sessionCtx;
    }
    return entry;
  }

  function _noteText(ctx) {
    const tags = [
      ctx.altMachine ? 'alt machine' : '',
      ctx.altGym ? `alt gym${ctx.gymName ? ' (' + ctx.gymName + ')' : ''}` : '',
    ].filter(Boolean).join(' + ');
    return `⚠️ Exercises you log now will be tagged ${tags} and left out of progression and PRs.`;
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
                aria-pressed="${ctx.altMachine}"
                title="Mark exercises as using different equipment than usual">
          <span class="scb-chip-icon">🔧</span>
          <span class="scb-chip-label">Alt&nbsp;Machine</span>
          ${ctx.altMachine ? '<span class="scb-chip-badge">ON</span>' : ''}
        </button>

        <!-- Alt Gym toggle + name input -->
        <button class="scb-chip ${ctx.altGym ? 'scb-chip--on' : ''}"
                onclick="window.toggleAltGym()"
                aria-pressed="${ctx.altGym}"
                title="Mark exercises as done at a different gym">
          <span class="scb-chip-icon">📍</span>
          <span class="scb-chip-label">Alt&nbsp;Gym</span>
          ${ctx.altGym ? '<span class="scb-chip-badge">ON</span>' : ''}
        </button>

        ${ctx.altGym ? `
          <input class="scb-gym-input"
                 id="altGymNameInput"
                 type="text"
                 placeholder="Gym name (optional)"
                 value="${_escapeAttr(ctx.gymName)}"
                 oninput="window.setAltGymName(this.value)"
                 maxlength="40" />
        ` : ''}
      </div>
      ${ctx.altMachine || ctx.altGym ? '<p class="scb-note"></p>' : ''}`;

    // textContent, not innerHTML — the gym name is user input.
    const note = bar.querySelector('.scb-note');
    if (note) note.textContent = _noteText(ctx);
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
    // Save and update the note only. Re-rendering the bar here would rebuild
    // the input and drop focus after every keystroke.
    const ctx = _saveSessionContext({ gymName: String(name || '').slice(0, 40) });
    const note = document.querySelector('#sessionContextBar .scb-note');
    if (note) note.textContent = _noteText(ctx);
  }

  /** Call after a workout is successfully saved to reset single-use flags. */
  function clearSessionContextAfterSave() {
    _set(SESSION_CTX_KEY, { ...EMPTY_CTX });
    renderSessionContextBar();
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
  window.toggleAltMachine         = toggleAltMachine;
  window.toggleAltGym             = toggleAltGym;
  window.setAltGymName            = setAltGymName;
  window.clearSessionContextAfterSave = clearSessionContextAfterSave;
  window.renderSessionContextBar  = renderSessionContextBar;
  window.initSessionContext        = initSessionContext;
})();
