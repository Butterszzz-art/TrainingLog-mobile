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
      ...(f.source === 'coach' && f.coachUsername ? { coachUsername: String(f.coachUsername).slice(0, 40) } : {}),
      ...(f.source === 'coach' && f.note ? { note: String(f.note).slice(0, 300) } : {}),
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

  // ── Food log entries ─────────────────────────────────────────────────
  // The food log is a flat list in localStorage (`foodLog_<user>`), one
  // entry per food logged. Cloud sync copies each entry to the server on
  // its own (by id), and a coach the client shares it with can read it.
  //   { id, date, meal, name, brand, amount, unit, grams, source, ref,
  //     kcal, protein, carbs, fat, fiber?, ..., per100, basis, servings, t }
  // per100/basis/servings are kept so the amount can be changed later.
  const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];
  const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };
  const KEEP_DAYS = 90;

  // A sensible default meal for the time of day (local clock).
  function mealForHour(hour) {
    const h = Number(hour);
    if (h >= 4 && h < 11) return 'breakfast';
    if (h >= 11 && h < 15) return 'lunch';
    if (h >= 17 && h < 22) return 'dinner';
    return 'snacks';
  }

  // Date first so ids sort by day; the random part keeps two devices from
  // ever picking the same id.
  function newEntryId(date, rand) {
    const r = typeof rand === 'string' ? rand : Math.random().toString(36).slice(2, 10);
    return `${date}-${r}`;
  }

  function makeEntry(food, { grams, amount, unit, date, meal, now, rand }) {
    const n = scaleNutrients(food.per100, grams);
    return {
      id: newEntryId(date, rand),
      date,
      meal: MEALS.includes(meal) ? meal : 'snacks',
      name: String(food.name || '').slice(0, 160),
      brand: String(food.brand || '').slice(0, 80),
      amount: num(amount) ?? round1(grams),
      unit: unit || food.basis || 'g',
      grams: round1(grams),
      source: food.source || 'custom',
      ref: food.id || null,
      ...n,
      kcal: n.kcal || 0, protein: n.protein || 0, carbs: n.carbs || 0, fat: n.fat || 0,
      per100: { ...food.per100 },
      ...(kcalCheck(food.per100).ok ? {} : { flag: 'kcal_mismatch' }),
      basis: food.basis === 'ml' ? 'ml' : 'g',
      servings: Array.isArray(food.servings) ? food.servings.slice(0, 10) : [],
      t: now,
    };
  }

  // ── Fibre & micros ───────────────────────────────────────────────────
  // Reference amounts per day for the secondary "Fibre & micros" view.
  // Minerals and vitamins: the EU reference intakes on food labels (NRV,
  // Regulation 1169/2011). Fibre: Dutch Health Council (30–40 g). Limits:
  // sodium 2.4 g (6 g salt, Health Council), sugar and saturated fat as a
  // share of the day's calories (WHO/Health Council: under 10 %).
  const MICROS = [
    { key: 'fiber', label: 'Fibre', unit: 'g', kind: 'min', ref: 30 },
    { key: 'sugar', label: 'Sugars', unit: 'g', kind: 'max', refFromKcal: kcal => (kcal * 0.1) / 4, note: 'under 10 % of calories' },
    { key: 'satFat', label: 'Saturated fat', unit: 'g', kind: 'max', refFromKcal: kcal => (kcal * 0.1) / 9, note: 'under 10 % of calories' },
    { key: 'sodiumMg', label: 'Sodium', unit: 'mg', kind: 'max', ref: 2400 },
    { key: 'ironMg', label: 'Iron', unit: 'mg', kind: 'min', ref: 14 },
    { key: 'calciumMg', label: 'Calcium', unit: 'mg', kind: 'min', ref: 800 },
    { key: 'potassiumMg', label: 'Potassium', unit: 'mg', kind: 'min', ref: 2000 },
    { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', kind: 'min', ref: 375 },
    { key: 'vitDUg', label: 'Vitamin D', unit: 'µg', kind: 'min', ref: 5 },
    { key: 'b12Ug', label: 'Vitamin B12', unit: 'µg', kind: 'min', ref: 2.5 },
  ];

  // One row per nutrient for a day's entries:
  //   { key, label, unit, kind, ref, total, missing, of, status, percent }
  // status: 'nodata' (no food lists it), 'partial' (some foods don't: the
  // total is a minimum), 'ok', 'low' (under a 'min' reference) or 'high'
  // (over a 'max' limit). Never reports 0 for data that isn't there.
  // dayKcal: the day's calorie target, for the limits that depend on it
  // (defaults to the EU reference of 2000 kcal).
  function microSummary(entries, dayKcal) {
    const list = Array.isArray(entries) ? entries : [];
    const kcal = num(dayKcal) || 2000;
    return MICROS.map(m => {
      const have = list.filter(e => num(e[m.key]) !== null);
      const missing = list.length - have.length;
      const total = have.reduce((s, e) => s + Number(e[m.key]), 0);
      const ref = m.refFromKcal ? (kcal > 0 ? Math.round(m.refFromKcal(kcal)) : null) : m.ref;
      const row = { key: m.key, label: m.label, unit: m.unit, kind: m.kind, ref, note: m.note || '', missing, of: list.length };
      if (!list.length || !have.length) return { ...row, total: null, percent: null, status: 'nodata' };
      const t = m.unit === 'g' ? round1(total) : Math.round(total * 10) / 10;
      const percent = ref ? Math.round((t / ref) * 100) : null;
      let status = 'ok';
      if (ref && m.kind === 'max' && t > ref) status = 'high';
      else if (missing) status = 'partial';
      else if (ref && m.kind === 'min' && t < ref) status = 'low';
      return { ...row, total: t, percent, status };
    });
  }

  // ── Data quality ─────────────────────────────────────────────────────
  // Calories vs. what the macros add up to (4P + 4C + 9F). Labels can
  // legitimately differ by fibre (2 kcal/g on EU labels), polyols, alcohol
  // and rounding, so it only fails when more than 15 % off both with and
  // without fibre, with a 10 kcal margin for small amounts. Same rule as the
  // backend's diary.js kcalMismatch.
  // → { ok, expected } (expected = 4P + 4C + 9F, rounded)
  function kcalCheck(n) {
    const k = num(n && n.kcal) || 0;
    const base = (num(n && n.protein) || 0) * 4 + (num(n && n.carbs) || 0) * 4 + (num(n && n.fat) || 0) * 9;
    const withFiber = base + (num(n && n.fiber) || 0) * 2;
    const off = e => { const d = Math.abs(k - e); return d > 10 && d > Math.max(k, e) * 0.15; };
    return { ok: !(off(base) && off(withFiber)), expected: Math.round(base) };
  }

  // What an entry adds to the day's running totals (the Macros tab's
  // dailyMacroProgress): whole-gram macros, plus whatever the food's kcal
  // differs from those by as direct calories. Removing an entry subtracts
  // exactly this, so add + remove leaves the day where it was.
  function progressDelta(e, sign) {
    const s = sign === -1 ? -1 : 1;
    const protein = Math.round(num(e && e.protein) || 0);
    const carbs = Math.round(num(e && e.carbs) || 0);
    const fats = Math.round(num(e && e.fat) || 0);
    const cals = Math.round(num(e && e.kcal) || 0) - (protein * 4 + carbs * 4 + fats * 9);
    return { protein: s * protein, carbs: s * carbs, fats: s * fats, cals: s * cals };
  }

  // The food an entry was made from, so it can be logged or edited again.
  function foodFromEntry(e) {
    if (!e) return null;
    const per100 = e.per100 && num(e.per100.kcal) !== null ? e.per100
      : (num(e.grams) > 0 ? Object.fromEntries(NUTRIENT_KEYS.filter(k => num(e[k]) !== null).map(k => [k, round1((e[k] * 100) / e.grams)])) : null);
    if (!per100) return null;
    return normalizeFood({
      id: e.ref || `entry:${e.id}`, source: e.source === 'quick' ? 'custom' : e.source,
      name: e.name, brand: e.brand, basis: e.basis, per100, servings: e.servings || [],
    });
  }

  // Sum of the nutrients in a list of entries. Core macros always present;
  // others only when at least one entry has them, with `missing` counting
  // entries that don't (so a screen can say "3 foods without iron data").
  function totals(entries) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const missing = {};
    (entries || []).forEach(e => {
      NUTRIENT_KEYS.forEach(k => {
        const v = num(e[k]);
        if (v === null) { missing[k] = (missing[k] || 0) + 1; return; }
        t[k] = (t[k] || 0) + v;
      });
    });
    Object.keys(t).forEach(k => { t[k] = k === 'kcal' ? Math.round(t[k]) : round1(t[k]); });
    return { ...t, missing };
  }

  function entriesFor(log, date) {
    return (Array.isArray(log) ? log : []).filter(e => e && e.date === date);
  }

  function groupByMeal(entries) {
    const out = {};
    MEALS.forEach(m => { out[m] = []; });
    (entries || []).forEach(e => out[MEALS.includes(e.meal) ? e.meal : 'snacks'].push(e));
    MEALS.forEach(m => out[m].sort((a, b) => (a.t || 0) - (b.t || 0)));
    return out;
  }

  // Drops entries older than KEEP_DAYS before `today`.
  function trimLog(log, today, keepDays) {
    const days = keepDays || KEEP_DAYS;
    const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - days * 864e5).toISOString().slice(0, 10);
    return (Array.isArray(log) ? log : []).filter(e => e && typeof e.date === 'string' && e.date >= cutoff);
  }

  // The old diary ({ 'YYYY-MM-DD': [{ name, kcal, protein, carbs, fat, t }] })
  // → food log entries. Meal comes from the time it was logged.
  function shortHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  // Ids come from the entry's content, so migrating the same old diary on
  // two devices gives the same ids (synced once), not duplicates.
  function migrateOldDiary(diary) {
    if (!diary || typeof diary !== 'object' || Array.isArray(diary)) return [];
    const out = [];
    Object.keys(diary).sort().forEach(date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(diary[date])) return;
      diary[date].forEach((e, i) => {
        if (!e || !e.name) return;
        const t = num(e.t) || Date.parse(date + 'T12:00:00Z');
        out.push({
          id: `${date}-old${shortHash(`${e.name}|${e.t}|${e.kcal}|${i}`)}`,
          date,
          meal: mealForHour(new Date(t).getHours()),
          name: String(e.name).slice(0, 160),
          brand: '',
          source: 'usda',
          ref: null,
          kcal: num(e.kcal) || 0, protein: num(e.protein) || 0, carbs: num(e.carbs) || 0, fat: num(e.fat) || 0,
          t,
        });
      });
    });
    return out;
  }

  // ── Barcodes ─────────────────────────────────────────────────────────
  // EAN-8, UPC-A (padded to 13 like Open Food Facts), EAN-13, GTIN-14.
  function normalizeBarcode(v) {
    const s = String(v == null ? '' : v).replace(/\D/g, '');
    if (![8, 12, 13, 14].includes(s.length)) return null;
    return s.length === 12 ? '0' + s : s;
  }

  // GS1 check digit, so a misread scan is caught on the phone.
  function validBarcode(v) {
    const s = normalizeBarcode(v);
    if (!s) return false;
    const d = s.split('').map(Number);
    const check = d.pop();
    const sum = d.reverse().reduce((acc, x, i) => acc + x * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }

  // First food with this barcode in any of the lists (custom foods first).
  function findByBarcode(lists, code) {
    const c = normalizeBarcode(code);
    if (!c) return null;
    for (const list of lists || []) {
      const hit = (list || []).find(f => f && normalizeBarcode(f.barcode) === c);
      if (hit) return hit;
    }
    return null;
  }

  // ── Custom foods ─────────────────────────────────────────────────────
  // Made by the client, per 100 g (or ml) with optional servings and
  // optional extra nutrients (left out when blank, never 0).
  // fields: { name, brand, barcode, basis, kcal, protein, carbs, fat,
  //           fiber, sugar, ..., servings: [{ label, grams }] }
  // → { food } or { error }
  function customFoodFromForm(fields, { id, now, rand } = {}) {
    const f = fields || {};
    const name = String(f.name || '').trim().slice(0, 120);
    if (!name) return { error: 'Give the food a name.' };
    const per100 = {};
    for (const k of NUTRIENT_KEYS) {
      const v = num(f[k]);
      if (v === null) continue;
      if (v < 0) return { error: 'Amounts can’t be negative.' };
      per100[k] = k === 'kcal' ? Math.round(v) : round1(v);
    }
    for (const k of ['protein', 'carbs', 'fat']) if (per100[k] === undefined) per100[k] = 0;
    if (per100.kcal === undefined) per100.kcal = Math.round(per100.protein * 4 + per100.carbs * 4 + per100.fat * 9);
    if (per100.protein + per100.carbs + per100.fat > 100) return { error: 'Protein, carbs and fat add up to more than 100 g per 100 g.' };
    if (per100.kcal > 950) return { error: 'More than 950 kcal per 100 g isn’t possible — check the label.' };
    const barcode = f.barcode ? normalizeBarcode(f.barcode) : null;
    if (f.barcode && !barcode) return { error: 'That barcode doesn’t look right.' };
    const servings = (Array.isArray(f.servings) ? f.servings : [])
      .map(s => ({ label: String(s && s.label || '').trim().slice(0, 60), grams: num(s && s.grams) }))
      .filter(s => s.label && s.grams > 0 && s.grams <= 5000)
      .slice(0, 10);
    const r = typeof rand === 'string' ? rand : Math.random().toString(36).slice(2, 10);
    return {
      food: {
        id: id || `custom:${r}`,
        source: 'custom',
        name,
        brand: String(f.brand || '').trim().slice(0, 80),
        ...(barcode ? { barcode } : {}),
        basis: f.basis === 'ml' ? 'ml' : 'g',
        per100,
        servings,
        updatedAt: now || 0,
      },
    };
  }

  // "250 g", or "1 × 1 bakje (500g)" for a serving.
  function amountLabel(e) {
    const unit = (e && e.unit) || 'g';
    const amount = e && e.amount != null ? e.amount : '';
    return unit === 'g' || unit === 'ml' ? `${amount} ${unit}` : `${amount} × ${unit}`;
  }

  // ── Editing, copying, saved meals ────────────────────────────────────

  // The entry with a new amount and/or meal/date. Nutrients are worked out
  // again from the food it was made from, so per-100 data stays exact.
  // changes: { grams, amount, unit, meal, date }
  function editEntry(entry, changes) {
    const c = changes || {};
    const food = foodFromEntry(entry);
    const out = { ...entry };
    if (c.meal && MEALS.includes(c.meal)) out.meal = c.meal;
    if (c.date && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) out.date = c.date;
    const g = num(c.grams);
    if (food && g !== null && g > 0) {
      NUTRIENT_KEYS.forEach(k => { delete out[k]; });
      const n = scaleNutrients(food.per100, g);
      Object.assign(out, n, { kcal: n.kcal || 0, protein: n.protein || 0, carbs: n.carbs || 0, fat: n.fat || 0 });
      out.grams = round1(g);
      out.amount = num(c.amount) ?? round1(g);
      out.unit = c.unit || out.unit || food.basis;
      if (!out.per100) { out.per100 = food.per100; out.basis = food.basis; }
    }
    return out;
  }

  // Copies of entries for another day (new ids, same meals and amounts).
  function copyEntries(entries, toDate, { now, rand } = {}) {
    let i = 0;
    return (entries || []).map(e => ({
      ...e,
      id: newEntryId(toDate, rand ? `${rand}${i++}` : undefined),
      date: toDate,
      t: (now || 0) + i,
    }));
  }

  // A saved meal ("my usual breakfast"): the foods and amounts, no date.
  function templateFromEntries(name, entries, { id, now, rand } = {}) {
    const items = (entries || []).map(e => {
      const food = foodFromEntry(e);
      return food ? { food, grams: e.grams || 100, amount: e.amount ?? e.grams, unit: e.unit || food.basis } : null;
    }).filter(Boolean);
    if (!items.length) return null;
    const r = typeof rand === 'string' ? rand : Math.random().toString(36).slice(2, 10);
    return { id: id || `meal:${r}`, name: String(name || '').trim().slice(0, 80) || 'Saved meal', items, updatedAt: now || 0 };
  }

  function entriesFromTemplate(tpl, { date, meal, now, rand } = {}) {
    let i = 0;
    return (tpl && Array.isArray(tpl.items) ? tpl.items : [])
      .map(it => makeEntry(it.food, {
        grams: it.grams, amount: it.amount, unit: it.unit, date, meal,
        now: (now || 0) + i, rand: rand ? `${rand}${i++}` : undefined,
      }));
  }

  // ── Recipes ──────────────────────────────────────────────────────────
  // A recipe is one of your own foods (source 'recipe'): its nutrients per
  // 100 g come from the ingredients, and "1 serving" is the total weight
  // divided by the number of servings.
  // input: { name, servings, ingredients: [{ food, grams }] }
  // → { food, perServing } or { error }
  function recipeFood(input, { id, now, rand } = {}) {
    const r = input || {};
    const name = String(r.name || '').trim().slice(0, 120);
    if (!name) return { error: 'Give the recipe a name.' };
    const servings = Math.round(num(r.servings) || 0);
    if (servings < 1 || servings > 100) return { error: 'Number of servings must be between 1 and 100.' };
    const items = (r.ingredients || []).filter(x => x && x.food && x.food.per100 && num(x.grams) > 0);
    if (!items.length) return { error: 'Add at least one ingredient with an amount.' };
    const totalGrams = items.reduce((s, x) => s + Number(x.grams), 0);
    const sums = {};
    const counts = {};
    items.forEach(x => {
      const n = scaleNutrients(x.food.per100, x.grams);
      Object.keys(n).forEach(k => { sums[k] = (sums[k] || 0) + n[k]; counts[k] = (counts[k] || 0) + 1; });
    });
    const per100 = {};
    Object.keys(sums).forEach(k => {
      // Only when every ingredient has it, else the total would be too low.
      if (counts[k] !== items.length && !['kcal', 'protein', 'carbs', 'fat'].includes(k)) return;
      const v = (sums[k] * 100) / totalGrams;
      per100[k] = k === 'kcal' ? Math.round(v) : round1(v);
    });
    ['kcal', 'protein', 'carbs', 'fat'].forEach(k => { if (per100[k] === undefined) per100[k] = 0; });
    const serving = round1(totalGrams / servings);
    const rid = typeof rand === 'string' ? rand : Math.random().toString(36).slice(2, 10);
    const food = {
      id: id || `custom:recipe-${rid}`,
      source: 'recipe',
      name,
      brand: '',
      basis: 'g',
      per100,
      servings: [{ label: `1 serving (${Math.round(serving)}g)`, grams: serving }, { label: `whole recipe (${Math.round(totalGrams)}g)`, grams: round1(totalGrams) }],
      recipe: {
        servings,
        ingredients: items.map(x => ({ food: normalizeFood(x.food) || x.food, grams: round1(Number(x.grams)) })),
      },
      updatedAt: now || 0,
    };
    // Straight from the ingredient sums, so rounding per 100 g doesn't drift.
    const perServing = {};
    Object.keys(per100).forEach(k => {
      const v = (sums[k] || 0) / servings;
      perServing[k] = k === 'kcal' ? Math.round(v) : round1(v);
    });
    return { food, perServing };
  }

  // schema.org Recipe from a recipe web page (JSON-LD), for the URL import.
  // → { name, servings, perServing: { kcal, protein, carbs, fat }, ingredients: [text] } or null
  function parseRecipeJsonLd(html) {
    const blocks = String(html || '').match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
    const flatten = v => (Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === 'object' ? [v, ...flatten(v['@graph'] || [])] : []);
    for (const block of blocks) {
      let data;
      try { data = JSON.parse(block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '')); } catch { continue; }
      const recipe = flatten(data).find(x => [].concat(x['@type'] || []).includes('Recipe'));
      if (!recipe) continue;
      const n = recipe.nutrition || {};
      const grams = v => { const m = /(\d+(?:[.,]\d+)?)/.exec(String(v || '')); return m ? Number(m[1].replace(',', '.')) : null; };
      let kcal = grams(n.calories);
      if (kcal !== null && /kj/i.test(String(n.calories)) && !/kcal/i.test(String(n.calories))) kcal = kcal / 4.184;
      const yieldText = [].concat(recipe.recipeYield || [])[0];
      return {
        name: String(recipe.name || '').trim().slice(0, 120),
        servings: Math.max(1, Math.min(100, Math.round(grams(yieldText) || 1))),
        perServing: {
          kcal: kcal === null ? null : Math.round(kcal),
          protein: grams(n.proteinContent), carbs: grams(n.carbohydrateContent), fat: grams(n.fatContent),
          fiber: grams(n.fiberContent), sugar: grams(n.sugarContent),
        },
        ingredients: [].concat(recipe.recipeIngredient || []).map(String).slice(0, 60),
      };
    }
    return null;
  }

  // ── CSV ──────────────────────────────────────────────────────────────
  // Quotes cells that need it, and defuses cells a spreadsheet would run
  // as a formula (food names from Open Food Facts are user-contributed).
  function csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  }

  const CSV_NUTRIENTS = [
    ['kcal', 'kcal'], ['protein', 'Protein (g)'], ['carbs', 'Carbs (g)'], ['fat', 'Fat (g)'],
    ['fiber', 'Fiber (g)'], ['sugar', 'Sugar (g)'], ['satFat', 'Sat fat (g)'], ['sodiumMg', 'Sodium (mg)'],
    ['ironMg', 'Iron (mg)'], ['calciumMg', 'Calcium (mg)'], ['potassiumMg', 'Potassium (mg)'],
    ['magnesiumMg', 'Magnesium (mg)'], ['vitDUg', 'Vitamin D (µg)'], ['b12Ug', 'B12 (µg)'],
  ];

  // One row per entry, oldest first. A nutrient the food has no data for
  // is left empty (not 0).
  function foodLogRows(entries) {
    const rows = [['Date', 'Meal', 'Food', 'Brand', 'Amount', 'Unit', 'Grams', 'Source', ...CSV_NUTRIENTS.map(c => c[1])]];
    (entries || []).slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || (a.t || 0) - (b.t || 0))
      .forEach(e => rows.push([
        e.date, MEAL_LABELS[e.meal] || e.meal || '', e.name, e.brand || '', e.amount ?? '', e.unit || '', e.grams ?? '', sourceLabel(e.source),
        ...CSV_NUTRIENTS.map(([k]) => (num(e[k]) === null ? '' : e[k])),
      ]));
    return rows;
  }

  const api = {
    csvCell, toCsv, foodLogRows,
    normalizeBarcode, validBarcode, findByBarcode, customFoodFromForm,
    amountLabel, editEntry, copyEntries, templateFromEntries, entriesFromTemplate, recipeFood, parseRecipeJsonLd,
    NUTRIENT_KEYS, SOURCE_LABELS, MEALS, MEAL_LABELS, KEEP_DAYS,
    scaleNutrients, gramsFor, sourceLabel, normalizeFood, kcalCheck, MICROS, microSummary,
    matchesQuery, addRecent, mergeResults,
    mealForHour, newEntryId, makeEntry, progressDelta, foodFromEntry, totals, entriesFor, groupByMeal, trimLog, migrateOldDiary,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FoodCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
