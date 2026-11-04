/* The coach's meal plan in the client's food log.
 *
 * The coach sends a meal plan (coachAssignment.mealPlan, see the backend's
 * src/routes/coachMeals.js): for a training day and a rest day, per slot a
 * meal plus alternatives. Each day, the first time the food log is shown,
 * that day's meals go into it already counted, tagged `coach` and not yet
 * confirmed. The client then:
 *   - taps ✓ to confirm a meal (Complete day confirms the rest),
 *   - changes amounts or removes foods like any other entry,
 *   - swaps a meal for one of the coach's alternatives,
 *   - removes a meal they didn't eat (with Undo), or all of the day's,
 *   - or switches to the other day type's meals while they're untouched.
 * The log can show an earlier day (food-database.js); ✓, Swap and Remove
 * work on the day shown. Meals are only ever filled in for today.
 * A completed day is never filled or changed.
 *
 * Pure helpers (tested): dayTypeFor, entriesForDay, slotState.
 * Browser: CoachMeals.sync(plan), ensureToday(), slotBar(slot) for food-database.js,
 * confirmAll() for Complete day. */
(function (globalScope) {
  'use strict';

  const SLOTS = ['breakfast', 'lunch', 'dinner', 'snacks'];
  const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  function core() {
    if (globalScope.FoodCore) return globalScope.FoodCore;
    if (typeof require === 'function') { try { return require('./food-core'); } catch (_e) { /* browser */ } }
    return null;
  }

  /**
   * Training or rest day for `iso` (YYYY-MM-DD): the coach's published plan
   * (its program's training weekdays), else the day-type macro plan's weekly
   * pattern, else a training day.
   */
  function dayTypeFor(iso, { plan, macroSchedule } = {}) {
    const PT = globalScope.PlanToday;
    if (plan && PT) {
      const r = PT.resolve(plan, iso);
      if (r && r.dayType) return r.dayType;
    }
    if (macroSchedule) {
      const t = macroSchedule[WEEKDAYS[new Date(`${iso}T12:00:00`).getDay()]];
      if (t === 'rest' || t === 'low') return 'rest';
      if (t) return 'training';
    }
    return 'training';
  }

  /** Food-log entries for one day of the plan: the main meal of each slot, tagged. */
  function entriesForDay(mealPlan, dayType, { date, now }) {
    const Core = core();
    const day = mealPlan && mealPlan.days && (mealPlan.days[dayType] || mealPlan.days.training);
    if (!day || !Core) return [];
    const out = [];
    SLOTS.forEach(slot => {
      const meal = day[slot] && day[slot][0];
      if (meal) out.push(...tagged(Core, meal, { slot, option: 0, dayType, key: mealPlan.key, date, now: now + out.length * 10 }));
    });
    return out;
  }

  function tagged(Core, meal, { slot, option, dayType, key, date, now }) {
    return Core.entriesFromTemplate(meal, { date, meal: slot, now }).map((e, i) => ({
      ...e,
      coach: { key, slot, option, dayType, mealId: meal.id || '', mealName: meal.name, grams: meal.items[i] ? meal.items[i].grams : e.grams },
      confirmed: false,
    }));
  }

  /**
   * One slot's coach entries today → { entries, meal (name), option, confirmed,
   * edited (any amount changed or a food removed), alternatives: [{ i, name }] }.
   */
  function slotState(log, today, slot, mealPlan) {
    const entries = (log || []).filter(e => e && e.date === today && e.coach && e.coach.slot === slot && (!mealPlan || e.coach.key === mealPlan.key));
    if (!entries.length) return null;
    const c = entries[0].coach;
    const options = (mealPlan && mealPlan.days && mealPlan.days[c.dayType] && mealPlan.days[c.dayType][slot]) || [];
    const planned = options[c.option];
    const edited = entries.some(e => Math.abs((e.grams || 0) - (e.coach.grams || 0)) > 0.5) || (planned && planned.items.length !== entries.length);
    return {
      entries, option: c.option, dayType: c.dayType, meal: c.mealName,
      confirmed: entries.every(e => e.confirmed), edited,
      alternatives: options.map((m, i) => ({ i, name: m.name })).filter(a => a.i !== c.option),
    };
  }

  const api = { dayTypeFor, entriesForDay, slotState, SLOTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.CoachMeals = api;
  const doc = globalScope.document;
  if (!doc) return;

  // ── browser side ─────────────────────────────────────────────────
  const user = () => globalScope.currentUser || globalScope.localStorage.getItem('fitnessAppUser') || '';
  const PLAN_KEY = () => `coachMealPlan_${user()}`;
  const read = (k, f) => { try { const v = JSON.parse(globalScope.localStorage.getItem(k)); return v == null ? f : v; } catch (_e) { return f; } };
  const FL = () => globalScope.FoodLog;
  const today = () => (FL() && FL().today()) || new Date().toISOString().slice(0, 10);
  // The day the food log shows: today, or an earlier day being filled in.
  const shown = () => (FL() && FL().day ? FL().day() : today());
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function plan() { return read(PLAN_KEY(), null); }

  /** From client-coaching.js after each refresh: the active coach's plan, or null. */
  function sync(mealPlan) {
    const before = plan();
    if (mealPlan) globalScope.localStorage.setItem(PLAN_KEY(), JSON.stringify(mealPlan));
    else globalScope.localStorage.removeItem(PLAN_KEY());
    if (JSON.stringify(before) !== JSON.stringify(mealPlan || null)) ensureToday();
  }

  function apply(changes) {
    if (!changes.length) return;
    if (typeof globalScope.applyFoodLogChanges === 'function') { globalScope.applyFoodLogChanges(changes); return; }
    changes.forEach(({ before, after }) => { if (before) FL().remove(before.id); if (after) FL().add(after); });
  }

  function currentDayType() {
    const u = user();
    return dayTypeFor(today(), {
      plan: read(`coachPlan_${u}`, null),
      macroSchedule: (typeof globalScope.getAssignedNutritionPlan === 'function' && (globalScope.getAssignedNutritionPlan(u) || {}).schedule) || null,
    });
  }

  let filling = false;
  /** Put today's meals in the log once (not on a completed day, not twice). */
  function ensureToday() {
    const mp = plan();
    if (filling || !mp || !FL() || !user()) return false;
    if (typeof globalScope.isMacroDayComplete === 'function' && globalScope.isMacroDayComplete()) return false;
    const d = today();
    const doneKey = `coachMealsFilled_${user()}`;
    const done = read(doneKey, {});
    const log = FL().load();
    if (done.date === d && done.key === mp.key) return false;
    if (log.some(e => e && e.date === d && e.coach && e.coach.key === mp.key)) return false; // filled on another device
    filling = true;
    try {
      apply(entriesForDay(mp, currentDayType(), { date: d, now: Date.now() }).map(after => ({ after })));
      globalScope.localStorage.setItem(doneKey, JSON.stringify({ date: d, key: mp.key }));
    } finally { filling = false; }
    return true;
  }

  function locked() {
    if (FL() && FL().locked) return FL().locked();
    return !!(globalScope.guardMacroDayLocked && globalScope.guardMacroDayLocked());
  }

  function confirmSlot(slot) {
    const mp = plan();
    const s = slotState(FL().load(), shown(), slot, mp);
    if (!s || locked()) return;
    const ids = new Set(s.entries.map(e => e.id));
    FL().save(FL().load().map(e => (ids.has(e.id) ? { ...e, confirmed: true } : e)));
    globalScope.renderFoodLog && globalScope.renderFoodLog();
  }

  /** Complete day: whatever is still in the log from the coach counts as eaten. */
  function confirmAll() {
    if (!FL()) return;
    const d = today();
    const log = FL().load();
    if (!log.some(e => e && e.date === d && e.coach && !e.confirmed)) return;
    FL().save(log.map(e => (e && e.date === d && e.coach ? { ...e, confirmed: true } : e)));
  }

  function swap(slot, option) {
    const mp = plan();
    const s = slotState(FL().load(), shown(), slot, mp);
    if (!s || locked()) return;
    const meal = mp.days[s.dayType] && mp.days[s.dayType][slot] && mp.days[s.dayType][slot][option];
    if (!meal) return;
    const Core = core();
    const adds = tagged(Core, meal, { slot, option, dayType: s.dayType, key: mp.key, date: shown(), now: Date.now() });
    apply([...s.entries.map(before => ({ before })), ...adds.map(after => ({ after }))]);
    globalScope.showToast && globalScope.showToast(`Swapped to ${meal.name}.`, 'success');
  }

  /** While nothing is confirmed or changed, switch the day to the other day type's meals. */
  function switchDay(dayType) {
    const mp = plan();
    if (!mp || locked()) return;
    const d = shown();
    const log = FL().load();
    const mine = log.filter(e => e && e.date === d && e.coach && e.coach.key === mp.key);
    apply([...mine.map(before => ({ before })), ...entriesForDay(mp, dayType, { date: d, now: Date.now() }).map(after => ({ after }))]);
  }

  // Takes coach entries out of the log; the Undo bar under the log's
  // header (food-log-tools.js) puts them back. They aren't filled in again:
  // the day is already marked as filled (synced, so on other devices too).
  function removeEntries(entries, label) {
    if (!entries.length || locked()) return;
    apply(entries.map(before => ({ before })));
    if (typeof globalScope.showFoodLogUndo === 'function') {
      globalScope.showFoodLogUndo(label, () => apply(entries.map(after => ({ after }))));
    } else if (globalScope.showToast) {
      globalScope.showToast(label, 'success');
    }
  }

  /** Remove one planned meal (e.g. the client skipped it or ate something else). */
  function removeSlot(slot) {
    const s = slotState(FL().load(), shown(), slot, plan());
    if (s) removeEntries(s.entries, `Removed ${s.meal}`);
  }

  /** Remove all of the coach's planned meals from the day shown. */
  function removeAll() {
    const mp = plan();
    if (!mp) return;
    const d = shown();
    const mine = FL().load().filter(e => e && e.date === d && e.coach && e.coach.key === mp.key);
    removeEntries(mine, 'Removed your coach’s meals');
  }

  /** Under a meal's name in the food log: what the coach planned, ✓, Swap, Remove. */
  function slotBar(slot) {
    const mp = plan();
    if (!mp || !FL()) return '';
    const s = slotState(FL().load(), shown(), slot, mp);
    if (!s) return '';
    const swap = s.alternatives.length
      ? `<select class="cm-swap" data-cm-swap="${slot}" aria-label="Swap for another meal from your coach"><option value="">Swap…</option>${s.alternatives.map(a => `<option value="${a.i}">${esc(a.name)}</option>`).join('')}</select>` : '';
    return `<div class="cm-bar${s.confirmed ? ' is-done' : ''}">
      <span class="cm-from">From your coach: <b>${esc(s.meal)}</b>${s.edited ? ' <span class="cm-edited">· changed</span>' : ''}</span>
      ${s.confirmed ? '<span class="cm-ok">✓ Eaten</span>' : `<button type="button" class="cm-confirm" data-cm-confirm="${slot}">✓ Ate this</button>`}
      ${swap}
      <button type="button" class="cm-remove" data-cm-remove="${slot}" aria-label="Remove ${esc(s.meal)} from the log">Remove</button></div>`;
  }

  /** Above the food log: the coach's note and the other day type's meals while untouched. */
  function headerHtml() {
    const mp = plan();
    if (!mp || !FL()) return '';
    const d = shown();
    const mine = FL().load().filter(e => e && e.date === d && e.coach && e.coach.key === mp.key);
    if (!mine.length) return '';
    const dt = mine[0].coach.dayType;
    const where = d === today() ? 'today’s log' : 'this day’s log';
    const untouched = mine.every(e => !e.confirmed && Math.abs((e.grams || 0) - (e.coach.grams || 0)) <= 0.5);
    const other = dt === 'training' ? 'rest' : 'training';
    const canSwitch = untouched && mp.days[other] && JSON.stringify(mp.days[other]) !== JSON.stringify(mp.days[dt]);
    return `<div class="cm-head"><span>Your coach’s ${dt === 'training' ? 'training-day' : 'rest-day'} meals are in ${where}. Tick ✓ when you’ve eaten one; change or remove anything that was different.</span>
      <span class="cm-links">
        ${canSwitch ? `<button type="button" class="cm-link" data-cm-day="${other}">Use ${other}-day meals</button>` : ''}
        <button type="button" class="cm-link cm-link--quiet" data-cm-remove-all>Remove all</button>
      </span>
      ${mp.note ? `<span class="cm-note">“${esc(mp.note)}”</span>` : ''}</div>`;
  }

  doc.addEventListener('click', e => {
    const c = e.target.closest && e.target.closest('[data-cm-confirm],[data-cm-day],[data-cm-remove],[data-cm-remove-all]');
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    if (c.dataset.cmConfirm) confirmSlot(c.dataset.cmConfirm);
    else if (c.dataset.cmDay) switchDay(c.dataset.cmDay);
    else if (c.dataset.cmRemove) removeSlot(c.dataset.cmRemove);
    else if (c.hasAttribute('data-cm-remove-all')) removeAll();
  }, true);

  doc.addEventListener('change', e => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('[data-cm-swap]') || t.value === '') return;
    swap(t.dataset.cmSwap, Number(t.value));
  });

  Object.assign(api, { sync, ensureToday, slotBar, headerHtml, confirmAll, swap, switchDay, confirmSlot, removeSlot, removeAll, plan });
})(typeof window !== 'undefined' ? window : globalThis);
