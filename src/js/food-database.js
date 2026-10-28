/* =============================================================
   FOOD DATABASE — food search + food log
   Searchable food picker injected above the macro meal container.
   Selecting a food adds macros to the daily totals and writes to a
   per-user food diary in localStorage.

   Search goes through our backend (/api/food/search), which asks
   USDA FoodData Central with a server-side key and Open Food Facts,
   then merges and caches the answers. No API key lives in the app.
   Pure helpers live in food-core.js.
   ============================================================= */

(function initFoodDatabase() {
  'use strict';

  const Core = window.FoodCore;
  const RECENT_KEY = u => `recentFoods_${u}`;
  const _searchCache = new Map(); // query -> server foods, for this session

  /* ── Helpers ─────────────────────────────────────────────── */

  function _debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') || '';
  }

  function _esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
  }

  function _authHeaders() {
    if (typeof window.getAuthHeaders === 'function') return window.getAuthHeaders();
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /* ── Search ──────────────────────────────────────────────── */

  // Foods on this device that match the query (recently logged ones).
  function _localMatches(q) {
    const recent = _readJSON(RECENT_KEY(_user()), []);
    return [recent.filter(f => Core.matchesQuery(f, q))];
  }

  // → { foods, offline?, error? }
  async function searchFoods(query) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) return { foods: [] };
    const local = _localMatches(q);
    if (_searchCache.has(q)) return { foods: Core.mergeResults(local, _searchCache.get(q), 25) };
    if (!navigator.onLine || !window.SERVER_URL) {
      return { foods: Core.mergeResults(local, [], 25), offline: true };
    }
    try {
      const res = await fetch(`${window.SERVER_URL}/api/food/search?q=${encodeURIComponent(q)}&limit=20`, {
        headers: _authHeaders(), signal: AbortSignal.timeout(9000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) throw new Error((data && data.error && data.error.message) || 'Search failed');
      const foods = (data.foods || []).map(Core.normalizeFood).filter(Boolean);
      _searchCache.set(q, foods);
      return { foods: Core.mergeResults(local, foods, 25) };
    } catch (err) {
      return { foods: Core.mergeResults(local, [], 25), error: err.message || 'Search failed' };
    }
  }
  window.searchFoods = searchFoods;

  /* ── Inject food-search widget ───────────────────────────── */

  function injectFoodSearchWidget() {
    const container = document.getElementById('macroMealContainer');
    if (!container || document.getElementById('foodSearchWidget')) return;

    const widget = document.createElement('div');
    widget.id = 'foodSearchWidget';
    widget.className = 'food-search-widget';
    widget.innerHTML = `
      <div class="food-search-bar">
        <span class="food-search-icon" aria-hidden="true">🍽️</span>
        <input type="search" id="foodSearchInput" class="food-search-input"
          placeholder="Search food — e.g. kwark, hagelslag, rice" autocomplete="off" enterkeyhint="search"
          aria-label="Search food" />
      </div>
      <div id="foodSearchResults" class="food-search-results" hidden></div>
      <div id="foodSelectedInfo" class="food-selected-info" hidden>
        <div class="food-selected-top">
          <span class="food-selected-name" id="foodSelectedName"></span>
          <button type="button" class="food-selected-clear" onclick="clearFoodSelection()" aria-label="Clear selected food">✕</button>
        </div>
        <div class="food-macro-badges">
          <span class="food-macro-badge kcal-badge" id="fsbKcal">0 kcal</span>
          <span class="food-macro-badge protein-badge" id="fsbProtein">0g P</span>
          <span class="food-macro-badge carbs-badge" id="fsbCarbs">0g C</span>
          <span class="food-macro-badge fat-badge" id="fsbFat">0g F</span>
        </div>
        <div class="food-serving-row">
          <label class="food-serving-label" for="foodServingInput">Amount</label>
          <input type="number" id="foodServingInput" class="food-serving-input"
            value="100" min="0" max="9999" step="any" inputmode="decimal" />
          <select id="foodServingUnit" class="food-serving-unit-select" aria-label="Unit"></select>
          <button type="button" class="food-add-btn" onclick="addFoodMacrosToDaily()">＋ Add</button>
        </div>
      </div>
    `;

    container.parentNode.insertBefore(widget, container);

    const input     = widget.querySelector('#foodSearchInput');
    const resultsEl = widget.querySelector('#foodSearchResults');
    let seq = 0;

    const doSearch = _debounce(async (q) => {
      if (q.length < 2) { resultsEl.hidden = true; return; }
      const mine = ++seq;
      resultsEl.hidden = false;
      resultsEl.innerHTML = '<div class="food-search-msg">Searching…</div>';
      const result = await searchFoods(q);
      if (mine !== seq) return; // a newer search is on its way
      _renderResults(resultsEl, result);
    }, 400);

    input.addEventListener('input', () => doSearch(input.value.trim()));
    resultsEl.addEventListener('click', (e) => {
      const item = e.target.closest('[data-food-idx]');
      if (item) _selectFood(_lastResults[Number(item.dataset.foodIdx)]);
    });
    document.addEventListener('click', (e) => {
      if (!widget.contains(e.target)) resultsEl.hidden = true;
    });
  }

  let _lastResults = [];

  function _renderResults(el, { foods, offline, error }) {
    _lastResults = foods;
    const note = offline ? 'Offline — showing foods you logged before.'
      : error ? 'Search is unavailable right now — showing foods you logged before.' : '';
    if (!foods.length) {
      el.innerHTML = `<div class="food-search-msg">${_esc(note || 'No results — try another word (Dutch or English both work).')}</div>`;
      return;
    }
    const hasOff = foods.some(f => f.source === 'off');
    el.innerHTML = (note ? `<div class="food-search-msg">${_esc(note)}</div>` : '') + foods.map((f, i) => {
      const p = f.per100;
      return `
        <button type="button" class="food-search-item" data-food-idx="${i}">
          <span class="food-item-top">
            <span class="food-item-name">${_esc(f.name)}</span>
            <span class="food-src-badge food-src-${_esc(f.source)}">${_esc(Core.sourceLabel(f.source))}</span>
          </span>
          ${f.brand ? `<span class="food-item-brand">${_esc(f.brand)}</span>` : ''}
          <span class="food-item-macros">
            <span class="fim kcal-badge">${p.kcal} kcal</span>
            <span class="fim protein-badge">${p.protein}P</span>
            <span class="fim carbs-badge">${p.carbs}C</span>
            <span class="fim fat-badge">${p.fat}F</span>
            <span class="fim unit-badge">per 100${_esc(f.basis)}</span>
          </span>
        </button>`;
    }).join('') + (hasOff ? '<div class="food-attrib">Product data: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL)</div>' : '');
  }

  /* ── Selected food state ─────────────────────────────────── */

  let _sel = null;

  function _selectFood(food) {
    if (!food) return;
    _sel = food;
    document.getElementById('foodSearchResults').hidden = true;
    document.getElementById('foodSelectedInfo').hidden  = false;
    document.getElementById('foodSelectedName').textContent = food.name + (food.brand ? ` · ${food.brand}` : '');
    const unitSel = document.getElementById('foodServingUnit');
    unitSel.innerHTML = `<option value="${_esc(food.basis)}">${_esc(food.basis)}</option>`
      + food.servings.map(s => `<option value="${_esc(s.label)}">${_esc(s.label)}</option>`).join('');
    // Start from one serving when the food has one, else 100 g.
    if (food.servings.length) {
      unitSel.value = food.servings[0].label;
      document.getElementById('foodServingInput').value = 1;
    } else {
      unitSel.value = food.basis;
      document.getElementById('foodServingInput').value = 100;
    }
    document.getElementById('foodSearchInput').value = '';
    _refreshBadges();
  }
  window.selectFoodForLogging = _selectFood;

  function _selGrams() {
    const qty = document.getElementById('foodServingInput').value;
    const unit = document.getElementById('foodServingUnit').value;
    return Core.gramsFor(_sel, qty, unit);
  }

  function _refreshBadges() {
    if (!_sel) return;
    const n = Core.scaleNutrients(_sel.per100, _selGrams());
    document.getElementById('fsbKcal').textContent    = (n.kcal || 0) + ' kcal';
    document.getElementById('fsbProtein').textContent = (n.protein || 0) + 'g P';
    document.getElementById('fsbCarbs').textContent   = (n.carbs || 0) + 'g C';
    document.getElementById('fsbFat').textContent     = (n.fat || 0) + 'g F';
  }

  document.addEventListener('input', (e) => {
    if (e.target.id === 'foodServingInput') _refreshBadges();
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'foodServingUnit') _refreshBadges();
  });

  window.clearFoodSelection = function () {
    _sel = null;
    const info  = document.getElementById('foodSelectedInfo');
    const input = document.getElementById('foodSearchInput');
    if (info)  info.hidden  = true;
    if (input) input.value  = '';
  };

  /* ── Add food macros to daily totals ─────────────────────── */

  window.addFoodMacrosToDaily = function () {
    if (!_sel) return;
    const grams = _selGrams();
    if (!grams) return;
    const n = Core.scaleNutrients(_sel.per100, grams);
    const kcal    = n.kcal || 0;
    const protein = Math.round(n.protein || 0);
    const carbs   = Math.round(n.carbs || 0);
    const fat     = Math.round(n.fat || 0);

    // Log the food's macros. Calories follow from them; whatever the label's
    // kcal differs by (fibre, alcohol, rounding) goes in as direct calories,
    // so the day's total matches the food's kcal instead of counting it twice.
    if (window.logMacroAmounts) {
      const macroKcal = protein * 4 + carbs * 4 + fat * 9;
      window.logMacroAmounts({ protein, carbs, fats: fat, cals: kcal - macroKcal });
    }

    const name = _sel.name;
    try {
      localStorage.setItem(RECENT_KEY(_user()), JSON.stringify(Core.addRecent(_readJSON(RECENT_KEY(_user()), []), _sel, Date.now())));
    } catch { /* storage full; the recent list is only a convenience */ }
    _logFood(name, kcal, protein, carbs, fat);
    clearFoodSelection();
    _toast(`✅ ${name.slice(0, 30)} — ${kcal} kcal added`);
  };

  /* ── Food diary ──────────────────────────────────────────── */

  function _logFood(name, kcal, protein, carbs, fat) {
    const key   = `foodDiary_${_user()}`;
    const today = new Date().toISOString().slice(0, 10);
    let diary   = JSON.parse(localStorage.getItem(key) || '{}');
    if (!diary[today]) diary[today] = [];
    diary[today].push({ name, kcal, protein, carbs, fat, t: Date.now() });
    // Trim to 60 days
    const keys = Object.keys(diary).sort();
    if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(k => delete diary[k]);
    localStorage.setItem(key, JSON.stringify(diary));
    _renderDiary(today);
  }

  function _renderDiary(today) {
    let host = document.getElementById('foodDiaryList');
    if (!host) {
      host = document.createElement('div');
      host.id = 'foodDiaryList';
      host.className = 'food-diary-list';
      const widget = document.getElementById('foodSearchWidget');
      if (widget) widget.after(host);
    }
    const key    = `foodDiary_${_user()}`;
    const diary  = JSON.parse(localStorage.getItem(key) || '{}');
    const items  = diary[today] || [];
    if (!items.length) { host.innerHTML = ''; return; }

    const tot = items.reduce((a, e) => ({
      kcal: a.kcal + e.kcal, protein: a.protein + e.protein,
      carbs: a.carbs + e.carbs, fat: a.fat + e.fat,
    }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });

    host.innerHTML = `
      <div class="food-diary-hdr">
        <span>🍽️ Today's food log</span>
        <span class="food-diary-tot">${tot.kcal} kcal · ${tot.protein}P / ${tot.carbs}C / ${tot.fat}F</span>
      </div>
      ${items.map((e, i) => `
        <div class="food-diary-row">
          <span class="food-diary-nm">${_esc(e.name.slice(0, 32))}</span>
          <span class="food-diary-kcal">${e.kcal} kcal</span>
          <button class="food-diary-del" onclick="_removeFoodEntry(${i})" title="Remove">✕</button>
        </div>
      `).join('')}
    `;
  }

  window._removeFoodEntry = function (idx) {
    const key   = `foodDiary_${_user()}`;
    const today = new Date().toISOString().slice(0, 10);
    let diary   = JSON.parse(localStorage.getItem(key) || '{}');
    if (diary[today]) { diary[today].splice(idx, 1); localStorage.setItem(key, JSON.stringify(diary)); }
    _renderDiary(today);
  };

  window.getFoodDiaryToday = function () {
    const key   = `foodDiary_${_user()}`;
    const today = new Date().toISOString().slice(0, 10);
    return (JSON.parse(localStorage.getItem(key) || '{}')[today] || []);
  };

  /* ── Toast ───────────────────────────────────────────────── */

  function _toast(msg) {
    let el = document.getElementById('_foodToast');
    if (!el) {
      el = document.createElement('div');
      el.id = '_foodToast';
      Object.assign(el.style, {
        position: 'fixed', bottom: '90px', left: '50%',
        transform: 'translateX(-50%) translateY(10px)',
        background: 'var(--card-bg,#0f1510)',
        border: '1px solid var(--primary,#5fa87e)',
        borderRadius: '10px', padding: '10px 22px',
        fontSize: '0.82rem', color: 'var(--primary,#5fa87e)',
        fontWeight: '600', zIndex: '1600', whiteSpace: 'nowrap',
        opacity: '0', transition: 'opacity 0.3s, transform 0.3s', pointerEvents: 'none',
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(10px)';
    }, 3000);
  }

  /* ── Boot ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      injectFoodSearchWidget();
      _renderDiary(new Date().toISOString().slice(0, 10));
    }, 1400);

    // Re-inject if user navigates to macro tab
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-tab="macroTab"]') || e.target.closest('.macros-subtab[data-macro-subtab="targets"]')) {
        setTimeout(injectFoodSearchWidget, 350);
      }
    });
  });

  window.injectFoodSearchWidget = injectFoodSearchWidget;

})();
