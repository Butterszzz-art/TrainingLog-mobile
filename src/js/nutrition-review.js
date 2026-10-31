/* =============================================================
   NUTRITION AND PERFORMANCE — weekly review section, Macros row,
   Insights card
   - Weekly recap sheet (weekly-recap.js calls
     window.renderNutritionReview(host, recap)): week averages, weight
     change, real maintenance, and a short review — the rules-based one
     at once (everyone), replaced by the AI-written one for Pro users who
     agreed to AI (POST /api/ai/coach/nutrition-review). Cached per week
     and per set of facts, at most 3 AI calls a day.
   - Macros tab: one row with last week's counts; opens that section.
   - Insights tab: carbs vs session volume, real maintenance and 7-day
     micro averages (no AI, everyone).
   The analysis itself is nutrition-insights.js (pure, tested).
   ============================================================= */

(function () {
  'use strict';

  const NI = () => window.NutritionInsights;
  const Core = () => window.FoodCore;
  const CACHE_KEY = u => `nutritionReview_${u}`;
  const KEEP_WEEKS = 8;
  const MAX_AI_CALLS_PER_DAY = 3;
  const inflight = {};

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const user = () => (window.getActiveUsername && window.getActiveUsername()) || window.currentUser || localStorage.getItem('fitnessAppUser') || '';
  const today = () => new Date().toISOString().slice(0, 10);
  function readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
  }
  const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-GB'));
  const icon = name => (typeof ICONS !== 'undefined' && ICONS[name]) || ''; // eslint-disable-line no-undef

  /* ── Inputs from the device ──────────────────────────────── */

  function inputs(u) {
    const days = new Map();
    (readJSON(`macroHistory_${u}`, []) || []).forEach(h => {
      if (!h || !h.date) return;
      const t = h.totals || h;
      const protein = Number(t.protein) || 0;
      const carbs = Number(t.carbs) || 0;
      const fat = Number(t.fats ?? t.fat) || 0;
      const kcal = Number(t.calories) || Math.round(protein * 4 + carbs * 4 + fat * 9 + (Number(t.cals) || 0));
      if (kcal > 0) days.set(String(h.date).slice(0, 10), { date: String(h.date).slice(0, 10), kcal, protein, carbs, fat });
    });
    const progDate = localStorage.getItem('dailyMacroDate');
    const prog = readJSON('dailyMacroProgress', null);
    if (progDate && prog) {
      const kcal = Number(prog.calories) || Math.round((Number(prog.protein) || 0) * 4 + (Number(prog.carbs) || 0) * 4 + (Number(prog.fats) || 0) * 9 + (Number(prog.cals) || 0));
      if (kcal > 0) days.set(progDate, { date: progDate, kcal, protein: Number(prog.protein) || 0, carbs: Number(prog.carbs) || 0, fat: Number(prog.fats) || 0 });
    }
    const toKg = e => (typeof window.getEntryWeightKg === 'function' ? window.getEntryWeightKg(e) : (Number(e.weightKg) || Number(e.weight) || null));
    const weights = (readJSON(`bodyweightLog_${u}`, []) || [])
      .filter(e => e && e.date)
      .map(e => ({ date: String(e.date).slice(0, 10), kg: toKg(e) }))
      .filter(e => e.kg > 0);
    const seen = new Set();
    const sessions = [];
    [readJSON(`workoutHistory_${u}`, []), readJSON(`workouts_${u}`, [])].forEach(list => (list || []).forEach(w => {
      if (!w || !w.date) return;
      const key = w.id || `${w.date}|${w.title || w.name || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      sessions.push({ date: String(w.date).slice(0, 10), volume: NI().sessionVolume(w) });
    }));
    const entries = window.FoodLog && typeof window.FoodLog.load === 'function' ? window.FoodLog.load() : readJSON(`foodLog_${u}`, []);
    const target = readJSON(`macroTargets_${u}`, null) || readJSON('macroTargets', null);
    return { days: [...days.values()], weights, sessions, entries: Array.isArray(entries) ? entries : [], target };
  }

  function factsFor(u, start, end) {
    const i = inputs(u);
    return NI().buildNutritionFacts({ start, end, ...i, Core: Core() });
  }

  function lastWeek() {
    const d = new Date();
    const dow = (d.getUTCDay() + 6) % 7;
    const thisMonday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
    const start = NI().addDays(thisMonday, -7);
    return { start, end: NI().addDays(start, 6) };
  }

  /* ── AI (Pro) ────────────────────────────────────────────── */

  // Only when it can't surprise the user with a consent or upgrade prompt.
  function aiAllowed() {
    const consent = window.pocketCoachAIConsent && window.pocketCoachAIConsent.get && window.pocketCoachAIConsent.get();
    return consent === 'granted' && typeof window.hasPaidAccess === 'function' && window.hasPaidAccess();
  }

  function fingerprint(facts) {
    const s = JSON.stringify(facts);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  async function fetchAi(u, facts, rules) {
    const token = localStorage.getItem('token') || '';
    const settings = window.CoachData && window.CoachData.loadCoachSettings ? window.CoachData.loadCoachSettings(localStorage, u) : {};
    const memory = window.CoachData && window.CoachData.loadMemory ? window.CoachData.loadMemory(localStorage, u).map(m => ({ text: m.text })) : [];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 150000);
    try {
      const res = await fetch(`${window.SERVER_URL}/api/ai/coach/nutrition-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ facts, rules, memory, style: settings.style }),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const body = await res.json();
      return body && body.source === 'ai' ? body : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ── Rendering ───────────────────────────────────────────── */

  const KIND = { work_on: ['Work on', 'is-work'], keeps_working: ['Keeps working', 'is-keep'], think_about: ['Think about', 'is-think'] };

  function reviewHtml(facts, review, { loading, aiNote }) {
    const w = facts.week;
    const m = facts.maintenance;
    const stats = `
      <div class="nr-stats">
        <div><b>${fmt(w.avgKcal)}</b><span>avg kcal${w.daysLogged ? ` · ${w.daysLogged}/7 days` : ''}</span></div>
        <div><b>${facts.weightChangeKg == null ? '—' : `${facts.weightChangeKg > 0 ? '+' : ''}${facts.weightChangeKg} kg`}</b><span>weight vs week before</span></div>
        <div><b>${m ? `~${fmt(m.kcal)}` : '—'}</b><span>${m ? `real maintenance${m.confidence === 'rough' ? ' (rough)' : ''}` : 'maintenance: needs 2+ weeks of logs and weigh-ins'}</span></div>
      </div>`;
    if (!w.daysLogged) {
      return `${stats}<p class="nr-empty">No food or macros logged this week, so there's nothing to review yet.</p>`;
    }
    const items = (review.items || []).map(i => {
      const [label, cls] = KIND[i.kind] || KIND.think_about;
      return `<li class="nr-item"><span class="nr-tag ${cls}">${label}</span><span>${esc(i.text)}</span></li>`;
    }).join('');
    const sups = (review.supplements || []).map(s => `<li class="nr-item"><span class="nr-tag is-sup">Supplement</span><span><b>${esc(s.name)}</b>${s.why ? ` — ${esc(s.why)}` : ''}</span></li>`).join('');
    return `
      ${stats}
      ${review.headline ? `<p class="nr-headline">${esc(review.headline)}</p>` : ''}
      <ul class="nr-list">${items}${sups}</ul>
      ${loading ? `<p class="nr-note"><span class="ui-icon">${icon('sparkles')}</span>Your coach is writing this week's review…</p>` : ''}
      ${aiNote ? `<p class="nr-note">${aiNote}</p>` : ''}
      <p class="nr-foot">Based on your food log, macros, lifts and weigh-ins. Supplements are general suggestions, not medical advice — check with your doctor if you take medication or have a condition.</p>`;
  }

  // Weekly recap sheet section.
  function renderNutritionReview(host, recap) {
    if (!host || !recap || !NI()) return;
    const u = user();
    if (!u) return;
    const facts = factsFor(u, recap.start, recap.end);
    const rules = NI().rulesReview(facts);
    const fp = fingerprint(facts);
    const all = readJSON(CACHE_KEY(u), {}) || {};
    const cached = all[recap.start];
    let review = cached && cached.fp === fp && cached.review ? cached.review : { ...rules, source: 'rules' };
    const paint = (opts = {}) => {
      if (!host.isConnected || host.dataset.week !== recap.start) return;
      host.innerHTML = `<section class="nr-section" aria-label="Nutrition and performance">
        <h4 class="nr-title"><span class="ui-icon">${icon('sparkles')}</span>Nutrition and performance</h4>
        ${reviewHtml(facts, review, opts)}</section>`;
    };
    host.dataset.week = recap.start;
    const paid = typeof window.hasPaidAccess === 'function' && window.hasPaidAccess();
    const calls = all.calls && all.calls.date === today() ? all.calls.n : 0;
    const wantAi = review.source !== 'ai' && !recap.inProgress && facts.week.daysLogged >= 3 && aiAllowed()
      && navigator.onLine !== false && calls < MAX_AI_CALLS_PER_DAY && !inflight[recap.start];
    paint({ loading: wantAi, aiNote: !paid && facts.week.daysLogged ? 'Pro: your AI coach writes this review from your data.' : '' });
    if (!wantAi) return;
    const save = (r) => {
      const latest = readJSON(CACHE_KEY(u), {}) || {};
      latest[recap.start] = { fp, review: r, at: new Date().toISOString() };
      latest.calls = { date: today(), n: calls + 1 };
      const weeks = Object.keys(latest).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
      weeks.slice(0, Math.max(0, weeks.length - KEEP_WEEKS)).forEach(k => { delete latest[k]; });
      try { localStorage.setItem(CACHE_KEY(u), JSON.stringify(latest)); } catch { /* full */ }
    };
    try { localStorage.setItem(CACHE_KEY(u), JSON.stringify({ ...all, calls: { date: today(), n: calls + 1 } })); } catch { /* full */ }
    inflight[recap.start] = fetchAi(u, facts, { headline: '', ...rules }).then(ai => {
      delete inflight[recap.start];
      if (ai) {
        review = { headline: ai.headline, items: ai.items || [], supplements: ai.supplements || [], source: 'ai' };
        save(review);
      }
      paint({});
    });
  }
  window.renderNutritionReview = renderNutritionReview;

  // Counts for the Macros tab row (last full week; AI version if cached).
  function weekSummary() {
    const u = user();
    if (!u || !NI()) return null;
    const { start, end } = lastWeek();
    const facts = factsFor(u, start, end);
    if (!facts.week.daysLogged) return { start, empty: true };
    const cached = (readJSON(CACHE_KEY(u), {}) || {})[start];
    const review = cached && cached.fp === fingerprint(facts) ? cached.review : NI().rulesReview(facts);
    return {
      start,
      workOn: (review.items || []).filter(i => i.kind === 'work_on').length,
      supplements: (review.supplements || []).length,
    };
  }

  function renderMacrosRow() {
    const row = document.getElementById('macroNutritionReviewRow');
    if (!row) return;
    const s = weekSummary();
    const sub = row.querySelector('[data-nr-sub]');
    if (!sub) return;
    if (!s) { sub.textContent = 'Sign in to see your weekly review'; return; }
    if (s.empty) { sub.textContent = 'Log food last week to get a review'; return; }
    const bits = [];
    bits.push(s.workOn ? `${s.workOn} thing${s.workOn === 1 ? '' : 's'} to work on` : 'Nothing urgent to work on');
    if (s.supplements) bits.push(`${s.supplements} supplement${s.supplements === 1 ? '' : 's'} to consider`);
    sub.textContent = bits.join(' · ');
  }
  window.renderNutritionReviewRow = renderMacrosRow;

  window.openNutritionReview = function () {
    if (typeof window.openWeeklyRecap !== 'function') return;
    window.openWeeklyRecap(lastWeek().start);
    setTimeout(() => document.querySelector('#weeklyRecapSheet .wr-nutrition-review')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120);
  };

  /* ── Insights card (everyone, no AI) ─────────────────────── */

  function renderInsightsCard() {
    const el = document.getElementById('nutritionInsightsCard');
    if (!el || !NI()) return;
    const u = user();
    if (!u) { el.innerHTML = ''; return; }
    const i = inputs(u);
    const end = today();
    const m = NI().estimateMaintenance({ days: i.days, weights: i.weights, end });
    const c = NI().carbsVsVolume({ days: i.days, sessions: i.sessions, end });
    const micros = NI().microAverages(i.entries, NI().addDays(end, -6), end, i.target && i.target.calories ? Number(i.target.calories) : 2000, Core());
    if (!m && !c && !micros) {
      el.innerHTML = `<div class="pod ni-card"><h3 class="ni-title">Nutrition vs training</h3><p class="ni-empty">Log food and weigh in for two weeks to see your real maintenance and how carbs affect your sessions.</p></div>`;
      return;
    }
    const tgt = i.target && Number(i.target.calories);
    const maintenance = m ? `
      <div class="ni-block"><span class="ni-lbl">Real maintenance</span>
        <b class="ni-big">~${fmt(m.kcal)} kcal</b>
        <p class="ni-sub">From ${m.loggedDays} logged days and ${m.weighIns} weigh-ins (${m.kgPerWeek > 0 ? '+' : ''}${m.kgPerWeek} kg/week)${m.confidence === 'rough' ? ', rough estimate' : ''}.${tgt ? ` Your ${fmt(tgt)} kcal target is ${Math.abs(m.kcal - tgt) < 60 ? 'right at it' : `${fmt(Math.abs(m.kcal - tgt))} kcal ${m.kcal > tgt ? 'below' : 'above'} it`}.` : ''}</p></div>`
      : '<div class="ni-block"><span class="ni-lbl">Real maintenance</span><p class="ni-sub">Needs 10+ logged days and weigh-ins spread over 10+ days.</p></div>';
    let carbs = '';
    if (c && c.points.length) {
      const max = Math.max(...c.points.map(p => p.volume)) || 1;
      const bars = c.points.slice(-16).map(p => `<span class="ni-bar${p.high ? ' is-high' : ''}" style="height:${Math.max(6, Math.round((p.volume / max) * 100))}%" title="${esc(p.date)}: ${fmt(p.volume)} volume, ${p.carbs} g carbs"></span>`).join('');
      carbs = `<div class="ni-block"><span class="ni-lbl">Carbs vs session volume · 4 weeks</span>
        <div class="ni-bars" role="img" aria-label="Session volume on high- and low-carb days">${bars}</div>
        <p class="ni-sub"><span class="ni-key is-high"></span>${c.threshold} g+ carbs that day <span class="ni-key"></span>under ${c.threshold} g${c.diffPct != null ? ` · low-carb days ${c.diffPct > 0 ? '+' : ''}${c.diffPct}% volume` : ''}</p></div>`;
    }
    let micro = '';
    if (micros) {
      const show = micros.rows.filter(r => ['fiber', 'ironMg', 'calciumMg', 'vitDUg', 'sodiumMg', 'magnesiumMg'].includes(r.key));
      micro = `<div class="ni-block"><span class="ni-lbl">Micros · 7-day average</span><p class="ni-micros">${show.map(r => {
        const v = r.status === 'nodata' ? '<span class="ni-nodata">no data</span>' : `${r.status === 'partial' ? '≥' : ''}${r.total} ${esc(r.unit)}`;
        const flag = r.status === 'low' ? ' <span class="ni-low">low</span>' : r.status === 'high' ? ' <span class="ni-low">high</span>' : r.status === 'ok' ? ' <span class="ni-ok">✓</span>' : '';
        return `<span>${esc(r.label)} ${v}${flag}</span>`;
      }).join('')}</p></div>`;
    }
    el.innerHTML = `<div class="pod ni-card"><h3 class="ni-title">Nutrition vs training</h3>${maintenance}${carbs}${micro}</div>`;
  }
  window.renderNutritionInsightsCard = renderInsightsCard;

  /* ── Macros > Adjust: advised maintenance (everyone) ─────── */
  // 4-week average of logged calories, corrected for the weight trend
  // over the same 4 weeks. Replaces the old Body tab calorie estimator.

  function renderMaintenanceCard() {
    const el = document.getElementById('macroMaintenanceCard');
    if (!el || !NI()) return;
    const u = user();
    if (!u) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    const i = inputs(u);
    const end = today();
    const m = NI().estimateMaintenance({ days: i.days, weights: i.weights, end });
    const head = '<span class="ni-lbl">Advised maintenance · last 4 weeks</span>';
    if (!m) {
      const from = NI().addDays(end, -27);
      const logged = i.days.filter(d => d.date >= from && d.date <= end && d.kcal > 0).length;
      const weighIns = i.weights.filter(w => w.date >= from && w.date <= end).length;
      el.innerHTML = `${head}
        <p class="mm-empty">Log your food and weigh in over a couple of weeks and we'll work out your maintenance from what you ate and what the scale did.</p>
        <p class="ni-sub">So far (last 4 weeks): ${Math.min(logged, 10)}/10 days of calories · ${Math.min(weighIns, 3)}/3 weigh-ins, spread over 10+ days.</p>`;
      return;
    }
    const tgt = i.target && Number(i.target.calories);
    const trend = m.kgPerWeek === 0 ? 'steady weight' : `${m.kgPerWeek > 0 ? '+' : ''}${m.kgPerWeek} kg/week`;
    const vsTarget = tgt
      ? ` Your ${fmt(tgt)} kcal target is ${Math.abs(m.kcal - tgt) < 60 ? 'right at it' : `${fmt(Math.abs(m.kcal - tgt))} kcal ${m.kcal > tgt ? 'below' : 'above'} it`}.`
      : '';
    const chip = (label, kcal) => `<button type="button" class="mm-chip" data-mm-kcal="${kcal}"><span>${esc(label)}</span><b class="mx-num">${fmt(kcal)}</b></button>`;
    el.innerHTML = `${head}
      <b class="ni-big mm-big">~${fmt(m.kcal)} kcal/day</b>
      <p class="ni-sub">You averaged ${fmt(m.avgIntake)} kcal over ${m.loggedDays} logged days with ${trend} (${m.weighIns} weigh-ins)${m.confidence === 'rough' ? '. Rough estimate, gets sharper with more data' : ''}.${vsTarget}</p>
      <div class="mm-chips">${chip('Cut', m.kcal - 500)}${chip('Maintain', m.kcal)}${chip('Bulk', m.kcal + 300)}</div>
      <p class="ni-sub mm-hint">Tap one to put it in "Or set exact calories" below.</p>`;
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('#macroMaintenanceCard [data-mm-kcal]');
    if (!btn) return;
    const input = document.getElementById('customCalories');
    if (!input) return;
    input.value = btn.dataset.mmKcal;
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input.focus({ preventScroll: true });
  });
  window.renderMacroMaintenanceCard = renderMaintenanceCard;

  document.addEventListener('DOMContentLoaded', () => setTimeout(() => { renderMacrosRow(); renderMaintenanceCard(); }, 1800));
  window.addEventListener('cloudsync:applied', () => { renderMacrosRow(); renderMaintenanceCard(); });
})();
