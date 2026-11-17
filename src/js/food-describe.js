/* =============================================================
   DESCRIBE TO LOG — "What did you eat?" in plain words (Pro)
   The Describe tab of the Log food sheet. The user types what they ate
   ("2 eggs, toast with butter, flat white"); POST /api/ai/food-describe
   splits it into foods and finds each in Open Food Facts / USDA (the AI
   never gives the numbers). Every food comes back as a row to check:
   which match, how much, include or not. "Log" adds the ticked ones to
   the chosen meal like any other food.
   Pro and AI consent are handled by the app's AI fetch wrapper
   (ai-consent.js): without them it shows the consent sheet or upgrade.
   ============================================================= */

(function () {
  'use strict';

  const Core = () => window.FoodCore;
  const FL = () => window.FoodLog || {};
  const MAX_TEXT = 400;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => (typeof ICONS !== 'undefined' && ICONS[name]) || ''; // eslint-disable-line no-undef
  const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
  // Coach set "log only": no calorie numbers (food-database.js applyLogOnly).
  const logOnly = () => document.documentElement.classList.contains('pc-log-only');
  const logLabel = t => `Log ${t.count} food${t.count === 1 ? '' : 's'}${logOnly() ? '' : ` · ${t.kcal} kcal`}`;

  // { host, meal, text, state: 'idle'|'loading'|'done'|'error', error, rows }
  // row: { item, foods, pick (index), amount, unit, on }
  let st = { host: null, meal: null, text: '', state: 'idle', error: '', rows: [] };
  let seq = 0;

  function authHeaders() { return FL().authHeaders ? FL().authHeaders() : {}; }

  function rowFor(item) {
    const foods = (item.foods || []).map(f => Core().normalizeFood(f)).filter(Boolean);
    const row = { item, foods, pick: 0, on: foods.length > 0, amount: 100, unit: 'g' };
    if (foods.length) Object.assign(row, Core().amountFor(foods[0], item));
    return row;
  }

  function gramsOf(row) {
    const f = row.foods[row.pick];
    return f ? Core().gramsFor(f, row.amount, row.unit) : 0;
  }

  function nutrientsOf(row) {
    const f = row.foods[row.pick];
    return f ? Core().scaleNutrients(f.per100, gramsOf(row)) : {};
  }

  /* ── Drawing ─────────────────────────────────────────────── */

  function unitOptions(food, unit) {
    const opts = [food.basis, ...food.servings.map(s => s.label)];
    return opts.map(u => `<option value="${esc(u)}"${u === unit ? ' selected' : ''}>${esc(u)}</option>`).join('');
  }

  function rowHtml(row, i) {
    const said = esc(row.item.text || row.item.search);
    if (!row.foods.length) {
      return `
        <div class="fd-row is-missing">
          <div class="fd-said">“${said}”</div>
          <p class="fd-miss">No match found.</p>
          <button type="button" class="mx-link fd-search" data-fd-search="${i}">Search for it</button>
        </div>`;
    }
    const f = row.foods[row.pick];
    const n = nutrientsOf(row);
    const label = x => `${x.name}${x.brand ? ` · ${x.brand}` : ''}`;
    return `
      <div class="fd-row${row.on ? '' : ' is-off'}">
        <label class="fd-check"><input type="checkbox" data-fd-on="${i}"${row.on ? ' checked' : ''} aria-label="Log ${esc(f.name)}"></label>
        <div class="fd-main">
          <div class="fd-said">“${said}”</div>
          <select class="fd-food" data-fd-pick="${i}" aria-label="Food for ${said}">
            ${row.foods.map((x, k) => `<option value="${k}"${k === row.pick ? ' selected' : ''}>${esc(label(x))} (${esc(Core().sourceLabel(x.source))})</option>`).join('')}
          </select>
          <div class="fd-amount">
            <input type="number" class="food-serving-input" data-fd-amount="${i}" value="${esc(row.amount)}" min="0" max="9999" step="any" inputmode="decimal" aria-label="Amount">
            <select class="food-serving-unit-select" data-fd-unit="${i}" aria-label="Unit">${unitOptions(f, row.unit)}</select>
          </div>
          <div class="fd-macros" data-fd-macros="${i}">${macrosHtml(n)}</div>
        </div>
      </div>`;
  }

  function macrosHtml(n) {
    return `<span class="fd-kcal">${n.kcal || 0} kcal</span>
      <span class="fim protein-badge">${r1(n.protein)}P</span>
      <span class="fim carbs-badge">${r1(n.carbs)}C</span>
      <span class="fim fat-badge">${r1(n.fat)}F</span>`;
  }

  function totalsHtml() {
    const on = st.rows.filter(r => r.on && r.foods.length);
    const kcal = on.reduce((s, r) => s + (nutrientsOf(r).kcal || 0), 0);
    return { count: on.length, kcal };
  }

  function mealOptions() {
    const C = Core();
    FL().applyMeals?.();
    const day = FL().day ? FL().day() : '';
    const pick = st.meal && C.ALL_MEALS.includes(st.meal) ? st.meal
      : (day && FL().today && day === FL().today() ? C.mealForHour(new Date().getHours()) : C.MEALS[0]);
    const list = C.MEALS.includes(pick) ? C.MEALS : [...C.MEALS, pick];
    return list.map(m => `<option value="${m}"${m === pick ? ' selected' : ''}>${esc(C.MEAL_LABELS[m])}</option>`).join('');
  }

  function draw() {
    const host = st.host;
    if (!host) return;
    const busy = st.state === 'loading';
    let body = '';
    if (st.state === 'loading') {
      body = '<div class="fd-loading" role="status"><span class="fd-spinner" aria-hidden="true"></span>Finding your foods…</div>';
    } else if (st.state === 'error') {
      body = `<p class="fd-error" role="alert">${esc(st.error)}</p>`;
    } else if (st.state === 'done' && !st.rows.length) {
      body = '<p class="fd-error" role="status">No food found in that. Try listing what you ate, e.g. “2 eggs, 1 slice of toast, coffee with milk”.</p>';
    } else if (st.state === 'done') {
      const t = totalsHtml();
      body = `
        <p class="food-sheet-sub fd-check-note">Check the matches and amounts, then log them.</p>
        <div class="fd-rows">${st.rows.map(rowHtml).join('')}</div>
        <div class="fd-footer">
          <label class="food-serving-label" for="fdMeal">Meal</label>
          <select id="fdMeal" class="food-serving-unit-select" data-fd-meal>${mealOptions()}</select>
          <button type="button" class="food-add-btn" data-fd-log${t.count ? '' : ' disabled'}>${logLabel(t)}</button>
        </div>`;
    }
    host.innerHTML = `
      <form class="fd-form" data-fd-form>
        <label class="fd-label" for="fdText">What did you eat?</label>
        <textarea id="fdText" class="fd-text" rows="3" maxlength="${MAX_TEXT}" placeholder="e.g. 2 eggs, a slice of toast with butter and a flat white" ${busy ? 'disabled' : ''}>${esc(st.text)}</textarea>
        <div class="fd-actions">
          <span class="fd-pro"><span class="ui-icon">${icon('sparkles')}</span>Pro · uses 1 AI credit</span>
          <button type="submit" class="food-add-btn" ${busy ? 'disabled' : ''}>${st.state === 'done' ? 'Find again' : 'Find foods'}</button>
        </div>
      </form>
      ${body}`;
  }

  // Only the numbers of one row change while typing an amount, so the
  // input keeps focus.
  function refreshRow(i) {
    const row = st.rows[i];
    const el = st.host && st.host.querySelector(`[data-fd-macros="${i}"]`);
    if (row && el) el.innerHTML = macrosHtml(nutrientsOf(row));
    const t = totalsHtml();
    const btn = st.host && st.host.querySelector('[data-fd-log]');
    if (btn) {
      btn.textContent = logLabel(t);
      btn.disabled = !t.count;
    }
  }

  /* ── Server ──────────────────────────────────────────────── */

  async function find() {
    const text = st.text.trim();
    if (text.length < 2) return;
    const my = ++seq;
    st.state = 'loading';
    st.rows = [];
    draw();
    try {
      const res = await fetch(`${window.SERVER_URL}/api/ai/food-describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (my !== seq) return;
      if (!res.ok || !data || !data.success) {
        st.state = 'error';
        st.error = (data && typeof data.error === 'string' && data.error) || 'AI logging didn’t work just now. Try again, or search for the foods.';
      } else {
        st.rows = (data.items || []).map(rowFor);
        st.state = 'done';
      }
    } catch {
      if (my !== seq) return;
      st.state = 'error';
      st.error = navigator.onLine === false ? 'You’re offline. AI logging needs a connection.' : 'AI logging didn’t work just now. Try again, or search for the foods.';
    }
    draw();
  }

  /* ── Logging ─────────────────────────────────────────────── */

  function logAll() {
    const C = Core();
    if (FL().locked && FL().locked()) return;
    const meal = st.host.querySelector('[data-fd-meal]')?.value || C.MEALS[0];
    const date = FL().day ? FL().day() : FL().today();
    const now = Date.now();
    const rows = st.rows.filter(r => r.on && r.foods.length && gramsOf(r) > 0);
    if (!rows.length) return;
    const entries = rows.map((r, i) => C.makeEntry(r.foods[r.pick], { grams: gramsOf(r), amount: r.amount, unit: r.unit, date, meal, now: now + i }));
    FL().addRecent?.(rows.map(r => r.foods[r.pick]), meal);
    if (typeof window.applyFoodLogChanges === 'function') window.applyFoodLogChanges(entries.map(after => ({ after })));
    else entries.forEach(e => FL().add(e));
    const kcal = entries.reduce((s, e) => s + (e.kcal || 0), 0);
    st = { host: st.host, meal: st.meal, text: '', state: 'idle', error: '', rows: [] };
    draw();
    window.closeFoodSearch?.();
    FL().toast?.(`✅ ${entries.length} food${entries.length === 1 ? '' : 's'} logged${logOnly() ? '' : ` — ${kcal} kcal`}`);
  }

  // A food with no match: search for it in the Search tab instead.
  function searchInstead(i) {
    const row = st.rows[i];
    if (!row) return;
    window.showFoodSheetTab?.('search');
    const input = document.getElementById('foodSearchInput');
    if (input) {
      input.value = row.item.text || row.item.search;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }
  }

  /* ── Events ──────────────────────────────────────────────── */

  function bind(host) {
    if (host.dataset.fdBound) return;
    host.dataset.fdBound = '1';
    host.addEventListener('submit', (e) => {
      if (!e.target.matches('[data-fd-form]')) return;
      e.preventDefault();
      st.text = (host.querySelector('#fdText')?.value || '').slice(0, MAX_TEXT);
      find();
    });
    host.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'fdText') { st.text = t.value.slice(0, MAX_TEXT); return; }
      if (t.dataset.fdAmount !== undefined) {
        const i = Number(t.dataset.fdAmount);
        if (st.rows[i]) { st.rows[i].amount = t.value; refreshRow(i); }
      }
    });
    host.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.fdOn !== undefined) {
        const i = Number(t.dataset.fdOn);
        st.rows[i].on = t.checked;
        t.closest('.fd-row')?.classList.toggle('is-off', !t.checked);
        refreshRow(i);
      } else if (t.dataset.fdPick !== undefined) {
        const i = Number(t.dataset.fdPick);
        const row = st.rows[i];
        row.pick = Number(t.value);
        Object.assign(row, Core().amountFor(row.foods[row.pick], row.item));
        draw();
      } else if (t.dataset.fdUnit !== undefined) {
        const i = Number(t.dataset.fdUnit);
        const row = st.rows[i];
        const f = row.foods[row.pick];
        // Switching to a serving starts at 1 of it; back to g/ml keeps the weight.
        const before = gramsOf(row);
        row.unit = t.value;
        row.amount = t.value === f.basis ? (before || 100) : 1;
        draw();
      } else if (t.dataset.fdMeal !== undefined) {
        st.meal = t.value;
      }
    });
    host.addEventListener('click', (e) => {
      if (e.target.closest('[data-fd-log]')) logAll();
      const s = e.target.closest('[data-fd-search]');
      if (s) searchInstead(Number(s.dataset.fdSearch));
    });
    host.addEventListener('keydown', (e) => {
      // Enter sends; Shift+Enter is a new line.
      if (e.target.id === 'fdText' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        host.querySelector('[data-fd-form]')?.requestSubmit();
      }
    });
  }

  // From the Log food sheet's Describe tab (food-database.js).
  function open({ host, meal } = {}) {
    if (!host) return;
    st.host = host;
    st.meal = meal || null;
    bind(host);
    draw();
    if (st.state === 'idle') setTimeout(() => host.querySelector('#fdText')?.focus(), 30);
  }

  window.openFoodDescribe = open;
  window.FoodDescribe = { open, _state: () => st };
})();
