import { DEFAULT_SERVER_URL } from "./constants";

declare global {
  interface Window {
    SERVER_URL?: string;
    appConfig?: Record<string, unknown>;
    TrainingLogConfig?: {
      DEFAULT_SERVER_URL?: string;
    };
    airtableConfig?: {
      airtableToken?: string;
      airtableBaseId?: string;
    };
  }
}

function getDefaultServerUrl(): string {
  if (typeof window !== 'undefined' && window.TrainingLogConfig?.DEFAULT_SERVER_URL) {
    return window.TrainingLogConfig.DEFAULT_SERVER_URL;
  }

  return DEFAULT_SERVER_URL;
}

function resolveServerUrl(): string {
  if (typeof window === 'undefined') {
    return getDefaultServerUrl();
  }
  if (window.SERVER_URL && typeof window.SERVER_URL === 'string') {
    return window.SERVER_URL;
  }
  window.SERVER_URL = getDefaultServerUrl();
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
