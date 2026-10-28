/* =============================================================
   NUTRITION INSIGHTS — intake against training and weight
   Pure functions (no DOM, no network), used by:
     - the weekly review's "Nutrition and performance" section
       (nutrition-review.js; the AI wording is Pro, the facts and the
       rules-based version are for everyone)
     - the Insights tab card and the Macros tab's review row
   and tested in tests/nutritionInsights.test.js.

   Inputs are plain arrays the browser glue reads from localStorage:
     days:     [{ date, kcal, protein, carbs, fat }]   (daily totals)
     weights:  [{ date, kg }]
     sessions: [{ date, volume }]                      (Σ weight × reps)
     entries:  food log entries (food-core.js)
   ============================================================= */

(function (root) {
  'use strict';

  const DAY = 864e5;
  const KCAL_PER_KG = 7700;
  const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));
  const r0 = n => Math.round(n);
  const r1 = n => Math.round(n * 10) / 10;
  const t = d => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
  const addDays = (iso, n) => new Date(t(iso) + n * DAY).toISOString().slice(0, 10);
  const within = (date, from, to) => typeof date === 'string' && date.slice(0, 10) >= from && date.slice(0, 10) <= to;
  const avg = list => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : null);

  // Least-squares slope of y per day.
  function slopePerDay(points) {
    const pts = points.filter(p => num(p.y) !== null && Number.isFinite(p.x));
    if (pts.length < 2) return null;
    const mx = avg(pts.map(p => p.x));
    const my = avg(pts.map(p => p.y));
    let sxy = 0;
    let sxx = 0;
    pts.forEach(p => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; });
    return sxx ? sxy / sxx : null;
  }

  // Real maintenance: what you ate on average, corrected for what the scale
  // did (7,700 kcal per kg). Needs enough logged days and weigh-ins spread
  // over at least 10 days, else null.
  // → { kcal, avgIntake, kgPerWeek, loggedDays, weighIns, confidence }
  function estimateMaintenance({ days, weights, end, windowDays = 28 }) {
    const from = addDays(end, -(windowDays - 1));
    const logged = (days || []).filter(d => within(d.date, from, end) && num(d.kcal) > 0);
    const w = (weights || []).filter(x => within(x.date, from, end) && num(x.kg) > 0);
    if (logged.length < 10 || w.length < 3) return null;
    const sorted = w.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if ((t(sorted[sorted.length - 1].date) - t(sorted[0].date)) / DAY < 10) return null;
    const slope = slopePerDay(sorted.map(x => ({ x: t(x.date) / DAY, y: Number(x.kg) })));
    if (slope === null) return null;
    const avgIntake = avg(logged.map(d => Number(d.kcal)));
    const kcal = Math.round((avgIntake - slope * KCAL_PER_KG) / 10) * 10;
    return {
      kcal,
      avgIntake: r0(avgIntake),
      kgPerWeek: Math.round(slope * 7 * 100) / 100 || 0,
      loggedDays: logged.length,
      weighIns: sorted.length,
      confidence: logged.length >= 21 && sorted.length >= 8 ? 'good' : 'rough',
    };
  }

  // Σ weight × reps of a workout from the app's log ({ log: [{ weightsArray,
  // repsArray }] }) or the coach pack ({ exercises: [{ sets: [{ w, r }] }] }).
  function sessionVolume(w) {
    if (!w) return 0;
    if (Array.isArray(w.exercises)) {
      return w.exercises.reduce((s, e) => s + (e.sets || []).reduce((a, x) => a + (num(x.w) || 0) * (num(x.r) || 0), 0), 0);
    }
    return (w.log || []).reduce((s, e) => {
      const reps = Array.isArray(e && e.repsArray) ? e.repsArray : [];
      const wts = Array.isArray(e && e.weightsArray) ? e.weightsArray : [];
      return s + reps.reduce((a, r, i) => a + (num(r) || 0) * (num(wts[i]) || 0), 0);
    }, 0);
  }

  // Training days split by that day's carbs. → { threshold, high, low,
  // diffPct (low vs high), points } or null without 2+ sessions on each side.
  function carbsVsVolume({ days, sessions, end, windowDays = 28, threshold = 200 }) {
    const from = addDays(end, -(windowDays - 1));
    const carbsByDate = new Map((days || []).filter(d => num(d.carbs) !== null && num(d.kcal) > 0).map(d => [d.date.slice(0, 10), Number(d.carbs)]));
    const byDate = new Map();
    (sessions || []).filter(s => within(s.date, from, end) && num(s.volume) > 0).forEach(s => {
      const d = s.date.slice(0, 10);
      byDate.set(d, (byDate.get(d) || 0) + Number(s.volume));
    });
    const points = [...byDate.entries()]
      .filter(([d]) => carbsByDate.has(d))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, volume]) => ({ date, volume: r0(volume), carbs: r0(carbsByDate.get(date)), high: carbsByDate.get(date) >= threshold }));
    const high = points.filter(p => p.high);
    const low = points.filter(p => !p.high);
    if (high.length < 2 || low.length < 2) return points.length ? { threshold, high: null, low: null, diffPct: null, points } : null;
    const hi = avg(high.map(p => p.volume));
    const lo = avg(low.map(p => p.volume));
    return {
      threshold,
      high: { sessions: high.length, avgVolume: r0(hi) },
      low: { sessions: low.length, avgVolume: r0(lo) },
      diffPct: hi ? r0(((lo - hi) / hi) * 100) : null,
      points,
    };
  }

  // Average protein per meal over the days with foods logged.
  function proteinByMeal(entries, from, to) {
    const list = (entries || []).filter(e => within(e.date, from, to));
    const days = new Set(list.map(e => e.date));
    if (days.size < 3) return null;
    const out = {};
    ['breakfast', 'lunch', 'dinner', 'snacks'].forEach(m => {
      out[m] = r0(list.filter(e => e.meal === m).reduce((s, e) => s + (num(e.protein) || 0), 0) / days.size);
    });
    return { perMeal: out, days: days.size };
  }

  // Daily average of each micro over the days with foods logged; "no data"
  // when no food lists it, a minimum when only some do.
  function microAverages(entries, from, to, dayKcal, Core) {
    const list = (entries || []).filter(e => within(e.date, from, to));
    const days = new Set(list.map(e => e.date)).size;
    if (!days || !Core || !Core.microSummary) return null;
    const rows = Core.microSummary(list, dayKcal).map(r => {
      if (r.total === null) return r;
      const total = r1(r.total / days);
      const ref = r.ref;
      let status = 'ok';
      if (ref && r.kind === 'max' && total > ref) status = 'high';
      else if (r.missing) status = 'partial';
      else if (ref && r.kind === 'min' && total < ref * 0.8) status = 'low';
      return { ...r, total, percent: ref ? r0((total / ref) * 100) : null, status };
    });
    return { days, rows };
  }

  const FISH = /\b(zalm|makreel|haring|tonijn|sardine|sardines|forel|ansjovis|kabeljauw|salmon|mackerel|herring|tuna|sardine|trout|anchov|fish|vis)\w*/i;

  // Supplements worth considering, each tied to something in the data.
  // Only these ids exist; the server only lets the AI mention ids on this
  // list that this function produced.
  const SUPPLEMENTS = {
    vitamin_d: 'Vitamin D',
    creatine: 'Creatine monohydrate',
    protein_powder: 'Protein powder',
    omega_3: 'Omega-3 (fish or algae oil)',
    iron: 'Iron',
    vitamin_b12: 'Vitamin B12',
  };

  function supplementCandidates({ month, micros, avgProtein, proteinTarget, sessions, entries }) {
    const out = [];
    const row = id => (micros && micros.rows || []).find(r => r.key === id);
    const vd = row('vitDUg');
    if ([9, 10, 11, 0, 1, 2].includes(month) || (vd && vd.status === 'low')) {
      out.push({ id: 'vitamin_d', why: [9, 10, 11, 0, 1, 2].includes(month) ? 'Little sun in the Netherlands from October to March' + (vd && vd.total === null ? ', and none of your foods list vitamin D' : '') : 'Vitamin D below the reference in your foods' });
    }
    if ((sessions || 0) >= 2) out.push({ id: 'creatine', why: 'You train regularly; creatine is the best-studied supplement for strength and muscle' });
    if (num(avgProtein) !== null && num(proteinTarget) && avgProtein < proteinTarget * 0.9) {
      out.push({ id: 'protein_powder', why: `Protein averaged ${r0(avgProtein)} g against a ${r0(proteinTarget)} g target` });
    }
    const fishDays = new Set((entries || []).filter(e => FISH.test(String(e.name || ''))).map(e => e.date)).size;
    if (entries && entries.length >= 20 && fishDays === 0) out.push({ id: 'omega_3', why: 'No fish in your food log' });
    const iron = row('ironMg');
    if (iron && iron.status === 'low' && !iron.missing) out.push({ id: 'iron', why: `Iron averaged ${iron.total} mg against ${iron.ref} mg` });
    const b12 = row('b12Ug');
    if (b12 && b12.status === 'low' && !b12.missing) out.push({ id: 'vitamin_b12', why: `B12 averaged ${b12.total} µg against ${b12.ref} µg` });
    return out.map(s => ({ ...s, name: SUPPLEMENTS[s.id] }));
  }

  // Everything the weekly section shows and the AI may use, for the week
  // [start, end] (maintenance and carbs over the 4 weeks ending at `end`).
  function buildNutritionFacts({ start, end, days, weights, sessions, entries, target, Core, month }) {
    const weekDays = (days || []).filter(d => within(d.date, start, end) && num(d.kcal) > 0);
    const week = {
      start, end,
      daysLogged: weekDays.length,
      avgKcal: weekDays.length ? r0(avg(weekDays.map(d => Number(d.kcal)))) : null,
      avgProtein: weekDays.length ? r0(avg(weekDays.map(d => Number(d.protein) || 0))) : null,
      avgCarbs: weekDays.length ? r0(avg(weekDays.map(d => Number(d.carbs) || 0))) : null,
      avgFat: weekDays.length ? r0(avg(weekDays.map(d => Number(d.fat) || 0))) : null,
    };
    const wk = (weights || []).filter(w => within(w.date, start, end)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const prev = (weights || []).filter(w => within(w.date, addDays(start, -7), addDays(start, -1)));
    const weightChange = wk.length && prev.length ? r1(avg(wk.map(w => Number(w.kg))) - avg(prev.map(w => Number(w.kg)))) : null;
    const weekSessions = (sessions || []).filter(s => within(s.date, start, end)).length;
    const microsFrom = addDays(end, -6);
    const micros = microAverages(entries, microsFrom, end, target && target.calories ? Number(target.calories) : 2000, Core);
    const maintenance = estimateMaintenance({ days, weights, end });
    const carbs = carbsVsVolume({ days, sessions, end });
    const meals = proteinByMeal(entries, start, end);
    const supplements = supplementCandidates({
      month: typeof month === 'number' ? month : new Date(t(end)).getUTCMonth(),
      micros, avgProtein: week.avgProtein, proteinTarget: target && target.protein, sessions: weekSessions,
      entries: (entries || []).filter(e => within(e.date, addDays(end, -27), end)),
    });
    return {
      week,
      target: target ? { calories: num(target.calories), protein: num(target.protein), carbs: num(target.carbs), fat: num(target.fat) } : null,
      weightChangeKg: weightChange,
      sessions: weekSessions,
      maintenance,
      carbsVsVolume: carbs ? { threshold: carbs.threshold, high: carbs.high, low: carbs.low, diffPct: carbs.diffPct } : null,
      proteinByMeal: meals,
      micros: micros ? { days: micros.days, rows: micros.rows.map(r => ({ key: r.key, label: r.label, unit: r.unit, kind: r.kind, ref: r.ref, avg: r.total, status: r.status })) } : null,
      supplementCandidates: supplements,
    };
  }

  // The rules-based review (no AI): what everyone sees, and the fallback.
  // → { items: [{ kind: 'work_on'|'keeps_working'|'think_about', text }], supplements }
  function rulesReview(f) {
    const items = [];
    const add = (kind, text) => { if (items.length < 5) items.push({ kind, text }); };
    const w = f.week || {};
    const tg = f.target || {};
    if (w.daysLogged < 4) add('work_on', `Only ${w.daysLogged || 0} of 7 days logged. Log at least 5 days so the numbers mean something.`);
    if (w.avgProtein != null && tg.protein && w.avgProtein < tg.protein * 0.9) add('work_on', `Protein averaged ${w.avgProtein} g against your ${tg.protein} g target.`);
    else if (w.avgProtein != null && tg.protein) add('keeps_working', `Protein on target: ${w.avgProtein} g a day.`);
    const meals = f.proteinByMeal && f.proteinByMeal.perMeal;
    if (meals) {
      const [bigMeal, bigG] = [['lunch', meals.lunch], ['dinner', meals.dinner]].sort((a, b) => b[1] - a[1])[0];
      if (meals.breakfast < 25 && bigG >= meals.breakfast + 20) add('work_on', `Breakfast has ${meals.breakfast} g protein against ${bigG} g at ${bigMeal}; spreading it out helps muscle growth.`);
    }
    const c = f.carbsVsVolume;
    if (c && c.diffPct !== null && c.diffPct <= -5) add('work_on', `Training days under ${c.threshold} g carbs averaged ${Math.abs(c.diffPct)}% less volume.`);
    const m = f.maintenance;
    if (m && tg.calories) {
      const gap = m.kcal - tg.calories;
      add('think_about', `Your real maintenance is about ${m.kcal.toLocaleString('en-GB')} kcal (${m.confidence === 'good' ? '4 weeks of data' : 'rough estimate'}); your target is ${Math.abs(gap) < 60 ? 'right at it' : `${Math.abs(gap)} kcal ${gap > 0 ? 'below' : 'above'} it`}.`);
    }
    if (f.weightChangeKg != null) add('think_about', `Weight ${f.weightChangeKg > 0 ? '+' : ''}${f.weightChangeKg} kg compared with the week before.`);
    const rows = f.micros && f.micros.rows || [];
    const fibre = rows.find(r => r.key === 'fiber');
    if (fibre && fibre.avg !== null && fibre.status === 'ok') add('keeps_working', `Fibre ${fibre.avg} g a day.`);
    else if (fibre && fibre.avg !== null && fibre.status === 'low') add('work_on', `Fibre averaged ${fibre.avg} g; aim for 30 g (vegetables, oats, beans, wholegrain).`);
    const sodium = rows.find(r => r.key === 'sodiumMg');
    if (sodium && sodium.status === 'high') add('think_about', `Sodium averaged ${sodium.avg} mg, over the 2,400 mg limit.`);
    return { items, supplements: (f.supplementCandidates || []).slice(0, 3) };
  }

  const api = {
    SUPPLEMENTS, KCAL_PER_KG,
    slopePerDay, estimateMaintenance, sessionVolume, carbsVsVolume, proteinByMeal, microAverages,
    supplementCandidates, buildNutritionFacts, rulesReview, addDays,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NutritionInsights = api;
})(typeof window !== 'undefined' ? window : globalThis);
