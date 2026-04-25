/* =============================================================
   DATA EXPORT
   Exports workout history, weight log, macro logs, and body
   measurements as CSV files; full data dump as JSON.
   Also hooks rest-timer completion → Web Notification.
   ============================================================= */

(function initDataExport() {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────── */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') ||
      localStorage.getItem('Username') || null;
  }

  function _parse(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; }
    catch { return null; }
  }

  function _downloadCSV(filename, rows) {
    const csv  = rows.map(r => r.map(_cell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function _cell(v) {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  }

  function _dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  /* ── Export: Workouts ────────────────────────────────────── */

  window.exportWorkoutsCSV = function () {
    const username = _user();
    if (!username) { alert('Log in first.'); return; }

    const workouts = _parse('workouts_' + username) || [];
    if (!workouts.length) { alert('No workouts to export.'); return; }

    const rows = [['Date', 'Exercise', 'Set', 'Reps', 'Weight', 'Unit', 'RPE']];

    for (const w of workouts) {
      const log = Array.isArray(w.log) ? w.log : [];
      for (const entry of log) {
        const name     = entry.exercise || entry.name || '';
        const reps     = entry.repsArray    || [];
        const weights  = entry.weightsArray || [];
        const rpeArr   = entry.rpeArray     || [];
        const unit     = entry.unit || 'kg';
        for (let i = 0; i < reps.length; i++) {
          rows.push([w.date || '', name, i + 1, reps[i] ?? '', weights[i] ?? '', unit, rpeArr[i] ?? '']);
        }
      }
    }

    _downloadCSV(`workouts_${username}_${_dateStamp()}.csv`, rows);
  };

  /* ── Export: Weight log ─────────────────────────────────── */

  window.exportWeightCSV = function () {
    const username = _user();
    if (!username) { alert('Log in first.'); return; }

    const entries = _parse('weightLog_' + username) ||
                    _parse('weightEntries')          || [];
    if (!entries.length) { alert('No weight entries to export.'); return; }

    const rows = [['Date', 'Weight (kg)', 'Calories', 'Cardio (min)']];
    for (const e of entries) {
      rows.push([e.date || '', e.weight || e.kg || '', e.calories || '', e.cardio || '']);
    }

    _downloadCSV(`weight_log_${username}_${_dateStamp()}.csv`, rows);
  };

  /* ── Export: Body measurements ──────────────────────────── */

  window.exportMeasurementsCSV = function () {
    const username = _user();
    if (!username) { alert('Log in first.'); return; }

    const entries = _parse('bodyMeasurements_' + username) || [];
    if (!entries.length) { alert('No measurements to export.'); return; }

    const fields = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'arm', 'thigh'];
    const rows = [['Date', ...fields.map(f => f.charAt(0).toUpperCase() + f.slice(1) + ' (cm)')]];
    for (const e of entries) {
      rows.push([e.date || '', ...fields.map(f => e[f] ?? '')]);
    }

    _downloadCSV(`measurements_${username}_${_dateStamp()}.csv`, rows);
  };

  /* ── Export: Readiness log ───────────────────────────────── */

  window.exportReadinessCSV = function () {
    const raw = _parse('dailyReadiness_v1') || {};
    const entries = Object.entries(raw).filter(([, v]) => !v.skipped);
    if (!entries.length) { alert('No readiness entries to export.'); return; }

    const rows = [['Date', 'Sleep (1-5)', 'Soreness (1-5)', 'Motivation (1-5)', 'Score (%)']];
    entries.sort((a, b) => a[0].localeCompare(b[0])).forEach(([date, v]) => {
      rows.push([date, v.sleep || '', v.soreness || '', v.motivation || '', v.score || '']);
    });

    _downloadCSV(`readiness_log_${_dateStamp()}.csv`, rows);
  };

  /* ── Export: Full JSON dump ─────────────────────────────── */

  window.exportAllJSON = function () {
    const username = _user();
    if (!username) { alert('Log in first.'); return; }

    const dump = {
      exportedAt: new Date().toISOString(),
      username,
      workouts:     _parse('workouts_' + username)           || [],
      weightLog:    _parse('weightLog_' + username)          ||
                    _parse('weightEntries')                   || [],
      measurements: _parse('bodyMeasurements_' + username)   || [],
      readiness:    _parse('dailyReadiness_v1')               || {},
      macroTargets: _parse('macroTargets_' + username)        || {},
      programs:     _parse('programs')                        || [],
      prBoard:      _parse('prBoard_' + username)             || {},
    };

    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `pocketcoach_backup_${username}_${_dateStamp()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /* ══════════════════════════════════════════════════════════════
     REST TIMER NOTIFICATIONS
     Watches #restTimerDisplay for "00:00" and fires a Web Notification.
  ══════════════════════════════════════════════════════════════ */

  let _notifPermission = Notification?.permission || 'default';

  window.requestRestTimerNotifications = function () {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(p => {
      _notifPermission = p;
      const banner = document.getElementById('notifPermBanner');
      if (banner) banner.style.display = 'none';
    });
  };

  function _fireRestCompleteNotification() {
    if (!('Notification' in window) || _notifPermission !== 'granted') return;
    try {
      new Notification('⏱️ Rest complete!', {
        body: 'Time to hit your next set 💪',
        icon: '/favicon.ico',
        silent: false,
      });
    } catch (_) {}
  }

  function _hookRestTimerObserver() {
    const display = document.getElementById('restTimerDisplay');
    if (!display || display.__notifObserverAttached) return;
    display.__notifObserverAttached = true;

    let _lastText = '';
    const observer = new MutationObserver(() => {
      const text = display.textContent.trim();
      // Fire when text changes TO "00:00" (not if it was already there)
      if ((text === '00:00' || text === '0:00') && _lastText !== text) {
        _fireRestCompleteNotification();
      }
      _lastText = text;
    });

    observer.observe(display, { childList: true, characterData: true, subtree: true });
  }

  function _showNotifBannerIfNeeded() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') return;

    const banner = document.getElementById('notifPermBanner');
    if (banner) banner.style.display = 'flex';
  }

  /* ── Boot ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      _hookRestTimerObserver();
      _showNotifBannerIfNeeded();
    }, 1500);
  });

})();
