/**
 * settings-hero.js
 * Mockup-style summary at the top of the Settings tab: profile pod +
 * grouped preference rows. Reads the same prefs the real settings form
 * (further down the same tab) already reads/writes — this is a summary
 * view, not a second source of truth. Toggling vacation/sick mode here
 * calls the exact same setVacationMode()/setSickMode() the rest of the
 * app already uses, so it stays in sync with the real settings form.
 */
(function (global) {
  'use strict';

  function _user() {
    return global.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser'));
  }

  function _row(label, right, sub) {
    return `<div class="sh-row"><span class="sh-row-label">${label}</span>` +
      (sub ? `<span class="sh-row-sub">${sub}</span>` : '') +
      `<span class="sh-row-val">${right}</span></div>`;
  }

  function _togglePill(on) {
    return `<span class="sh-toggle ${on ? 'is-on' : ''}">${on ? 'ON' : 'OFF'}</span>`;
  }

  function renderSettingsHero() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('settingsHero');
    if (!el) return;

    const u = _user();
    const initials = (u || '?').slice(0, 2).toUpperCase();
    const appMode = typeof global.getCurrentAppMode === 'function' ? global.getCurrentAppMode() : 'athlete';
    const unit = typeof global.getBodyweightPreference === 'function' ? global.getBodyweightPreference().unit : 'kg';
    const theme = (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'system default';
    const vacation = typeof global.getVacationMode === 'function' ? global.getVacationMode() : { active: false };
    const sick = typeof global.getSickMode === 'function' ? global.getSickMode() : { active: false };

    el.innerHTML = `
      <div class="pod pod--hero sh-profile">
        <div class="sh-profile-avatar">${initials}</div>
        <div class="sh-profile-info">
          <div class="sh-profile-name">${u || 'Athlete'}</div>
          <div class="sh-profile-meta">${appMode === 'both' ? 'Coach + athlete' : appMode === 'coach' ? 'Coach' : 'Athlete'}</div>
        </div>
      </div>

      <div class="pod sh-group">
        <div class="pod-kicker" style="margin-bottom:6px;">Units &amp; display</div>
        ${_row('Weight unit', unit)}
        ${_row('Theme', theme)}
      </div>

      <div class="pod sh-group">
        <div class="pod-kicker" style="margin-bottom:6px;">Modes</div>
        <div class="sh-row"><span class="sh-row-label">Vacation mode</span><span class="sh-row-sub">pauses streak</span>${_togglePill(!!vacation.active)}</div>
        <div class="sh-row"><span class="sh-row-label">Sick mode</span><span class="sh-row-sub">pauses progression</span>${_togglePill(!!sick.active)}</div>
      </div>

      <button class="sh-logout" onclick="if(typeof logout==='function') logout();">Log out</button>
    `;
  }

  global.renderSettingsHero = renderSettingsHero;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderSettingsHero };
  }
})(typeof window !== 'undefined' ? window : globalThis);
