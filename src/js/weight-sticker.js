/* ── Weight story sticker ─────────────────────────────────────────────
 * The bodyweight counterpart of src/js/story-sticker.js: a transparent
 * PNG for the story composer (src/js/workout-story.js) that tells the
 * user's weight story the way their coach would —
 *   • framed by their goal (cut / bulk / maintain) from the Macros tab,
 *   • measured on the 7-day average, not one noisy morning weigh-in,
 *   • checked against their planned weekly rate (dashed "plan" line and
 *     an ON PLAN stamp),
 *   • private by default: the change is shown, the actual bodyweight
 *     only when the user switches it on.
 *
 * buildWeightStoryData() is pure (tests/weightSticker.test.js);
 * drawWeightSticker() renders it onto a transparent canvas.
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const KG_TO_LB = 2.20462;
  const RANGES = { '4w': 28, '12w': 84, all: Infinity };
  // Below this the scale is just noise — treat it as "no change".
  const MIN_CHANGE_KG = 0.2;
  // Maintenance counts as held when the average stayed inside this band.
  const MAINTAIN_BAND_KG = 1;

  function entryKg(e) {
    if (!e) return null;
    if (typeof e.weightKg === 'number' && Number.isFinite(e.weightKg)) return e.weightKg;
    const w = parseFloat(e.weight);
    if (!Number.isFinite(w)) return null;
    return e.unit === 'lb' ? w / KG_TO_LB : w;
  }

  function dayOf(date) {
    const t = new Date(String(date || '').slice(0, 10) + 'T00:00:00').getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  function toUnit(kg, unit) {
    return unit === 'lb' ? kg * KG_TO_LB : kg;
  }

  function fmt(n, unit, signed) {
    const r = Math.round(n * 10) / 10;
    const abs = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const sign = !signed || r === 0 ? '' : r > 0 ? '+' : '−';
    return `${sign}${abs}${unit ? ' ' + unit : ''}`;
  }

  function periodLabel(days) {
    if (days < 14) return `${Math.max(1, Math.round(days))} day${Math.round(days) === 1 ? '' : 's'}`;
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }

  const GOAL_LABEL = { cut: 'Cut', bulk: 'Lean bulk', maintain: 'Maintenance' };

  /**
   * Everything the sticker shows.
   * @param {Array} log bodyweightLog entries ({date, weightKg} or {date, weight, unit})
   * @param {{range?:'4w'|'12w'|'all', goal?:string, planKgPerWeek?:number, unit?:'kg'|'lb'}} opts
   * @returns {null | {
   *   kicker:string, headline:string, caption:string,
   *   stamp: null | {text:string},
   *   entries:number, period:string, unit:string,
   *   startText:string, endText:string,
   *   points: {x:number, kg:number}[],   // raw weigh-ins, x in 0..1
   *   trend:  {x:number, kg:number}[],   // 7-day average at each weigh-in
   *   plan:   null | {x:number, kg:number}[],  // planned pace from the start
   * }}
   */
  function buildWeightStoryData(log, opts = {}) {
    const unit = opts.unit === 'lb' ? 'lb' : 'kg';
    const goal = GOAL_LABEL[opts.goal] ? opts.goal : null;
    const plan = Number(opts.planKgPerWeek) || 0;
    const windowDays = RANGES[opts.range] ?? RANGES['12w'];

    // One reading per day (the log replaces same-day entries, but synced
    // or imported data might not), oldest first.
    const byDay = new Map();
    (Array.isArray(log) ? log : []).forEach((e) => {
      const t = dayOf(e?.date);
      const kg = entryKg(e);
      if (Number.isFinite(t) && kg != null && kg > 0) byDay.set(t, kg);
    });
    const rows = [...byDay.entries()].map(([t, kg]) => ({ t, kg })).sort((a, b) => a.t - b.t);
    if (rows.length < 2) return null;

    const lastT = rows[rows.length - 1].t;
    const inRange = rows.filter((r) => r.t >= lastT - windowDays * DAY);
    if (inRange.length < 2) return null;

    // 7-day average at each weigh-in. Looks back past the range start so
    // the first point is as smooth as the rest. `tc` is the average's time
    // centre: the rate is measured between centres, otherwise a first point
    // with no earlier week to average would understate it.
    const avgAt = (t) => {
      const near = rows.filter((r) => r.t <= t && r.t > t - 7 * DAY);
      return {
        kg: near.reduce((s, r) => s + r.kg, 0) / near.length,
        tc: near.reduce((s, r) => s + r.t, 0) / near.length,
      };
    };
    const firstT = inRange[0].t;
    const spanDays = Math.max(1, (lastT - firstT) / DAY);
    const xOf = (t) => (t - firstT) / (lastT - firstT || 1);
    const points = inRange.map((r) => ({ x: xOf(r.t), kg: r.kg }));
    const avgs = inRange.map((r) => avgAt(r.t));
    const trend = inRange.map((r, i) => ({ x: xOf(r.t), kg: avgs[i].kg }));

    const startKg = trend[0].kg;
    const endKg = trend[trend.length - 1].kg;
    const change = endKg - startKg;
    const rateDays = Math.max(1, (avgs[avgs.length - 1].tc - avgs[0].tc) / DAY);
    const perWeek = (change / rateDays) * 7;
    const period = periodLabel(spanDays);
    const changeText = fmt(toUnit(change, unit), unit, true);
    const rateText = `${fmt(toUnit(perWeek, unit), unit, true)}/wk`;

    const towardGoal =
      goal === 'cut' ? change <= -MIN_CHANGE_KG
        : goal === 'bulk' ? change >= MIN_CHANGE_KG
          : goal === 'maintain' ? Math.abs(change) <= MAINTAIN_BAND_KG
            : null;

    let headline;
    let caption;
    let stamp = null;
    let planLine = null;
    if (goal === 'maintain' && towardGoal) {
      headline = period;
      caption = `held within ${fmt(toUnit(Math.max(Math.abs(change), 0.1), unit), unit)}`;
      stamp = { text: 'Holding steady' };
    } else if (towardGoal) {
      headline = changeText;
      caption = `${change < 0 ? 'down' : 'up'} in ${period}`;
      // Planned pace only makes sense when the plan points the same way.
      if (plan && Math.sign(plan) === Math.sign(change)) {
        const ratio = perWeek / plan;
        const verdict = ratio > 1.4 ? 'Ahead of plan' : ratio >= 0.6 ? 'On plan' : 'Steady progress';
        stamp = { text: `${verdict} · ${rateText}` };
        planLine = [{ x: 0, kg: startKg }, { x: 1, kg: startKg + (plan * rateDays) / 7 }];
      } else {
        stamp = { text: rateText };
      }
    } else if (goal) {
      // Moving away from the goal: the story worth sharing is showing up.
      headline = String(inRange.length);
      caption = `weigh-ins in ${period}`;
    } else if (Math.abs(change) >= MIN_CHANGE_KG) {
      headline = changeText;
      caption = `in ${period}`;
      stamp = { text: rateText };
    } else {
      headline = period;
      caption = `held within ${fmt(toUnit(Math.max(Math.abs(change), 0.1), unit), unit)}`;
    }

    return {
      kicker: `${goal ? GOAL_LABEL[goal] : 'Bodyweight'} · ${period}`,
      headline,
      caption,
      stamp,
      entries: inRange.length,
      period,
      unit,
      startText: fmt(toUnit(startKg, unit), unit),
      endText: fmt(toUnit(endKg, unit), unit),
      points,
      trend,
      plan: planLine,
    };
  }

  // ── Drawing ────────────────────────────────────────────────────────
  const STICKER_W = 1080;
  const accent = () =>
    (typeof window !== 'undefined' && typeof window.accentColor === 'function')
      ? window.accentColor('--acc-52d68a')
      : '#52d68a';
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  // The app's display face for big numbers; falls back to the system
  // stack when it hasn't loaded.
  const DISPLAY = `Anton, ${FONT}`;

  function drawWeightSticker(canvas, data, opts = {}) {
    canvas.width = STICKER_W;
    canvas.height = 1700;
    const endY = paint(canvas.getContext('2d'), data, opts);
    canvas.height = Math.ceil(endY + 60);
    paint(canvas.getContext('2d'), data, opts);
    return canvas;
  }

  function spaced(ctx, px) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
  }

  function paint(ctx, d, { showWeight = false } = {}) {
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

    // Headline — the change, in the app's display face
    y += 200;
    let size = 210;
    ctx.font = `400 ${size}px ${DISPLAY}`;
    while (ctx.measureText(d.headline).width > W - 120 && size > 90) {
      size -= 8;
      ctx.font = `400 ${size}px ${DISPLAY}`;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(d.headline, cx, y);

    y += 70;
    ctx.font = `600 44px ${FONT}`;
    ctx.fillText(d.caption, cx, y);

    // Coach stamp
    if (d.stamp) {
      y += 50;
      ctx.font = `800 34px ${FONT}`;
      spaced(ctx, 3);
      const text = `✓ ${d.stamp.text.toUpperCase()}`;
      const tw = ctx.measureText(text).width;
      const h = 76;
      const w = tw + 72;
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

    // Chart: raw weigh-ins as faint dots, the 7-day average as the line,
    // the planned pace as a dashed guide.
    const boxW = 820;
    const boxH = 300;
    const x0 = cx - boxW / 2;
    const y0 = y + 80;
    const all = d.trend.map((p) => p.kg).concat(d.points.map((p) => p.kg), d.plan ? d.plan.map((p) => p.kg) : []);
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const px = (p) => ({ x: x0 + p.x * boxW, y: y0 + (max - p.kg) / span * boxH });

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    d.points.map(px).forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill(); });

    if (d.plan) {
      const [a, b] = d.plan.map(px);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'butt';
      ctx.setLineDash([22, 16]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.shadowBlur = 18;
    const pts = d.trend.map(px);
    ctx.lineWidth = 14;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.shadowBlur = 0;
    const first = pts[0];
    const last = pts[pts.length - 1];
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(first.x, first.y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(last.x, last.y, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent();
    ctx.beginPath(); ctx.arc(last.x, last.y, 17, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 18;
    y = y0 + boxH;

    if (showWeight) {
      y += 80;
      ctx.font = `700 44px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(d.startText, x0 - 10, y);
      ctx.textAlign = 'right';
      ctx.fillText(d.endText, x0 + boxW + 10, y);
      ctx.textAlign = 'center';
    }

    y += 84;
    ctx.font = `500 32px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    const legend = d.plan ? '7-day average vs. planned pace' : '7-day average';
    ctx.fillText(`${d.entries} weigh-ins · ${legend}`, cx, y);

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

  const api = { buildWeightStoryData, drawWeightSticker, RANGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WeightSticker = api;
})(typeof window !== 'undefined' ? window : null);
