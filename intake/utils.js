// Small helpers shared by the client-facing page and the coach dashboard.

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmt(n, decimals = 0) {
  if (n == null || Number.isNaN(n)) return '–';
  return Number(n).toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function num(value, fallback = null) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

export function downloadJson(bestandsnaam, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bestandsnaam;
  a.click();
  URL.revokeObjectURL(url);
}
