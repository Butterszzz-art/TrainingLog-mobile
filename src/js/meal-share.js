/* Sending a logged meal to friends or groups, and logging or saving a meal
   someone sent you.

   The share button on a meal in the food log opens a sheet: pick friends
   (inbox, src/js/shares.js) and/or groups you're in (a group post,
   community.js), add a note, and choose whether the meal photo
   (src/js/meal-photos.js) goes with it. Only what is shown in the sheet is
   sent: food names, amounts and macros. Nothing leaves the device until
   the user taps Send.

   A received meal can be logged to today (it lands in the meal for the
   current time; tap a food to move it) or kept as a saved meal
   (mealTemplates_<user>, the same list as "Save as a meal"). */
(function (root) {
  'use strict';

  const Core = (typeof module !== 'undefined' && module.exports) ? require('./food-core.js') : root.FoodCore;

  /* ── Pure logic (tests/mealShare.test.js) ─────────────────────── */

  const r1 = v => Math.round((Number(v) || 0) * 10) / 10;

  // Today's foods in one meal → the item Shares.send / group posts take.
  function mealShareItem(entries, meal, name) {
    const items = (entries || []).filter(e => e && e.name).slice(0, 40).map(e => {
      const it = { name: String(e.name).slice(0, 80), kcal: Math.round(Number(e.kcal) || 0), protein: r1(e.protein), carbs: r1(e.carbs), fat: r1(e.fat) };
      if (Number(e.amount) > 0) { it.amount = r1(e.amount); if (e.unit) it.unit = String(e.unit).slice(0, 12); }
      if (Number(e.grams) > 0) it.grams = r1(e.grams);
      // The log calls it `fiber`; shared meals use `fibre` (backend src/mealShare.js).
      if (e.fiber != null && Number.isFinite(Number(e.fiber))) it.fibre = r1(e.fiber);
      return it;
    });
    if (!items.length) return null;
    return { type: 'meal', name: String(name || '').trim().slice(0, 60) || 'Meal', data: { meal, items } };
  }

  // Totals of a shared meal (the server sends them, but older or partial
  // data is recomputed here so the pills always match the foods).
  function mealTotals(data) {
    const items = data && Array.isArray(data.items) ? data.items : [];
    const sum = k => r1(items.reduce((t, i) => t + (Number(i[k]) || 0), 0));
    return { kcal: Math.round(sum('kcal')), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat') };
  }

  // A shared food → a food the log understands. With grams, nutrients are
  // per 100 g as usual; without, the whole portion counts as one "serving".
  function foodFromSharedItem(it, i) {
    if (!it || typeof it.name !== 'string' || !it.name.trim()) return null;
    const grams = Number(it.grams) > 0 ? Number(it.grams)
      : (['g', 'ml'].includes(it.unit) && Number(it.amount) > 0 ? Number(it.amount) : 0);
    const base = grams || 100;
    // Not rounded: the log rounds once when it scales back to the portion,
    // so the logged numbers match what was sent.
    const per = k => ((Number(it[k]) || 0) * 100) / base;
    const per100 = { kcal: per('kcal'), protein: per('protein'), carbs: per('carbs'), fat: per('fat') };
    if (it.fibre != null) per100.fiber = per('fibre');
    const food = Core.normalizeFood({
      id: `shared:${i}:${String(it.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
      source: 'custom', name: it.name, basis: it.unit === 'ml' ? 'ml' : 'g', per100,
      servings: grams ? [] : [{ label: 'serving', grams: 100 }],
    });
    if (!food) return null;
    return grams
      ? { food, grams, amount: Number(it.amount) > 0 ? Number(it.amount) : grams, unit: Number(it.amount) > 0 && it.unit ? it.unit : food.basis }
      : { food, grams: 100, amount: 1, unit: 'serving' };
  }

  // Shared meal → food log entries for `date` / `meal`.
  function entriesFromSharedMeal(data, { date, meal, now, rand } = {}) {
    const items = data && Array.isArray(data.items) ? data.items : [];
    return Core.entriesFromTemplate({ items: items.map(foodFromSharedItem).filter(Boolean) }, { date, meal, now, rand });
  }

  // Shared meal → a saved meal (same shape as "Save as a meal").
  function templateFromSharedMeal(name, data, opts = {}) {
    return Core.templateFromEntries(name, entriesFromSharedMeal(data, { date: '2000-01-01', meal: 'snacks', now: 0 }), opts);
  }

  const api = { mealShareItem, mealTotals, entriesFromSharedMeal, templateFromSharedMeal };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ── Browser ──────────────────────────────────────────────────── */

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const user = () => root.currentUser || localStorage.getItem('fitnessAppUser') || '';
  const FL = () => root.FoodLog || {};
  const toast = (m, type) => (root.showToast ? root.showToast(m, type) : FL().toast && FL().toast(m));
  const icon = name => (typeof ICONS !== 'undefined' && ICONS[name]) || ''; // eslint-disable-line no-undef

  // Coloured P/C/F pills (same badges as the food search and the log).
  function pillsHtml(data) {
    const t = mealTotals(data);
    return `<span class="food-item-macros meal-share-pills">
      <span class="fim kcal-badge">${t.kcal} kcal</span>
      <span class="fim protein-badge">${t.protein}P</span>
      <span class="fim carbs-badge">${t.carbs}C</span>
      <span class="fim fat-badge">${t.fat}F</span>
    </span>`;
  }

  function foodsHtml(data) {
    const items = data && Array.isArray(data.items) ? data.items : [];
    return `<p class="meal-share-foods">${items.map(i => esc(i.amount ? `${i.name} (${i.amount}${i.unit && i.unit !== 'g' && i.unit !== 'ml' ? ' ' : ''}${i.unit || ''})` : i.name)).join(', ')}</p>`;
  }

  /* Sending */

  async function openShareMeal(meal) {
    const Sheet = root.FoodSheet;
    if (!Sheet || !Core) return;
    const label = Core.MEAL_LABELS[meal] || 'Meal';
    const entries = Core.groupByMeal(Core.entriesFor(FL().load(), FL().today()))[meal] || [];
    const item = mealShareItem(entries, meal, label);
    if (!item) return;
    let photo = null;
    try { photo = await root.mealPhotos?.getPhoto?.(user(), FL().today(), meal); } catch { /* no photo */ }

    const friends = (typeof root.getFriends === 'function' ? root.getFriends() : []).filter(f => f && f.username);
    const groups = (typeof root.getGroups === 'function' ? root.getGroups() : [])
      .filter(g => typeof root.isMemberOf === 'function' ? root.isMemberOf(g, root.getCurrentUserId?.()) : g.isMember);
    const chip = (kind, value, text) => `<button type="button" class="meal-share-chip" data-pick="${kind}" data-value="${esc(value)}" aria-pressed="false">${esc(text)}</button>`;

    Sheet.open(`
      <form class="food-form" data-meal-share-form>
        <div class="food-sheet-hdr"><h3>Send ${esc(label.toLowerCase())}</h3><button type="button" class="food-sheet-x" aria-label="Close" data-close>✕</button></div>
        ${pillsHtml(item.data)}
        ${foodsHtml(item.data)}
        ${photo ? `<label class="meal-share-photo-opt"><input type="checkbox" name="withPhoto" checked> <img src="${esc(photo)}" alt=""> Include the photo</label>` : ''}
        <label class="food-field"><span>Name</span><input name="name" maxlength="60" value="${esc(label)}"></label>
        <label class="food-field"><span>Note (optional)</span><input name="note" maxlength="200" placeholder="e.g. 50 g protein and done in 10 minutes"></label>
        <p class="meal-share-h">Friends</p>
        <div class="meal-share-chips">${friends.length ? friends.map(f => chip('friend', f.username, '@' + f.username)).join('') : '<span class="meal-share-none">No friends yet. Add them in Community → Friends.</span>'}</div>
        <p class="meal-share-h">Groups</p>
        <div class="meal-share-chips">${groups.length ? groups.map(g => chip('group', g.id, g.name)).join('') : '<span class="meal-share-none">You’re not in a group yet.</span>'}</div>
        <p class="meal-share-privacy">They’ll see the foods, amounts and macros${photo ? ' and, if ticked, the photo' : ''}. Group members can see posts until they’re deleted.</p>
        <button type="submit" class="food-add-btn" data-meal-share-send disabled>Send</button>
      </form>`, { label: `Send ${label.toLowerCase()}` });

    const form = document.querySelector('[data-meal-share-form]');
    form.querySelector('[data-close]').onclick = Sheet.close;
    const sendBtn = form.querySelector('[data-meal-share-send]');
    const picked = () => [...form.querySelectorAll('[data-pick][aria-pressed="true"]')];
    form.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      const n = picked().length;
      sendBtn.disabled = !n;
      sendBtn.textContent = n ? `Send to ${n}` : 'Send';
    }));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const targets = picked();
      if (!targets.length) return;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      const share = { ...item, name: form.name.value.trim() || label };
      const note = form.note.value.trim();
      const withPhoto = photo && form.withPhoto?.checked ? photo : null;
      let ok = 0;
      let lastError = null;
      for (const t of targets) {
        try {
          if (t.dataset.pick === 'friend') await root.Shares.send(t.dataset.value, share, note, { photo: withPhoto });
          else await root.shareMealToGroup(t.dataset.value, share, { text: note, photo: withPhoto });
          ok++;
        } catch (err) {
          lastError = err;
        }
      }
      if (ok) { Sheet.close(); toast(`✅ Sent to ${ok}`, 'success'); }
      if (lastError) {
        toast(lastError.message || 'Could not send', 'error');
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
      }
    };
  }

  /* Receiving */

  function logSharedMeal(data, name) {
    if (root.guardMacroDayLocked?.()) return false;
    const meal = Core.mealForHour(new Date().getHours());
    const entries = entriesFromSharedMeal(data, { date: FL().today(), meal, now: Date.now() });
    if (!entries.length) return false;
    entries.forEach(e => FL().add(e));
    toast(`✅ Logged ${name || 'the meal'} to ${Core.MEAL_LABELS[meal].toLowerCase()}`, 'success');
    return true;
  }

  function saveSharedMeal(data, name, from) {
    const u = user();
    if (!u) return false;
    const tpl = templateFromSharedMeal(from ? `${name} (from @${from})` : name, data, { now: Date.now() });
    if (!tpl) return false;
    const key = `mealTemplates_${u}`;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key)) || []; } catch { list = []; }
    localStorage.setItem(key, JSON.stringify([...(Array.isArray(list) ? list : []), tpl]));
    toast(`✅ Saved "${tpl.name}" to your meals`, 'success');
    return true;
  }

  // The meal part of an inbox row or a group post. `photoKey` marks where
  // the photo goes once loaded (see loadPhotos).
  function receivedMealHtml(share, { photoKey } = {}) {
    return `<div class="meal-share-card">
      ${photoKey ? `<div class="meal-share-photo" data-meal-photo-key="${esc(photoKey)}"></div>` : ''}
      ${pillsHtml(share.data)}
      ${foodsHtml(share.data)}
    </div>`;
  }

  // Fills photo placeholders inside `container`. fetchers: { key: () => Promise<dataUrl> }
  const _photoCache = new Map();
  function loadPhotos(container, fetchers) {
    if (!container) return;
    container.querySelectorAll('[data-meal-photo-key]').forEach(async (el) => {
      const key = el.dataset.mealPhotoKey;
      const fetcher = fetchers[key];
      if (!fetcher) return;
      try {
        if (!_photoCache.has(key)) _photoCache.set(key, fetcher());
        const src = await _photoCache.get(key);
        if (src && el.isConnected) el.innerHTML = `<img src="${esc(src)}" alt="Photo of the meal" loading="lazy">`;
      } catch {
        _photoCache.delete(key);
      }
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-share-meal]');
    if (b) openShareMeal(b.dataset.shareMeal);
  });

  root.MealShare = { ...api, openShareMeal, logSharedMeal, saveSharedMeal, receivedMealHtml, loadPhotos, pillsHtml };
})(typeof window !== 'undefined' ? window : globalThis);
