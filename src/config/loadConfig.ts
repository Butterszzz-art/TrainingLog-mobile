const DEFAULT_SERVER_URL = 'https://traininglog-backend.onrender.com';

declare global {
  interface Window {
    SERVER_URL?: string;
    appConfig?: Record<string, unknown>;
    airtableConfig?: {
      airtableToken?: string;
      airtableBaseId?: string;
    };
  }
}

function resolveServerUrl(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_SERVER_URL;
  }
  if (window.SERVER_URL && typeof window.SERVER_URL === 'string') {
    return window.SERVER_URL;
  }
  window.SERVER_URL = DEFAULT_SERVER_URL;
  return window.SERVER_URL;
}

export async function loadConfig(): Promise<Record<string, unknown>> {
  const serverUrl = resolveServerUrl();
  const res = await fetch(`${serverUrl}/config`);
  const config = await res.json();

  if (typeof window !== 'undefined') {
    window.appConfig = config;

    if (typeof (config as { serverUrl?: string }).serverUrl === 'string' && (config as { serverUrl?: string }).serverUrl) {
      window.SERVER_URL = (config as { serverUrl?: string }).serverUrl;
    }

    const airtableBaseId = (config as { airtableBaseId?: string }).airtableBaseId;
    const airtableToken = (config as { airtableToken?: string }).airtableToken;
    if (airtableBaseId || airtableToken) {
      window.airtableConfig = {
        ...(window.airtableConfig || {}),
        ...(airtableBaseId ? { airtableBaseId } : {}),
        ...(airtableToken ? { airtableToken } : {})
      };
    }
  }

  return config as Record<string, unknown>;
}
