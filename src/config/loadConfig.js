const DEFAULT_SERVER_URL =
  (typeof window !== 'undefined' &&
    window.TrainingLogConfig &&
    window.TrainingLogConfig.DEFAULT_SERVER_URL) ||
  (typeof require === 'function' && require('./constants').DEFAULT_SERVER_URL);

function resolveServerUrl() {
  if (typeof window === 'undefined') {
    return DEFAULT_SERVER_URL;
  }
  if (window.SERVER_URL && typeof window.SERVER_URL === 'string') {
    return window.SERVER_URL;
  }
  window.SERVER_URL = DEFAULT_SERVER_URL;
  return window.SERVER_URL;
}

async function loadConfig() {
  const serverUrl = resolveServerUrl();
  const res = await fetch(`${serverUrl}/config`);
  const config = await res.json();

  if (typeof window !== 'undefined') {
    window.appConfig = config;

    if (typeof config.serverUrl === 'string' && config.serverUrl.length) {
      window.SERVER_URL = config.serverUrl;
    }

    if (config.airtableBaseId || config.airtableToken) {
      window.airtableConfig = {
        ...(window.airtableConfig || {}),
        ...(config.airtableBaseId ? { airtableBaseId: config.airtableBaseId } : {}),
        ...(config.airtableToken ? { airtableToken: config.airtableToken } : {})
      };
    }
  }

  return config;
}

if (typeof module !== 'undefined') {
  module.exports = { loadConfig };
}

if (typeof window !== 'undefined') {
  window.loadConfig = loadConfig;
}
