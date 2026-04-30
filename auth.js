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

function clearAuthState() {
  const storage = resolveStorage();
  storage.removeItem('token');
  storage.removeItem('authToken');
  storage.removeItem('fitnessAppUser');
}

function isInvalidSignatureError(value) {
  const message = typeof value === 'string'
    ? value
    : (value?.message || value?.error?.message || value?.error || '');

  return /invalid\s+signature/i.test(String(message));
}

function forceLogoutDueToInvalidToken() {
  clearAuthState();
  if (typeof window !== 'undefined' && typeof window.logout === 'function') {
    window.logout({ suppressReload: true });
  }
  if (typeof window !== 'undefined') {
    window.alert('Your session token is invalid. Please log in again to get a new token.');
  }
}

function getAuthHeaders() {
  const storage = resolveStorage();
  const token = storage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getActiveUsername() {
  const storage = resolveStorage();
  return (
    globalThis.currentUser?.username ||
    globalThis.currentUser?.userId ||
    globalThis.currentUser ||
    storage.getItem('username') ||
    storage.getItem('Username') ||
    null
  );
}

function persistLoginIdentity(username, token) {
  const storage = resolveStorage();
  if (username) {
    const normalizedUsername = String(username);
    storage.setItem('username', normalizedUsername);
    storage.setItem('Username', normalizedUsername);
  }

  storage.removeItem('token');
  storage.removeItem('authToken');
  if (token) {
    storage.setItem('token', String(token));
    storage.setItem('authToken', String(token));
  }
}

async function login(username, password, serverUrl) {
  const url = `${resolveServerUrl(serverUrl)}/login`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(5000)
  });

  const data = await parseJsonResponse(response);
  if (isInvalidSignatureError(data)) {
    forceLogoutDueToInvalidToken();
    throw new Error('Invalid token signature. Logged out; please sign in again.');
  }

  if (data && data.token) {
    persistLoginIdentity(username, data.token);
  }

  return data;
}

async function fetchProtected(serverUrl) {
  const url = `${resolveServerUrl(serverUrl)}/protected-route`;
  const response = await fetch(url, {
    headers: getAuthHeaders(),
    signal: AbortSignal.timeout(5000)
  });

  const data = await parseJsonResponse(response);
  if (isInvalidSignatureError(data)) {
    forceLogoutDueToInvalidToken();
    throw new Error('Invalid token signature. Logged out; please sign in again.');
  }

  if (!response.ok) {
    throw new Error('Unauthorized or forbidden');
  }

  return data;
}

async function loadTemplates(username, serverUrl) {
  const url = `${resolveServerUrl(serverUrl)}/templates?username=${encodeURIComponent(username)}`;
  const response = await fetch(url, {
    headers: getAuthHeaders(),
    signal: AbortSignal.timeout(5000)
  });

  const data = await parseJsonResponse(response);
  if (isInvalidSignatureError(data)) {
    forceLogoutDueToInvalidToken();
    throw new Error('Invalid token signature. Logged out; please sign in again.');
  }

  if (!data.success) {
    throw new Error(data.message || 'Failed to load templates');
  }

  return data.templates;
}

if (typeof module !== 'undefined') {
  module.exports = { login, fetchProtected, loadTemplates, getAuthHeaders, getActiveUsername, persistLoginIdentity, clearAuthState, isInvalidSignatureError, forceLogoutDueToInvalidToken };
}

if (typeof window !== 'undefined') {
  window.login = login;
  window.fetchProtected = fetchProtected;
  window.loadTemplates = loadTemplates;
  window.getAuthHeaders = getAuthHeaders;
  window.getActiveUsername = getActiveUsername;
  window.persistLoginIdentity = persistLoginIdentity;
  window.clearAuthState = clearAuthState;
  window.isInvalidSignatureError = isInvalidSignatureError;
  window.forceLogoutDueToInvalidToken = forceLogoutDueToInvalidToken;
}
