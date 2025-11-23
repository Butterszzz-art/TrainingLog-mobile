// Authentication and template-loading helpers that can run in Node or the browser.

function resolveServerUrl(override) {
  if (override) return override;
  if (typeof globalThis !== 'undefined' && globalThis.SERVER_URL) {
    return globalThis.SERVER_URL;
  }
  if (typeof window !== 'undefined' && window.SERVER_URL) {
    return window.SERVER_URL;
  }
  throw new Error('SERVER_URL is not configured');
}

function resolveStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  throw new Error('localStorage is not available');
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error('Invalid JSON response from server');
  }
}

async function login(username, password, serverUrl) {
  const url = `${resolveServerUrl(serverUrl)}/login`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await parseJsonResponse(response);
  if (!data.success) {
    throw new Error(data.message || 'Login failed');
  }

  const storage = resolveStorage();
  if (data.token) {
    storage.setItem('token', data.token);
  }

  return data.token;
}

async function fetchProtected(serverUrl) {
  const storage = resolveStorage();
  const token = storage.getItem('token');
  if (!token) {
    throw new Error('No token available');
  }

  const url = `${resolveServerUrl(serverUrl)}/protected-route`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw new Error('Unauthorized or forbidden');
  }

  return parseJsonResponse(response);
}

async function loadTemplates(username, serverUrl) {
  const storage = resolveStorage();
  const token = storage.getItem('token');
  if (!token) {
    throw new Error('No token available');
  }

  const url = `${resolveServerUrl(serverUrl)}/templates?username=${encodeURIComponent(username)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await parseJsonResponse(response);
  if (!data.success) {
    throw new Error(data.message || 'Failed to load templates');
  }

  return data.templates;
}

if (typeof module !== 'undefined') {
  module.exports = { login, fetchProtected, loadTemplates };
}

if (typeof window !== 'undefined') {
  window.login = login;
  window.fetchProtected = fetchProtected;
  window.loadTemplates = loadTemplates;
}
