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
  const COACH_KEY = u => `coachFoods_${u}`;    // copy of the coach's list (server owns it)
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
    const coach = loadCoachFoods();
    const custom = loadCustomFoods().map(Core.normalizeFood).filter(Boolean);
    const recent = _readJSON(RECENT_KEY(_user()), []);
    return [coach, custom, recent].map(list => list.filter(f => Core.matchesQuery(f, q)));
  }

  /* ── Coach-approved foods ────────────────────────────────── */
  // Foods your coach approved for you. They rank first in search and can't
  // be edited here (copy one into your own foods to change it).

  function loadCoachFoods() {
    const list = _readJSON(COACH_KEY(_user()), []);
    return (Array.isArray(list) ? list : []).map(Core.normalizeFood).filter(Boolean);
  }

  async function refreshCoachFoods() {
    if (!_user() || !window.SERVER_URL || !localStorage.getItem('token') || !navigator.onLine) return;
    try {
      const res = await fetch(`${window.SERVER_URL}/api/client/coach-foods`, { headers: _authHeaders(), signal: AbortSignal.timeout(9000) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) return;
      localStorage.setItem(COACH_KEY(_user()), JSON.stringify((data.foods || []).map(Core.normalizeFood).filter(Boolean)));
    } catch { /* keep the last copy */ }
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
    const hit = Core.findByBarcode([loadCoachFoods(), loadCustomFoods(), _readJSON(RECENT_KEY(_user()), [])], code);
    return hit ? Core.normalizeFood(hit) : null;
  }

  // One database's results for a search: 'off' (Open Food Facts, fast) or
  // 'usda' (slower). Cached for the session. Throws on failure.
  async function fetchSource(q, source, signal) {
    const key = `${source}:${q}`;
    if (_searchCache.has(key)) return _searchCache.get(key);
    const res = await fetch(`${window.SERVER_URL}/api/food/search?q=${encodeURIComponent(q)}&limit=20&source=${source}`, {
      headers: _authHeaders(), signal: signal || AbortSignal.timeout(9000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.success) throw new Error((data && data.error && data.error.message) || 'Search failed');
    const foods = (data.foods || []).map(Core.normalizeFood).filter(Boolean);
    _searchCache.set(key, foods);
    return foods;
  }

  // Both databases at once (recipe builder etc.) → { foods, offline?, error? }
  async function searchFoods(query) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) return { foods: [] };
    const local = _localMatches(q);
    if (!navigator.onLine || !window.SERVER_URL) return { foods: Core.mergeResults(local, [], 25), offline: true };
    const [off, usda] = await Promise.allSettled([fetchSource(q, 'off'), fetchSource(q, 'usda')]);
    const ok = r => (r.status === 'fulfilled' ? r.value : []);
    const failed = off.status === 'rejected' && usda.status === 'rejected';
    return { foods: Core.combineSourceResults(local, ok(off), ok(usda), 25), ...(failed ? { error: 'Search failed' } : {}) };
  }
  window.searchFoods = searchFoods;

  /* ── Inject food-search widget ───────────────────────────── */

  // The search lives in the "Log food" sheet that the Macros tab's Search
  // food button opens (#foodSearchHost). Older markup without the sheet
  // gets it above the meal cards, as before.
  function injectFoodSearchWidget() {
    const host = document.getElementById('foodSearchHost');
    const container = document.getElementById('macroMealContainer');
    if ((!host && !container) || document.getElementById('foodSearchWidget')) return;

    const widget = document.createElement('div');
    widget.id = 'foodSearchWidget';
    widget.className = 'food-search-widget';
    widget.innerHTML = `
      <div class="food-search-bar">
        <span class="food-search-icon ui-icon" aria-hidden="true">${_icon('search')}</span>
        <input type="search" id="foodSearchInput" class="food-search-input"
          placeholder="Search food — e.g. kwark, hagelslag, rice" autocomplete="off" enterkeyhint="search"
          aria-label="Search food" />
        <button type="button" class="food-scan-btn" onclick="scanFoodBarcode()" aria-label="Scan a barcode"><span class="ui-icon" aria-hidden="true">${_icon('camera')}</span></button>
      </div>
      <button type="button" class="food-own-link" onclick="openCustomFoodForm()">＋ Add your own food</button>
      <div id="foodSearchResults" class="food-search-results" hidden></div>
      <div id="foodSelectedInfo" class="food-selected-info" hidden>
        <div class="food-selected-top">
          <span class="food-selected-name" id="foodSelectedName"></span>
          <button type="button" class="food-selected-clear" onclick="clearFoodSelection()" aria-label="Clear selected food">✕</button>
        </div>
        <p id="foodSelectedWarn" class="food-selected-warn" hidden></p>
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

    if (host) host.appendChild(widget);
    else container.parentNode.insertBefore(widget, container);

    const input     = widget.querySelector('#foodSearchInput');
    const resultsEl = widget.querySelector('#foodSearchResults');
    const doSearch = _debounce((q) => runSearch(q, resultsEl), 250);

    input.addEventListener('input', () => doSearch(input.value.trim().toLowerCase()));
    resultsEl.addEventListener('click', (e) => {
      const alt = e.target.closest('[data-food-alt]');
      if (alt) {
        input.value = alt.dataset.foodAlt;
        runSearch(alt.dataset.foodAlt.toLowerCase(), resultsEl);
        return;
      }
      if (e.target.closest('[data-food-ai]')) { runAiSearch(resultsEl, { asked: true }); return; }
      const item = e.target.closest('[data-food-idx]');
      if (item) _selectFood(_lastResults[Number(item.dataset.foodIdx)]);
    });
    document.addEventListener('click', (e) => {
      // In the sheet the results stay put; inline they close on outside taps.
      if (!host && !widget.contains(e.target)) resultsEl.hidden = true;
    });
  }

  let _lastResults = [];

  /* ── Progressive search ──────────────────────────────────── */
  // Your own, coach and recent foods show at once; Open Food Facts (Dutch
  // products, ~0.1-0.3 s) and USDA (~0.6-1.6 s) are asked in parallel and
  // shown as each answers. Typing again cancels the searches in flight.
  // When nothing good comes back, AI search rewrites the words (Pro).
  let _search = null; // { q, seq, local, off, usda, offErr, usdaErr, ai, aiState }
  let _searchSeq = 0;
  let _searchAbort = null;
  const _aiCache = new Map(); // q -> assist answer, for this session

  function _aiAllowed() {
    const consent = window.pocketCoachAIConsent && window.pocketCoachAIConsent.get && window.pocketCoachAIConsent.get();
    const paid = typeof window.hasPaidAccess === 'function' && window.hasPaidAccess();
    return { auto: consent === 'granted' && paid };
  }

  function _paintSearch(el) {
    const st = _search;
    if (!st) return;
    const loading = st.off === null || st.usda === null;
    let foods;
    if (st.ai && st.ai.foods && st.ai.foods.length) foods = Core.mergeResults(st.local, st.ai.foods, 25);
    else foods = Core.combineSourceResults(st.local, st.off, st.usda, 25);
    const offline = !navigator.onLine || !window.SERVER_URL;
    const error = !offline && !loading && st.offErr && st.usdaErr;
    _renderResults(el, { foods, offline, error: error ? 'Search failed' : '', loading, ai: st.ai, aiState: st.aiState, query: st.q });
  }

  async function runSearch(q, el) {
    if (_searchAbort) _searchAbort.abort();
    if (q.length < 2) { _search = null; _renderRecent(el); return; }
    const seq = ++_searchSeq;
    const ctrl = new AbortController();
    _searchAbort = ctrl;
    _search = { q, seq, local: _localMatches(q), off: null, usda: null, offErr: false, usdaErr: false, ai: _aiCache.get(q) || null, aiState: _aiCache.has(q) ? 'done' : '' };
    el.hidden = false;
    if (!navigator.onLine || !window.SERVER_URL) {
      _search.off = []; _search.usda = [];
      _paintSearch(el);
      return;
    }
    _paintSearch(el);
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const one = (source) => fetchSource(q, source, ctrl.signal)
      .then(list => { if (_search && _search.seq === seq) { _search[source] = list; _paintSearch(el); } })
      .catch(() => { if (_search && _search.seq === seq) { _search[source] = []; _search[`${source}Err`] = true; _paintSearch(el); } });
    await Promise.all([one('off'), one('usda')]);
    clearTimeout(timer);
    if (!_search || _search.seq !== seq || _search.ai) return;
    const shown = Core.combineSourceResults(_search.local, _search.off, _search.usda, 25);
    if (Core.isWeakSearch(q, shown)) {
      if (_aiAllowed().auto) runAiSearch(el, {});
      else { _search.aiState = 'offer'; _paintSearch(el); }
    }
  }

  // POST /api/ai/food-search-assist. Pro and AI consent are checked by the
  // app's AI fetch wrapper (ai-consent.js): tapping "Try AI search" without
  // them shows the consent sheet or the upgrade screen.
  async function runAiSearch(el, { asked }) {
    const st = _search;
    if (!st || st.aiState === 'loading') return;
    const seq = st.seq;
    st.aiState = 'loading';
    _paintSearch(el);
    try {
      const res = await fetch(`${window.SERVER_URL}/api/ai/food-search-assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._authHeaders() },
        body: JSON.stringify({ q: st.q }),
      });
      const data = await res.json().catch(() => null);
      if (!_search || _search.seq !== seq) return;
      if (!res.ok || !data || !data.success) throw new Error('AI search failed');
      const ai = { rewrite: data.rewrite || null, foods: (data.foods || []).map(Core.normalizeFood).filter(Boolean) };
      _aiCache.set(st.q, ai);
      _search.ai = ai;
      _search.aiState = 'done';
    } catch {
      if (!_search || _search.seq !== seq) return;
      _search.aiState = asked ? 'failed' : '';
    }
    _paintSearch(el);
  }

  // The app's icon set (index.html's top-level ICONS).
  function _icon(name) {
    // eslint-disable-next-line no-undef
    const set = typeof ICONS !== 'undefined' ? ICONS : window.ICONS;
    return (set && set[name]) || '';
  }

  // Before anything is typed: your own and recent foods, one tap to log.
  function _renderRecent(el) {
    const coach = loadCoachFoods();
    const custom = loadCustomFoods().map(Core.normalizeFood).filter(Boolean);
    const recent = _readJSON(RECENT_KEY(_user()), []).map(Core.normalizeFood).filter(Boolean);
    const foods = Core.mergeResults([recent, coach, custom], [], 12);
    if (!foods.length) {
      el.hidden = false;
      el.innerHTML = '<div class="food-search-msg">Type a food (Dutch or English), or scan a barcode.</div>';
      _lastResults = [];
      return;
    }
    _renderResults(el, { foods });
    el.insertAdjacentHTML('afterbegin', '<div class="food-search-msg food-search-recent-hdr">Recent and your foods</div>');
    el.querySelector('.food-attrib')?.remove();
    el.hidden = false;
  }

  /* ── "Log food" sheet and the Macros tab's dock ──────────── */

  // The meal the sheet logs to when opened from a meal's "+" (else the
  // last meal used, else one for the time of day).
  let _sheetMeal = null;

  // Search / Quick add / My foods tabs in the Log food sheet.
  function showFoodSheetTab(name) {
    const sheet = document.getElementById('foodSearchSheet');
    if (!sheet) return;
    sheet.querySelectorAll('[data-food-tab]').forEach(b => {
      const on = b.dataset.foodTab === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    sheet.querySelectorAll('[data-food-panel]').forEach(p => { p.hidden = p.dataset.foodPanel !== name; });
    if (name === 'mine' && typeof window.openFoodLibrary === 'function') {
      window.openFoodLibrary({ host: document.getElementById('foodMyFoodsPanel'), meal: _sheetMeal || undefined });
    }
    if (name === 'search') setTimeout(() => document.getElementById('foodSearchInput')?.focus(), 30);
  }
  window.showFoodSheetTab = showFoodSheetTab;

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-food-tab]');
    if (tab) showFoodSheetTab(tab.dataset.foodTab);
  });

  function openFoodSearch({ focus = true, meal = null, tab = 'search' } = {}) {
    injectFoodSearchWidget();
    const sheet = document.getElementById('foodSearchSheet');
    if (!sheet) {
      document.getElementById('foodSearchWidget')?.scrollIntoView({ block: 'center' });
      return;
    }
    _sheetMeal = Core.MEALS.includes(meal) ? meal : null;
    const title = document.getElementById('foodSearchSheetTitle');
    if (title) title.textContent = _sheetMeal ? `Log food · ${Core.MEAL_LABELS[_sheetMeal]}` : 'Log food';
    const mealSel = document.getElementById('foodMealSelect');
    if (mealSel && _sheetMeal) mealSel.value = _sheetMeal;
    sheet.hidden = false;
    document.body.classList.add('food-search-open');
    showFoodSheetTab(tab);
    _updateDock();
    const input = document.getElementById('foodSearchInput');
    const results = document.getElementById('foodSearchResults');
    if (input && !input.value && results && document.getElementById('foodSelectedInfo')?.hidden !== false) _renderRecent(results);
    if (focus && input) setTimeout(() => input.focus(), 50);
  }

  function closeFoodSearch() {
    const sheet = document.getElementById('foodSearchSheet');
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    document.body.classList.remove('food-search-open');
    window.clearFoodSelection?.();
    _sheetMeal = null;
    _updateDock();
  }
  window.openFoodSearch = openFoodSearch;
  window.closeFoodSearch = closeFoodSearch;

  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'foodSearchSheet') closeFoodSearch(); // tap on the backdrop
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('foodSheet')) closeFoodSearch();
  });

  // The dock shows on the Macros tab's main view, for a signed-in user.
  function _updateDock() {
    const dock = document.getElementById('foodDock');
    if (!dock) return;
    const tab = document.getElementById('macroTab');
    const targets = document.getElementById('macrosTargetsView');
    const sheetOpen = !document.getElementById('foodSearchSheet')?.hidden;
    const on = !!(_user() && tab && tab.classList.contains('active')
      && (!targets || !targets.classList.contains('is-hidden')) && !sheetOpen);
    dock.hidden = !on;
    const collapsed = _dockCollapsed();
    dock.classList.toggle('is-collapsed', collapsed);
    dock.querySelector('.food-dock-toggle')?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    document.body.classList.toggle('food-dock-on', on && !collapsed);
    document.body.classList.toggle('food-dock-mini', on && collapsed);
  }
  window.updateFoodDock = _updateDock;

  // Collapsed = one round search button; remembered on this device.
  function _dockCollapsed() {
    try { return localStorage.getItem('foodDockCollapsed') === '1'; } catch { return false; }
  }
  window.toggleFoodDock = function () {
    try { localStorage.setItem('foodDockCollapsed', _dockCollapsed() ? '0' : '1'); } catch { /* storage blocked */ }
    _updateDock();
  };

  function _watchDock() {
    const watch = ['macroTab', 'macrosTargetsView'].map(id => document.getElementById(id)).filter(Boolean);
    if (!watch.length || typeof MutationObserver !== 'function') return;
    const mo = new MutationObserver(_updateDock);
    watch.forEach(el => mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
    _updateDock();
  }

  const SOURCE_DOT = { off: 'off', usda: 'usda', custom: 'own', recipe: 'own', coach: 'coach' };

  const _r1 = v => Math.round((Number(v) || 0) * 10) / 10;

  function _row(f, i) {
    const p = f.per100;
    const check = Core.kcalCheck(p);
    const serving = f.servings && f.servings[0] ? f.servings[0].label : '';
    const sub = [f.source === 'usda' ? 'USDA' : f.brand, serving].filter(Boolean).join(' · ');
    return `
      <button type="button" class="food-result" data-food-idx="${i}">
        <span class="food-result-dot food-dot-${SOURCE_DOT[f.source] || 'off'}" aria-label="${_esc(Core.sourceLabel(f.source))}"></span>
        <span class="food-result-main">
          <span class="food-result-name">${_esc(f.name)}${check.ok ? '' : ' <span class="food-flag-dot" title="Calories don’t match the macros — check the label">⚠</span>'}</span>
          ${sub ? `<span class="food-result-sub">${_esc(sub)}</span>` : ''}
          ${f.source === 'coach' && f.note ? `<span class="food-result-sub">${_esc(f.coachUsername || 'Coach')}: ${_esc(f.note)}</span>` : ''}
          <span class="food-item-macros food-result-macros">
            <span class="fim kcal-badge">${p.kcal} kcal</span>
            <span class="fim protein-badge">${_r1(p.protein)}P</span>
            <span class="fim carbs-badge">${_r1(p.carbs)}C</span>
            <span class="fim fat-badge">${_r1(p.fat)}F</span>
            <span class="fim unit-badge">per 100${_esc(f.basis || 'g')}</span>
          </span>
        </span>
        <span class="food-result-add ui-icon" aria-hidden="true">${_icon('plus')}</span>
      </button>`;
  }

  // st: { foods, offline, error, loading, ai, aiState, query }
  function _renderResults(el, st) {
    const foods = st.foods || [];
    _lastResults = foods;
    const note = st.offline ? 'Offline — showing foods you logged before.'
      : st.error ? 'Search is unavailable right now — showing foods you logged before.' : '';
    const rw = st.ai && st.ai.rewrite;
    const aiBanner = st.aiState === 'loading'
      ? `<div class="food-ai-note"><span class="ui-icon">${_icon('sparkles')}</span>Searching smarter…</div>`
      : rw && rw.corrected && rw.corrected.toLowerCase() !== String(st.query || '').toLowerCase()
        ? `<div class="food-ai-note"><span class="ui-icon">${_icon('sparkles')}</span>Showing results for <b>${_esc(rw.corrected)}</b></div>`
        : st.aiState === 'failed' ? '<div class="food-search-msg">AI search didn’t find anything better.</div>' : '';
    const alts = rw && rw.alternatives && rw.alternatives.length
      ? `<div class="food-alts"><span>Also try</span>${rw.alternatives.map(a => `<button type="button" class="food-alt" data-food-alt="${_esc(a)}">${_esc(a)}</button>`).join('')}</div>` : '';
    const offer = st.aiState === 'offer' && !st.loading
      ? `<button type="button" class="food-ai-offer" data-food-ai><span class="ui-icon">${_icon('sparkles')}</span>Not what you meant? Try AI search</button>` : '';
    const loadingRow = st.loading ? '<div class="food-search-msg food-search-loading">Searching…</div>' : '';
    if (!foods.length) {
      el.innerHTML = aiBanner + (note ? `<div class="food-search-msg">${_esc(note)}</div>` : '')
        + (st.loading ? loadingRow : (st.aiState === 'loading' ? '' : `<div class="food-search-msg">No results — try another word (Dutch or English both work).</div>`))
        + offer + alts;
      return;
    }
    const hasOff = foods.some(f => f.source === 'off');
    el.innerHTML = aiBanner + (note ? `<div class="food-search-msg">${_esc(note)}</div>` : '')
      + foods.map(_row).join('') + loadingRow + offer + alts
      + `<div class="food-attrib"><span class="food-result-dot food-dot-own"></span>yours/coach <span class="food-result-dot food-dot-off"></span>Open Food Facts <span class="food-result-dot food-dot-usda"></span>USDA · per 100 g${hasOff ? ' · Product data: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL)' : ''}</div>`;
  }

  /* ── Selected food state ─────────────────────────────────── */

  let _sel = null;

  function _selectFood(food) {
    if (!food) return;
    _sel = food;
    document.getElementById('foodSearchResults').hidden = true;
    document.getElementById('foodSelectedInfo').hidden  = false;
    document.getElementById('foodSelectedName').textContent = food.name + (food.brand ? ` · ${food.brand}` : '');
    const warn = document.getElementById('foodSelectedWarn');
    const check = Core.kcalCheck(food.per100);
    if (warn) {
      warn.hidden = check.ok;
      warn.textContent = check.ok ? '' : `⚠ The calories (${food.per100.kcal} per 100${food.basis}) don't match the macros (${check.expected} kcal). The label data may be wrong — check it if you can.`;
    }
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
    if (mealSel) mealSel.value = _sheetMeal || _lastMeal || Core.mealForHour(new Date().getHours());
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
    const results = document.getElementById('foodSearchResults');
    if (results && document.getElementById('foodSearchSheet') && !document.getElementById('foodSearchSheet').hidden) _renderRecent(results);
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
    _updateMicrosButton(items);
    const icons = typeof window.foodLogToolbar === 'function' ? window.foodLogToolbar(items) : '';
    const tot = Core.totals(items);
    const groups = Core.groupByMeal(items);

    // Every meal gets a section; empty ones are a faint "+" placeholder.
    host.innerHTML = `
      <div class="food-log-hdr">
        <span class="mx-lbl">Food log</span>
        ${items.length ? `<span class="food-log-tot">${tot.kcal} kcal</span>` : ''}
        ${icons}
      </div>
      ${Core.MEALS.map(m => {
        const list = groups[m];
        const label = Core.MEAL_LABELS[m];
        const add = `<button type="button" class="food-meal-add" data-add-meal="${m}" aria-label="Add food to ${label.toLowerCase()}"><span class="ui-icon">${_icon('plus')}</span></button>`;
        if (!list.length) {
          return `<div class="food-meal-card is-empty"><span class="food-meal-name">${label}</span>${add}</div>`;
        }
        const mt = Core.totals(list);
        return `
        <div class="food-meal-card">
          <div class="food-meal-top">
            <span class="food-meal-name">${label}</span>
            <span class="food-meal-right">
              <span class="food-meal-kcal">${mt.kcal} kcal</span>
              <button type="button" class="food-icon-btn" data-save-meal="${m}" aria-label="Save ${label.toLowerCase()} as a meal" title="Save as a meal"><span class="ui-icon">${_icon('bookmark')}</span></button>
              ${add}
            </span>
          </div>
          ${list.map(e => `
          <button type="button" class="food-entry" data-edit-entry="${_esc(e.id)}" aria-label="Edit ${_esc(e.name)}">
            <span class="food-entry-main">
              <span class="food-entry-name">${_esc(e.name)}${e.amount ? `<small> · ${_esc(Core.amountLabel(e))}</small>` : ''}</span>
              <span class="food-item-macros food-entry-macros">
                <span class="fim protein-badge">${_r1(e.protein)}P</span>
                <span class="fim carbs-badge">${_r1(e.carbs)}C</span>
                <span class="fim fat-badge">${_r1(e.fat)}F</span>
              </span>
            </span>
            <span class="food-diary-kcal">${e.flag ? '<span class="food-flag-dot" title="Calories do not match the macros — check this food">⚠</span> ' : ''}${e.kcal}</span>
          </button>`).join('')}
        </div>`;
      }).join('')}
    `;
  }
  window.renderFoodLog = renderFoodLog;

  /* ── Log-only mode ───────────────────────────────────────── */
  // A coach can switch a client to "log only": calorie and macro numbers
  // are hidden (CSS on html.pc-log-only) and the client just logs foods.
  // The flag comes from the coach assignment (client-coaching.js) and is
  // kept per user, so it also holds offline and before that loads.

  const LOG_ONLY_KEY = u => `nutritionLogOnly_${u}`;

  function applyLogOnly(on) {
    document.documentElement.classList.toggle('pc-log-only', !!on);
    const hero = document.querySelector('#macrosTargetsView .macro-hero');
    let note = document.getElementById('logOnlyNote');
    if (on && hero && !note) {
      note = document.createElement('p');
      note.id = 'logOnlyNote';
      note.className = 'pc-log-only-note';
      note.textContent = 'Your coach set your food log to "log only": just log what you eat — they look at the numbers for you.';
      hero.before(note);
    }
    if (note) note.hidden = !on;
  }

  window.setNutritionLogOnly = function (on) {
    if (_user()) localStorage.setItem(LOG_ONLY_KEY(_user()), on ? '1' : '0');
    applyLogOnly(on);
  };

  /* ── Fibre & micros (sheet behind the macro card's button) ─ */
  // Kept off the main screen so it stays about macros: the small "Micros"
  // button on the macro card opens it, with a dot when something is over
  // its limit. A nutrient no logged food lists says "No data" instead of 0;
  // when only some foods list it, the total is shown as a minimum.

  function _microRows(items) {
    // Limits that depend on calories follow the day's target (not what's
    // been eaten so far); without a target, the EU reference of 2000 kcal.
    const target = _readJSON(`macroTargets_${_user()}`, null) || _readJSON('macroTargets', null);
    return Core.microSummary(items, Number(target && target.calories) > 0 ? Number(target.calories) : 2000);
  }

  function _updateMicrosButton(items) {
    const dot = document.getElementById('macroMicrosDot');
    if (dot) dot.hidden = !_microRows(items).some(r => r.status === 'high');
  }

  function openMicrosSheet() {
    if (!window.FoodSheet) return;
    const items = Core.entriesFor(loadLog(), _today());
    window.FoodSheet.open(`
      <div class="food-sheet-hdr"><h3>Fibre and micros</h3><button type="button" class="food-sheet-x" aria-label="Close" data-close>✕</button></div>
      ${microsHtml(items)}`, { label: 'Fibre and micros' });
    document.querySelector('#foodSheet [data-close]')?.addEventListener('click', () => window.FoodSheet.close());
  }
  window.openMicrosSheet = openMicrosSheet;

  function _fmtMicro(v, unit) {
    return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${unit}`;
  }

  function microsHtml(items) {
    const rows = _microRows(items);
    const withData = rows.filter(r => r.status !== 'nodata').length;
    const row = r => {
      const target = r.ref ? `${r.kind === 'max' ? 'limit' : 'aim'} ${_fmtMicro(r.ref, r.unit)}` : '';
      let value;
      if (r.status === 'nodata') value = '<span class="food-micro-nodata">No data</span>';
      else value = `${r.status === 'partial' ? '≥ ' : ''}${_fmtMicro(r.total, r.unit)}`;
      const pct = r.percent === null ? 0 : Math.min(100, r.percent);
      const sub = r.status === 'partial' ? `${r.missing} of ${r.of} foods have no data`
        : r.status === 'high' ? `over the limit${r.note ? ` (${r.note})` : ''}`
          : r.note && r.status !== 'nodata' ? r.note : '';
      return `
        <div class="food-micro-row is-${r.status}" title="${_esc(target)}">
          <span class="food-micro-lbl">${_esc(r.label)}${sub ? `<small>${_esc(sub)}</small>` : ''}</span>
          <span class="food-micro-bar" aria-hidden="true"><span style="width:${r.status === 'nodata' ? 0 : pct}%"></span></span>
          <span class="food-micro-val">${value}<small>${_esc(target)}</small></span>
        </div>`;
    };
    return `
      <div class="food-micros">
        <p class="food-sheet-sub">Today · ${withData ? `${withData} of ${rows.length} with data` : 'no data in today’s foods yet'}</p>
        ${rows.map(row).join('')}
        <p class="food-micro-foot">Totals of the foods logged today, against the EU label reference intakes (fibre: Dutch Health Council). Quick-added macros have no micronutrients.</p>
      </div>`;
  }

  document.addEventListener('click', (e) => {
    const del = e.target.closest('[data-remove-entry]');
    if (del) removeEntry(del.dataset.removeEntry);
    const add = e.target.closest('[data-add-meal]');
    if (add) openFoodSearch({ meal: add.dataset.addMeal });
  });

  // Today's entries (used by other screens).
  window.getFoodDiaryToday = function () {
    return Core.entriesFor(loadLog(), _today());
  };
  window.FoodLog = {
    load: loadLog, save: saveLog, add: addEntry, remove: removeEntry, today: _today,
    customFoods: loadCustomFoods, saveCustomFood, deleteCustomFood, localFoodByBarcode,
    coachFoods: loadCoachFoods, refreshCoachFoods,
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
    applyLogOnly(_user() && localStorage.getItem(LOG_ONLY_KEY(_user())) === '1');
    setTimeout(() => {
      refreshCoachFoods();
      migrateOldDiary();
      injectFoodSearchWidget();
      renderFoodLog();
      _watchDock();
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
