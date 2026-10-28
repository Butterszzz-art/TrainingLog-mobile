/* =============================================================
   FOOD BARCODE + CUSTOM FOOD FORM
   scanFoodBarcode(): scan a product, look it up and open the usual
   "amount + meal" step for it.
     1. Read the code: the native scanner in the app
        (@capacitor/barcode-scanner, its own camera screen), the
        browser's BarcodeDetector on the web, or typing the numbers.
     2. Foods already on the device with that barcode (your own foods,
        recent foods) — works offline.
     3. The backend's /api/food/barcode/:code (Open Food Facts, then
        USDA Branded).
     4. Not found / offline: the custom food form, with the barcode
        filled in, so the next scan finds it.
   openCustomFoodForm() is also used to add or edit your own foods.
   ============================================================= */

(function () {
  'use strict';

  const Core = window.FoodCore;
  const FL = () => window.FoodLog || {};

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg) {
    if (FL().toast) FL().toast(msg);
    else if (window.showToast) window.showToast(msg);
  }

  /* ── Sheet (shared by the scanner fallback and the form) ─── */

  function openSheet(html, { label }) {
    closeSheet();
    const wrap = document.createElement('div');
    wrap.id = 'foodSheet';
    wrap.className = 'food-sheet-backdrop';
    wrap.innerHTML = `<div class="food-sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
    wrap.addEventListener('click', e => { if (e.target === wrap) closeSheet(); });
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onEsc);
    const first = wrap.querySelector('input, select, button');
    if (first) first.focus({ preventScroll: true });
    return wrap;
  }

  function onEsc(e) { if (e.key === 'Escape') closeSheet(); }

  let stopCamera = null;
  function closeSheet() {
    if (stopCamera) { stopCamera(); stopCamera = null; }
    document.removeEventListener('keydown', onEsc);
    document.getElementById('foodSheet')?.remove();
  }
  window.closeFoodSheet = closeSheet;

  /* ── Reading a barcode ───────────────────────────────────── */

  function nativeScannerAvailable() {
    const cap = window.Capacitor;
    return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()
      && typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable('CapacitorBarcodeScanner'));
  }

  // → code string, '' when cancelled, or null when this device can't scan.
  async function readNative() {
    if (!nativeScannerAvailable()) return null;
    try {
      const res = await window.Capacitor.nativePromise('CapacitorBarcodeScanner', 'scanBarcode', {
        hint: 17, // ALL — iOS doesn't tell EAN-13 and UPC-A apart anyway
        scanInstructions: 'Point the camera at the barcode',
        cancelButtonAccessibilityLabel: 'Cancel scanning',
      });
      return String((res && res.ScanResult) || '');
    } catch (err) {
      // Cancelling the scanner rejects; so does a denied camera.
      if (/cancel/i.test(String(err && (err.message || err.code)))) return '';
      console.warn('[Barcode] native scan failed:', err && err.message);
      return null;
    }
  }

  // Live camera + BarcodeDetector (Chrome on Android, desktop Chrome).
  function readWithDetector() {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) return Promise.resolve(null);
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; closeSheet(); resolve(v); };
      openSheet(`
        <div class="food-sheet-hdr"><h3>Scan barcode</h3><button type="button" class="food-sheet-x" aria-label="Close" data-scan-cancel>✕</button></div>
        <video id="foodScanVideo" class="food-scan-video" playsinline muted></video>
        <p class="food-sheet-sub">Hold the barcode inside the frame.</p>
        <button type="button" class="food-share-no" data-scan-manual>Type the numbers instead</button>`, { label: 'Scan barcode' });
      const sheet = document.getElementById('foodSheet');
      sheet.querySelector('[data-scan-cancel]').onclick = () => finish('');
      sheet.querySelector('[data-scan-manual]').onclick = () => finish('manual');
      let stream = null;
      let timer = null;
      stopCamera = () => { clearInterval(timer); stream?.getTracks().forEach(t => t.stop()); };
      (async () => {
        try {
          const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (done) { stream.getTracks().forEach(t => t.stop()); return; }
          const video = document.getElementById('foodScanVideo');
          video.srcObject = stream;
          await video.play();
          timer = setInterval(async () => {
            try {
              const codes = await detector.detect(video);
              const hit = codes.map(c => c.rawValue).find(v => Core.validBarcode(v));
              if (hit) finish(hit);
            } catch { /* frame not ready */ }
          }, 250);
        } catch (err) {
          console.warn('[Barcode] camera unavailable:', err && err.message);
          finish('manual');
        }
      })();
    });
  }

  function readTyped() {
    return new Promise(resolve => {
      openSheet(`
        <form class="food-form" data-typed-form>
          <div class="food-sheet-hdr"><h3>Enter barcode</h3><button type="button" class="food-sheet-x" aria-label="Close" data-typed-cancel>✕</button></div>
          <label class="food-field"><span>The numbers under the barcode</span>
            <input name="code" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" maxlength="18" required /></label>
          <p class="food-form-err" hidden></p>
          <button type="submit" class="food-add-btn">Look up</button>
        </form>`, { label: 'Enter barcode' });
      const form = document.querySelector('[data-typed-form]');
      form.querySelector('[data-typed-cancel]').onclick = () => { closeSheet(); resolve(''); };
      form.onsubmit = e => {
        e.preventDefault();
        const code = form.code.value;
        if (!Core.validBarcode(code)) {
          const err = form.querySelector('.food-form-err');
          err.hidden = false;
          err.textContent = 'That doesn’t look like a valid barcode. Check the numbers.';
          return;
        }
        closeSheet();
        resolve(code);
      };
    });
  }

  async function readBarcode() {
    let code = await readNative();
    if (code === null) code = await readWithDetector();
    if (code === null || code === 'manual') code = await readTyped();
    return code;
  }

  /* ── Lookup ──────────────────────────────────────────────── */

  // → { food } | { notFound } | { offline } | { error }
  async function lookup(code) {
    const local = FL().localFoodByBarcode ? FL().localFoodByBarcode(code) : null;
    if (local) return { food: local };
    if (!navigator.onLine || !window.SERVER_URL) return { offline: true };
    try {
      const res = await fetch(`${window.SERVER_URL}/api/food/barcode/${encodeURIComponent(Core.normalizeBarcode(code))}`, {
        headers: FL().authHeaders ? FL().authHeaders() : {}, signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 404) return { notFound: true };
      if (!res.ok || !data || !data.success) return { error: (data && data.error && data.error.message) || 'Lookup failed.' };
      const food = Core.normalizeFood(data.food);
      return food ? { food } : { notFound: true };
    } catch {
      return { offline: true };
    }
  }

  function showFoodWidget() {
    // The food search lives in the Meals card on the Macros tab.
    const card = document.getElementById('mealsCard');
    if (card && !card.open) card.open = true;
    if (typeof window.injectFoodSearchWidget === 'function') window.injectFoodSearchWidget();
    document.getElementById('foodSearchWidget')?.scrollIntoView({ block: 'center' });
  }

  async function scanFoodBarcode() {
    if (window.guardMacroDayLocked?.()) return;
    const raw = await readBarcode();
    if (!raw) return;
    const code = Core.normalizeBarcode(raw);
    if (!code || !Core.validBarcode(code)) { toast('That barcode didn’t read correctly — try again.'); return; }
    toast('Looking up product…');
    const r = await lookup(code);
    if (r.food) {
      showFoodWidget();
      window.selectFoodForLogging?.(r.food);
      return;
    }
    const why = r.notFound ? 'This product isn’t in the food databases yet.'
      : r.offline ? 'You’re offline, so this product can’t be looked up.'
        : r.error;
    openCustomFoodForm({ barcode: code, note: `${why} Add it from the label — next time this barcode is scanned it’s found straight away.`, logAfter: true });
  }
  window.scanFoodBarcode = scanFoodBarcode;

  /* ── Custom food form ────────────────────────────────────── */

  const EXTRA = [
    ['fiber', 'Fibre', 'g'], ['sugar', 'Sugars', 'g'], ['satFat', 'Saturated fat', 'g'], ['sodiumMg', 'Sodium', 'mg'],
    ['ironMg', 'Iron', 'mg'], ['calciumMg', 'Calcium', 'mg'], ['potassiumMg', 'Potassium', 'mg'],
    ['magnesiumMg', 'Magnesium', 'mg'], ['vitDUg', 'Vitamin D', 'µg'], ['b12Ug', 'Vitamin B12', 'µg'],
  ];

  function numField(name, label, unit, value, required) {
    return `<label class="food-field food-field--num"><span>${esc(label)}</span>
      <span class="food-field-in"><input name="${name}" type="number" min="0" step="any" inputmode="decimal" value="${value ?? ''}" ${required ? 'required' : ''} /><small>${esc(unit)}</small></span></label>`;
  }

  // opts: { food (to edit), barcode, note, logAfter, onSaved(food) }
  function openCustomFoodForm(opts = {}) {
    const f = opts.food || {};
    const p = f.per100 || {};
    const servings = (f.servings || []).slice(0, 3);
    while (servings.length < 1) servings.push({ label: '', grams: '' });
    const html = `
      <form class="food-form" data-custom-form novalidate>
        <div class="food-sheet-hdr"><h3>${f.id ? 'Edit food' : 'Add your own food'}</h3><button type="button" class="food-sheet-x" aria-label="Close" data-form-cancel>✕</button></div>
        ${opts.note ? `<p class="food-sheet-sub">${esc(opts.note)}</p>` : ''}
        <label class="food-field"><span>Name</span><input name="name" required maxlength="120" value="${esc(f.name || '')}" /></label>
        <label class="food-field"><span>Brand (optional)</span><input name="brand" maxlength="80" value="${esc(f.brand || '')}" /></label>
        <label class="food-field"><span>Barcode (optional)</span><input name="barcode" inputmode="numeric" maxlength="18" value="${esc(opts.barcode || f.barcode || '')}" /></label>
        <fieldset class="food-fieldset">
          <legend>Nutrition (from the label)</legend>
          <label class="food-basis-row"><span>Values are per 100</span>
            <select name="basis"><option value="g"${f.basis === 'ml' ? '' : ' selected'}>g</option><option value="ml"${f.basis === 'ml' ? ' selected' : ''}>ml</option></select></label>
          <div class="food-grid">
            ${numField('kcal', 'Calories', 'kcal', p.kcal, false)}
            ${numField('protein', 'Protein', 'g', p.protein, true)}
            ${numField('carbs', 'Carbs', 'g', p.carbs, true)}
            ${numField('fat', 'Fat', 'g', p.fat, true)}
          </div>
          <details class="food-more"${EXTRA.some(([k]) => p[k] !== undefined) ? ' open' : ''}><summary>More nutrients (optional — leave blank if not on the label)</summary>
            <div class="food-grid">${EXTRA.map(([k, l, u]) => numField(k, l, u, p[k], false)).join('')}</div>
          </details>
        </fieldset>
        <fieldset class="food-fieldset">
          <legend>Serving (optional)</legend>
          ${servings.map((s, i) => `<div class="food-grid food-grid--serving">
            <label class="food-field"><span>Name</span><input name="servingLabel${i}" placeholder="e.g. 1 slice" maxlength="60" value="${esc(s.label || '')}" /></label>
            ${numField('servingGrams' + i, 'Weight', 'g', s.grams, false)}</div>`).join('')}
        </fieldset>
        <p class="food-form-err" role="alert" hidden></p>
        <div class="food-share-actions">
          <button type="submit" class="food-add-btn">${opts.logAfter ? 'Save and log' : 'Save food'}</button>
          <button type="button" class="food-share-no" data-form-cancel>Cancel</button>
        </div>
      </form>`;
    openSheet(html, { label: f.id ? 'Edit food' : 'Add your own food' });
    const form = document.querySelector('[data-custom-form]');
    form.querySelectorAll('[data-form-cancel]').forEach(b => { b.onclick = closeSheet; });
    form.onsubmit = e => {
      e.preventDefault();
      const fields = { name: form.name.value, brand: form.brand.value, barcode: form.barcode.value.trim(), basis: form.basis.value, servings: [] };
      ['kcal', 'protein', 'carbs', 'fat', ...EXTRA.map(x => x[0])].forEach(k => { fields[k] = form[k].value.trim(); });
      servings.forEach((_, i) => fields.servings.push({ label: form['servingLabel' + i].value, grams: form['servingGrams' + i].value }));
      const { food, error } = Core.customFoodFromForm(fields, { id: f.id, now: Date.now() });
      const errEl = form.querySelector('.food-form-err');
      if (error) { errEl.hidden = false; errEl.textContent = error; return; }
      FL().saveCustomFood(food);
      closeSheet();
      toast(`✅ ${food.name.slice(0, 30)} saved to your foods`);
      if (typeof opts.onSaved === 'function') opts.onSaved(food);
      if (opts.logAfter) { showFoodWidget(); window.selectFoodForLogging?.(Core.normalizeFood(food)); }
    };
  }
  window.openCustomFoodForm = openCustomFoodForm;
})();
