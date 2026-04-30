/* =============================================================
   FOOD DATABASE — USDA FoodData Central
   Searchable food autocomplete injected above the macro meal
   container. Selecting a food adds macros to the daily totals
   and writes to a per-user food diary in localStorage.
   ============================================================= */

(function initFoodDatabase() {
  'use strict';

  const API_KEY = 'DEMO_KEY'; // Free — 30 req/min per IP
  const BASE    = 'https://api.nal.usda.gov/fdc/v1';

  // USDA FDC nutrient IDs
  const NID = { kcal: 1008, protein: 1003, carbs: 1005, fat: 1004 };

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

  function _getNutrient(food, id) {
    const n = (food.foodNutrients || []).find(n => n.nutrientId === id || n.nutrientNumber === String(id));
    return +(n?.value ?? 0);
  }

  /* ── USDA search ─────────────────────────────────────────── */

  async function searchUSDA(query) {
    if (!query || query.length < 2) return [];
    try {
      const url = `${BASE}/foods/search?query=${encodeURIComponent(query)}&pageSize=8&dataType=Survey%20%28FNDDS%29,SR%20Legacy,Branded&api_key=${API_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.foods || []).slice(0, 8).map(f => ({
        fdcId:       f.fdcId,
        name:        f.description,
        brand:       f.brandOwner || f.brandName || '',
        kcal:        Math.round(_getNutrient(f, NID.kcal)),
        protein:     +_getNutrient(f, NID.protein).toFixed(1),
        carbs:       +_getNutrient(f, NID.carbs).toFixed(1),
        fat:         +_getNutrient(f, NID.fat).toFixed(1),
        servingSize: f.servingSize || 100,
        servingUnit: f.servingSizeUnit || 'g',
      }));
    } catch {
      return [];
    }
  }

  /* ── Inject food-search widget ───────────────────────────── */

  function injectFoodSearchWidget() {
    const container = document.getElementById('macroMealContainer');
    if (!container || document.getElementById('foodSearchWidget')) return;

    const widget = document.createElement('div');
    widget.id = 'foodSearchWidget';
    widget.className = 'food-search-widget';
    widget.innerHTML = `
      <div class="food-search-bar">
        <span class="food-search-icon">🍽️</span>
        <input type="text" id="foodSearchInput" class="food-search-input"
          placeholder="Search food (USDA database)…" autocomplete="off" />
      </div>
      <div id="foodSearchResults" class="food-search-results" hidden></div>
      <div id="foodSelectedInfo" class="food-selected-info" hidden>
        <div class="food-selected-top">
          <span class="food-selected-name" id="foodSelectedName"></span>
          <button class="food-selected-clear" onclick="clearFoodSelection()">✕</button>
        </div>
        <div class="food-macro-badges">
          <span class="food-macro-badge kcal-badge" id="fsbKcal">0 kcal</span>
          <span class="food-macro-badge protein-badge" id="fsbProtein">0g P</span>
          <span class="food-macro-badge carbs-badge" id="fsbCarbs">0g C</span>
          <span class="food-macro-badge fat-badge" id="fsbFat">0g F</span>
        </div>
        <div class="food-serving-row">
          <label class="food-serving-label">Amount:</label>
          <input type="number" id="foodServingInput" class="food-serving-input"
            value="100" min="1" max="9999" />
          <span id="foodServingUnit" class="food-serving-unit">g</span>
          <button class="food-add-btn" onclick="addFoodMacrosToDaily()">＋ Add</button>
        </div>
      </div>
    `;

    container.parentNode.insertBefore(widget, container);

    const input     = widget.querySelector('#foodSearchInput');
    const resultsEl = widget.querySelector('#foodSearchResults');

    const doSearch = _debounce(async (q) => {
      if (q.length < 2) { resultsEl.hidden = true; return; }
      resultsEl.hidden = false;
      resultsEl.innerHTML = '<div class="food-search-msg">Searching…</div>';
      const foods = await searchUSDA(q);
      if (!foods.length) {
        resultsEl.innerHTML = '<div class="food-search-msg">No results — try a different term.</div>';
        return;
      }
      resultsEl.innerHTML = foods.map(f => `
        <div class="food-search-item"
          data-name="${encodeURIComponent(f.name)}"
          data-brand="${encodeURIComponent(f.brand)}"
          data-kcal="${f.kcal}" data-protein="${f.protein}"
          data-carbs="${f.carbs}" data-fat="${f.fat}"
          data-serving="${f.servingSize}" data-unit="${encodeURIComponent(f.servingUnit)}"
          onclick="_selectFoodItem(this)">
          <div class="food-item-name">${f.name}</div>
          ${f.brand ? `<div class="food-item-brand">${f.brand}</div>` : ''}
          <div class="food-item-macros">
            <span class="fim kcal-badge">${f.kcal} kcal</span>
            <span class="fim protein-badge">${f.protein}P</span>
            <span class="fim carbs-badge">${f.carbs}C</span>
            <span class="fim fat-badge">${f.fat}F</span>
            <span class="fim unit-badge">per ${f.servingSize}${f.servingUnit}</span>
          </div>
        </div>
      `).join('');
    }, 450);

    input.addEventListener('input', () => doSearch(input.value.trim()));
    document.addEventListener('click', (e) => {
      if (!widget.contains(e.target)) resultsEl.hidden = true;
    });
  }

  /* ── Selected food state ─────────────────────────────────── */

  let _sel = null;

  window._selectFoodItem = function (el) {
    const d = el.dataset;
    _sel = {
      name:        decodeURIComponent(d.name),
      brand:       decodeURIComponent(d.brand),
      kcal100:     +d.kcal,
      protein100:  +d.protein,
      carbs100:    +d.carbs,
      fat100:      +d.fat,
      servingSize: +d.serving || 100,
      unit:        decodeURIComponent(d.unit),
    };
    document.getElementById('foodSearchResults').hidden = true;
    document.getElementById('foodSelectedInfo').hidden  = false;
    document.getElementById('foodSelectedName').textContent = _sel.name + (_sel.brand ? ` · ${_sel.brand}` : '');
    document.getElementById('foodServingInput').value = _sel.servingSize;
    document.getElementById('foodServingUnit').textContent = _sel.unit;
    document.getElementById('foodSearchInput').value = '';
    _refreshBadges();
  };

  function _refreshBadges() {
    if (!_sel) return;
    const g = +document.getElementById('foodServingInput').value || 100;
    const s = g / 100;
    document.getElementById('fsbKcal').textContent    = Math.round(_sel.kcal100 * s) + ' kcal';
    document.getElementById('fsbProtein').textContent = (_sel.protein100 * s).toFixed(1) + 'g P';
    document.getElementById('fsbCarbs').textContent   = (_sel.carbs100 * s).toFixed(1) + 'g C';
    document.getElementById('fsbFat').textContent     = (_sel.fat100 * s).toFixed(1) + 'g F';
  }

  document.addEventListener('input', (e) => {
    if (e.target.id === 'foodServingInput') _refreshBadges();
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
    const g    = +document.getElementById('foodServingInput').value || 100;
    const s    = g / 100;
    const kcal    = Math.round(_sel.kcal100 * s);
    const protein = Math.round(_sel.protein100 * s);
    const carbs   = Math.round(_sel.carbs100 * s);
    const fat     = Math.round(_sel.fat100 * s);

    // Inject values by setting quick-add inputs then firing addMacro
    const map = { cal: ['qaCals', kcal], protein: ['qaProtein', protein], carbs: ['qaCarbs', carbs], fat: ['qaFat', fat] };
    for (const [type, [inputId, val]] of Object.entries(map)) {
      const el = document.getElementById(inputId);
      if (el) {
        const prev = el.value;
        el.value = val;
        if (window.addMacro) window.addMacro(type);
        el.value = prev; // restore so user's preset isn't lost
      }
    }

    // Persist to food diary
    const name = _sel.name;
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
          <span class="food-diary-nm">${e.name.slice(0, 32)}</span>
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
