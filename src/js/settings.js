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
    autoIncrement: localStorage.getItem('autoIncrementEnabled') !== 'false'
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
    autoIncrement: autoIncrementField ? Boolean(autoIncrementField.checked) : getDefaultSettings().autoIncrement
  };

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(getSettingsStorageKey(), JSON.stringify(settings));
  }
  applySettingsToUI(settings);

  if (typeof showToast === 'function') {
    showToast('Settings saved');
  } else if (typeof console !== 'undefined') {
    console.log('Settings saved');
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('traininglog:settings-saved', { detail: settings }));
  }
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

function setFieldValue(container, selector, value) {
  const el = container.querySelector(selector);
  if (!el) return;
  el.value = value ?? '';
}

function updatePhaseSetupConditionalFields(container, mode) {
  const contestFields = container.querySelector('#contestPrepFields');
  const improvementFields = container.querySelector('#improvementFields');
  const miniCutFields = container.querySelector('#miniCutFields');

  if (contestFields) contestFields.style.display = mode === 'contest_prep' ? 'block' : 'none';
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
  summary.textContent = `${athleteName}: ${modeLabel}`;
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
    const startDate = mode === 'mini_cut'
      ? form.querySelector('#miniCutStartDate')?.value
      : form.querySelector('#improvementStartDate')?.value;

    const payload = {
      ...state,
      athleteName: form.querySelector('#athleteName')?.value?.trim() || '',
      mode,
      startDate: startDate || null,
      showDate: mode === 'contest_prep' ? form.querySelector('#prepShowDate')?.value || null : null,
      division: mode === 'contest_prep' ? form.querySelector('#prepDivision')?.value?.trim() || '' : '',
      currentWeight: mode === 'contest_prep' ? toNumberOrNull(form.querySelector('#prepCurrentWeight')?.value) : null,
      targetStageWeight: mode === 'contest_prep' ? toNumberOrNull(form.querySelector('#prepStageWeight')?.value) : null,
      checkInDay: mode === 'contest_prep' ? form.querySelector('#prepCheckInDay')?.value || 'Sunday' : 'Sunday',
      cardioBaseline: mode === 'contest_prep' ? form.querySelector('#prepCardioBaseline')?.value?.trim() || '' : '',
      posingFrequency: mode === 'contest_prep' ? form.querySelector('#prepPosingFrequency')?.value?.trim() || '' : '',
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
    applySettingsToUI({ ...getDefaultSettings(), ...readStoredSettings() });
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
      bindPhaseSetup(container);
      applySettingsToUI({ ...getDefaultSettings(), ...readStoredSettings() });
    })
    .catch(error => {
      console.error('Failed to load settings page', error);
      container.innerHTML = '<p class="form-error">Unable to load settings at this time.</p>';
      delete container.dataset.loaded;
    });
}

function initializeSettingsFeature() {
  injectSettingsMarkup();
  applySettingsToUI({ ...getDefaultSettings(), ...readStoredSettings() });
}

document.addEventListener('DOMContentLoaded', initializeSettingsFeature);

window.initSettingsPage = injectSettingsMarkup;
window.saveSettings = saveSettings;
window.getStoredUserSettings = readStoredSettings;
window.getDefaultUserSettings = getDefaultSettings;
window.bindPhaseSetup = bindPhaseSetup;
