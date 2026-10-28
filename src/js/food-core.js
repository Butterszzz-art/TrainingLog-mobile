/* =============================================================
   FOOD CORE — pure helpers for the food log
   No DOM, no network: the food log UI (food-database.js) and the
   jest tests (tests/foodCore.test.js) both use these.

   A food (from the server's /api/food/search, a custom food or a
   recipe) looks like:
     { id, source: 'usda'|'off'|'custom'|'recipe'|'coach',
       name, brand, barcode?, basis: 'g'|'ml',
       per100: { kcal, protein, carbs, fat, fiber?, sugar?, satFat?,
                 sodiumMg?, ironMg?, calciumMg?, potassiumMg?,
                 magnesiumMg?, vitDUg?, b12Ug? },
       servings: [{ label, grams }] }
   A nutrient that's missing stays missing (never 0), so screens can
   say "no data" instead of showing a fake zero.
   ============================================================= */

(function (root) {
  'use strict';

  const NUTRIENT_KEYS = [
    'kcal', 'protein', 'carbs', 'fat',
    'fiber', 'sugar', 'satFat', 'sodiumMg',
    'ironMg', 'calciumMg', 'potassiumMg', 'magnesiumMg', 'vitDUg', 'b12Ug',
  ];
  const SOURCE_LABELS = { usda: 'USDA', off: 'OFF', custom: 'Custom', recipe: 'Recipe', coach: 'Coach', quick: 'Quick' };
  const RECENT_MAX = 60;

  const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));
  const round1 = n => Math.round(n * 10) / 10;

  // Nutrients for `grams` of a food. kcal is a whole number, the rest one
  // decimal. Keys the food doesn't have stay out of the result.
  function scaleNutrients(per100, grams) {
    const g = num(grams);
    const out = {};
    if (!per100 || g === null || g < 0) return out;
    NUTRIENT_KEYS.forEach(k => {
      const v = num(per100[k]);
      if (v === null) return;
      const x = (v * g) / 100;
      out[k] = k === 'kcal' ? Math.round(x) : round1(x);
    });
    return out;
  }

  // Amount + unit picked in the UI → grams. unit is 'g' / 'ml' or the label
  // of one of the food's servings.
  function gramsFor(food, quantity, unit) {
    const q = num(quantity);
    if (q === null || q <= 0) return 0;
    if (!unit || unit === 'g' || unit === 'ml') return round1(q);
    const s = (food && Array.isArray(food.servings) ? food.servings : []).find(x => x.label === unit);
    return s ? round1(q * s.grams) : round1(q);
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || 'Food';
  }

  // Only the fields worth keeping from a server result; drops anything
  // unexpected and rejects foods without usable core numbers.
  function normalizeFood(f) {
    if (!f || typeof f !== 'object' || !f.id || !f.per100) return null;
    const per100 = {};
    NUTRIENT_KEYS.forEach(k => {
      const v = num(f.per100[k]);
      if (v !== null && v >= 0) per100[k] = v;
    });
    if (['kcal', 'protein', 'carbs', 'fat'].some(k => per100[k] === undefined)) return null;
    const servings = (Array.isArray(f.servings) ? f.servings : [])
      .map(s => ({ label: String(s && s.label || '').slice(0, 60), grams: num(s && s.grams) }))
      .filter(s => s.label && s.grams > 0)
      .slice(0, 10);
    return {
      id: String(f.id).slice(0, 80),
      source: SOURCE_LABELS[f.source] ? f.source : 'usda',
      name: String(f.name || '').slice(0, 160),
      brand: String(f.brand || '').slice(0, 80),
      ...(f.barcode ? { barcode: String(f.barcode) } : {}),
      basis: f.basis === 'ml' ? 'ml' : 'g',
      per100,
      servings,
    };
  }

  // ── Local search (offline, and to rank your own foods first) ─────────
  function words(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9%]+/).filter(Boolean);
  }

  // True when every word typed starts some word of the food's name/brand.
  function matchesQuery(food, query) {
    const q = words(query);
    if (!q.length) return false;
    const w = words(`${food && food.name} ${food && food.brand}`);
    return q.every(x => w.some(y => y.startsWith(x)));
  }

  // Recently logged foods, newest first, one per id.
  function addRecent(list, food, now) {
    const f = normalizeFood(food);
    if (!f) return Array.isArray(list) ? list : [];
    const rest = (Array.isArray(list) ? list : []).filter(x => x && x.id !== f.id);
    return [{ ...f, usedAt: now }, ...rest].slice(0, RECENT_MAX);
  }

  // Local foods first (your own and your coach's, then recent ones), then
  // the server's results, one per id/barcode.
  function mergeResults(localGroups, remote, limit) {
    const seen = new Set();
    const out = [];
    const push = f => {
      if (!f) return;
      const key = f.barcode ? `bc:${f.barcode}` : f.id;
      if (seen.has(key) || seen.has(f.id)) return;
      seen.add(key); seen.add(f.id);
      out.push(f);
    };
    (localGroups || []).forEach(group => (group || []).forEach(push));
    (remote || []).forEach(push);
    return out.slice(0, limit || 25);
  }

  const api = {
    NUTRIENT_KEYS, SOURCE_LABELS,
    scaleNutrients, gramsFor, sourceLabel, normalizeFood,
    matchesQuery, addRecent, mergeResults,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FoodCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
