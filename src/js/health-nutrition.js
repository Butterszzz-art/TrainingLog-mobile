// Imports today's food from Health Connect (Android) into the Macros tab.
// Cronometer and other food apps save what you eat to Health Connect; the
// native HealthConnect plugin (plugins/health-connect) reads the day's totals.
//
// We remember what we imported last time and only log the difference, so
// manual entries in the app stay untouched and re-syncing never double counts.
(function (root) {
  'use strict';

  var MIN_AUTO_SYNC_MS = 60 * 1000;

  // Known food apps, matched on part of their package name.
  var SOURCE_NAMES = [
    ['cronometer', 'Cronometer'],
    ['myfitnesspal', 'MyFitnessPal'],
    ['macrofactor', 'MacroFactor'],
    ['loseit', 'Lose It!'],
    ['fatsecret', 'FatSecret'],
    ['yazio', 'YAZIO'],
    ['samsung', 'Samsung Health'],
    ['fitbit', 'Fitbit'],
  ];

  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

  // Health Connect totals -> the app's progress shape. The app counts
  // calories as 4/4/9 from macros plus a separate `cals` amount, so `cals`
  // holds whatever makes the total match the food app's own calorie count.
  function toProgressShape(totals) {
    var t = totals || {};
    var protein = round1(t.protein);
    var carbs = round1(t.carbs);
    var fats = round1(t.fat);
    var kcal = Math.round(Number(t.energyKcal) || 0);
    var fromMacros = protein * 4 + carbs * 4 + fats * 9;
    var cals = kcal > 0 ? Math.round(kcal - fromMacros) : 0;
    return { protein: protein, carbs: carbs, fats: fats, cals: cals };
  }

  // What to add to today's log: new import minus what we already added today.
  function importDelta(previous, next, today) {
    var prev = previous && previous.date === today ? previous : null;
    var out = {};
    ['protein', 'carbs', 'fats', 'cals'].forEach(function (k) {
      var diff = (Number(next[k]) || 0) - (prev ? Number(prev[k]) || 0 : 0);
      out[k] = k === 'cals' ? Math.round(diff) : round1(diff);
    });
    return out;
  }

  function isZeroDelta(d) {
    return !d.protein && !d.carbs && !d.fats && !d.cals;
  }

  function describeSources(packages) {
    var names = [];
    (packages || []).forEach(function (pkg) {
      var lower = String(pkg).toLowerCase();
      var match = SOURCE_NAMES.find(function (pair) { return lower.indexOf(pair[0]) !== -1; });
      var name = match ? match[1] : pkg;
      if (names.indexOf(name) === -1) names.push(name);
    });
    return names.join(', ');
  }

  // Time range for one of the app's days ("YYYY-MM-DD"). The app dates its
  // log with getTodayDateString(), which is the UTC date, so we read the same
  // UTC day from Health Connect; otherwise food could land on the wrong day.
  function dayRange(day) {
    var start = Date.parse(day + 'T00:00:00Z');
    return { start: start, end: start + 24 * 60 * 60 * 1000 };
  }

  var api = {
    toProgressShape: toProgressShape,
    importDelta: importDelta,
    isZeroDelta: isZeroDelta,
    describeSources: describeSources,
    dayRange: dayRange,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;

  // ── App wiring (Android app only) ──────────────────────────────────
  var state = { status: null, granted: false, syncing: false, lastAutoSync: 0, message: '', pendingEnable: false };

  function plugin() {
    var cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    if (cap.getPlatform && cap.getPlatform() !== 'android') return null;
    return (cap.Plugins && cap.Plugins.HealthConnect) || (cap.registerPlugin && cap.registerPlugin('HealthConnect')) || null;
  }

  function user() { return window.currentUser || null; }
  function enabledKey() { return 'healthNutritionEnabled_' + user(); }
  function importKey() { return 'healthNutritionImport_' + user(); }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_e) { return null; }
  }

  function isEnabled() { return !!user() && localStorage.getItem(enabledKey()) === '1'; }

  function today() {
    return typeof window.getTodayDateString === 'function'
      ? window.getTodayDateString()
      : new Date().toISOString().slice(0, 10);
  }

  function formatTime(ms) {
    try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (_e) { return ''; }
  }

  function render() {
    var card = document.getElementById('healthNutritionCard');
    if (!card) return;
    if (!plugin() || !user() || !state.status) { card.hidden = true; return; }
    card.hidden = false;

    var statusEl = document.getElementById('healthNutritionStatus');
    var btn = document.getElementById('healthNutritionBtn');
    var label = btn && btn.querySelector('[data-label]');
    var offBtn = document.getElementById('healthNutritionOff');
    var text;
    var action;

    if (state.status === 'unavailable') {
      text = 'Install Health Connect to import food from Cronometer.';
      action = 'Install';
    } else if (state.status === 'update_required') {
      text = 'Update Health Connect to import food from Cronometer.';
      action = 'Update';
    } else if (!isEnabled() || !state.granted) {
      text = state.message || 'Import today’s food from Cronometer and other apps.';
      action = state.message ? 'Open' : 'Connect';
    } else {
      var last = readJSON(importKey());
      if (state.message) {
        text = state.message;
      } else if (last && last.date === today()) {
        var from = describeSources(last.sources);
        text = 'Synced ' + formatTime(last.syncedAt) + (from ? ' · from ' + from : '');
      } else {
        text = 'Connected. Nothing logged in your food app today yet.';
      }
      action = state.syncing ? 'Syncing…' : 'Sync now';
    }

    if (statusEl) statusEl.textContent = text;
    if (label) label.textContent = action;
    if (btn) btn.disabled = state.syncing;
    if (offBtn) offBtn.hidden = !(isEnabled() && state.granted);
  }

  async function checkStatus() {
    var hc = plugin();
    if (!hc) return;
    try {
      var res = await hc.getStatus();
      state.status = res.status;
      state.granted = !!res.granted;
    } catch (err) {
      console.warn('[HealthNutrition] status check failed', err);
      state.status = null;
    }
  }

  async function sync(options) {
    var opts = options || {};
    var hc = plugin();
    if (!hc || !isEnabled() || !state.granted || state.syncing) return;
    // A completed day is locked; leave it alone.
    if (typeof window.isMacroDayComplete === 'function' && window.isMacroDayComplete()) {
      if (opts.manual) window.showToast && window.showToast('Today is marked complete. Reopen it to sync.', 'warn');
      return;
    }
    if (typeof window.logMacroAmounts !== 'function') return;

    state.syncing = true;
    state.message = '';
    render();
    try {
      var day = today();
      var range = dayRange(day);
      var totals = await hc.getNutritionTotals(range);
      var next = toProgressShape(totals);
      var previous = readJSON(importKey());
      var delta = importDelta(previous, next, day);
      if (!isZeroDelta(delta)) window.logMacroAmounts(delta);
      localStorage.setItem(importKey(), JSON.stringify({
        date: day,
        protein: next.protein,
        carbs: next.carbs,
        fats: next.fats,
        cals: next.cals,
        sources: totals.sources || [],
        syncedAt: Date.now(),
      }));
      if (opts.manual && window.showToast) {
        window.showToast(isZeroDelta(delta) ? 'Already up to date' : 'Imported from Health Connect', 'success');
      }
    } catch (err) {
      console.warn('[HealthNutrition] sync failed', err);
      if (err && err.code === 'PERMISSION_DENIED') {
        state.granted = false;
        state.message = 'Access was turned off. Allow nutrition for Pocket Coach in Health Connect.';
      } else {
        state.message = 'Couldn’t sync just now. Try again in a moment.';
      }
    } finally {
      state.syncing = false;
      render();
    }
  }

  async function connect() {
    var hc = plugin();
    if (!hc || !user()) return;
    try {
      var res = await hc.requestPermission();
      state.granted = !!res.granted;
    } catch (err) {
      console.warn('[HealthNutrition] permission request failed', err);
      state.granted = false;
    }
    if (state.granted) {
      localStorage.setItem(enabledKey(), '1');
      state.message = '';
      await sync({ manual: true });
    } else {
      // After two refusals Android stops showing the dialog, so point the
      // user to Health Connect itself.
      state.message = 'Permission not granted. Allow nutrition for Pocket Coach in Health Connect.';
      state.pendingEnable = true;
      render();
    }
  }

  async function onButton() {
    var hc = plugin();
    if (!hc) return;
    if (state.status !== 'available' || (state.message && !state.granted)) {
      try { await hc.openHealthConnect(); } catch (err) { console.warn('[HealthNutrition] open failed', err); }
      return;
    }
    if (!isEnabled() || !state.granted) return connect();
    return sync({ manual: true });
  }

  // Stops future imports. Food already imported today stays in the log, and
  // so does the import record, so turning it back on later today only adds
  // what's new instead of importing everything a second time.
  function turnOff() {
    if (!user()) return;
    localStorage.removeItem(enabledKey());
    state.pendingEnable = false;
    state.message = '';
    render();
  }

  // Called when the Macros tab opens and when the app comes back to the
  // foreground. Re-checks status (so returning from Health Connect settings
  // picks up a new grant) and auto-syncs at most once a minute.
  async function refresh() {
    if (!plugin() || !user()) { render(); return; }
    await checkStatus();
    // They were sent to Health Connect to allow access and came back.
    if (state.granted && state.pendingEnable) {
      localStorage.setItem(enabledKey(), '1');
      state.pendingEnable = false;
    }
    if (state.granted && state.message && !state.syncing) state.message = '';
    render();
    if (isEnabled() && state.granted && Date.now() - state.lastAutoSync > MIN_AUTO_SYNC_MS) {
      state.lastAutoSync = Date.now();
      await sync();
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh();
  });

  window.HealthNutrition = {
    refresh: refresh,
    sync: sync,
    onButton: onButton,
    turnOff: turnOff,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { refresh(); });
  } else {
    refresh();
  }
})(typeof window !== 'undefined' ? window : globalThis);
