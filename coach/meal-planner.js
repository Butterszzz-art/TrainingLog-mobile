/* Coach dashboard: meal plans (Nutrition tab).
 *
 * Build meals from foods (your approved foods first, then the food search),
 * keep them in your meal library, and lay out a training day and a rest day:
 * per slot (breakfast, lunch, dinner, snacks) a meal plus up to three
 * alternatives the client can swap to. Day totals show against the client's
 * targets for that day type. Send puts the plan in the client's app, where
 * each day's food log fills with that day's meals (counted); the client
 * confirms, edits or swaps them, then completes the day.
 *
 * Meals use the app's saved-meal shape (food-core.js):
 *   { id, name, note, items: [{ food, grams, amount, unit }] }
 *
 *   MealPlanner.mount(container, { clientName, plan, targets, api })
 *     api: { meals() → [meal], coachFoods() → [food], search(q) → [food],
 *            saveMeal(meal) → meal, send(plan, message), clear() }
 *   MealPlanner.mealTotals(meal), dayTotals(day)   (pure, tested) */
(function (root) {
  'use strict';

  const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks']];
  const DAYS = [['training', 'Training day'], ['rest', 'Rest day']];
  const MAX_OPTIONS = 4;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const clone = v => JSON.parse(JSON.stringify(v));

  function mealTotals(meal) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    ((meal && meal.items) || []).forEach(it => {
      const p = (it.food && it.food.per100) || {};
      Object.keys(t).forEach(k => { t[k] += ((Number(p[k]) || 0) * (Number(it.grams) || 0)) / 100; });
    });
    return { kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
  }

  /** The default meal of each slot (the client's plan unless they swap). */
  function dayTotals(day) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    SLOTS.forEach(([s]) => {
      const m = day && day[s] && day[s][0];
      if (!m) return;
      const x = mealTotals(m);
      Object.keys(t).forEach(k => { t[k] += x[k]; });
    });
    return t;
  }

  const macroLine = t => `${t.kcal} kcal · P ${t.protein} · C ${t.carbs} · F ${t.fat}`;

  function diffLine(t, target) {
    if (!target || target.kcal == null) return '';
    const d = k => {
      const v = Math.round((t[k] || 0) - (target[k] || 0));
      return `<span class="mp2-diff${Math.abs(v) > (k === 'kcal' ? 100 : 10) ? ' is-off' : ''}">${v > 0 ? '+' : ''}${v}${k === 'kcal' ? '' : 'g'}</span>`;
    };
    return `Target ${macroLine(target)} · difference ${d('kcal')} kcal, P ${d('protein')}, C ${d('carbs')}, F ${d('fat')}`;
  }

  function newId(name) {
    return (String(name || 'meal').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'meal')
      + '-' + Math.random().toString(36).slice(2, 6);
  }

  function mount(container, opts) {
    const o = opts || {};
    const api = o.api || {};
    const state = {
      day: 'training',
      plan: o.plan && o.plan.days ? clone({ training: o.plan.days.training || {}, rest: o.plan.days.rest || {} }) : { training: {}, rest: {} },
      note: (o.plan && o.plan.note) || '',
      editing: null,   // { slot, index (null = new), meal }
      results: [],
      query: '',
      busy: false,
      message: '',
    };
    let library = [];
    let coachFoods = [];
    Promise.resolve(api.meals ? api.meals() : []).then(m => { library = m || []; render(); }).catch(() => {});
    Promise.resolve(api.coachFoods ? api.coachFoods() : []).then(f => { coachFoods = f || []; }).catch(() => {});

    const day = () => state.plan[state.day];

    function optionHtml(m, slot, i) {
      const t = mealTotals(m);
      return `<div class="mp2-meal${i === 0 ? ' is-default' : ''}">
        <div class="mp2-meal-main"><span class="mp2-tag">${i === 0 ? 'Meal' : `Alternative ${i}`}</span>
          <b>${esc(m.name)}</b><small>${esc(m.items.map(it => `${it.food.name} ${Math.round(it.grams)} g`).join(', '))}</small></div>
        <span class="mp2-macros">${macroLine(t)}</span>
        <span class="mp2-acts">
          <button type="button" class="pb-link" data-mp="edit" data-slot="${slot}" data-i="${i}">Edit</button>
          ${i > 0 ? `<button type="button" class="pb-link" data-mp="default" data-slot="${slot}" data-i="${i}">Make main</button>` : ''}
          <button type="button" class="pb-icon" data-mp="remove" data-slot="${slot}" data-i="${i}" aria-label="Remove ${esc(m.name)}">✕</button>
        </span></div>`;
    }

    function slotHtml([slot, label]) {
      const opts = day()[slot] || [];
      const canAdd = opts.length < MAX_OPTIONS;
      const libOpts = library.map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${mealTotals(m).kcal} kcal)</option>`).join('');
      return `<section class="mp2-slot"><header class="mp2-slot-head"><span class="mp2-slot-name">${label}</span>
          ${opts.length ? `<span class="mp2-macros">${macroLine(mealTotals(opts[0]))}</span>` : '<span class="mp2-macros">Nothing planned</span>'}</header>
        ${opts.map((m, i) => optionHtml(m, slot, i)).join('')}
        ${canAdd ? `<div class="mp2-add">
          ${library.length ? `<select class="pb-in" data-mp-lib="${slot}" aria-label="Add a meal from your library"><option value="">${opts.length ? '+ Alternative from your meals…' : '+ Meal from your meals…'}</option>${libOpts}</select>` : ''}
          <button type="button" class="pb-link" data-mp="new" data-slot="${slot}">+ New meal</button></div>` : ''}
      </section>`;
    }

    function editorHtml() {
      const e = state.editing;
      const m = e.meal;
      const t = mealTotals(m);
      const rows = m.items.map((it, i) => {
        const x = mealTotals({ items: [it] });
        return `<tr><td>${esc(it.food.name)}${it.food.brand ? `<small> · ${esc(it.food.brand)}</small>` : ''}</td>
          <td><input class="pb-in pb-in--num" type="number" min="1" max="5000" data-mp-grams="${i}" value="${esc(it.grams)}" aria-label="Grams of ${esc(it.food.name)}"> g</td>
          <td class="mp2-macros">${macroLine(x)}</td>
          <td><button type="button" class="pb-icon" data-mp="drop-item" data-i="${i}" aria-label="Remove ${esc(it.food.name)}">✕</button></td></tr>`;
      }).join('');
      const results = state.results.map((f, i) => `<li><button type="button" class="mp2-result" data-mp="pick" data-i="${i}">
          <b>${esc(f.name)}</b>${f.brand ? ` <small>${esc(f.brand)}</small>` : ''}${f.source === 'coach' ? ' <span class="mp2-tag">Your food</span>' : ''}
          <small>${Math.round(f.per100.kcal || 0)} kcal · P ${f.per100.protein ?? '–'} · C ${f.per100.carbs ?? '–'} · F ${f.per100.fat ?? '–'} per 100 ${f.basis === 'ml' ? 'ml' : 'g'}</small></button></li>`).join('');
      return `<div class="mp2-editor">
        <div class="mp2-editor-top"><label class="mp-field"><span class="mp-field-label">Meal name</span><input class="mp-input mp-input--text" data-mp-name value="${esc(m.name)}" maxlength="80" placeholder="e.g. Oats & whey"></label>
          <span class="mp2-macros">${macroLine(t)}</span></div>
        <table class="mp2-items"><tbody>${rows || '<tr><td colspan="4" class="ws-empty-note">Add foods below.</td></tr>'}</tbody></table>
        <div class="mp2-search"><input class="pb-in" data-mp-search value="${esc(state.query)}" placeholder="Add a food: search your foods and the food database" aria-label="Search foods">
          <button type="button" class="pb-link" data-mp="search">Search</button></div>
        ${results ? `<ul class="mp2-results">${results}</ul>` : ''}
        <label class="mp-field mp-field--wide"><span class="mp-field-label">Note for the client (optional)</span><input class="mp-input mp-input--text" data-mp-note value="${esc(m.note || '')}" maxlength="300" placeholder="e.g. Cook the rice the night before"></label>
        <div class="mp-adjust-actions"><button type="button" class="mp-btn" data-mp="save-meal"${state.busy ? ' disabled' : ''}>${state.editing.index == null ? 'Add to plan' : 'Save meal'}</button>
          <button type="button" class="pb-link" data-mp="cancel-edit">Cancel</button>
          <span class="mp-adjust-count">Also saved to your meals for other clients</span></div>
      </div>`;
    }

    function render() {
      const d = day();
      const totals = dayTotals(d);
      const target = o.targets && o.targets[state.day];
      const sent = o.plan && o.plan.sentAt ? `Sent ${new Date(o.plan.sentAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.` : 'Not sent yet.';
      container.innerHTML = `<div class="mp2">
        <div class="mp2-bar"><div class="mt-mode" role="tablist" aria-label="Day type">${DAYS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${state.day === k}" class="mt-mode-btn${state.day === k ? ' is-on' : ''}" data-mp-day="${k}">${l}</button>`).join('')}</div>
          <button type="button" class="pb-link" data-mp="copy-day">Copy to ${state.day === 'training' ? 'rest' : 'training'} day</button>
          <span class="pb-stats">${esc(sent)}</span></div>
        <p class="mp2-total"><b>${DAYS.find(x => x[0] === state.day)[1]}:</b> ${macroLine(totals)}${target ? `<br><small>${diffLine(totals, target)}</small>` : ''}</p>
        ${state.editing ? editorHtml() : SLOTS.map(slotHtml).join('')}
        ${state.editing ? '' : `<label class="mp-field mp-field--wide"><span class="mp-field-label">Note for ${esc(o.clientName || 'the client')} (optional)</span>
          <textarea class="coach-input" rows="2" maxlength="500" data-mp-plan-note placeholder="e.g. Follow these; swap breakfast if you prefer eggs.">${esc(state.note)}</textarea></label>
        <div class="mp-adjust-actions"><button type="button" class="mp-btn mp-btn--gold" data-mp="send"${state.busy ? ' disabled' : ''}>Send meal plan</button>
          ${o.plan ? '<button type="button" class="pb-link pb-link--danger" data-mp="clear">Remove meal plan</button>' : ''}
          <span class="pb-msg" role="status">${esc(state.message)}</span></div>
        <p class="ws-empty-note">${esc(o.clientName || 'The client')}’s food log fills with that day’s meals (training or rest day, by their schedule). They confirm or change them, can swap to an alternative, and complete the day.</p>`}
      </div>`;
    }

    async function search() {
      const q = state.query.trim().toLowerCase();
      if (!q) return;
      const mine = coachFoods.filter(f => String(f.name).toLowerCase().includes(q)).map(f => ({ ...f, source: 'coach' })).slice(0, 8);
      state.results = mine;
      render();
      try {
        const found = await api.search(q);
        state.results = mine.concat((found || []).filter(f => f && f.per100 && f.per100.protein != null).slice(0, 15));
      } catch (_e) { /* the coach's own foods still show */ }
      render();
      container.querySelector('[data-mp-search]')?.focus();
    }

    container.addEventListener('input', ev => {
      const t = ev.target;
      if (t.matches('[data-mp-plan-note]')) state.note = t.value;
      else if (t.matches('[data-mp-search]')) state.query = t.value;
      else if (state.editing && t.matches('[data-mp-name]')) state.editing.meal.name = t.value;
      else if (state.editing && t.matches('[data-mp-note]')) state.editing.meal.note = t.value;
    });

    container.addEventListener('change', ev => {
      const t = ev.target;
      if (t.matches('[data-mp-grams]') && state.editing) {
        const it = state.editing.meal.items[Number(t.dataset.mpGrams)];
        const g = Math.max(1, Math.min(5000, Number(t.value) || 0));
        it.amount = it.unit && it.unit !== it.food.basis && it.grams ? Math.round((it.amount * g / it.grams) * 100) / 100 : g;
        it.grams = g;
        render();
      } else if (t.matches('[data-mp-lib]') && t.value) {
        const m = library.find(x => x.id === t.value);
        if (m) (day()[t.dataset.mpLib] = day()[t.dataset.mpLib] || []).push(clone(m));
        render();
      }
    });

    container.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && ev.target.matches('[data-mp-search]')) { ev.preventDefault(); search(); }
    });

    container.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-mp],[data-mp-day]');
      if (!b || !container.contains(b) || b.disabled) return;
      if (b.dataset.mpDay) { state.day = b.dataset.mpDay; state.editing = null; render(); return; }
      const act = b.dataset.mp;
      const slot = b.dataset.slot;
      const i = Number(b.dataset.i);
      const d = day();
      if (act === 'new') state.editing = { slot, index: null, meal: { id: null, name: '', note: '', items: [] } };
      else if (act === 'edit') state.editing = { slot, index: i, meal: clone(d[slot][i]) };
      else if (act === 'remove') { d[slot].splice(i, 1); if (!d[slot].length) delete d[slot]; }
      else if (act === 'default') { const [m] = d[slot].splice(i, 1); d[slot].unshift(m); }
      else if (act === 'copy-day') {
        const other = state.day === 'training' ? 'rest' : 'training';
        if (Object.keys(state.plan[other]).length && !root.confirm(`Replace the ${other} day with a copy of this one?`)) return;
        state.plan[other] = clone(d);
        state.message = `Copied to the ${other} day.`;
      } else if (act === 'search') { search(); return; }
      else if (act === 'pick') {
        const f = state.results[i];
        state.editing.meal.items.push({ food: { id: f.id || null, source: f.source || 'coach', name: f.name, brand: f.brand || '', basis: f.basis === 'ml' ? 'ml' : 'g', per100: f.per100, servings: f.servings || [] }, grams: 100, amount: 100, unit: f.basis === 'ml' ? 'ml' : 'g' });
        state.results = [];
        state.query = '';
      } else if (act === 'drop-item') state.editing.meal.items.splice(i, 1);
      else if (act === 'cancel-edit') state.editing = null;
      else if (act === 'save-meal') {
        const e = state.editing;
        if (!e.meal.name.trim()) { root.alert('Give the meal a name.'); return; }
        if (!e.meal.items.length) { root.alert('Add at least one food.'); return; }
        state.busy = true; render();
        try {
          const meal = { ...e.meal, id: e.meal.id || newId(e.meal.name) };
          const saved = (api.saveMeal && await api.saveMeal(meal)) || meal;
          library = library.filter(x => x.id !== saved.id).concat(saved).sort((a, b) => a.name.localeCompare(b.name));
          const list = d[e.slot] = d[e.slot] || [];
          if (e.index == null) list.push(saved); else list[e.index] = saved;
          state.editing = null;
        } catch (err) { root.alert(err.message || 'Could not save the meal.'); }
        state.busy = false;
      } else if (act === 'send') {
        if (!Object.keys(state.plan.training).length && !Object.keys(state.plan.rest).length) { state.message = 'Add at least one meal first.'; render(); return; }
        state.busy = true; state.message = ''; render();
        try {
          await api.send({ days: state.plan }, state.note.trim());
          o.plan = { days: clone(state.plan), note: state.note.trim(), sentAt: new Date().toISOString() };
          state.message = 'Sent. ' + (o.clientName || 'The client') + ' gets a notification, and their food log fills with these meals.';
        } catch (err) { state.message = err.message || 'Could not send.'; }
        state.busy = false;
      } else if (act === 'clear') {
        if (!root.confirm('Remove the meal plan? Meals already in their log stay.')) return;
        try { await api.clear(); state.plan = { training: {}, rest: {} }; state.message = 'Meal plan removed.'; } catch (err) { state.message = err.message; }
      }
      render();
    });

    render();
    return { state: () => state };
  }

  root.MealPlanner = { mount, mealTotals, dayTotals, SLOTS };
})(typeof window !== 'undefined' ? window : globalThis);
