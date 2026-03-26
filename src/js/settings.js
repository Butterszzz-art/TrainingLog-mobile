const SETTINGS_PREFIX = 'settings_';

function getActiveUsername() {
  if (typeof window !== 'undefined') {
    if (window.currentUser) return window.currentUser;
    const savedUser = window.localStorage?.getItem('fitnessAppUser');
    if (savedUser) return savedUser;
    const legacy = window.localStorage?.getItem('currentUser');
    if (legacy) return legacy;
  }
  return null;
}

function getSettingsStorageKey() {
  const user = getActiveUsername();
  return user ? `${SETTINGS_PREFIX}${user}` : `${SETTINGS_PREFIX}guest`;
}

function readStoredSettings() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getSettingsStorageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    console.warn('Unable to parse stored settings', error);
    return {};
  }
}

function applySettingsToUI(settings) {
  const unit = settings.unit;
  const theme = settings.theme;
  const streakReminderEnabled = settings.streakReminderEnabled;
  const streakReminderTime = settings.streakReminderTime;
  const autoIncrement = settings.autoIncrement;

  if (unit) {
    const unitSelect = document.getElementById('defaultUnit');
    if (unitSelect) unitSelect.value = unit;
    const weightUnitSelect = document.getElementById('weightUnit');
    if (weightUnitSelect) weightUnitSelect.value = unit;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('defaultWeightUnit', unit);
    }
  }

  if (theme) {
    const themeSelect = document.getElementById('theme');
    if (themeSelect) themeSelect.value = theme;
    const legacyThemeSelect = document.getElementById('themeSelect');
    if (legacyThemeSelect) legacyThemeSelect.value = theme;
    if (typeof applyTheme === 'function') {
      applyTheme(theme);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem('theme', theme);
    }
  }

  const reminderEnabledCheckbox = document.getElementById('streakReminderEnabled');
  if (reminderEnabledCheckbox) {
    reminderEnabledCheckbox.checked = Boolean(streakReminderEnabled);
  }

  const reminderTimeInput = document.getElementById('streakReminderTime');
  if (reminderTimeInput) {
    reminderTimeInput.value = typeof streakReminderTime === 'string' && streakReminderTime
      ? streakReminderTime
      : '19:00';
    reminderTimeInput.disabled = !Boolean(streakReminderEnabled);
  }

  if (typeof autoIncrement === 'boolean' && typeof localStorage !== 'undefined') {
    const toggle = document.getElementById('autoIncrementSetting') || document.getElementById('autoIncrementToggle');
    if (toggle) toggle.checked = autoIncrement;
    localStorage.setItem('autoIncrementEnabled', String(autoIncrement));
  }

  const profile = settings.profile || {};
  const athleteInfo = profile.athleteInfo || {};
  const phaseSettings = profile.phaseSettings || {};
  const goals = profile.goals || {};

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.value = value;
  };

  setValue('athleteInfoName', athleteInfo.name || '');
  setValue('athleteInfoCurrentWeight', athleteInfo.currentWeight ?? '');
  setValue('athleteInfoHeight', athleteInfo.height || '');
  setValue('athleteInfoDivision', athleteInfo.divisionClass || '');

  setValue('profileCurrentPhase', phaseSettings.currentPhase || '');
  setValue('profileStartDate', phaseSettings.startDate || '');
  setValue('profileShowDate', phaseSettings.showDate || '');
  setValue('profileTargetStageWeight', phaseSettings.targetStageWeight ?? '');
  setValue('profileCheckInDay', phaseSettings.checkInDay || 'Sunday');
  setValue('profileCardioBaseline', phaseSettings.cardioBaseline || '');
  setValue('profilePosingFrequency', phaseSettings.posingFrequency || '');

  setValue('profileMacroTargets', goals.macroTargets || '');
  setValue('profileStepsTarget', goals.stepsTarget ?? '');
  setValue('profileCardioTarget', goals.cardioTarget || '');
  setValue('profileSleepTarget', goals.sleepTarget ?? '');
}

function getDefaultSettings() {
  if (typeof localStorage === 'undefined') {
    return { unit: 'kg', theme: 'light' };
  }
  return {
    unit: localStorage.getItem('defaultWeightUnit') || 'kg',
    theme: localStorage.getItem('theme') || 'light',
    streakReminderEnabled: false,
    streakReminderTime: '19:00',
    autoIncrement: localStorage.getItem('autoIncrementEnabled') !== 'false',
    profile: {
      athleteInfo: {},
      phaseSettings: {},
      goals: {}
    }
  };
}

function saveSettings(event) {
  if (event) event.preventDefault();

  const container = document.getElementById('settingsFormContainer') || document;
  const unitField = container.querySelector('#defaultUnit');
  const themeField = container.querySelector('#theme');
  const reminderEnabledField = container.querySelector('#streakReminderEnabled');
  const reminderTimeField = container.querySelector('#streakReminderTime');
  const autoIncrementField = container.querySelector('#autoIncrementSetting') || document.getElementById('autoIncrementToggle');

  const settings = {
    unit: unitField ? unitField.value : getDefaultSettings().unit,
    theme: themeField ? themeField.value : getDefaultSettings().theme,
    streakReminderEnabled: reminderEnabledField ? Boolean(reminderEnabledField.checked) : false,
    streakReminderTime: reminderTimeField && reminderTimeField.value ? reminderTimeField.value : '19:00',
    autoIncrement: autoIncrementField ? Boolean(autoIncrementField.checked) : getDefaultSettings().autoIncrement,
    profile: {
      athleteInfo: {
        name: container.querySelector('#athleteInfoName')?.value?.trim() || '',
        currentWeight: toNumberOrNull(container.querySelector('#athleteInfoCurrentWeight')?.value),
        height: container.querySelector('#athleteInfoHeight')?.value?.trim() || '',
        divisionClass: container.querySelector('#athleteInfoDivision')?.value?.trim() || ''
      },
      phaseSettings: {
        currentPhase: container.querySelector('#profileCurrentPhase')?.value || 'improvement',
        startDate: container.querySelector('#profileStartDate')?.value || null,
        showDate: container.querySelector('#profileShowDate')?.value || null,
        targetStageWeight: toNumberOrNull(container.querySelector('#profileTargetStageWeight')?.value),
        checkInDay: container.querySelector('#profileCheckInDay')?.value || 'Sunday',
        cardioBaseline: container.querySelector('#profileCardioBaseline')?.value?.trim() || '',
        posingFrequency: container.querySelector('#profilePosingFrequency')?.value?.trim() || ''
      },
      goals: {
        macroTargets: container.querySelector('#profileMacroTargets')?.value?.trim() || '',
        stepsTarget: toNumberOrNull(container.querySelector('#profileStepsTarget')?.value),
        cardioTarget: container.querySelector('#profileCardioTarget')?.value?.trim() || '',
        sleepTarget: toNumberOrNull(container.querySelector('#profileSleepTarget')?.value)
      }
    }
  };

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(getSettingsStorageKey(), JSON.stringify(settings));
  }
  applySettingsToUI(settings);
  renderProfileGamificationSummary(container);
  syncProfilePhaseSettings(settings.profile);

  if (typeof showToast === 'function') {
    showToast('Settings saved');
  } else if (typeof console !== 'undefined') {
    console.log('Settings saved');
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('traininglog:settings-saved', { detail: settings }));
  }
}

function syncProfilePhaseSettings(profile) {
  const phaseApi = getPhaseSetupApi();
  if (!phaseApi) return;
  const current = phaseApi.getCurrentPhaseState?.() || phaseApi.initializeDefaultPhaseState?.() || {};
  const next = {
    ...current,
    athleteName: profile?.athleteInfo?.name || current.athleteName || '',
    currentWeight: profile?.athleteInfo?.currentWeight ?? current.currentWeight,
    division: profile?.athleteInfo?.divisionClass || current.division || '',
    mode: profile?.phaseSettings?.currentPhase || current.mode || 'improvement',
    startDate: profile?.phaseSettings?.startDate || current.startDate || null,
    showDate: profile?.phaseSettings?.showDate || current.showDate || null,
    targetStageWeight: profile?.phaseSettings?.targetStageWeight ?? current.targetStageWeight,
    checkInDay: profile?.phaseSettings?.checkInDay || current.checkInDay || 'Sunday',
    cardioBaseline: profile?.phaseSettings?.cardioBaseline || current.cardioBaseline || '',
    posingFrequency: profile?.phaseSettings?.posingFrequency || current.posingFrequency || ''
  };
  phaseApi.saveCurrentPhaseState?.(null, next);
}

function hydrateProfileFromPhaseState(settings) {
  const phaseApi = getPhaseSetupApi();
  if (!phaseApi) return settings;
  const phaseState = phaseApi.getCurrentPhaseState?.() || phaseApi.initializeDefaultPhaseState?.();
  if (!phaseState) return settings;
  return {
    ...settings,
    profile: {
      ...(settings.profile || {}),
      athleteInfo: {
        ...((settings.profile && settings.profile.athleteInfo) || {}),
        name: settings.profile?.athleteInfo?.name || phaseState.athleteName || '',
        currentWeight: settings.profile?.athleteInfo?.currentWeight ?? phaseState.currentWeight,
        divisionClass: settings.profile?.athleteInfo?.divisionClass || phaseState.division || ''
      },
      phaseSettings: {
        ...((settings.profile && settings.profile.phaseSettings) || {}),
        currentPhase: settings.profile?.phaseSettings?.currentPhase || phaseState.mode || 'improvement',
        startDate: settings.profile?.phaseSettings?.startDate || phaseState.startDate || null,
        showDate: settings.profile?.phaseSettings?.showDate || phaseState.showDate || null,
        targetStageWeight: settings.profile?.phaseSettings?.targetStageWeight ?? phaseState.targetStageWeight,
        checkInDay: settings.profile?.phaseSettings?.checkInDay || phaseState.checkInDay || 'Sunday',
        cardioBaseline: settings.profile?.phaseSettings?.cardioBaseline || phaseState.cardioBaseline || '',
        posingFrequency: settings.profile?.phaseSettings?.posingFrequency || phaseState.posingFrequency || ''
      }
    }
  };
}

function renderProfileGamificationSummary(container = document) {
  const userId = getActiveUsername() || 'guest';
  const summary = typeof window.getGamificationSummary === 'function'
    ? window.getGamificationSummary(userId)
    : (typeof window.getGamificationState === 'function' ? window.getGamificationState(userId) : null);
  if (!summary) return;
  const level = summary.level ?? '—';
  const totalXp = summary.totalXp ?? '—';
  const streak = summary.streak ?? '—';
  const badges = Array.isArray(summary.badges) ? summary.badges.length : (summary.badgeCount ?? '—');

  const setText = (id, value) => {
    const el = container.querySelector(`#${id}`) || document.getElementById(id);
    if (el) el.textContent = String(value);
  };
  setText('profileGamificationLevel', level);
  setText('profileGamificationXp', totalXp);
  setText('profileGamificationStreak', streak);
  setText('profileGamificationBadges', badges);
}

function getProfileSnapshot() {
  const hydrated = hydrateProfileFromPhaseState({ ...getDefaultSettings(), ...readStoredSettings() });
  return hydrated.profile || {};
}

function getHydratedSettingsSnapshot() {
  return hydrateProfileFromPhaseState({ ...getDefaultSettings(), ...readStoredSettings() });
}

function formatProfileValue(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderSeasonArchiveMarkup({ phaseSettings, userId }) {
  const archive = window.checkinEngine?.buildSeasonArchive
    ? window.checkinEngine.buildSeasonArchive(
      {
        mode: phaseSettings.currentPhase,
        startDate: phaseSettings.startDate,
        prepStartDate: phaseSettings.prepStartDate || phaseSettings.startDate,
        showDate: phaseSettings.showDate
      },
      window.checkinEngine.loadCheckIns?.(userId) || []
    )
    : null;

  if (!archive || !Array.isArray(archive.timeline) || !archive.timeline.length) {
    return '<p class="season-archive-empty">Set a show date to unlock season archive milestones.</p>';
  }

  const timelineItems = archive.timeline.map((entry) => {
    const photoHookSummary = entry.photoHooks
      .map((hook) => `${hook.view}: ${hook.hasPhoto ? 'saved' : 'pending'}`)
      .join(' · ');
    return `
      <li class="season-archive-item">
        <div class="season-archive-row">
          <strong>${escapeHtml(entry.label)}</strong>
          <span>${escapeHtml(entry.date || 'TBD')}</span>
        </div>
        <div class="season-archive-meta">
          ${entry.hasLinkedCheckIn
      ? `Linked check-in: ${escapeHtml(entry.linkedCheckInDate)}${entry.linkedCheckInWeekLabel ? ` · ${escapeHtml(entry.linkedCheckInWeekLabel)}` : ''}`
      : 'Linked check-in: pending'}
        </div>
        <div class="season-archive-meta">Photo hooks: ${escapeHtml(photoHookSummary)}</div>
      </li>
    `;
  }).join('');

  const compareItems = archive.comparisons.map((item) => (
    `<li>${escapeHtml(item.label)} <em>(${escapeHtml(item.status)})</em></li>`
  )).join('');

  return `
    <div class="season-archive">
      <p class="season-archive-summary">
        ${archive.hasAnyLinkedCheckIn
      ? 'Season milestones are now tied to available check-ins and photo slots.'
      : 'Milestones are generated. Add check-ins to link each waypoint automatically.'}
      </p>
      <ol class="season-archive-list">${timelineItems}</ol>
      <h4>Comparison View Queue</h4>
      <ul class="season-archive-compare">${compareItems}</ul>
    </div>
  `;
}

function renderProfileTab() {
  const container = document.getElementById('profileTabContent');
  if (!container) return;

  const profile = getProfileSnapshot();
  const athleteInfo = profile.athleteInfo || {};
  const phaseSettings = profile.phaseSettings || {};
  const goals = profile.goals || {};
  const selectedPhase = phaseSettings.currentPhase || 'improvement';
  const selectedCheckInDay = phaseSettings.checkInDay || 'Sunday';
  const timelineLabel = getProfileTimelineLabel({
    ...phaseSettings,
    mode: phaseSettings.currentPhase,
    startDate: phaseSettings.startDate,
    showDate: phaseSettings.showDate
  });
  const userId = getActiveUsername() || 'guest';
  const summary = typeof window.getGamificationSummary === 'function'
    ? window.getGamificationSummary(userId)
    : (typeof window.getGamificationState === 'function' ? window.getGamificationState(userId) : null);

  container.innerHTML = `
    <section class="panel profile-section" aria-labelledby="profileAthleteInfoHeading">
      <h3 id="profileAthleteInfoHeading">Athlete Info</h3>
      <div class="profile-field-grid">
        <label>Name<input id="profileTabAthleteName" type="text" value="${escapeHtmlAttribute(formatProfileValue(athleteInfo.name, ''))}" disabled></label>
        <label>Current Weight<input id="profileTabCurrentWeight" type="number" min="0" step="0.1" value="${escapeHtmlAttribute(formatProfileValue(athleteInfo.currentWeight, ''))}" disabled></label>
        <label>Height<input id="profileTabHeight" type="text" value="${escapeHtmlAttribute(formatProfileValue(athleteInfo.height, ''))}" disabled></label>
        <label>Division / Class<input id="profileTabDivision" type="text" value="${escapeHtmlAttribute(formatProfileValue(athleteInfo.divisionClass, ''))}" disabled></label>
      </div>
    </section>
    <section class="panel profile-section" aria-labelledby="profilePhaseHeading">
      <h3 id="profilePhaseHeading">Phase / Prep Settings</h3>
      <div class="profile-field-grid">
        <label>Timeline label<input id="profileTabTimelineLabel" type="text" value="${escapeHtmlAttribute(formatProfileValue(timelineLabel, 'Improvement Season Week 1'))}" disabled></label>
        <label>Current phase
          <select id="profileTabCurrentPhase" disabled>
            <option value="improvement" ${selectedPhase === 'improvement' ? 'selected' : ''}>Improvement Season</option>
            <option value="mini_cut" ${selectedPhase === 'mini_cut' ? 'selected' : ''}>Mini Cut</option>
            <option value="contest_prep" ${selectedPhase === 'contest_prep' ? 'selected' : ''}>Contest Prep</option>
            <option value="peak_week" ${selectedPhase === 'peak_week' ? 'selected' : ''}>Peak Week</option>
            <option value="show_day" ${selectedPhase === 'show_day' ? 'selected' : ''}>Show Day</option>
            <option value="post_show" ${selectedPhase === 'post_show' ? 'selected' : ''}>Post-Show</option>
          </select>
        </label>
        <label>Phase start date<input id="profileTabStartDate" type="date" value="${escapeHtmlAttribute(formatProfileValue(phaseSettings.startDate, ''))}" disabled></label>
        <label>Show date<input id="profileTabShowDate" type="date" value="${escapeHtmlAttribute(formatProfileValue(phaseSettings.showDate, ''))}" disabled></label>
        <label>Target stage weight<input id="profileTabTargetStageWeight" type="number" min="0" step="0.1" value="${escapeHtmlAttribute(formatProfileValue(phaseSettings.targetStageWeight, ''))}" disabled></label>
        <label>Check-in day
          <select id="profileTabCheckInDay" disabled>
            ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => `<option value="${day}" ${selectedCheckInDay === day ? 'selected' : ''}>${day}</option>`).join('')}
          </select>
        </label>
        <label>Cardio baseline<input id="profileTabCardioBaseline" type="text" value="${escapeHtmlAttribute(formatProfileValue(phaseSettings.cardioBaseline, ''))}" disabled></label>
        <label>Posing frequency<input id="profileTabPosingFrequency" type="text" value="${escapeHtmlAttribute(formatProfileValue(phaseSettings.posingFrequency, ''))}" disabled></label>
      </div>
    </section>
    <section class="panel profile-section" aria-labelledby="profileGoalsHeading">
      <h3 id="profileGoalsHeading">Goals / Targets</h3>
      <div class="profile-field-grid">
        <label>Macro targets<input id="profileTabMacroTargets" type="text" value="${escapeHtmlAttribute(formatProfileValue(goals.macroTargets, ''))}" disabled></label>
        <label>Steps target<input id="profileTabStepsTarget" type="number" min="0" step="100" value="${escapeHtmlAttribute(formatProfileValue(goals.stepsTarget, ''))}" disabled></label>
        <label>Cardio target<input id="profileTabCardioTarget" type="text" value="${escapeHtmlAttribute(formatProfileValue(goals.cardioTarget, ''))}" disabled></label>
        <label>Sleep target<input id="profileTabSleepTarget" type="number" min="0" step="0.5" value="${escapeHtmlAttribute(formatProfileValue(goals.sleepTarget, ''))}" disabled></label>
      </div>
    </section>
    <section class="panel profile-section" aria-labelledby="profileGamificationHeading">
      <h3 id="profileGamificationHeading">Gamification Summary</h3>
      <div class="profile-summary-grid">
        <div><span>Level</span><strong>${formatProfileValue(summary?.level)}</strong></div>
        <div><span>XP</span><strong>${formatProfileValue(summary?.totalXp)}</strong></div>
        <div><span>Current Streak</span><strong>${formatProfileValue(summary?.streak)}</strong></div>
        <div><span>Badges Unlocked</span><strong>${formatProfileValue(Array.isArray(summary?.badges) ? summary.badges.length : summary?.badgeCount)}</strong></div>
      </div>
    </section>
    <section class="panel profile-section" aria-labelledby="profileSeasonArchiveHeading">
      <h3 id="profileSeasonArchiveHeading">Season Archive</h3>
      ${renderSeasonArchiveMarkup({ phaseSettings, userId })}
    </section>
    <section class="panel profile-section" aria-labelledby="profileSettingsShortcutsHeading">
      <h3 id="profileSettingsShortcutsHeading">App Settings shortcuts</h3>
      <div class="profile-edit-actions">
        <button type="button" id="profileEditButton">Edit Profile Hub</button>
        <button type="button" id="profileSaveButton" style="display:none;">Save</button>
        <button type="button" id="profileCancelButton" class="secondary" style="display:none;">Cancel</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="secondary" onclick="showTab('settingsTab')">Open Settings</button>
        <button type="button" class="secondary" onclick="showTab('macroTab')">Open Macro Targets</button>
        <button type="button" class="secondary" onclick="showTab('checkInTab')">Open Check-In</button>
      </div>
    </section>
  `;
  bindProfileTabEditing(container);
}

function bindProfileTabEditing(container) {
  const editButton = container.querySelector('#profileEditButton');
  const saveButton = container.querySelector('#profileSaveButton');
  const cancelButton = container.querySelector('#profileCancelButton');
  if (!editButton || !saveButton || !cancelButton) return;

  const editableFields = Array.from(container.querySelectorAll(
    '#profileTabAthleteName, #profileTabCurrentWeight, #profileTabHeight, #profileTabDivision, #profileTabCurrentPhase, #profileTabStartDate, #profileTabShowDate, #profileTabTargetStageWeight, #profileTabCheckInDay, #profileTabCardioBaseline, #profileTabPosingFrequency, #profileTabMacroTargets, #profileTabStepsTarget, #profileTabCardioTarget, #profileTabSleepTarget'
  ));

  const setEditingState = (isEditing) => {
    editableFields.forEach((field) => {
      field.disabled = !isEditing;
    });
    editButton.style.display = isEditing ? 'none' : 'inline-flex';
    saveButton.style.display = isEditing ? 'inline-flex' : 'none';
    cancelButton.style.display = isEditing ? 'inline-flex' : 'none';
  };

  editButton.addEventListener('click', () => setEditingState(true));
  cancelButton.addEventListener('click', () => renderProfileTab());
  saveButton.addEventListener('click', () => {
    const currentSettings = getHydratedSettingsSnapshot();
    const nextProfile = {
      athleteInfo: {
        name: container.querySelector('#profileTabAthleteName')?.value?.trim() || '',
        currentWeight: toNumberOrNull(container.querySelector('#profileTabCurrentWeight')?.value),
        height: container.querySelector('#profileTabHeight')?.value?.trim() || '',
        divisionClass: container.querySelector('#profileTabDivision')?.value?.trim() || ''
      },
      phaseSettings: {
        currentPhase: container.querySelector('#profileTabCurrentPhase')?.value || 'improvement',
        startDate: container.querySelector('#profileTabStartDate')?.value || null,
        showDate: container.querySelector('#profileTabShowDate')?.value || null,
        targetStageWeight: toNumberOrNull(container.querySelector('#profileTabTargetStageWeight')?.value),
        checkInDay: container.querySelector('#profileTabCheckInDay')?.value || 'Sunday',
        cardioBaseline: container.querySelector('#profileTabCardioBaseline')?.value?.trim() || '',
        posingFrequency: container.querySelector('#profileTabPosingFrequency')?.value?.trim() || ''
      },
      goals: {
        macroTargets: container.querySelector('#profileTabMacroTargets')?.value?.trim() || '',
        stepsTarget: toNumberOrNull(container.querySelector('#profileTabStepsTarget')?.value),
        cardioTarget: container.querySelector('#profileTabCardioTarget')?.value?.trim() || '',
        sleepTarget: toNumberOrNull(container.querySelector('#profileTabSleepTarget')?.value)
      }
    };

    const mergedSettings = {
      ...currentSettings,
      profile: {
        ...(currentSettings.profile || {}),
        ...nextProfile
      }
    };

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(getSettingsStorageKey(), JSON.stringify(mergedSettings));
    }
    syncProfilePhaseSettings(mergedSettings.profile);
    applySettingsToUI(mergedSettings);
    renderProfileTab();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('traininglog:settings-saved', { detail: mergedSettings }));
    }
    if (typeof showToast === 'function') showToast('Profile hub saved');
  });
}

function bindLogoutAction(container = document) {
  const logoutBtn = container.querySelector('#logoutBtn');
  if (!logoutBtn) return;
  logoutBtn.addEventListener('click', () => {
    if (typeof window.logout === 'function') {
      window.logout();
      return;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('fitnessAppUser');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('username');
    }
    if (typeof showToast === 'function') showToast('Logged out');
  });
}

function bindReminderToggle(container = document) {
  const reminderEnabledField = container.querySelector('#streakReminderEnabled');
  const reminderTimeField = container.querySelector('#streakReminderTime');
  if (!reminderEnabledField || !reminderTimeField) return;

  reminderEnabledField.addEventListener('change', () => {
    reminderTimeField.disabled = !reminderEnabledField.checked;
  });
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function getPhaseSetupApi() {
  if (typeof window === 'undefined' || !window.prepModeApi) return null;
  const api = window.prepModeApi;
  if (typeof api.getCurrentPhaseState !== 'function' || typeof api.saveCurrentPhaseState !== 'function') return null;
  return api;
}

function getProfileTimelineLabel(state, referenceDate = new Date().toISOString().slice(0, 10)) {
  if (!window.prepModeApi) return 'Improvement Season Week 1';
  const mode = String(state?.mode || state?.currentPhase || 'improvement').toLowerCase().replace(/\s+/g, '_');
  const payload = { ...(state || {}), referenceDate };
  if (mode === 'post_show') return window.prepModeApi.getPostShowLabel?.(payload) || 'Post-Show Week 1';
  if (mode === 'contest_prep' || mode === 'peak_week' || mode === 'show_day') {
    return window.prepModeApi.getPrepWeekLabel?.(payload) || 'Contest Prep Week 1';
  }
  if (mode === 'mini_cut') return window.prepModeApi.getImprovementSeasonLabel?.(payload) || 'Mini Cut Week 1';
  return window.prepModeApi.getImprovementSeasonLabel?.(payload) || 'Improvement Season Week 1';
}

function setFieldValue(container, selector, value) {
  const el = container.querySelector(selector);
  if (!el) return;
  el.value = value ?? '';
}

function updatePhaseSetupConditionalFields(container, mode) {
  const contestFields = container.querySelector('#contestPrepFields');
  const improvementFields = container.querySelector('#improvementFields');
  const miniCutFields = container.querySelector('#miniCutFields');
  const contestLikeMode = mode === 'contest_prep' || mode === 'peak_week' || mode === 'show_day' || mode === 'post_show';

  if (contestFields) contestFields.style.display = contestLikeMode ? 'block' : 'none';
  if (improvementFields) improvementFields.style.display = mode === 'improvement' ? 'block' : 'none';
  if (miniCutFields) miniCutFields.style.display = mode === 'mini_cut' ? 'block' : 'none';
}

function renderPhaseSetupSummary(container, state) {
  const summary = container.querySelector('#athleteSetupSummary');
  const cta = container.querySelector('#phaseSetupCta');
  if (!summary || !cta) return;

  if (!state || !state.mode) {
    summary.textContent = 'Set up prep mode details for phase-aware tracking.';
    cta.textContent = 'Set Up Prep Mode';
    return;
  }

  const athleteName = state.athleteName || 'Athlete';
  const modeLabel = (window.prepModeApi && typeof window.prepModeApi.getCurrentPhaseLabel === 'function')
    ? window.prepModeApi.getCurrentPhaseLabel(state)
    : state.mode;
  const timelineLabel = getProfileTimelineLabel(state);
  summary.textContent = `${athleteName}: ${modeLabel} · ${timelineLabel}`;
  cta.textContent = 'Edit Phase Setup';
}

function hydratePhaseSetupForm(container, state) {
  const form = container.querySelector('#athleteSetupForm');
  if (!form) return;

  const mode = state?.mode || 'improvement';
  setFieldValue(form, '#athleteName', state?.athleteName || '');
  setFieldValue(form, '#phaseMode', mode);

  setFieldValue(form, '#prepShowDate', state?.showDate || '');
  setFieldValue(form, '#prepDivision', state?.division || '');
  setFieldValue(form, '#prepCurrentWeight', state?.currentWeight ?? '');
  setFieldValue(form, '#prepStageWeight', state?.targetStageWeight ?? '');
  setFieldValue(form, '#prepCheckInDay', state?.checkInDay || 'Sunday');
  setFieldValue(form, '#prepCardioBaseline', state?.cardioBaseline || '');
  setFieldValue(form, '#prepPosingFrequency', state?.posingFrequency || '');

  setFieldValue(form, '#improvementStartDate', state?.startDate || '');
  setFieldValue(form, '#weightGoalDirection', state?.weightGoalDirection || '');

  setFieldValue(form, '#miniCutStartDate', state?.startDate || '');
  setFieldValue(form, '#miniCutRateLoss', state?.targetRateOfLoss ?? '');

  updatePhaseSetupConditionalFields(container, mode);
}

function bindPhaseSetup(container = document) {
  const form = container.querySelector('#athleteSetupForm');
  const cta = container.querySelector('#phaseSetupCta');
  const phaseMode = container.querySelector('#phaseMode');
  if (!form || !cta || !phaseMode) return;

  const phaseApi = getPhaseSetupApi();
  if (!phaseApi) {
    cta.disabled = true;
    cta.title = 'Prep mode API is unavailable in this environment.';
    return;
  }

  let state = phaseApi.getCurrentPhaseState?.() || phaseApi.initializeDefaultPhaseState?.() || null;
  renderPhaseSetupSummary(container, state);
  hydratePhaseSetupForm(container, state);

  cta.addEventListener('click', () => {
    const isHidden = form.style.display === 'none';
    form.style.display = isHidden ? 'block' : 'none';
  });

  phaseMode.addEventListener('change', () => {
    updatePhaseSetupConditionalFields(container, phaseMode.value || 'improvement');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const mode = phaseMode.value || 'improvement';
    const usesShowTimeline = mode === 'contest_prep' || mode === 'peak_week' || mode === 'show_day' || mode === 'post_show';
    const startDate = mode === 'mini_cut'
      ? form.querySelector('#miniCutStartDate')?.value
      : form.querySelector('#improvementStartDate')?.value;

    const payload = {
      ...state,
      athleteName: form.querySelector('#athleteName')?.value?.trim() || '',
      mode,
      startDate: startDate || null,
      showDate: usesShowTimeline ? form.querySelector('#prepShowDate')?.value || null : null,
      division: usesShowTimeline ? form.querySelector('#prepDivision')?.value?.trim() || '' : '',
      currentWeight: usesShowTimeline ? toNumberOrNull(form.querySelector('#prepCurrentWeight')?.value) : null,
      targetStageWeight: usesShowTimeline ? toNumberOrNull(form.querySelector('#prepStageWeight')?.value) : null,
      checkInDay: usesShowTimeline ? form.querySelector('#prepCheckInDay')?.value || 'Sunday' : 'Sunday',
      cardioBaseline: usesShowTimeline ? form.querySelector('#prepCardioBaseline')?.value?.trim() || '' : '',
      posingFrequency: usesShowTimeline ? form.querySelector('#prepPosingFrequency')?.value?.trim() || '' : '',
      weightGoalDirection: mode === 'improvement' ? form.querySelector('#weightGoalDirection')?.value || '' : '',
      targetRateOfLoss: mode === 'mini_cut' ? toNumberOrNull(form.querySelector('#miniCutRateLoss')?.value) : null
    };

    state = phaseApi.saveCurrentPhaseState?.(null, payload) || payload;
    renderPhaseSetupSummary(container, state);
    form.style.display = 'none';

    if (typeof showToast === 'function') {
      showToast('Athlete setup saved');
    }
  });
}

function injectSettingsMarkup() {
  const container = document.getElementById('settingsFormContainer');
  if (!container || container.dataset.loaded === 'true' || container.dataset.loaded === 'loading') {
    applySettingsToUI(hydrateProfileFromPhaseState({ ...getDefaultSettings(), ...readStoredSettings() }));
    return;
  }

  if (typeof fetch !== 'function') {
    console.warn('Fetch API is unavailable; rendering static settings form.');
    container.innerHTML = '<p class="form-error">Settings form unavailable in this environment.</p>';
    applySettingsToUI({ ...getDefaultSettings(), ...readStoredSettings() });
    return;
  }

  container.dataset.loaded = 'loading';

  fetch('src/html/settings.html')
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .then(html => {
      container.innerHTML = html;
      container.dataset.loaded = 'true';
      const form = container.querySelector('#settingsForm');
      if (form) {
        form.addEventListener('submit', saveSettings);
      }
      bindReminderToggle(container);
      bindLogoutAction(container);
      const hydrated = hydrateProfileFromPhaseState({ ...getDefaultSettings(), ...readStoredSettings() });
      applySettingsToUI(hydrated);
      renderProfileGamificationSummary(container);
    })
    .catch(error => {
      console.error('Failed to load settings page', error);
      container.innerHTML = '<p class="form-error">Unable to load settings at this time.</p>';
      delete container.dataset.loaded;
    });
}

function initializeSettingsFeature() {
  injectSettingsMarkup();
  applySettingsToUI(hydrateProfileFromPhaseState({ ...getDefaultSettings(), ...readStoredSettings() }));
  renderProfileTab();
}

document.addEventListener('DOMContentLoaded', initializeSettingsFeature);
window.addEventListener('traininglog:settings-saved', renderProfileTab);

window.initSettingsPage = injectSettingsMarkup;
window.saveSettings = saveSettings;
window.getStoredUserSettings = readStoredSettings;
window.getDefaultUserSettings = getDefaultSettings;
window.bindPhaseSetup = bindPhaseSetup;
window.renderProfileTab = renderProfileTab;
window.dispatchEvent(new CustomEvent('traininglog:settings-ready'));
