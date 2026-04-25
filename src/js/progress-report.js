/* =============================================================
   PROGRESS REPORT
   Generates a print-ready HTML report summarising the user's
   fitness data: workouts, PRs, body measurements, readiness,
   weight trend, and macro compliance.
   Opens a new window and triggers window.print().
   ============================================================= */

(function initProgressReport() {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────── */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') || '';
  }

  function _parse(k) {
    try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; }
  }

  function _last30Days() {
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 29);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }

  function _inRange(dateStr, { start, end }) {
    return dateStr >= start && dateStr <= end;
  }

  /* ── Data gathering ──────────────────────────────────────── */

  function _gatherData(username) {
    const range       = _last30Days();
    const workouts    = _parse(`workouts_${username}`) || [];
    const prBoard     = _parse(`prBoard_${username}`)  || {};
    const readiness   = _parse('dailyReadiness_v1')     || {};
    const measurements= _parse(`bodyMeasurements_${username}`) || [];
    const weightLog   = _parse(`weightLog_${username}`) || _parse('weightEntries') || [];
    const targets     = _parse(`macroTargets_${username}`) || {};

    // Workouts in range
    const recentWorkouts = workouts.filter(w => _inRange(w.date || '', range));
    let totalVolume = 0, totalSets = 0;
    for (const w of recentWorkouts) {
      for (const e of (w.log || [])) {
        const weights = e.weightsArray || [];
        const reps    = e.repsArray    || [];
        for (let i = 0; i < reps.length; i++) {
          const vol = (+weights[i] || 0) * (+reps[i] || 0);
          if (vol > 0) { totalVolume += vol; totalSets++; }
        }
      }
    }

    // Top 5 PRs by e1RM
    const topPRs = Object.entries(prBoard)
      .map(([exercise, pr]) => ({ exercise, ...pr }))
      .sort((a, b) => (b.e1rm || 0) - (a.e1rm || 0))
      .slice(0, 5);

    // Readiness in range
    const readinessEntries = Object.entries(readiness)
      .filter(([k, v]) => !v.skipped && _inRange(new Date(k).toISOString?.().slice(0, 10) || k, range));
    const avgReadiness = readinessEntries.length
      ? Math.round(readinessEntries.reduce((s, [, v]) => s + v.score, 0) / readinessEntries.length)
      : null;

    // Weight trend (last 10 entries in range)
    const recentWeight = weightLog
      .filter(e => _inRange(e.date || '', range))
      .slice(-10);

    // Latest measurements
    const latestMeasure = measurements.length ? measurements[measurements.length - 1] : null;

    // Streak
    const workedDates = new Set(workouts.map(w => w.date).filter(Boolean));
    let streak = 0;
    let check = new Date();
    check.setHours(0, 0, 0, 0);
    while (workedDates.has(check.toISOString().slice(0, 10))) {
      streak++;
      check.setDate(check.getDate() - 1);
    }

    return {
      username,
      range,
      generatedAt:     new Date().toLocaleString(),
      workoutCount:    recentWorkouts.length,
      totalVolume:     Math.round(totalVolume),
      totalSets,
      avgFrequency:    +(recentWorkouts.length / 4.3).toFixed(1),
      topPRs,
      avgReadiness,
      readinessCount:  readinessEntries.length,
      recentWeight,
      latestMeasure,
      streak,
      calTarget:       targets.calories || 0,
      proteinTarget:   targets.protein || 0,
    };
  }

  /* ── HTML report template ─────────────────────────────────── */

  function _buildReportHTML(d) {
    const NA = '<span style="color:#aaa">N/A</span>';

    const prRows = d.topPRs.length
      ? d.topPRs.map(p => `
          <tr>
            <td>${p.exercise}</td>
            <td>${p.weight ?? '—'} ${p.unit || 'kg'} × ${p.reps ?? '—'}</td>
            <td><strong>${p.e1rm ?? '—'} ${p.unit || 'kg'}</strong></td>
            <td>${p.date || '—'}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="4" style="text-align:center;color:#aaa">No PRs recorded yet</td></tr>`;

    const weightRows = d.recentWeight.length
      ? d.recentWeight.map(e => `<tr><td>${e.date}</td><td>${e.weight || e.kg || '—'} kg</td></tr>`).join('')
      : `<tr><td colspan="2" style="text-align:center;color:#aaa">No weight entries</td></tr>`;

    const mFields = ['neck','shoulders','chest','waist','hips','arm','thigh'];
    const measureRows = d.latestMeasure
      ? mFields.filter(f => d.latestMeasure[f] != null).map(f => `
          <tr>
            <td style="text-transform:capitalize">${f}</td>
            <td>${d.latestMeasure[f]} cm</td>
          </tr>
        `).join('')
      : `<tr><td colspan="2" style="text-align:center;color:#aaa">No measurements logged</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pocket Coach — Progress Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #fff;
      color: #1a1a1a;
      padding: 32px 40px;
      max-width: 900px;
      margin: 0 auto;
    }
    h1 { font-size: 1.8rem; color: #2e7d55; margin-bottom: 4px; }
    h2 { font-size: 1.1rem; color: #2e7d55; margin: 24px 0 10px; border-bottom: 2px solid #2e7d55; padding-bottom: 4px; }
    .meta { font-size: 0.85rem; color: #666; margin-bottom: 24px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    .stat-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; text-align: center; }
    .stat-val { font-size: 1.6rem; font-weight: 700; color: #2e7d55; display: block; }
    .stat-lbl { font-size: 0.75rem; color: #666; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-bottom: 8px; }
    th { background: #f0faf4; color: #2e7d55; text-align: left; padding: 8px 10px; border-bottom: 2px solid #c8e6c9; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; }
    tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
    .badge-green { background: #e8f5e9; color: #2e7d55; }
    .badge-amber { background: #fff8e1; color: #f57f17; }
    .badge-red   { background: #ffebee; color: #c62828; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .footer { margin-top: 32px; font-size: 0.75rem; color: #aaa; text-align: center; border-top: 1px solid #eee; padding-top: 12px; }
    @media print {
      body { padding: 16px 20px; }
      .no-print { display: none; }
      @page { margin: 15mm; }
    }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()"
    style="float:right;padding:8px 20px;background:#2e7d55;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9rem;">
    🖨️ Print / Save PDF
  </button>
  <h1>📊 Progress Report</h1>
  <p class="meta">
    Athlete: <strong>${d.username}</strong> &nbsp;·&nbsp;
    Period: ${d.range.start} → ${d.range.end} (last 30 days) &nbsp;·&nbsp;
    Generated: ${d.generatedAt}
  </p>

  <h2>Overview</h2>
  <div class="stats-grid">
    <div class="stat-box">
      <span class="stat-val">${d.workoutCount}</span>
      <span class="stat-lbl">Workouts</span>
    </div>
    <div class="stat-box">
      <span class="stat-val">${d.totalVolume >= 1000 ? (d.totalVolume / 1000).toFixed(1) + 'k' : d.totalVolume}</span>
      <span class="stat-lbl">kg Total Volume</span>
    </div>
    <div class="stat-box">
      <span class="stat-val">${d.avgFrequency}×</span>
      <span class="stat-lbl">Sessions / week</span>
    </div>
    <div class="stat-box">
      <span class="stat-val">${d.streak > 0 ? '🔥 ' + d.streak : d.streak}</span>
      <span class="stat-lbl">Current streak (days)</span>
    </div>
  </div>

  <div class="two-col">
    <div>
      <h2>🏆 Top Personal Records</h2>
      <table>
        <thead><tr><th>Exercise</th><th>Best Set</th><th>Est. 1RM</th><th>Date</th></tr></thead>
        <tbody>${prRows}</tbody>
      </table>

      <h2>😴 Readiness</h2>
      <table>
        <tbody>
          <tr><td>Check-ins logged (30d)</td><td><strong>${d.readinessCount}</strong></td></tr>
          <tr><td>Average score</td>
            <td><strong>${d.avgReadiness !== null
              ? `<span class="badge ${d.avgReadiness >= 67 ? 'badge-green' : d.avgReadiness >= 40 ? 'badge-amber' : 'badge-red'}">${d.avgReadiness}%</span>`
              : 'N/A'}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div>
      <h2>⚖️ Weight Log (last 10)</h2>
      <table>
        <thead><tr><th>Date</th><th>Weight</th></tr></thead>
        <tbody>${weightRows}</tbody>
      </table>

      <h2>📏 Latest Measurements</h2>
      ${d.latestMeasure ? `<p style="font-size:0.8rem;color:#888;margin-bottom:6px;">Logged: ${d.latestMeasure.date}</p>` : ''}
      <table>
        <thead><tr><th>Site</th><th>Value</th></tr></thead>
        <tbody>${measureRows}</tbody>
      </table>
    </div>
  </div>

  ${d.calTarget > 0 ? `
  <h2>🥗 Nutrition Targets</h2>
  <table>
    <tbody>
      <tr><td>Calories</td><td><strong>${d.calTarget} kcal</strong></td></tr>
      <tr><td>Protein</td><td><strong>${d.proteinTarget}g</strong></td></tr>
    </tbody>
  </table>` : ''}

  <div class="footer">
    Generated by Pocket Coach &nbsp;·&nbsp; pocketcoach.app
  </div>
</body>
</html>`;
  }

  /* ── Public API ──────────────────────────────────────────── */

  window.generateProgressReport = function () {
    const username = _user();
    if (!username) { alert('Please log in first.'); return; }

    const data = _gatherData(username);
    const html = _buildReportHTML(data);

    const win = window.open('', '_blank', 'width=960,height=800,scrollbars=yes');
    if (!win) {
      alert('Pop-up blocked. Please allow pop-ups for this site and try again.');
      return;
    }
    win.document.write(html);
    win.document.close();
    // Auto-focus so user can immediately press print or Ctrl+P
    win.focus();
  };

})();
