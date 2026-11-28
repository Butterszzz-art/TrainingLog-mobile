/* =============================================================
   WEEKLY MACRO BUDGET — Macros tab card
   "This week": the week's targets added up, eaten so far, what's
   left and the daily average that still lands on the weekly number
   (sums in weekly-budget-core.js).

   Reads, all on the device:
   - today:        loadDailyMacroProgress() / getAdaptiveMacroTargets()
   - earlier days: macroHistory_<user> totals, and the day's own target
                   when it was saved with the day (`target`, see
                   rolloverMacroDay in index.html); older entries fall
                   back to the usual targets
   - days ahead:   the usual targets (getMacroTargetValues)
   Rendered by updateMacroUI() into #macroWeeklyBudget.
   ============================================================= */
(function () {
  'use strict';

  const Core = () => window.WeeklyBudgetCore;
  const user = () => (typeof currentUser !== 'undefined' && currentUser) || window.currentUser || ''; // eslint-disable-line no-undef
  const today = () => (typeof getTodayDateString === 'function' ? getTodayDateString() : (globalThis.AppTime?.today() || new Date().toISOString().slice(0, 10))); // eslint-disable-line no-undef
  const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-GB');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
  }

  // { calories, protein, carbs, fat } → { kcal, protein, carbs, fat }
  function asTarget(t) {
    if (!t) return null;
    return { kcal: Number(t.calories ?? t.kcal) || 0, protein: Number(t.protein) || 0, carbs: Number(t.carbs) || 0, fat: Number(t.fat ?? t.fats) || 0 };
  }
  function asEaten(t) {
    if (!t) return null;
    const protein = Number(t.protein) || 0;
    const carbs = Number(t.carbs) || 0;
    const fat = Number(t.fats ?? t.fat) || 0;
    const kcal = Number(t.calories) || Math.round(protein * 4 + carbs * 4 + fat * 9 + (Number(t.cals) || 0));
    return { kcal, protein, carbs, fat };
  }

  function computeThisWeek() {
    const u = user();
    if (!u || !Core()) return null;
    const t = today();
    const history = new Map();
    (readJSON(`macroHistory_${u}`, []) || []).forEach(h => {
      if (h && h.date) history.set(String(h.date).slice(0, 10), h);
    });
    const usual = asTarget(typeof getMacroTargetValues === 'function' ? getMacroTargetValues() : readJSON(`macroTargets_${u}`, null)); // eslint-disable-line no-undef
    if (!usual || !usual.kcal) return null;
    const todayTarget = asTarget(typeof getAdaptiveMacroTargets === 'function' ? getAdaptiveMacroTargets() : null) || usual; // eslint-disable-line no-undef

    return Core().computeWeek({
      today: t,
      eatenOn(date) {
        if (date === t) return asEaten(typeof loadDailyMacroProgress === 'function' ? loadDailyMacroProgress() : null); // eslint-disable-line no-undef
        const h = history.get(date);
        return h ? asEaten(h.totals || h) : null;
      },
      targetFor(date) {
        if (date === t) return todayTarget.kcal ? todayTarget : usual;
        const saved = date < t && asTarget(history.get(date)?.target);
        return saved && saved.kcal ? saved : usual;
      },
    });
  }

  const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDate = key => { const [, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
  const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
  // Same stroke icons as the hero's pace nudge (24×24, currentColor).
  const SVG = '<svg class="nudge-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  const ICON = {
    under: SVG + '<path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
    on_track: SVG + '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    over: SVG + '<path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>',
  };
  ICON.over_week = ICON.over;

  // Seven slim bars, one per day, under the week's meter.
  function dayStrip(week) {
    return week.days.map((d, i) => {
      let cls = 'is-ahead';
      let label = `${shortDate(d.date)}: ${fmt(d.target.kcal)} kcal target`;
      if (d.when === 'past' && !d.counted) { cls = 'is-skipped'; label = `${shortDate(d.date)}: not logged, left out`; }
      else if (d.when !== 'ahead') {
        const diff = d.eaten.kcal - d.target.kcal;
        cls = d.when === 'today' ? 'is-today' : Math.abs(diff) <= Math.max(50, d.target.kcal * 0.05) ? 'is-hit' : diff > 0 ? 'is-over' : 'is-under';
        label = `${shortDate(d.date)}: ${fmt(d.eaten.kcal)} of ${fmt(d.target.kcal)} kcal`;
      }
      const h = d.when === 'ahead' ? 0 : pct(d.eaten.kcal, d.target.kcal);
      return `<li class="mwb-day ${cls}" title="${esc(label)}" aria-label="${esc(label)}">
        <span class="mwb-day-bar"><span style="height:${h}%"></span></span>
        <span class="mwb-day-lbl">${DOW[i]}</span>
      </li>`;
    }).join('');
  }

  // A stat column in the hero's grid: eaten / weekly, meter, what's left.
  function macroStat(label, key, week, bar) {
    const left = week.left[key];
    const over = left < 0;
    return `<div class="macro-hero-stat">
      <span class="mx-lbl">${label}</span>
      <div class="macro-hero-stat-val">${fmt(week.eaten[key])}<small> / ${fmt(week.budget[key])}g</small></div>
      <div class="macro-hero-meter macro-hero-meter--sm"><div class="macro-card-bar-fill ${bar}" style="width:${pct(week.eaten[key], week.budget[key])}%"></div></div>
      <small class="mwb-stat-left${over ? ' is-over' : ''}">${fmt(Math.abs(left))}g ${over ? 'over' : 'left'}</small>
      <small class="mwb-stat-day">~${fmt(week.perDay[key])}g a day</small>
    </div>`;
  }

  function render() {
    const host = document.getElementById('macroWeeklyBudget');
    if (!host) return;
    const week = computeThisWeek();
    if (!week || !week.budget.kcal) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;

    const over = week.left.kcal < 0;
    const fill = pct(week.eaten.kcal, week.budget.kcal);
    const pace = pct(week.paceKcal, week.budget.kcal);
    const chip = {
      on_track: ['On track', ''],
      under: ['Banked', 'mx-chip--brass'],
      over: ['Over pace', 'mwb-chip-over'],
      over_week: ['Over budget', 'mwb-chip-over'],
    }[week.status];
    const n = week.daysRemaining;
    const notes = [];
    if (week.daysSkipped) notes.push(`${week.daysSkipped} unlogged day${week.daysSkipped === 1 ? '' : 's'} left out.`);
    notes.push('Days ahead count at your usual targets.');

    host.innerHTML = `
      <div class="macro-hero-top">
        <span class="mx-lbl">This week <span class="mwb-range">${shortDate(week.start)} – ${shortDate(week.end)}</span></span>
        <span class="mx-chip mx-chip--sm ${chip[1]}">${chip[0]}</span>
      </div>
      <div class="macro-hero-num-row">
        <span class="macro-hero-num mwb-num mx-num">${fmt(week.eaten.kcal)}</span>
        <span class="mx-unit">/ ${fmt(week.budget.kcal)} kcal</span>
      </div>
      <p class="macro-hero-sub">
        <b class="${over ? 'is-over' : ''}">${fmt(Math.abs(week.left.kcal))} kcal ${over ? 'over' : 'left'}</b>
        <span aria-hidden="true">·</span>
        <span>~${fmt(week.perDay.kcal)} a day for ${n === 1 ? 'today' : `${n} days`}</span>
      </p>
      <div class="macro-hero-meter mwb-meter" role="img" aria-label="${fmt(week.eaten.kcal)} of ${fmt(week.budget.kcal)} kcal eaten this week">
        <div class="macro-card-bar-fill macro-bar-cal" style="width:${fill}%"></div>
        <span class="mwb-pace" style="left:${pace}%"></span>
      </div>
      <ul class="mwb-days" aria-label="Calories by day">${dayStrip(week)}</ul>
      <div class="macro-hero-grid">
        ${macroStat('Protein', 'protein', week, 'macro-bar-protein')}
        ${macroStat('Carbs', 'carbs', week, 'macro-bar-carbs')}
        ${macroStat('Fat', 'fat', week, 'macro-bar-fat')}
      </div>
      <div class="macro-hero-nudge mwb-nudge is-${week.status}">
        ${ICON[week.status]}
        <p>${esc(Core().headline(week))} <span class="mwb-foot">${esc(notes.join(' '))}</span></p>
      </div>`;
  }

  window.renderWeeklyMacroBudget = render;
  window.computeWeeklyMacroBudget = computeThisWeek;
})();
