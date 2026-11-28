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
  const OPEN_KEY = 'macroWeeklyBudgetOpen';

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

  function dayStrip(week) {
    return week.days.map((d, i) => {
      let cls = 'is-ahead';
      let title = `${d.date}: ${fmt(d.target.kcal)} kcal target`;
      if (d.when === 'past' && !d.counted) { cls = 'is-skipped'; title = `${d.date}: not logged, left out`; }
      else if (d.when !== 'ahead') {
        const diff = d.eaten.kcal - d.target.kcal;
        cls = d.when === 'today' ? 'is-today' : Math.abs(diff) <= Math.max(50, d.target.kcal * 0.05) ? 'is-hit' : diff > 0 ? 'is-over' : 'is-under';
        title = `${d.date}: ${fmt(d.eaten.kcal)} / ${fmt(d.target.kcal)} kcal`;
      }
      const pct = d.target.kcal ? Math.min(100, Math.round((d.eaten.kcal / d.target.kcal) * 100)) : 0;
      return `<li class="mwb-day ${cls}" title="${esc(title)}">
        <span class="mwb-day-bar"><span style="height:${d.when === 'ahead' ? 0 : pct}%"></span></span>
        <span class="mwb-day-lbl">${DOW[i]}</span>
      </li>`;
    }).join('');
  }

  function macroRow(label, key, week, dot) {
    const left = week.left[key];
    const over = left < 0;
    return `<div class="mwb-macro">
      <span class="mwb-macro-name"><span class="macro-card-dot ${dot}"></span>${label}</span>
      <span class="mwb-macro-val">${fmt(week.eaten[key])}<small> / ${fmt(week.budget[key])}g</small></span>
      <span class="mwb-macro-left${over ? ' is-over' : ''}">${fmt(Math.abs(left))}g ${over ? 'over' : 'left'}</span>
      <span class="mwb-macro-day">~${fmt(week.perDay[key])}g/day</span>
    </div>`;
  }

  function render() {
    const host = document.getElementById('macroWeeklyBudget');
    if (!host) return;
    const week = computeThisWeek();
    if (!week || !week.budget.kcal) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;

    const over = week.left.kcal < 0;
    const fill = Math.min(100, Math.round((week.eaten.kcal / week.budget.kcal) * 100));
    const pace = Math.min(100, Math.round((week.paceKcal / week.budget.kcal) * 100));
    const chip = { on_track: ['On track', ''], under: ['Banked', 'mx-chip--brass'], over: ['Over pace', 'mwb-chip-over'], over_week: ['Over budget', 'mwb-chip-over'] }[week.status];
    const open = readJSON(OPEN_KEY, false) === true;
    const notes = [];
    if (week.daysSkipped) notes.push(`${week.daysSkipped} earlier day${week.daysSkipped === 1 ? '' : 's'} with nothing logged ${week.daysSkipped === 1 ? 'is' : 'are'} left out.`);
    notes.push('Days ahead count at your usual daily targets.');

    host.innerHTML = `
      <div class="mwb-top">
        <span class="mx-lbl">This week</span>
        <span class="mx-chip mx-chip--sm ${chip[1]}">${chip[0]}</span>
      </div>
      <div class="mwb-num-row">
        <span class="mwb-num mx-num">${fmt(week.eaten.kcal)}</span>
        <span class="mx-unit">/ ${fmt(week.budget.kcal)} kcal</span>
        <b class="mwb-left${over ? ' is-over' : ''}">${fmt(Math.abs(week.left.kcal))} ${over ? 'over' : 'left'}</b>
      </div>
      <div class="macro-hero-meter mwb-meter" role="img" aria-label="${fmt(week.eaten.kcal)} of ${fmt(week.budget.kcal)} kcal eaten this week">
        <div class="macro-card-bar-fill macro-bar-cal" style="width:${fill}%"></div>
        <span class="mwb-pace" style="left:${pace}%" title="Where the week would be if every day so far hit its target"></span>
      </div>
      <p class="mwb-line">${esc(Core().headline(week))}</p>
      <details class="mwb-more"${open ? ' open' : ''}>
        <summary>Macros and days</summary>
        <ul class="mwb-days" aria-label="Calories by day">${dayStrip(week)}</ul>
        <div class="mwb-macros">
          ${macroRow('Protein', 'protein', week, 'macro-dot-protein')}
          ${macroRow('Carbs', 'carbs', week, 'macro-dot-carbs')}
          ${macroRow('Fat', 'fat', week, 'macro-dot-fat')}
        </div>
        <p class="mwb-foot">${esc(notes.join(' '))} The daily average spreads what's banked (or over) across today and the days left; it doesn't change your targets.</p>
      </details>`;
    host.querySelector('.mwb-more')?.addEventListener('toggle', e => {
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(e.target.open)); } catch { /* storage blocked */ }
    });
  }

  window.renderWeeklyMacroBudget = render;
  window.computeWeeklyMacroBudget = computeThisWeek;
})();
