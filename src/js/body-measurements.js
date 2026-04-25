/* =============================================================
   BODY MEASUREMENTS TRACKER
   Neck, Shoulders, Chest, Waist, Hips, Left Arm, Left Thigh
   Stored per user in localStorage; Chart.js trend line.
   ============================================================= */

(function initMeasurements() {
  'use strict';

  const KEY_PREFIX = 'bodyMeasurements_';
  const FIELDS = [
    { key: 'neck',      label: 'Neck (cm)' },
    { key: 'shoulders', label: 'Shoulders (cm)' },
    { key: 'chest',     label: 'Chest (cm)' },
    { key: 'waist',     label: 'Waist (cm)' },
    { key: 'hips',      label: 'Hips (cm)' },
    { key: 'arm',       label: 'Arm (cm)' },
    { key: 'thigh',     label: 'Thigh (cm)' },
  ];

  const COLORS = {
    neck: '#4da8da', shoulders: '#a78bfa', chest: '#f0a040',
    waist: '#eb5757', hips: '#5fa87e', arm: '#6fcf97', thigh: '#f472b6',
  };

  /* ── Storage ─────────────────────────────────────────────── */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') ||
      localStorage.getItem('Username') || null;
  }

  function _key(username) { return KEY_PREFIX + username; }

  function loadMeasurements(username) {
    try { return JSON.parse(localStorage.getItem(_key(username))) || []; }
    catch { return []; }
  }

  function saveMeasurements(username, data) {
    localStorage.setItem(_key(username), JSON.stringify(data));
  }

  /* ── Save new entry ──────────────────────────────────────── */

  window.saveMeasurement = function () {
    const username = _user();
    if (!username) return;

    const dateEl = document.getElementById('measureDate');
    const date   = dateEl?.value || new Date().toISOString().slice(0, 10);

    const entry = { date };
    FIELDS.forEach(f => {
      const val = parseFloat(document.getElementById('measure_' + f.key)?.value);
      if (!isNaN(val) && val > 0) entry[f.key] = val;
    });

    if (Object.keys(entry).length <= 1) {
      alert('Enter at least one measurement.');
      return;
    }

    const all = loadMeasurements(username);
    // Replace existing entry for same date, or append
    const idx = all.findIndex(e => e.date === date);
    if (idx >= 0) all[idx] = entry; else all.push(entry);
    all.sort((a, b) => a.date.localeCompare(b.date));
    saveMeasurements(username, all);

    // Clear inputs
    FIELDS.forEach(f => {
      const el = document.getElementById('measure_' + f.key);
      if (el) el.value = '';
    });

    renderMeasurementsHistory();
    renderMeasurementsChart(document.getElementById('_activeMetric') || 'waist');
    showMeasurementToast('📏 Measurements saved!');
  };

  /* ── Render history table ────────────────────────────────── */

  function renderMeasurementsHistory() {
    const host = document.getElementById('measurementsHistory');
    if (!host) return;

    const username = _user();
    const all = username ? loadMeasurements(username) : [];

    if (!all.length) {
      host.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted,#7a8f7d);text-align:center;padding:10px 0;">No measurements logged yet.</p>';
      return;
    }

    // Show last 10, newest first
    const rows = all.slice().reverse().slice(0, 10);
    const headers = ['Date', ...FIELDS.map(f => f.label.replace(' (cm)', ''))];

    host.innerHTML = `
      <table class="measurements-history-table">
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.date}</td>
              ${FIELDS.map(f => `<td>${r[f.key] != null ? r[f.key] : '–'}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  /* ── Chart ───────────────────────────────────────────────── */

  let _chart = null;
  window._activeMetric = 'waist';

  function renderMeasurementsChart(metric) {
    window._activeMetric = metric;

    // Update pill active state
    document.querySelectorAll('.measurements-metric-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.metric === metric);
    });

    const canvas = document.getElementById('measurementsCanvas');
    if (!canvas) return;

    const username = _user();
    const all = username ? loadMeasurements(username) : [];

    if (_chart) { _chart.destroy(); _chart = null; }
    if (!all.length) return;

    const labels = all.map(e => e.date);
    const values = all.map(e => e[metric] ?? null);
    const color  = COLORS[metric] || '#5fa87e';

    _chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: FIELDS.find(f => f.key === metric)?.label || metric,
          data: values,
          borderColor: color,
          backgroundColor: color + '22',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: color,
          spanGaps: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: '#7a8f7d', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            ticks: { color: '#7a8f7d', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
    });
  }

  window.renderMeasurementsChart = renderMeasurementsChart;

  /* ── Toast ───────────────────────────────────────────────── */

  function showMeasurementToast(msg) {
    let el = document.getElementById('_measureToast');
    if (!el) {
      el = document.createElement('div');
      el.id = '_measureToast';
      Object.assign(el.style, {
        position: 'fixed', bottom: '80px', left: '50%',
        transform: 'translateX(-50%) translateY(10px)',
        background: 'var(--card-bg,#0f1510)',
        border: '1px solid var(--primary,#5fa87e)',
        borderRadius: '10px', padding: '10px 20px',
        fontSize: '0.82rem', color: 'var(--primary,#5fa87e)',
        fontWeight: '600', fontFamily: "'Poppins',sans-serif",
        zIndex: '1500', whiteSpace: 'nowrap',
        opacity: '0', transition: 'opacity 0.3s, transform 0.3s',
        pointerEvents: 'none',
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(10px)';
    }, 3000);
  }

  /* ── Boot ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      renderMeasurementsHistory();
      renderMeasurementsChart('waist');
    }, 1000);
  });

  window.renderMeasurementsHistory = renderMeasurementsHistory;
  window.loadMeasurements          = loadMeasurements;

})();
