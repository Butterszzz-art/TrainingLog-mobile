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
}

function getDefaultSettings() {
  if (typeof localStorage === 'undefined') {
    return { unit: 'kg', theme: 'light' };
  }
  return {
    unit: localStorage.getItem('defaultWeightUnit') || 'kg',
    theme: localStorage.getItem('theme') || 'light'
  };
}

function saveSettings(event) {
  if (event) event.preventDefault();

  const container = document.getElementById('settingsFormContainer') || document;
  const unitField = container.querySelector('#defaultUnit');
  const themeField = container.querySelector('#theme');

  const settings = {
    unit: unitField ? unitField.value : getDefaultSettings().unit,
    theme: themeField ? themeField.value : getDefaultSettings().theme
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
