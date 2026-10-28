/* =============================================================
   FOOD DATABASE — food search + food log
   Searchable food picker injected above the macro meal container.
   Selecting a food adds macros to the daily totals and an entry to
   the food log (foodLog_<user>, synced by cloud-sync.js).

   Search goes through our backend (/api/food/search), which asks
   USDA FoodData Central with a server-side key and Open Food Facts,
   then merges and caches the answers. No API key lives in the app.
   Pure helpers live in food-core.js.
   ============================================================= */

(function initFoodDatabase() {
  'use strict';

  const Core = window.FoodCore;
  const RECENT_KEY = u => `recentFoods_${u}`;
  const CUSTOM_KEY = u => `customFoods_${u}`; // synced (cloud-sync.js)
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

  // Foods on this device that match the query: your own foods first,
  // then recently logged ones.
  function _localMatches(q) {
    const custom = loadCustomFoods().map(Core.normalizeFood).filter(Boolean);
    const recent = _readJSON(RECENT_KEY(_user()), []);
    return [custom.filter(f => Core.matchesQuery(f, q)), recent.filter(f => Core.matchesQuery(f, q))];
  }

  /* ── Custom foods ────────────────────────────────────────── */

  function loadCustomFoods() {
    const list = _readJSON(CUSTOM_KEY(_user()), []);
    return Array.isArray(list) ? list : [];
  }

  // Adds or replaces (same id) one of the user's own foods.
  function saveCustomFood(food) {
    if (!_user() || !food || !food.id) return;
    const list = loadCustomFoods().filter(f => f.id !== food.id);
    list.push(food);
    localStorage.setItem(CUSTOM_KEY(_user()), JSON.stringify(list));
  }

  function deleteCustomFood(id) {
    if (!_user()) return;
    localStorage.setItem(CUSTOM_KEY(_user()), JSON.stringify(loadCustomFoods().filter(f => f.id !== id)));
  }

  // A food with this barcode already on the device (your own first).
  function localFoodByBarcode(code) {
    const hit = Core.findByBarcode([loadCustomFoods(), _readJSON(RECENT_KEY(_user()), [])], code);
    return hit ? Core.normalizeFood(hit) : null;
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
        <button type="button" class="food-scan-btn" onclick="scanFoodBarcode()" aria-label="Scan a barcode">▥</button>
      </div>
      <button type="button" class="food-own-link" onclick="openCustomFoodForm()">＋ Add your own food</button>
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
        </div>
        <div class="food-serving-row food-meal-row">
          <label class="food-serving-label" for="foodMealSelect">Meal</label>
          <select id="foodMealSelect" class="food-serving-unit-select">
            ${Core.MEALS.map(m => `<option value="${m}">${Core.MEAL_LABELS[m]}</option>`).join('')}
          </select>
          <button type="button" class="food-add-btn" onclick="addFoodMacrosToDaily()">＋ Add</button>
        </div>
      </div>
      <div id="foodShareAsk" class="food-share-ask" hidden></div>
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
    const mealSel = document.getElementById('foodMealSelect');
    if (mealSel) mealSel.value = _lastMeal || Core.mealForHour(new Date().getHours());
    _refreshBadges();
  }
  window.selectFoodForLogging = _selectFood;
  let _lastMeal = null;

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

  /* ── Add food to the log ─────────────────────────────────── */

  window.addFoodMacrosToDaily = function () {
    if (!_sel) return;
    if (window.guardMacroDayLocked?.()) return;
    const grams = _selGrams();
    if (!grams) return;
    const meal = document.getElementById('foodMealSelect')?.value || Core.mealForHour(new Date().getHours());
    _lastMeal = meal;
    const entry = Core.makeEntry(_sel, {
      grams,
      amount: document.getElementById('foodServingInput').value,
      unit: document.getElementById('foodServingUnit').value,
      date: _today(),
      meal,
      now: Date.now(),
    });
    try {
      localStorage.setItem(RECENT_KEY(_user()), JSON.stringify(Core.addRecent(_readJSON(RECENT_KEY(_user()), []), _sel, Date.now())));
    } catch { /* storage full; the recent list is only a convenience */ }
    addEntry(entry);
    clearFoodSelection();
    _toast(`✅ ${entry.name.slice(0, 30)} — ${entry.kcal} kcal added`);
  };

  /* ── Food log ────────────────────────────────────────────── */
  // foodLog_<user>: flat list of entries (see food-core.js). Cloud sync
  // copies each entry to the server; a coach the client shares the food log
  // with reads it there. Entries older than 90 days are dropped.

  const LOG_KEY = u => `foodLog_${u}`;

  // Same day boundary as the Macros tab's running totals.
  function _today() {
    return (typeof window.getTodayDateString === 'function' && window.getTodayDateString()) || new Date().toISOString().slice(0, 10);
  }

  function loadLog() {
    const log = _readJSON(LOG_KEY(_user()), []);
    return Array.isArray(log) ? log : [];
  }

  function saveLog(log) {
    if (!_user()) return;
    localStorage.setItem(LOG_KEY(_user()), JSON.stringify(Core.trimLog(log, _today())));
  }

  // Adds an entry and, for today, its macros to the day's running totals.
  function addEntry(entry) {
    const log = loadLog();
    log.push(entry);
    saveLog(log);
    if (entry.date === _today() && window.logMacroAmounts) window.logMacroAmounts(Core.progressDelta(entry, 1));
    renderFoodLog();
  }

  function removeEntry(id) {
    if (window.guardMacroDayLocked?.()) return;
    const log = loadLog();
    const entry = log.find(e => e.id === id);
    if (!entry) return;
    saveLog(log.filter(e => e.id !== id));
    if (entry.date === _today() && window.logMacroAmounts) window.logMacroAmounts(Core.progressDelta(entry, -1));
    renderFoodLog();
  }

  // One-time move of the old per-device diary into the synced food log.
  function migrateOldDiary() {
    const u = _user();
    if (!u) return;
    const oldKey = `foodDiary_${u}`;
    const old = _readJSON(oldKey, null);
    if (!old) return;
    const log = loadLog();
    const have = new Set(log.map(e => e.id));
    Core.migrateOldDiary(old).forEach(e => { if (!have.has(e.id)) log.push(e); });
    saveLog(log);
    localStorage.removeItem(oldKey);
  }

  function renderFoodLog() {
    let host = document.getElementById('foodDiaryList');
    if (!host) {
      const widget = document.getElementById('foodSearchWidget');
      if (!widget) return;
      host = document.createElement('div');
      host.id = 'foodDiaryList';
      host.className = 'food-diary-list';
      widget.after(host);
    }
    renderShareAsk();
    const items = Core.entriesFor(loadLog(), _today());
    const toolbar = typeof window.foodLogToolbar === 'function' ? window.foodLogToolbar(items) : '';
    if (!items.length) { host.innerHTML = toolbar ? `<div class="food-diary-empty">${toolbar}</div>` : ''; return; }
    const tot = Core.totals(items);
    const groups = Core.groupByMeal(items);

    host.innerHTML = `
      <div class="food-diary-hdr">
        <span>🍽️ Today's food log</span>
        <span class="food-diary-tot">${tot.kcal} kcal · ${Math.round(tot.protein)}P / ${Math.round(tot.carbs)}C / ${Math.round(tot.fat)}F</span>
      </div>
      ${toolbar}
      ${Core.MEALS.filter(m => groups[m].length).map(m => {
        const mt = Core.totals(groups[m]);
        return `
        <div class="food-meal-hdr"><span>${Core.MEAL_LABELS[m]}</span>
          <span><button type="button" class="food-mini-btn" data-save-meal="${m}">Save as meal</button> ${mt.kcal} kcal</span></div>
        ${groups[m].map(e => `
          <div class="food-diary-row" data-entry-id="${_esc(e.id)}">
            <button type="button" class="food-diary-nm" data-edit-entry="${_esc(e.id)}" aria-label="Edit ${_esc(e.name)}">${_esc(e.name)}${e.amount ? `<small class="food-diary-amt"> · ${_esc(Core.amountLabel(e))}</small>` : ''}</button>
            <span class="food-diary-kcal">${e.kcal} kcal</span>
            <button type="button" class="food-diary-del" data-remove-entry="${_esc(e.id)}" aria-label="Remove ${_esc(e.name)}">✕</button>
          </div>`).join('')}`;
      }).join('')}
    `;
  }
  window.renderFoodLog = renderFoodLog;

  document.addEventListener('click', (e) => {
    const del = e.target.closest('[data-remove-entry]');
    if (del) removeEntry(del.dataset.removeEntry);
  });

  // Today's entries (used by other screens).
  window.getFoodDiaryToday = function () {
    return Core.entriesFor(loadLog(), _today());
  };
  window.FoodLog = {
    load: loadLog, save: saveLog, add: addEntry, remove: removeEntry, today: _today,
    customFoods: loadCustomFoods, saveCustomFood, deleteCustomFood, localFoodByBarcode,
    authHeaders: _authHeaders, toast: (m) => _toast(m),
  };

  /* ── Ask once about sharing the food log with a coach ────── */
  // The coach only sees the food log after the client says yes
  // (client-coaching.js owns the sharing switches).

  function renderShareAsk() {
    const el = document.getElementById('foodShareAsk');
    if (!el) return;
    const ask = typeof window.coachFoodLogAsk === 'function' ? window.coachFoodLogAsk() : null;
    if (!ask) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `
      <p class="food-share-q">Share your food log with ${_esc(ask.coachName || 'your coach')}?</p>
      <p class="food-share-sub">They'll see what you eat (foods, amounts and macros) to coach you on it. You can turn this off any time in Settings → Your Coach.</p>
      <div class="food-share-actions">
        <button type="button" class="food-add-btn" data-food-share="yes">Share</button>
        <button type="button" class="food-share-no" data-food-share="no">Not now</button>
      </div>`;
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-food-share]');
    if (!b || typeof window.answerCoachFoodLogShare !== 'function') return;
    b.disabled = true;
    const ok = await window.answerCoachFoodLogShare(b.dataset.foodShare === 'yes');
    if (ok && b.dataset.foodShare === 'yes') _toast('✅ Your coach can now see your food log');
    renderShareAsk();
  });
  document.addEventListener('pc:coach-sharing-changed', renderShareAsk);

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
      migrateOldDiary();
      injectFoodSearchWidget();
      renderFoodLog();
    }, 1400);

    // Re-inject if user navigates to macro tab
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-tab="macroTab"]') || e.target.closest('.macros-subtab[data-macro-subtab="targets"]')) {
        setTimeout(() => { injectFoodSearchWidget(); renderFoodLog(); }, 350);
      }
    });
  });

  window.injectFoodSearchWidget = injectFoodSearchWidget;

})();
