/* ── Macro story sticker ──────────────────────────────────────────────
 * The nutrition counterpart of src/js/story-sticker.js and
 * src/js/weight-sticker.js: a transparent PNG for the story composer
 * (src/js/workout-story.js) showing today's intake —
 *   • calories, with the target when there is one,
 *   • protein / carbs / fat, each with a bar towards its target,
 *   • the pre-workout meal: what it was and its macros.
 *
 * buildMacroStoryData() and preWorkoutOptions() are pure
 * (tests/macroSticker.test.js); drawMacroSticker() renders onto a
 * transparent canvas.
 */
(function (root) {
  'use strict';

  // The user's meal names (food-core.js) when loaded, else Meal 1, 2...
  const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snacks', 'meal5', 'meal6'];
  const MEAL_LABELS = new Proxy({}, {
    get: (_t, k) => (root && root.FoodCore && root.FoodCore.MEAL_LABELS && root.FoodCore.MEAL_LABELS[k]) || (MEAL_ORDER.includes(k) ? `Meal ${MEAL_ORDER.indexOf(k) + 1}` : undefined),
  });
  const MAX_FOODS = 3;

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  const kcalOf = (p, c, f) => p * 4 + c * 4 + f * 9;
  const grams = (v) => `${Math.round(v)}g`;
  const thousands = (v) => Math.round(v).toLocaleString('en-US');

  /**
   * The meals the user can pick as their pre-workout meal today.
   *  • Macro meal cards whose timing is "Pre-workout" (dailyMacroMeals) —
   *    macros only, no food names.
   *  • Each food-log meal (foodLog_<user>) with food in it today.
   * @param {Array} foodLog  food-log entries (food-core.js makeEntry)
   * @param {Array} mealCards dailyMacroMeals: { protein, carbs, fats, slot }
   * @param {string} date    YYYY-MM-DD
   * @returns {Array<{key,label,foods:string[],protein,carbs,fat,kcal}>}
   */
  function preWorkoutOptions(foodLog, mealCards, date) {
    const out = [];
    const cards = (Array.isArray(mealCards) ? mealCards : [])
      .filter((m) => m && m.slot === 'pre_workout' && num(m.protein) + num(m.carbs) + num(m.fats) > 0);
    cards.forEach((m, i) => {
      const protein = num(m.protein);
      const carbs = num(m.carbs);
      const fat = num(m.fats);
      out.push({
        key: `card:${i}`,
        label: cards.length > 1 ? `Pre-workout ${i + 1}` : 'Pre-workout',
        foods: [],
        protein, carbs, fat,
        kcal: kcalOf(protein, carbs, fat),
      });
    });

    const today = (Array.isArray(foodLog) ? foodLog : []).filter((e) => e && e.date === date);
    MEAL_ORDER.forEach((meal) => {
      const entries = today.filter((e) => e.meal === meal);
      if (!entries.length) return;
      const sum = (k) => entries.reduce((s, e) => s + num(e[k]), 0);
      const names = [];
      entries.forEach((e) => {
        const n = String(e.name || '').trim();
        if (n && !names.includes(n)) names.push(n);
      });
      const protein = sum('protein');
      const carbs = sum('carbs');
      const fat = sum('fat');
      out.push({
        key: `log:${meal}`,
        label: MEAL_LABELS[meal],
        foods: names,
        protein, carbs, fat,
        kcal: sum('kcal') || kcalOf(protein, carbs, fat),
      });
    });
    return out;
  }

  // "Oats · Banana · Whey" — the first few foods, then "+N more".
  function foodsLine(foods) {
    const list = (foods || []).map((f) => (f.length > 26 ? `${f.slice(0, 25).trimEnd()}…` : f));
    if (list.length <= MAX_FOODS) return list.join(' · ');
    return `${list.slice(0, MAX_FOODS).join(' · ')} +${list.length - MAX_FOODS} more`;
  }

  /**
   * @param {{protein,carbs,fats,cals}} progress  dailyMacroProgress
   * @param {object} [opts]
   *   targets — { calories, protein, carbs, fat } (getAdaptiveMacroTargets)
   *   preMeal — one of preWorkoutOptions(), or null
   *   date    — Date for the kicker
   * @returns {object|null} null when nothing is logged today.
   */
  function buildMacroStoryData(progress, opts = {}) {
    const p = progress || {};
    const protein = num(p.protein);
    const carbs = num(p.carbs);
    const fat = num(p.fats ?? p.fat);
    // `cals` is calories logged on their own, on top of the macros.
    const kcal = kcalOf(protein, carbs, fat) + num(p.cals);
    if (kcal <= 0) return null;

    const t = opts.targets || {};
    const target = {
      kcal: num(t.calories),
      protein: num(t.protein),
      carbs: num(t.carbs),
      fat: num(t.fat ?? t.fats),
    };
    const ratio = (v, goal) => (goal > 0 ? v / goal : null);
    const macros = [
      { key: 'protein', label: 'Protein', value: grams(protein), target: target.protein ? grams(target.protein) : null, ratio: ratio(protein, target.protein) },
      { key: 'carbs', label: 'Carbs', value: grams(carbs), target: target.carbs ? grams(target.carbs) : null, ratio: ratio(carbs, target.carbs) },
      { key: 'fat', label: 'Fat', value: grams(fat), target: target.fat ? grams(target.fat) : null, ratio: ratio(fat, target.fat) },
    ];

    // Coach stamp: every target within 10% beats "protein hit".
    let stamp = null;
    const within = (r) => r != null && r >= 0.9 && r <= 1.1;
    const kcalRatio = ratio(kcal, target.kcal);
    if (within(kcalRatio) && macros.every((m) => within(m.ratio))) stamp = 'On target';
    else if (macros[0].ratio != null && macros[0].ratio >= 0.95) stamp = 'Protein hit';

    const date = opts.date instanceof Date ? opts.date : new Date();
    const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

    const m = opts.preMeal;
    const preMeal = m ? {
      label: m.key && m.key.startsWith('log:') ? `Pre-workout · ${m.label}` : 'Pre-workout',
      foods: foodsLine(m.foods),
      macros: `${grams(m.protein)} P · ${grams(m.carbs)} C · ${grams(m.fat)} F · ${thousands(m.kcal)} kcal`,
    } : null;

    return {
      kicker: `Today's fuel · ${day}`,
      headline: `${thousands(kcal)} kcal`,
      caption: target.kcal ? `of ${thousands(target.kcal)} kcal target` : 'eaten today',
      stamp,
      macros,
      preMeal,
    };
  }

  // ── Drawing ────────────────────────────────────────────────────────
  const STICKER_W = 1080;
  const accent = () =>
    (typeof window !== 'undefined' && typeof window.accentColor === 'function')
      ? window.accentColor('--acc-52d68a')
      : '#52d68a';
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const DISPLAY = `Anton, ${FONT}`;

  function drawMacroSticker(canvas, data) {
    canvas.width = STICKER_W;
    canvas.height = 1700;
    const endY = paint(canvas.getContext('2d'), data);
    // Trim to the content so Instagram doesn't size the sticker by
    // empty transparent space.
    canvas.height = Math.ceil(endY + 60);
    paint(canvas.getContext('2d'), data);
    return canvas;
  }

  function spaced(ctx, px) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
  }

  function fit(ctx, text, weight, size, min, maxW, face) {
    ctx.font = `${weight} ${size}px ${face}`;
    while (ctx.measureText(text).width > maxW && size > min) {
      size -= 4;
      ctx.font = `${weight} ${size}px ${face}`;
    }
    return size;
  }

  function paint(ctx, d) {
    const W = STICKER_W;
    const cx = W / 2;
    ctx.clearRect(0, 0, W, ctx.canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18;
    let y = 90;

    // Kicker
    ctx.font = `600 38px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    spaced(ctx, 4);
    ctx.fillText(d.kicker.toUpperCase(), cx, y);
    spaced(ctx, 0);

    // Headline — calories in the display face
    y += 200;
    fit(ctx, d.headline, 400, 200, 90, W - 120, DISPLAY);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(d.headline, cx, y);

    y += 70;
    ctx.font = `600 44px ${FONT}`;
    ctx.fillText(d.caption, cx, y);

    if (d.stamp) {
      y += 50;
      ctx.font = `800 34px ${FONT}`;
      spaced(ctx, 3);
      const text = `✓ ${d.stamp.toUpperCase()}`;
      const h = 76;
      const w = ctx.measureText(text).width + 72;
      ctx.shadowBlur = 0;
      ctx.fillStyle = accent();
      roundRect(ctx, cx - w / 2, y, w, h, h / 2);
      ctx.fill();
      ctx.fillStyle = '#06110b';
      ctx.fillText(text, cx, y + h / 2 + 12);
      spaced(ctx, 0);
      ctx.shadowBlur = 18;
      y += h;
    }

    // Macro columns: grams, label, bar towards the target.
    const colW = 300;
    const gap = 30;
    const left = cx - (colW * 3 + gap * 2) / 2;
    const top = y + 150;
    d.macros.forEach((m, i) => {
      const x = left + i * (colW + gap);
      const mid = x + colW / 2;
      ctx.fillStyle = '#ffffff';
      fit(ctx, m.value, 400, 120, 60, colW - 20, DISPLAY);
      ctx.fillText(m.value, mid, top);

      ctx.font = `800 30px ${FONT}`;
      spaced(ctx, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillText(m.label.toUpperCase(), mid, top + 58);
      spaced(ctx, 0);

      if (m.ratio != null) {
        const barY = top + 88;
        const barW = colW - 40;
        const bx = x + 20;
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        roundRect(ctx, bx, barY, barW, 14, 7);
        ctx.fill();
        ctx.fillStyle = m.ratio >= 0.9 ? accent() : '#ffffff';
        roundRect(ctx, bx, barY, Math.max(14, barW * Math.min(1, m.ratio)), 14, 7);
        ctx.fill();
        ctx.shadowBlur = 18;
        ctx.font = `500 28px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(`of ${m.target}`, mid, barY + 56);
      }
    });
    y = top + (d.macros.some((m) => m.ratio != null) ? 144 : 58);

    // Pre-workout meal card
    if (d.preMeal) {
      y += 70;
      const boxW = 900;
      const bx = cx - boxW / 2;
      const lines = d.preMeal.foods ? 3 : 2;
      const boxH = 70 + lines * 62;
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      roundRect(ctx, bx, y, boxW, boxH, 36);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      roundRect(ctx, bx, y, boxW, boxH, 36);
      ctx.stroke();

      let ly = y + 78;
      ctx.font = `800 32px ${FONT}`;
      spaced(ctx, 4);
      ctx.fillStyle = accent();
      ctx.fillText(d.preMeal.label.toUpperCase(), cx, ly);
      spaced(ctx, 0);
      ctx.fillStyle = '#ffffff';
      if (d.preMeal.foods) {
        ly += 64;
        fit(ctx, d.preMeal.foods, 700, 44, 28, boxW - 80, FONT);
        ctx.fillText(d.preMeal.foods, cx, ly);
      }
      ly += 62;
      fit(ctx, d.preMeal.macros, 600, 38, 26, boxW - 80, FONT);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(d.preMeal.macros, cx, ly);
      ctx.shadowBlur = 18;
      y += boxH;
    }

    y += 96;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    spaced(ctx, 10);
    ctx.fillText('POCKET COACH', cx, y);
    spaced(ctx, 0);
    ctx.shadowBlur = 0;
    return y;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const api = { buildMacroStoryData, preWorkoutOptions, drawMacroSticker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MacroSticker = api;
})(typeof window !== 'undefined' ? window : null);
