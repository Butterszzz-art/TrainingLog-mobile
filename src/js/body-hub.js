/* =============================================================
   BODY TAB — SUMMARY HUB
   The Body tab is a launcher into Weight/Macros/Sleep/Cardio (each
   keeps its own id/render function — see index.html #bodyTab). Before
   this file, opening the tab showed nothing but the launcher pills.
   This renders an "at a glance" grid mirroring each mini-tab's
   headline stat plus a small preview (30-day weight sparkline, today's
   macro bars, 7-night sleep and 7-day cardio bars), in the same
   pod/stat-tile language as the Home dashboard (weekly-summary.js).
   Empty cards draw a faint placeholder chart so the tab never reads
   as an empty shell. Tapping a card jumps into that mini-tab via the
   existing showTab().
   ============================================================= */

(function initBodyHub() {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────── */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') || '';
  }

  function _parse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }

  function _isoDate(d) { return d.toISOString().slice(0, 10); }

  function _daysAgo(n) {
    const d = new Date(); d.setDate(d.getDate() - n); return _isoDate(d);
  }

  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Last 7 calendar days (oldest → today) as { date, label }.
  function _week() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      out.push({ date: _isoDate(d), label: DOW[d.getDay()] });
    }
    return out;
  }

  function _card(kicker, value, sub, tab, opts = {}) {
    const cls = ['body-hub-card'];
    if (opts.empty) cls.push('body-hub-empty');
    if (opts.wide) cls.push('body-hub-card--wide');
    return `
      <button type="button" class="${cls.join(' ')}" onclick="showTab('${tab}')">
        <span class="body-hub-head">
          <span class="body-hub-kicker">${kicker}</span>
          ${opts.aside ? `<span class="body-hub-aside">${opts.aside}</span>` : ''}
        </span>
        <span class="body-hub-value">${value}</span>
        <span class="body-hub-sub">${sub}</span>
        ${opts.preview ? `<span class="body-hub-preview">${opts.preview}</span>` : ''}
      </button>`;
  }

  // 7 vertical bars; values[i] null = nothing logged that day. When every
  // value is null a faint placeholder shape is drawn so an empty card
  // still previews what the chart will look like once there's data.
  function _bars(week, values, max, fmt) {
    const empty = values.every(v => v == null);
    const ghost = [0.45, 0.7, 0.55, 0.85, 0.4, 0.65, 0.5];
    return `<span class="body-hub-bars${empty ? ' body-hub-bars--ghost' : ''}">` +
      week.map((d, i) => {
        const v = values[i];
        const pct = empty ? ghost[i] * 100
          : v == null ? 0 : Math.max(6, Math.min(100, (v / (max || 1)) * 100));
        const today = i === week.length - 1 ? ' is-today' : '';
        const title = !empty && v != null ? ` title="${fmt ? fmt(v) : v}"` : '';
        return `<span class="body-hub-bar${today}"${title}>` +
          `<span class="body-hub-bar-col"><span class="body-hub-bar-fill" style="height:${pct}%"></span></span>` +
          `<span class="body-hub-bar-label">${d.label}</span></span>`;
      }).join('') + '</span>';
  }

  // Inline SVG sparkline over values (oldest → newest).
  function _sparkline(points) {
    const W = 100, H = 36, PAD = 4;
    if (points.length < 2) {
      return `<svg class="body-hub-spark body-hub-spark--ghost" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
        `<polyline points="0,26 14,21 28,23 42,16 56,19 70,12 84,14 100,9" vector-effect="non-scaling-stroke"/></svg>`;
    }
    const min = Math.min(...points), max = Math.max(...points);
    const span = max - min || 1;
    const xy = points.map((v, i) => [
      (i / (points.length - 1)) * W,
      PAD + (1 - (v - min) / span) * (H - PAD * 2),
    ]);
    const line = xy.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
    return `<svg class="body-hub-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<polygon class="body-hub-spark-area" points="0,${H} ${line} ${W},${H}"/>` +
      `<polyline points="${line}" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /* ── Weight ──────────────────────────────────────────────── */

  function _weightCard(username) {
    const log = _parse(`bodyweightLog_${username}`, []) || [];
    if (!log.length) {
      return _card('Weight', '&mdash;', 'No weigh-ins yet — log one to start your trend line', 'weightTab',
        { empty: true, wide: true, preview: _sparkline([]) });
    }

    const getKg = typeof window.getEntryWeightKg === 'function'
      ? window.getEntryWeightKg
      : (e) => Number(e?.weightKg ?? e?.weight) || null;
    const pref = typeof window.getBodyweightPreference === 'function'
      ? window.getBodyweightPreference() : { unit: 'kg' };
    const unit = pref.unit === 'lb' ? 'lb' : 'kg';
    const toDisp = typeof window.convertWeightValue === 'function'
      ? (kg) => window.convertWeightValue(kg, 'kg', unit, 1)
      : (kg) => Math.round(kg * 10) / 10;

    const lastKg = getKg(log[log.length - 1]);
    const value = lastKg != null ? `${toDisp(lastKg)} <span class="body-hub-unit">${unit}</span>` : '&mdash;';

    const trend = window.weightTab?.computeWeightChangeRate
      ? window.weightTab.computeWeightChangeRate(log)
      : { kgPerWeek: 0, days: 0 };
    let sub = 'Log another weigh-in to see your trend';
    if (trend.days > 0 && Math.abs(trend.kgPerWeek) >= 0.05) {
      const dispRate = Math.abs(toDisp(trend.kgPerWeek));
      const dir = trend.kgPerWeek > 0 ? 'up' : 'down';
      const arrow = trend.kgPerWeek > 0 ? '&#9650;' : '&#9660;';
      sub = `<span class="body-hub-trend body-hub-trend--${dir}">${arrow} ${dispRate.toFixed(1)} ${unit}/wk</span>`;
    } else if (trend.days > 0) {
      sub = 'Holding steady';
    }

    // Last 30 days drive the sparkline and the range / net-change captions.
    const since = _daysAgo(30);
    const recent = log
      .filter(e => (e.date || '') >= since)
      .map(e => getKg(e))
      .filter(v => v != null);
    let aside = '';
    if (recent.length >= 2) {
      const delta = toDisp(recent[recent.length - 1]) - toDisp(recent[0]);
      const sign = delta > 0 ? '+' : delta < 0 ? '&minus;' : '&plusmn;';
      aside = `30d ${sign}${Math.abs(delta).toFixed(1)} ${unit}`;
      sub += ` &middot; range ${toDisp(Math.min(...recent))}&ndash;${toDisp(Math.max(...recent))}`;
    } else {
      const lastDate = log[log.length - 1]?.date;
      if (lastDate) aside = `Last ${lastDate.slice(5).replace('-', '/')}`;
    }

    return _card('Weight', value, sub, 'weightTab',
      { wide: true, aside, preview: _sparkline(recent) });
  }

  /* ── Macros ──────────────────────────────────────────────── */

  function _macroBar(label, have, target, mod) {
    const pct = target > 0 ? Math.min(100, (have / target) * 100) : 0;
    const right = target > 0
      ? `${Math.round(have)}<span class="body-hub-of"> / ${Math.round(target)}g</span>`
      : `${Math.round(have)}g`;
    return `<span class="body-hub-macro">
        <span class="body-hub-macro-row"><span>${label}</span><span>${right}</span></span>
        <span class="body-hub-track"><span class="body-hub-track-fill body-hub-track-fill--${mod}" style="width:${pct}%"></span></span>
      </span>`;
  }

  function _macroCard() {
    const today = _isoDate(new Date());
    const savedDate = localStorage.getItem('dailyMacroDate');
    const progress = savedDate === today ? _parse('dailyMacroProgress', null) : null;
    const p = progress || { protein: 0, carbs: 0, fats: 0 };
    // `cals` is calories logged on their own, on top of the macros.
    const totalCals = Math.max(0, Math.round((p.protein || 0) * 4 + (p.carbs || 0) * 4 + (p.fats || 0) * 9 + (Number(p.cals) || 0)));

    let t = null;
    try {
      if (typeof window.getAdaptiveMacroTargets === 'function') t = window.getAdaptiveMacroTargets();
    } catch { /* macro targets not ready — fall back to raw totals only */ }
    const targetCals = Math.round(Number(t?.calories) || 0);

    const preview = `<span class="body-hub-macros">` +
      _macroBar('Protein', p.protein || 0, Number(t?.protein) || 0, 'p') +
      _macroBar('Carbs', p.carbs || 0, Number(t?.carbs) || 0, 'c') +
      _macroBar('Fat', p.fats || 0, Number(t?.fat ?? t?.fats) || 0, 'f') +
      `</span>`;

    if (!totalCals) {
      const sub = targetCals
        ? `Nothing logged yet &middot; ${targetCals.toLocaleString()} kcal to go`
        : 'No meals logged today';
      return _card('Macros', `0 <span class="body-hub-unit">kcal</span>`, sub, 'macroTab',
        { empty: true, wide: true, aside: 'Today', preview });
    }
    const value = `${totalCals.toLocaleString()} <span class="body-hub-unit">kcal</span>`;
    let sub = 'Logged today';
    if (targetCals) {
      const left = targetCals - totalCals;
      sub = left >= 0
        ? `${left.toLocaleString()} kcal left of ${targetCals.toLocaleString()}`
        : `${Math.abs(left).toLocaleString()} kcal over ${targetCals.toLocaleString()}`;
    }
    return _card('Macros', value, sub, 'macroTab', { wide: true, aside: 'Today', preview });
  }

  /* ── Sleep ───────────────────────────────────────────────── */

  function _fmtHours(h) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return `${hh}h ${mm}m`;
  }

  function _sleepCard(username) {
    const log = _parse(`sleepLog_${username}`, []) || [];
    const week = _week();
    const byDate = {};
    log.forEach(e => { if (e && e.date) byDate[e.date] = Number(e.duration) || 0; });
    const values = week.map(d => byDate[d.date] || null);
    const preview = _bars(week, values, 10, _fmtHours);

    if (!log.length) {
      return _card('Sleep', '&mdash;', 'No nights logged yet', 'sleepTab', { empty: true, preview });
    }
    const sorted = log.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const latest = sorted[0];
    const today = _isoDate(new Date());
    const h = Math.floor(latest.duration || 0);
    const m = Math.round(((latest.duration || 0) - h) * 60);
    const value = `${h}<span class="body-hub-unit">h</span> ${m}<span class="body-hub-unit">m</span>`;
    const stars = '&#9733;'.repeat(latest.quality || 0) + '&#9734;'.repeat(5 - (latest.quality || 0));
    const whenLabel = (latest.date === today || latest.date === _daysAgo(1)) ? 'Last night' : latest.date;
    const logged = values.filter(v => v != null);
    const avg = logged.length ? logged.reduce((s, v) => s + v, 0) / logged.length : 0;
    const sub = `${whenLabel} &middot; <span class="body-hub-stars">${stars}</span>`;
    return _card('Sleep', value, sub, 'sleepTab',
      { aside: logged.length ? `avg ${_fmtHours(avg)}` : '', preview });
  }

  /* ── Cardio ──────────────────────────────────────────────── */

  function _cardioCard(username) {
    const log = _parse(`cardioLog_${username}`, []) || [];
    const week = _week();
    const weekEntries = log.filter(e => (e.date || '') >= week[0].date);
    const byDate = {};
    weekEntries.forEach(e => { byDate[e.date] = (byDate[e.date] || 0) + (parseFloat(e.duration) || 0); });
    const values = week.map(d => byDate[d.date] || null);
    const max = Math.max(30, ...values.filter(v => v != null));
    const preview = _bars(week, values, max, v => `${Math.round(v)} min`);

    if (!weekEntries.length) {
      return _card('Cardio', '&mdash;', 'None this week', 'cardioTab', { empty: true, preview });
    }
    const weekMins = Math.round(weekEntries.reduce((s, e) => s + (parseFloat(e.duration) || 0), 0));
    const value = `${weekMins} <span class="body-hub-unit">min</span>`;
    const sub = `${weekEntries.length} session${weekEntries.length === 1 ? '' : 's'} this week`;
    const activeDays = values.filter(v => v != null).length;
    return _card('Cardio', value, sub, 'cardioTab', { aside: `${activeDays}/7 days`, preview });
  }

  /* ── Coach takeaways ─────────────────────────────────────── */
  // Rules version from CoachData.buildBodyFacts renders instantly; Claude's
  // wording from POST /api/ai/coach/body replaces it. Cached per day and per
  // set of facts (like the Home brief in coach-brief.js), so revisiting the
  // tab doesn't re-bill; a new weigh-in or meal refreshes it.

  const COACH_CACHE_KEY = u => `coachBody_${u}`;
  const MAX_AI_CALLS_PER_DAY = 3;
  let coachInflight = null;

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // The data pack, with the adaptive macro targets the Macros card shows
  // so the takeaways and the card quote the same target.
  function _bodyPack(username) {
    const cd = window.CoachData;
    const settings = cd.loadCoachSettings(localStorage, username);
    const pack = cd.buildCoachDataPack(localStorage, username, settings.access);
    if (settings.access.nutrition) {
      try {
        const t = typeof window.getAdaptiveMacroTargets === 'function' ? window.getAdaptiveMacroTargets() : null;
        if (t && Number(t.calories) > 0) {
          pack.macros = { ...(pack.macros || {}),
            targets: { calories: Number(t.calories), protein: Number(t.protein) || null, carbs: Number(t.carbs) || null, fat: Number(t.fat ?? t.fats) || null } };
        }
      } catch { /* targets not ready — keep the stored ones */ }
    }
    return { pack, settings };
  }

  function _renderCoach(el, view) {
    const stamp = view.loading ? 'Updating…'
      : view.source === 'ai' && view.updatedAt
        ? `Updated ${new Date(view.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : '';
    el.innerHTML = `
      <section class="body-hub-coach${view.loading ? ' is-loading' : ''}" aria-labelledby="bodyHubCoachTitle">
        <div class="body-hub-coach-head">
          <h2 id="bodyHubCoachTitle" class="body-hub-kicker">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/></svg>
            Coach takeaways
          </h2>
          <span class="body-hub-coach-stamp">${_esc(stamp)}</span>
        </div>
        <p class="body-hub-coach-headline">${_esc(view.headline)}</p>
        ${view.bullets.length ? `<ul class="body-hub-coach-list">${view.bullets.map(b =>
          `<li><span class="cbr-dot cbr-dot--${_esc(b.tone)}" aria-hidden="true"></span><span>${_esc(b.text)}</span></li>`).join('')}</ul>` : ''}
        ${view.hasData ? `<button type="button" class="body-hub-coach-ask">Ask your coach about this</button>` : ''}
      </section>`;
    const ask = el.querySelector('.body-hub-coach-ask');
    if (ask) {
      ask.addEventListener('click', () => {
        if (typeof window.openAiCoach === 'function') {
          window.openAiCoach('Look at my weight, nutrition, sleep and cardio this week. What should I change?');
        }
      });
    }
  }

  async function _fetchCoachBody(username, pack, settings) {
    const cd = window.CoachData;
    const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
    const base = (typeof window.getServerUrl === 'function' ? window.getServerUrl() : null) || window.SERVER_URL || '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000); // server walks a model chain on free tiers
    try {
      const res = await fetch(`${base}/api/ai/coach/body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          data: pack,
          memory: cd.loadMemory(localStorage, username).map(m => ({ text: m.text })),
          style: settings.style,
        }),
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

  function renderBodyCoach(username) {
    const el = document.getElementById('bodyHubCoach');
    if (!el) return;
    if (!username || !window.CoachData || typeof window.CoachData.buildBodyFacts !== 'function') {
      el.innerHTML = '';
      return;
    }

    const { pack, settings } = _bodyPack(username);
    const body = window.CoachData.buildBodyFacts(pack);
    const fp = JSON.stringify(body.facts);
    const date = body.facts.date;
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem(COACH_CACHE_KEY(username))); } catch { /* corrupt — refetch */ }
    cache = cache || {};
    const sameDay = cache.date === date;
    const writeCache = v => { try { localStorage.setItem(COACH_CACHE_KEY(username), JSON.stringify(v)); } catch { /* quota */ } };

    if (sameDay && cache.fp === fp && cache.ai) {
      _renderCoach(el, { ...cache.ai, hasData: body.hasData, source: 'ai', updatedAt: cache.at });
      return;
    }

    const rules = { headline: body.headline, bullets: body.takeaways, hasData: body.hasData, source: 'rules' };
    const calls = sameDay ? cache.calls || 0 : 0;
    // Auto-loading AI: only for accounts with AI access (see coach-brief.js).
    const aiAccess = typeof window.hasPaidAccess === 'function' && window.hasPaidAccess();
    const canAsk = body.hasData && aiAccess && navigator.onLine !== false && calls < MAX_AI_CALLS_PER_DAY && !coachInflight;
    _renderCoach(el, { ...rules, loading: canAsk });
    if (!canAsk) return;

    writeCache({ date, fp: cache.fp, ai: sameDay ? cache.ai : null, at: cache.at, calls: calls + 1 });
    coachInflight = _fetchCoachBody(username, pack, settings).then(ai => {
      coachInflight = null;
      const now = new Date().toISOString();
      if (ai) writeCache({ date, fp, ai: { headline: ai.headline, bullets: ai.bullets }, at: now, calls: calls + 1 });
      // Only repaint if this box is still showing this user's takeaways.
      if (document.getElementById('bodyHubCoach') !== el || _user() !== username) return;
      if (ai) _renderCoach(el, { headline: ai.headline, bullets: ai.bullets, hasData: true, source: 'ai', updatedAt: now });
      else _renderCoach(el, rules);
    });
  }

  /* ── Body analysis (tracker vitals + smart scale) ────────────
     Data and analysis come from activity-sync-bridge.js
     (getBodyAnalysis): each vital is compared with the user's own last
     30 days. Shown above the summary cards only when there's synced
     data or scale body fat to show. */

  function _fmtNum(v, decimals, signed) {
    if (v == null || !Number.isFinite(v)) return '&mdash;';
    const s = v.toFixed(decimals);
    return signed && v > 0 ? `+${s}` : s;
  }

  function _dayLabel(date) {
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }

  // Open/close a vital tile, then let the last closed tile span the row when
  // the closed ones are odd in number, so the panel never shows a hole.
  function _balanceVitals(panel) {
    if (!panel) return;
    const closed = [...panel.querySelectorAll('.body-hub-vital')].filter(t => !t.classList.contains('is-open'));
    panel.querySelectorAll('.body-hub-vital.is-filler').forEach(t => t.classList.remove('is-filler'));
    if (closed.length % 2 === 1) closed[closed.length - 1].classList.add('is-filler');
  }

  window.toggleBodyVital = function (tile) {
    tile.classList.toggle('is-open');
    tile.setAttribute('aria-expanded', String(tile.classList.contains('is-open')));
    _balanceVitals(tile.closest('.body-hub-analysis'));
  };

  function _vitalTile(m, filler) {
    const unit = m.unit ? ` <span class="body-hub-unit">${_esc(m.unit)}</span>` : '';
    let sub;
    if (m.key === 'vo2Max') {
      sub = m.change30 != null && Math.abs(m.change30) >= 0.1
        ? `${_fmtNum(m.change30, 1, true)} in 30 days` : 'Steady over 30 days';
    } else if (m.usualLow != null) {
      sub = m.signed
        ? `usual &plusmn;${_fmtNum(m.usualHigh, 1)}`
        : `usual ${_fmtNum(m.usualLow, m.decimals)}&ndash;${_fmtNum(m.usualHigh, m.decimals)}`;
    } else {
      sub = `Learning your normal (${m.baselineDays} of 5 nights)`;
    }
    const flagLabel = m.flag === 'high' ? 'High' : m.flag === 'low' ? 'Low' : '';
    const aside = flagLabel
      ? `<span class="body-hub-flag">${flagLabel}</span>`
      : (!m.fresh ? _esc(_dayLabel(m.date)) : '');
    const range = m.month.length ? `${_fmtNum(Math.min(...m.month), m.decimals, m.signed)}&ndash;${_fmtNum(Math.max(...m.month), m.decimals, m.signed)}` : '';
    return `
      <button type="button" class="body-hub-card body-hub-vital${m.flag ? ' is-flagged' : ''}${filler ? ' is-filler' : ''}"
        aria-expanded="false" onclick="toggleBodyVital(this)">
        <span class="body-hub-head">
          <span class="body-hub-kicker">${_esc(m.label)}</span>
          ${aside ? `<span class="body-hub-aside">${aside}</span>` : ''}
        </span>
        <span class="body-hub-value">${_fmtNum(m.value, m.decimals, m.signed)}${unit}</span>
        <span class="body-hub-sub">${sub}</span>
        <span class="body-hub-preview">${_sparkline(m.spark)}</span>
        <span class="body-hub-vital-more">
          <span class="body-hub-sub">${_esc(m.about)}</span>
          ${range ? `<span class="body-hub-sub">Last 30 days: ${range} ${_esc(m.unit)}</span>` : ''}
          ${_sparkline(m.month)}
        </span>
      </button>`;
  }

  function _compositionCard(c) {
    const pref = typeof window.getBodyweightPreference === 'function'
      ? window.getBodyweightPreference() : { unit: 'kg' };
    const unit = pref.unit === 'lb' ? 'lb' : 'kg';
    const toDisp = typeof window.convertWeightValue === 'function'
      ? (kg) => window.convertWeightValue(kg, 'kg', unit, 1)
      : (kg) => Math.round((unit === 'lb' ? kg * 2.20462 : kg) * 10) / 10;
    const signed = (kg) => {
      const v = toDisp(Math.abs(kg));
      if (!(v > 0)) return 'unchanged';
      return `${kg >= 0 ? '+' : '&minus;'}${v} ${unit}`;
    };
    const value = `${toDisp(c.weightKg)} <span class="body-hub-unit">${unit}</span> &middot; ${c.bodyFatPercent.toFixed(1)}<span class="body-hub-unit">% fat</span>`;
    let sub = `Lean ${toDisp(c.leanKg)} ${unit} &middot; Fat ${toDisp(c.fatKg)} ${unit}`;
    if (c.change) {
      sub += `<br>${c.change.days} days: fat ${signed(c.change.fatKg)} &middot; lean ${signed(c.change.leanKg)}`;
    }
    const aside = c.bodyFatFrom === 'profile' ? 'Body fat from your profile' : 'Smart scale';
    const series = c.fatSeries.length >= 2 ? c.fatSeries : c.weightSeries;
    return _card('Body composition', value, sub, 'weightTab', { wide: true, aside, preview: _sparkline(series) });
  }

  function _analysisCards() {
    const api = window.activitySyncBridge;
    if (!api || typeof api.getBodyAnalysis !== 'function') return [];
    let analysis;
    try { analysis = api.getBodyAnalysis(); } catch { return []; }
    const out = [];
    const { status, metrics } = analysis.vitals || {};
    if (status) {
      out.push(`
        <div class="body-hub-card body-hub-card--wide body-hub-status body-hub-status--${status.level}" role="status">
          <span class="body-hub-head">
            <span class="body-hub-kicker">Body analysis</span>
            <span class="body-hub-aside">vs your last 30 days</span>
          </span>
          <span class="body-hub-value">${_esc(status.title)}</span>
          <span class="body-hub-sub">${_esc(status.text)}</span>
          <span class="body-hub-note">From your tracker. A trend check, not a medical diagnosis.</span>
        </div>`);
    }
    // An odd last tile spans the row so the panel has no hole (see _balanceVitals).
    const list = metrics || [];
    list.forEach((m, i) => out.push(_vitalTile(m, list.length % 2 === 1 && i === list.length - 1)));
    const c = analysis.composition;
    if (c && c.bodyFatPercent) out.push(_compositionCard(c));
    return out.length ? [`<div class="body-hub-analysis">${out.join('')}</div>`] : [];
  }

  /* ── Render ──────────────────────────────────────────────── */

  function renderBodyHub() {
    const host = document.getElementById('bodyHubSummary');
    if (!host) return;

    const username = _user();
    if (!username) {
      host.innerHTML = '';
      renderBodyCoach(null);
      return;
    }

    host.innerHTML = [
      ..._analysisCards(),
      _weightCard(username),
      _macroCard(),
      _sleepCard(username),
      _cardioCard(username),
    ].join('');
    renderBodyCoach(username);
  }

  window.renderBodyHub = renderBodyHub;

})();
