/**
 * settings-hero.js
 * The Settings home: a profile pod and six tiles. Each tile shows a one-line
 * status and opens its page from src/html/settings.html via
 * openSettingsPage() in settings.js. This file only reads prefs; all editing
 * happens on those pages.
 */
(function (global) {
  'use strict';

  function _user() {
    return global.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser'));
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Inline outline icons (the data-icon hydrator only runs at page load).
  const ICON = {
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    training: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
    targets: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    reminders: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    devices: '<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9 6V3h6v3M9 18v3h6v-3"/>',
    account: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9a2 2 0 0 1 4 0v2"/>'
  };

  function _icon(key) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[key]}</svg>`;
  }

  const PHASE_LABELS = {
    improvement: 'Improvement season', mini_cut: 'Mini cut', contest_prep: 'Contest prep',
    peak_week: 'Peak week', show_day: 'Show day', post_show: 'Post-show',
    meet_prep: 'Meet prep', off_season: 'Off season'
  };
  const MODE_LABELS = { bodybuilding: 'Bodybuilding', powerlifting: 'Powerlifting', athlete: 'Athlete' };

  function _settings() {
    const stored = typeof global.getStoredUserSettings === 'function' ? global.getStoredUserSettings() : {};
    const defaults = typeof global.getDefaultUserSettings === 'function' ? global.getDefaultUserSettings() : {};
    return { ...defaults, ...stored };
  }

  function _daysUntil(dateStr) {
    if (!dateStr) return null;
    const target = new Date(dateStr + 'T00:00:00');
    if (Number.isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  function _tileStatuses(settings) {
    const profile = settings.profile || {};
    const info = profile.athleteInfo || {};
    const goals = profile.goals || {};
    const unit = settings.unit || 'kg';

    const body = [
      info.currentWeight != null && info.currentWeight !== '' ? `${info.currentWeight} ${unit}` : '',
      info.height || ''
    ].filter(Boolean).join(' · ');

    const mode = (typeof localStorage !== 'undefined' && localStorage.getItem('trainingMode')) || 'bodybuilding';

    const targets = [
      goals.stepsTarget ? `${Number(goals.stepsTarget).toLocaleString()} steps` : '',
      goals.sleepTarget ? `${goals.sleepTarget} h sleep` : ''
    ].filter(Boolean).join(' · ');

    const vacation = typeof global.getVacationMode === 'function' && global.getVacationMode().active;
    const sick = typeof global.getSickMode === 'function' && global.getSickMode().active;
    const reminders = vacation ? 'Vacation on'
      : sick ? 'Sick mode on'
        : settings.streakReminderEnabled ? `On · ${settings.streakReminderTime || '19:00'}` : 'Off';

    const connected = global.activitySyncBridge?.isConnected?.();
    const plan = global.currentUserPlan || 'free';

    return {
      profile: body || 'Add your details',
      training: MODE_LABELS[mode] || 'Bodybuilding',
      targets: targets || 'Set targets',
      reminders,
      devices: connected ? 'Connected' : 'Not connected',
      account: plan === 'coach' ? 'Coach plan' : plan === 'pro' ? 'Pro plan' : 'Free plan'
    };
  }

  const TILES = [
    ['profile', 'Profile'],
    ['training', 'Training'],
    ['targets', 'Targets'],
    ['reminders', 'Reminders'],
    ['devices', 'Devices'],
    ['account', 'Account']
  ];

  function renderSettingsHero() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('settingsHero');
    if (!el) return;

    const u = _user();
    const initials = (u || '?').slice(0, 2).toUpperCase();
    const profile = (global.Profiles && u && global.Profiles.get(u)) || null;
    const canEdit = !!(global.Profiles && u);
    const appMode = typeof global.getCurrentAppMode === 'function' ? global.getCurrentAppMode() : 'athlete';
    const settings = _settings();
    const archetypeCfg = typeof global.getArchetypeConfig === 'function'
      ? global.getArchetypeConfig(settings.profile?.athleteArchetype) : null;
    const phaseSettings = settings.profile?.phaseSettings || {};
    const phase = PHASE_LABELS[phaseSettings.currentPhase] || '';
    const daysOut = _daysUntil(phaseSettings.showDate);
    const statuses = _tileStatuses(settings);

    const roleLabel = appMode === 'both' ? 'Coach and athlete' : appMode === 'coach' ? 'Coach' : (archetypeCfg?.label || 'Athlete');
    const chips = [
      phase ? `<span class="mx-chip mx-chip--green mx-chip--sm">${_esc(phase)}</span>` : '',
      daysOut != null && daysOut >= 0 ? `<span class="mx-chip mx-chip--sm">${daysOut === 0 ? 'Show day' : `${daysOut} days out`}</span>` : ''
    ].join('');

    el.innerHTML = `
      <div class="pod pod--hero sh-profile">
        <div class="sh-profile-top">
          <div class="sh-profile-avatar"${u ? ` data-avatar-user="${_esc(u)}"` : ''}${canEdit ? ' data-avatar-edit role="button" tabindex="0" aria-label="Edit profile photo"' : ''}>${_esc(initials)}</div>
          <div class="sh-profile-info">
            <div class="sh-profile-name">${_esc((profile && profile.displayName) || u || 'Athlete')}</div>
            <div class="sh-profile-meta">${profile && profile.displayName && u ? '@' + _esc(u) + ' · ' : ''}${_esc(roleLabel)}</div>
          </div>
          ${canEdit ? '<button type="button" class="mx-link sh-profile-edit" data-profile-edit>Edit</button>' : ''}
        </div>
        ${profile && profile.bio ? `<div class="sh-profile-bio">${_esc(profile.bio)}</div>` : ''}
        ${chips ? `<div class="sh-profile-chips">${chips}</div>` : ''}
      </div>

      <div class="sh-tiles">
        ${TILES.map(([key, label]) => `
          <button type="button" class="sh-tile" data-settings-tile="${key}">
            <span class="sh-tile-icon">${_icon(key)}</span>
            <span class="sh-tile-label">${label}</span>
            <span class="sh-tile-status">${_esc(statuses[key])}</span>
          </button>`).join('')}
      </div>
    `;

    el.querySelectorAll('[data-avatar-edit], [data-profile-edit]').forEach(btn => {
      const open = () => global.Profiles && global.Profiles.openEditor();
      btn.addEventListener('click', open);
      btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    el.querySelectorAll('[data-settings-tile]').forEach(btn => {
      btn.addEventListener('click', () => global.openSettingsPage && global.openSettingsPage(btn.dataset.settingsTile));
    });
  }

  global.renderSettingsHero = renderSettingsHero;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderSettingsHero };
  }
})(typeof window !== 'undefined' ? window : globalThis);
