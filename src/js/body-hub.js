/* =============================================================
   BODY TAB — SUMMARY HUB
   The Body tab is a launcher into Weight/Macros/Sleep/Cardio (each
   keeps its own id/render function — see index.html #bodyTab). Before
   this file, opening the tab showed nothing but the launcher pills.
   This renders a 2x2 "at a glance" grid mirroring each mini-tab's
   headline stat, in the same pod/stat-tile language as the Home
   dashboard (weekly-summary.js), so the tab isn't an empty shell.
   Tapping a card jumps into that mini-tab via the existing showTab().
   ============================================================= */

(function initBodyHub() {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────── */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') || '';
  }

  function _parse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }

  function _isoDate(d) { return d.toISOString().slice(0, 10); }

  function _card(kicker, value, sub, tab, extraClass) {
    return `
      <button type="button" class="body-hub-card${extraClass ? ' ' + extraClass : ''}" onclick="showTab('${tab}')">
        <span class="body-hub-kicker">${kicker}</span>
        <span class="body-hub-value">${value}</span>
        <span class="body-hub-sub">${sub}</span>
      </button>`;
  }

  /* ── Weight ──────────────────────────────────────────────── */

  function _weightCard(username) {
    const log = _parse(`bodyweightLog_${username}`, []) || [];
    if (!log.length) {
      return _card('Weight', '&mdash;', 'No entries yet — tap to log', 'weightTab', 'body-hub-empty');
    }

    const getKg = typeof window.getEntryWeightKg === 'function'
      ? window.getEntryWeightKg
      : (e) => Number(e?.weightKg ?? e?.weight) || null;
    const pref = typeof window.getBodyweightPreference === 'function'
      ? window.getBodyweightPreference() : { unit: 'kg' };
    const unit = pref.unit === 'lb' ? 'lb' : 'kg';
    const toDisp = typeof window.convertWeightValue === 'function'
      ? (kg) => window.convertWeightValue(kg, 'kg', unit, 1)
      : (kg) => Math.round(kg * 10) / 10;

    const lastKg = getKg(log[log.length - 1]);
    const value = lastKg != null ? `${toDisp(lastKg)} <span class="body-hub-unit">${unit}</span>` : '&mdash;';

    const trend = window.weightTab?.computeWeightChangeRate
      ? window.weightTab.computeWeightChangeRate(log)
      : { kgPerWeek: 0, days: 0 };
    let sub = 'Log a weigh-in to see your trend';
    if (trend.days > 0 && Math.abs(trend.kgPerWeek) >= 0.05) {
      const dispRate = Math.abs(toDisp(trend.kgPerWeek));
      const dir = trend.kgPerWeek > 0 ? 'up' : 'down';
      const arrow = trend.kgPerWeek > 0 ? '&#9650;' : '&#9660;';
      sub = `<span class="body-hub-trend body-hub-trend--${dir}">${arrow} ${dispRate.toFixed(1)} ${unit}/wk</span>`;
    } else if (trend.days > 0) {
      sub = 'Holding steady';
    }
    return _card('Weight', value, sub, 'weightTab');
  }

  /* ── Macros ──────────────────────────────────────────────── */

  function _macroCard() {
    const today = _isoDate(new Date());
    const savedDate = localStorage.getItem('dailyMacroDate');
    const progress = savedDate === today ? _parse('dailyMacroProgress', null) : null;
    const p = progress || { protein: 0, carbs: 0, fats: 0 };
    const totalCals = Math.round((p.protein || 0) * 4 + (p.carbs || 0) * 4 + (p.fats || 0) * 9);

    let targetCals = null;
    try {
      if (typeof window.getAdaptiveMacroTargets === 'function') {
        targetCals = window.getAdaptiveMacroTargets().calories;
      }
    } catch { /* macro targets not ready — fall back to raw totals only */ }

    if (!totalCals) {
      return _card('Macros', '&mdash;', 'No meals logged today', 'macroTab', 'body-hub-empty');
    }
    const value = `${totalCals.toLocaleString()} <span class="body-hub-unit">kcal</span>`;
    const sub = targetCals
      ? `of ${targetCals.toLocaleString()} target &middot; P${Math.round(p.protein||0)} C${Math.round(p.carbs||0)} F${Math.round(p.fats||0)}`
      : `P${Math.round(p.protein||0)} &middot; C${Math.round(p.carbs||0)} &middot; F${Math.round(p.fats||0)}`;
    return _card('Macros', value, sub, 'macroTab');
  }

  /* ── Sleep ───────────────────────────────────────────────── */

  function _sleepCard(username) {
    const log = _parse(`sleepLog_${username}`, []) || [];
    if (!log.length) {
      return _card('Sleep', '&mdash;', 'No entries yet — tap to log', 'sleepTab', 'body-hub-empty');
    }
    const sorted = log.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const latest = sorted[0];
    const today = _isoDate(new Date());
    const yesterday = _isoDate(new Date(Date.now() - 86400000));
    const h = Math.floor(latest.duration || 0);
    const m = Math.round(((latest.duration || 0) - h) * 60);
    const value = `${h}<span class="body-hub-unit">h</span> ${m}<span class="body-hub-unit">m</span>`;
    const stars = '&#9733;'.repeat(latest.quality || 0) + '&#9734;'.repeat(5 - (latest.quality || 0));
    const whenLabel = latest.date === today ? 'Last night'
      : latest.date === yesterday ? 'Last night'
      : latest.date;
    const sub = `${whenLabel} &middot; <span class="body-hub-stars">${stars}</span>`;
    return _card('Sleep', value, sub, 'sleepTab');
  }

  /* ── Cardio ──────────────────────────────────────────────── */

  function _cardioCard(username) {
    const log = _parse(`cardioLog_${username}`, []) || [];
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    const weekStart = _isoDate(weekAgo);
    const weekEntries = log.filter(e => (e.date || '') >= weekStart);

    if (!weekEntries.length) {
      return _card('Cardio', '&mdash;', 'Nothing logged this week', 'cardioTab', 'body-hub-empty');
    }
    const weekMins = Math.round(weekEntries.reduce((s, e) => s + (parseFloat(e.duration) || 0), 0));
    const value = `${weekMins} <span class="body-hub-unit">min</span>`;
    const sub = `${weekEntries.length} session${weekEntries.length === 1 ? '' : 's'} this week`;
    return _card('Cardio', value, sub, 'cardioTab');
  }

  /* ── Render ──────────────────────────────────────────────── */

  function renderBodyHub() {
    const host = document.getElementById('bodyHubSummary');
    if (!host) return;

    const username = _user();
    if (!username) {
      host.innerHTML = '';
      return;
    }

    host.innerHTML = [
      _weightCard(username),
      _macroCard(),
      _sleepCard(username),
      _cardioCard(username),
    ].join('');
  }

  window.renderBodyHub = renderBodyHub;

})();
