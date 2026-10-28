/* =============================================================
   FOOD LOG TOOLS — what Cronometer users expect around the log
   - Tap a logged food to change its amount or meal (or remove it).
   - Copy yesterday's foods into today.
   - "Save as meal" on a meal → a saved meal you can log again in one tap
     (mealTemplates_<user>, synced).
   - Library sheet: saved meals, recipes and your own foods.
   - Recipe builder: ingredients from search with amounts, number of
     servings, per-serving totals. Stored as one of your own foods.
   - Recipe import from a URL (schema.org Recipe data on the page).
   Pure logic lives in food-core.js; the log itself in food-database.js.
   ============================================================= */

(function () {
  'use strict';

  const Core = window.FoodCore;
  const FL = () => window.FoodLog || {};
  const Sheet = () => window.FoodSheet;
  const TPL_KEY = u => `mealTemplates_${u}`;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const user = () => window.currentUser || localStorage.getItem('fitnessAppUser') || '';
  const toast = m => (FL().toast ? FL().toast(m) : window.showToast && window.showToast(m));
  const locked = () => !!window.guardMacroDayLocked?.();

  function readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
  }

  function yesterday() {
    const t = Date.parse(FL().today() + 'T00:00:00Z') - 864e5;
    return new Date(t).toISOString().slice(0, 10);
  }

  // Applies a list of { before, after } entry changes to the log and the
  // day's running totals (only today's entries count towards those).
  function applyChanges(changes) {
    const log = FL().load();
    const today = FL().today();
    const total = { protein: 0, carbs: 0, fats: 0, cals: 0 };
    const add = d => Object.keys(total).forEach(k => { total[k] += d[k]; });
    changes.forEach(({ before, after }) => {
      if (before) {
        const i = log.findIndex(e => e.id === before.id);
        if (i >= 0) log.splice(i, 1);
        if (before.date === today) add(Core.progressDelta(before, -1));
      }
      if (after) {
        log.push(after);
        if (after.date === today) add(Core.progressDelta(after, 1));
      }
    });
    FL().save(log);
    if (Object.values(total).some(Boolean) && window.logMacroAmounts) window.logMacroAmounts(total);
    window.renderFoodLog?.();
  }

  /* ── Toolbar above today's log ───────────────────────────── */

  window.foodLogToolbar = function (todayItems) {
    const y = Core.entriesFor(FL().load(), yesterday());
    return `<div class="food-log-toolbar">
      ${y.length ? `<button type="button" class="food-mini-btn" data-copy-yesterday>Copy yesterday's foods (${y.length})</button>` : ''}
      <button type="button" class="food-mini-btn" data-open-library>Meals, recipes &amp; my foods</button>
    </div>`;
  };

  function copyYesterday() {
    if (locked()) return;
    const y = Core.entriesFor(FL().load(), yesterday());
    if (!y.length) return;
    const today = Core.entriesFor(FL().load(), FL().today());
    if (today.length && !confirm(`Add yesterday's ${y.length} foods to today's log? Today's ${today.length} foods stay.`)) return;
    applyChanges(Core.copyEntries(y, FL().today(), { now: Date.now() }).map(after => ({ after })));
    toast(`✅ Copied ${y.length} foods from yesterday`);
  }

  /* ── Edit a logged food ──────────────────────────────────── */

  function openEdit(id) {
    const entry = FL().load().find(e => e.id === id);
    if (!entry) return;
    const food = Core.foodFromEntry(entry);
    const units = food ? [food.basis, ...food.servings.map(s => s.label)] : [entry.unit || 'g'];
    const unit = units.includes(entry.unit) ? entry.unit : units[0];
    const amount = units.includes(entry.unit) ? entry.amount : entry.grams;
    Sheet().open(`
      <form class="food-form" data-edit-form>
        <div class="food-sheet-hdr"><h3>${esc(entry.name)}</h3><button type="button" class="food-sheet-x" aria-label="Close" data-close>✕</button></div>
        ${entry.brand ? `<p class="food-sheet-sub">${esc(entry.brand)} · ${esc(Core.sourceLabel(entry.source))}</p>` : ''}
        <div class="food-grid food-grid--serving">
          <label class="food-field"><span>Amount</span><input name="amount" type="number" min="0" step="any" inputmode="decimal" value="${esc(amount ?? '')}" ${food ? '' : 'disabled'} /></label>
          <label class="food-field"><span>Unit</span><select name="unit" ${food ? '' : 'disabled'}>${units.map(u => `<option value="${esc(u)}"${u === unit ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
        </div>
        <label class="food-field"><span>Meal</span><select name="meal">${Core.MEALS.map(m => `<option value="${m}"${m === entry.meal ? ' selected' : ''}>${Core.MEAL_LABELS[m]}</option>`).join('')}</select></label>
        <p class="food-sheet-sub" data-edit-preview></p>
        <div class="food-share-actions">
          <button type="submit" class="food-add-btn">Save</button>
          <button type="button" class="food-share-no" data-delete>Remove</button>
        </div>
      </form>`, { label: `Edit ${entry.name}` });
    const form = document.querySelector('[data-edit-form]');
    const grams = () => (food ? Core.gramsFor(food, form.amount.value, form.unit.value) : entry.grams);
    const preview = () => {
      const n = food ? Core.scaleNutrients(food.per100, grams()) : entry;
      form.querySelector('[data-edit-preview]').textContent = `${n.kcal || 0} kcal · ${n.protein || 0}P / ${n.carbs || 0}C / ${n.fat || 0}F`;
    };
    form.addEventListener('input', preview);
    form.addEventListener('change', preview);
    preview();
    form.querySelector('[data-close]').onclick = Sheet().close;
    form.querySelector('[data-delete]').onclick = () => {
      if (locked()) return;
      Sheet().close();
      applyChanges([{ before: entry }]);
    };
    form.onsubmit = e => {
      e.preventDefault();
      if (locked()) return;
      const g = grams();
      if (food && !(g > 0)) return;
      const after = Core.editEntry(entry, food ? { grams: g, amount: form.amount.value, unit: form.unit.value, meal: form.meal.value } : { meal: form.meal.value });
      Sheet().close();
      applyChanges([{ before: entry, after }]);
    };
  }

  /* ── Saved meals ─────────────────────────────────────────── */

  function loadTemplates() {
    const v = readJSON(TPL_KEY(user()), []);
    return Array.isArray(v) ? v : [];
  }
  function saveTemplates(list) {
    if (user()) localStorage.setItem(TPL_KEY(user()), JSON.stringify(list));
  }

  function saveMealAsTemplate(meal) {
    const items = Core.groupByMeal(Core.entriesFor(FL().load(), FL().today()))[meal] || [];
    if (!items.length) return;
    Sheet().open(`
      <form class="food-form" data-tpl-form>
        <div class="food-sheet-hdr"><h3>Save ${esc(Core.MEAL_LABELS[meal].toLowerCase())} as a meal</h3><button type="button" class="food-sheet-x" aria-label="Close" data-close>✕</button></div>
        <p class="food-sheet-sub">${items.map(e => esc(e.name)).join(', ')}</p>
        <label class="food-field"><span>Name</span><input name="name" maxlength="80" required value="My ${esc(Core.MEAL_LABELS[meal].toLowerCase())}" /></label>
        <button type="submit" class="food-add-btn">Save meal</button>
      </form>`, { label: 'Save as meal' });
    const form = document.querySelector('[data-tpl-form]');
    form.querySelector('[data-close]').onclick = Sheet().close;
    form.onsubmit = e => {
      e.preventDefault();
      const tpl = Core.templateFromEntries(form.name.value, items, { now: Date.now() });
      if (!tpl) return;
      saveTemplates([...loadTemplates(), tpl]);
      Sheet().close();
      toast(`✅ Saved "${tpl.name}"`);
    };
  }

  function logTemplate(id, meal) {
    if (locked()) return;
    const tpl = loadTemplates().find(t => t.id === id);
    if (!tpl) return;
    applyChanges(Core.entriesFromTemplate(tpl, { date: FL().today(), meal, now: Date.now() }).map(after => ({ after })));
    toast(`✅ Logged ${tpl.name}`);
  }

  /* ── Library: saved meals, recipes, my foods ─────────────── */

  function openLibrary() {
    const tpls = loadTemplates();
    const own = FL().customFoods();
    const recipes = own.filter(f => f.source === 'recipe');
    const foods = own.filter(f => f.source !== 'recipe');
    const defaultMeal = Core.mealForHour(new Date().getHours());
    const mealSelect = `<select data-lib-meal aria-label="Log saved meals to">${Core.MEALS.map(m => `<option value="${m}"${m === defaultMeal ? ' selected' : ''}>${Core.MEAL_LABELS[m]}</option>`).join('')}</select>`;
    const kcalOf = f => `${f.per100.kcal} kcal / 100${esc(f.basis || 'g')}`;
    const tplKcal = t => Core.totals(Core.entriesFromTemplate(t, { date: '2000-01-01', meal: 'snacks', now: 0 })).kcal;
    Sheet().open(`
      <div class="food-sheet-hdr"><h3>Meals, recipes &amp; my foods</h3><button type="button" class="food-sheet-x" aria-label="Close" data-close>✕</button></div>
      <div class="food-lib-actions">
        <button type="button" class="food-mini-btn" data-new-food>＋ New food</button>
        <button type="button" class="food-mini-btn" data-new-recipe>＋ New recipe</button>
        <button type="button" class="food-mini-btn" data-import-recipe>Import recipe from a link</button>
      </div>
      <h4 class="food-lib-h">Saved meals <span class="food-lib-to">log to ${mealSelect}</span></h4>
      ${tpls.length ? tpls.map(t => `<div class="food-lib-row"><span class="food-lib-name">${esc(t.name)}<small>${t.items.length} ${t.items.length === 1 ? 'food' : 'foods'} · ${tplKcal(t)} kcal</small></span>
        <button type="button" class="food-add-btn" data-log-tpl="${esc(t.id)}">Log</button>
        <button type="button" class="food-diary-del" data-del-tpl="${esc(t.id)}" aria-label="Delete ${esc(t.name)}">✕</button></div>`).join('')
        : '<p class="food-sheet-sub">None yet — use "Save as meal" on a meal in today\'s log.</p>'}
      <h4 class="food-lib-h">Recipes</h4>
      ${recipes.length ? recipes.map(f => `<div class="food-lib-row"><span class="food-lib-name">${esc(f.name)}<small>${esc(f.recipe ? f.recipe.servings + ' servings · ' : '')}${kcalOf(f)}</small></span>
        <button type="button" class="food-add-btn" data-log-food="${esc(f.id)}">Log</button>
        <button type="button" class="food-mini-btn" data-edit-recipe="${esc(f.id)}">Edit</button>
        <button type="button" class="food-diary-del" data-del-food="${esc(f.id)}" aria-label="Delete ${esc(f.name)}">✕</button></div>`).join('')
        : '<p class="food-sheet-sub">None yet.</p>'}
      <h4 class="food-lib-h">My foods</h4>
      ${foods.length ? foods.map(f => `<div class="food-lib-row"><span class="food-lib-name">${esc(f.name)}<small>${esc(f.brand ? f.brand + ' · ' : '')}${kcalOf(f)}</small></span>
        <button type="button" class="food-add-btn" data-log-food="${esc(f.id)}">Log</button>
        <button type="button" class="food-mini-btn" data-edit-food="${esc(f.id)}">Edit</button>
        <button type="button" class="food-diary-del" data-del-food="${esc(f.id)}" aria-label="Delete ${esc(f.name)}">✕</button></div>`).join('')
        : '<p class="food-sheet-sub">None yet.</p>'}`, { label: 'Meals, recipes and my foods' });

    const root = document.getElementById('foodSheet');
    root.addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      const own2 = FL().customFoods();
      if (t.matches('[data-close]')) Sheet().close();
      else if (t.matches('[data-new-food]')) window.openCustomFoodForm({ onSaved: () => openLibrary() });
      else if (t.matches('[data-new-recipe]')) openRecipeBuilder();
      else if (t.matches('[data-import-recipe]')) openRecipeImport();
      else if (t.dataset.logTpl) { logTemplate(t.dataset.logTpl, root.querySelector('[data-lib-meal]').value); Sheet().close(); }
      else if (t.dataset.delTpl) {
        if (!confirm('Delete this saved meal?')) return;
        saveTemplates(loadTemplates().filter(x => x.id !== t.dataset.delTpl)); openLibrary();
      } else if (t.dataset.logFood) {
        const f = Core.normalizeFood(own2.find(x => x.id === t.dataset.logFood));
        Sheet().close();
        if (f) window.selectFoodForLogging?.(f);
      } else if (t.dataset.editFood) {
        const f = own2.find(x => x.id === t.dataset.editFood);
        if (f) window.openCustomFoodForm({ food: f, onSaved: () => openLibrary() });
      } else if (t.dataset.editRecipe) {
        openRecipeBuilder(own2.find(x => x.id === t.dataset.editRecipe));
      } else if (t.dataset.delFood) {
        if (!confirm('Delete this food? Foods you already logged with it stay in your log.')) return;
        FL().deleteCustomFood(t.dataset.delFood); openLibrary();
      }
    });
  }
  window.openFoodLibrary = openLibrary;

  /* ── Recipe builder ──────────────────────────────────────── */

  function openRecipeBuilder(existing) {
    const state = {
      name: existing ? existing.name : '',
      servings: existing && existing.recipe ? existing.recipe.servings : 2,
      ingredients: existing && existing.recipe ? existing.recipe.ingredients.map(x => ({ ...x })) : [],
    };
    Sheet().open(`
      <form class="food-form" data-recipe-form>
        <div class="food-sheet-hdr"><h3>${existing ? 'Edit recipe' : 'New recipe'}</h3><button type="button" class="food-sheet-x" aria-label="Close" data-close>✕</button></div>
        <div class="food-grid food-grid--serving">
          <label class="food-field"><span>Name</span><input name="name" maxlength="120" value="${esc(state.name)}" required /></label>
          <label class="food-field"><span>Servings</span><input name="servings" type="number" min="1" max="100" step="1" inputmode="numeric" value="${state.servings}" /></label>
        </div>
        <label class="food-field"><span>Add an ingredient</span><input name="q" type="search" placeholder="Search, e.g. kipfilet, rijst" autocomplete="off" /></label>
        <div class="food-search-results" data-recipe-results hidden></div>
        <div data-recipe-items></div>
        <p class="food-sheet-sub" data-recipe-total></p>
        <p class="food-form-err" role="alert" hidden></p>
        <button type="submit" class="food-add-btn">Save recipe</button>
      </form>`, { label: existing ? 'Edit recipe' : 'New recipe' });
    const form = document.querySelector('[data-recipe-form]');
    const resultsEl = form.querySelector('[data-recipe-results]');
    let results = [];
    let timer = null;

    function renderItems() {
      form.querySelector('[data-recipe-items]').innerHTML = state.ingredients.map((x, i) => `
        <div class="food-lib-row"><span class="food-lib-name">${esc(x.food.name)}<small>${esc(x.food.brand || Core.sourceLabel(x.food.source))}</small></span>
          <span class="food-field-in food-recipe-g"><input type="number" min="0" step="any" inputmode="decimal" value="${x.grams}" data-ing-grams="${i}" aria-label="Grams of ${esc(x.food.name)}" /><small>${esc(x.food.basis || 'g')}</small></span>
          <button type="button" class="food-diary-del" data-ing-del="${i}" aria-label="Remove ${esc(x.food.name)}">✕</button></div>`).join('');
      renderTotal();
    }
    function renderTotal() {
      const r = Core.recipeFood({ name: form.name.value || 'x', servings: form.servings.value, ingredients: state.ingredients });
      form.querySelector('[data-recipe-total]').textContent = r.food
        ? `Per serving: ${r.perServing.kcal} kcal · ${r.perServing.protein}P / ${r.perServing.carbs}C / ${r.perServing.fat}F (${Math.round(r.food.servings[0].grams)} g)`
        : 'Add ingredients to see the totals per serving.';
    }

    form.querySelector('[data-close]').onclick = Sheet().close;
    form.q.addEventListener('input', () => {
      clearTimeout(timer);
      const q = form.q.value.trim();
      if (q.length < 2) { resultsEl.hidden = true; return; }
      timer = setTimeout(async () => {
        const r = await window.searchFoods(q);
        results = r.foods.slice(0, 8);
        resultsEl.hidden = false;
        resultsEl.innerHTML = results.length ? results.map((f, i) => `<button type="button" class="food-search-item" data-pick="${i}">
          <span class="food-item-top"><span class="food-item-name">${esc(f.name)}</span><span class="food-src-badge food-src-${esc(f.source)}">${esc(Core.sourceLabel(f.source))}</span></span>
          ${f.brand ? `<span class="food-item-brand">${esc(f.brand)}</span>` : ''}</button>`).join('')
          : `<div class="food-search-msg">${r.offline ? 'Offline — only foods you used before.' : 'No results.'}</div>`;
      }, 350);
    });
    resultsEl.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const f = results[Number(b.dataset.pick)];
      state.ingredients.push({ food: f, grams: f.servings[0] ? f.servings[0].grams : 100 });
      form.q.value = '';
      resultsEl.hidden = true;
      renderItems();
    });
    form.addEventListener('input', e => {
      if (e.target.dataset.ingGrams !== undefined) {
        state.ingredients[Number(e.target.dataset.ingGrams)].grams = Number(e.target.value) || 0;
        renderTotal();
      } else if (e.target.name === 'servings' || e.target.name === 'name') renderTotal();
    });
    form.addEventListener('click', e => {
      const d = e.target.closest('[data-ing-del]');
      if (d) { state.ingredients.splice(Number(d.dataset.ingDel), 1); renderItems(); }
    });
    form.onsubmit = e => {
      e.preventDefault();
      const r = Core.recipeFood({ name: form.name.value, servings: form.servings.value, ingredients: state.ingredients },
        { id: existing && existing.id, now: Date.now() });
      const err = form.querySelector('.food-form-err');
      if (r.error) { err.hidden = false; err.textContent = r.error; return; }
      FL().saveCustomFood(r.food);
      Sheet().close();
      toast(`✅ Recipe saved — ${r.perServing.kcal} kcal per serving`);
    };
    renderItems();
  }
  window.openRecipeBuilder = openRecipeBuilder;

  /* ── Recipe import from a link ───────────────────────────── */
  // Reads the schema.org Recipe data most recipe sites publish. Many sites
  // don't let other apps read their pages (CORS); then we say so and the
  // user builds the recipe by hand.

  async function importRecipeFromUrl(url) {
    let u;
    try { u = new URL(String(url || '').trim()); } catch { return { error: 'That isn’t a valid link.' }; }
    if (!/^https?:$/.test(u.protocol)) return { error: 'Only http(s) links can be imported.' };
    let html;
    try {
      const res = await fetch(u.toString(), { credentials: 'omit', signal: AbortSignal.timeout(8000) });
      html = await res.text();
    } catch {
      return { error: 'This site doesn’t let the app read its pages. Build the recipe from its ingredients instead.' };
    }
    const r = Core.parseRecipeJsonLd(html);
    if (!r) return { error: 'No recipe data found on that page. Build the recipe from its ingredients instead.' };
    return { recipe: r };
  }
  window.importRecipeFromUrl = importRecipeFromUrl;

  function openRecipeImport(prefill) {
    Sheet().open(`
      <form class="food-form" data-import-form>
        <div class="food-sheet-hdr"><h3>Import a recipe</h3><button type="button" class="food-sheet-x" aria-label="Close" data-close>✕</button></div>
        <label class="food-field"><span>Recipe link</span><input name="url" type="url" inputmode="url" placeholder="https://…" value="${esc(prefill || '')}" required /></label>
        <p class="food-form-err" role="alert" hidden></p>
        <button type="submit" class="food-add-btn">Import</button>
      </form>`, { label: 'Import a recipe' });
    const form = document.querySelector('[data-import-form]');
    form.querySelector('[data-close]').onclick = Sheet().close;
    form.onsubmit = async e => {
      e.preventDefault();
      const err = form.querySelector('.food-form-err');
      err.hidden = true;
      const { recipe, error } = await importRecipeFromUrl(form.url.value);
      if (error) { err.hidden = false; err.textContent = error; return; }
      const p = recipe.perServing;
      if (p.protein === null && p.carbs === null && p.fat === null) {
        err.hidden = false;
        err.textContent = `Found "${recipe.name}" but it lists no nutrition. Build it from its ${recipe.ingredients.length} ingredients instead.`;
        return;
      }
      // The page gives nutrition per serving without a weight: store one
      // serving as 100 g so the numbers stay per serving.
      window.openCustomFoodForm({
        food: {
          name: recipe.name, brand: '', basis: 'g',
          per100: { kcal: p.kcal ?? undefined, protein: p.protein ?? 0, carbs: p.carbs ?? 0, fat: p.fat ?? 0, fiber: p.fiber ?? undefined, sugar: p.sugar ?? undefined },
          servings: [{ label: '1 serving', grams: 100 }],
        },
        note: `Imported from the recipe page (${recipe.servings} servings). The values are per serving; one serving is stored as 100 g. Check them before saving.`,
      });
    };
  }
  window.openRecipeImport = openRecipeImport;

  /* ── Wiring ──────────────────────────────────────────────── */

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-edit-entry],[data-copy-yesterday],[data-open-library],[data-save-meal]');
    if (!t || t.closest('#foodSheet')) return;
    if (t.dataset.editEntry) openEdit(t.dataset.editEntry);
    else if (t.matches('[data-copy-yesterday]')) copyYesterday();
    else if (t.matches('[data-open-library]')) openLibrary();
    else if (t.dataset.saveMeal) saveMealAsTemplate(t.dataset.saveMeal);
  });
})();
