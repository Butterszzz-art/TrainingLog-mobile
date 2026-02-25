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
