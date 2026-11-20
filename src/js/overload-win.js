/**
 * overload-win.js
 * The "Overload Win" card: a short green reward that pops when a lifter's
 * TOP SET beats their last session or hits the overload tip the app gave
 * them (progressiveOverload.js suggestNextSession).
 *
 * Rules
 *  - Top set only: the set that drives progression (progressiveOverload.js
 *    topSetOf: a tagged Top Set, else the heaviest non-back-off set). Back-off
 *    and warm-up sets never earn it.
 *  - Followed the plan: today's top set is at or above the tip's top set
 *    (weight and reps) for tips that add load: Add weight / Add a rep /
 *    Maxed out (+1 rep).
 *  - Beat last time: today's top set beats last session's top set: more
 *    reps at the same weight, or more weight with a higher e1RM (which
 *    includes more weight at the same or more reps).
 *  - No card when the tip was Repeat or Deload, at an alt gym or on an alt
 *    machine, for a lift's first session, or for matching last time exactly.
 *  - Once per exercise per session (day).
 *  - An all-time PR outranks it: the gold PR card shows and gets a
 *    "+2.5 kg vs last time" line instead of a second card.
 *  - Overload streak: sessions in a row the top set went up; shown from 2.
 *
 * Hooks in on the tl:set-logged event that quick log (index.html
 * addLogEntry) and ticking a planned set (set-complete.js) both send, after
 * PRs have been checked.
 */
(function (global) {
  'use strict';

  const CARD_MS = 5000;
  const WIN_KEY = 'tl_overload_wins_v1';
  const LOADING_STRATEGIES = new Set(['increase', 'increase-reps', 'maxed-out']);
  const NO_CARD_STRATEGIES = new Set(['repeat', 'deload']);

  // ── Engine access (window globals in the app, require() in tests) ──

  function _engine() {
    let mod = null;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { mod = require('../../progressiveOverload'); } catch { mod = null; }
    }
    const pick = (name, globalName) => (mod && mod[name]) || global[globalName || name];
    return {
      collectSessions: pick('collectSessions', 'overloadCollectSessions'),
      topSetOf: pick('topSetOf', 'overloadTopSetOf'),
      suggestNextSession: pick('suggestNextSession'),
    };
  }

  function _e1rm(s) {
    return s && s.weight > 0 && s.reps > 0 ? s.weight * (1 + s.reps / 30) : 0;
  }

  function _round(n, dp = 2) {
    const f = Math.pow(10, dp);
    return Math.round((Number(n) || 0) * f) / f;
  }

  /**
   * a beats b: more weight at same/more reps, more reps at same weight, or
   * more weight with a higher e1RM. A lighter set never beats a heavier one,
   * so a high-rep ramp-up set can't pass for the top set.
   */
  function beats(a, b) {
    if (!a || !b) return false;
    if (a.weight === b.weight) return a.reps > b.reps;
    return a.weight > b.weight && _e1rm(a) > _e1rm(b) + 1e-9;
  }

  /** Progress for the streak: a beat, or any weight added (double progression resets reps). */
  function progressed(a, b) {
    return beats(a, b) || (!!a && !!b && a.weight > b.weight);
  }

  function _byDate(workouts) {
    return (Array.isArray(workouts) ? workouts : [])
      .filter(w => w && typeof w.date === 'string')
      .map((w, i) => [w, i])
      .sort((x, y) => (x[0].date < y[0].date ? -1 : x[0].date > y[0].date ? 1 : x[1] - y[1]))
      .map(p => p[0]);
  }

  function _mergeSessions(sessions) {
    if (!sessions.length) return null;
    const sets = [];
    sessions.forEach(s => sets.push(...s.sets));
    return { date: sessions[0].date, unit: sessions[sessions.length - 1].unit || 'kg', sets };
  }

  function _workTop(topSetOf, sets) {
    const top = sets && sets.length ? topSetOf(sets) : null;
    if (!top || top.type === 'backoff' || top.skipped || !(top.weight > 0) || !(top.reps > 0)) return null;
    return top;
  }

  /**
   * Did today's top set of `exercise` earn the card? `workouts` is the full
   * history (any order) including `date`'s session, with only completed
   * sets in planned sessions. Returns the win, or null.
   */
  function evaluateWin(exercise, workouts, date, engine) {
    const eng = engine || _engine();
    if (!eng.collectSessions || !eng.topSetOf) return null;
    const name = String(exercise || '').trim();
    if (!name || !date) return null;

    const all = _byDate(workouts);
    const prior = all.filter(w => w.date < date);
    const today = _mergeSessions(eng.collectSessions(name, all.filter(w => w.date === date), ''));
    if (!today) return null; // nothing at the usual gym today (alt gym / alt machine)
    const top = _workTop(eng.topSetOf, today.sets);
    if (!top) return null;

    const sessions = eng.collectSessions(name, prior, '');
    if (!sessions.length) return null; // first time: nothing to beat
    const last = sessions[sessions.length - 1];
    const lastTop = _workTop(eng.topSetOf, last.sets) || eng.topSetOf(last.sets);
    if (!lastTop) return null;
    const unit = today.unit || 'kg';
    if ((last.unit || 'kg') !== unit) return null;

    let rec = null;
    if (typeof eng.suggestNextSession === 'function') {
      try { rec = eng.suggestNextSession(name, prior, { gymKey: '' }); } catch { rec = null; }
    }
    if (rec && NO_CARD_STRATEGIES.has(rec.strategy)) return null;

    const tip = rec && LOADING_STRATEGIES.has(rec.strategy) && rec.topSet ? rec.topSet : null;
    const followed = !!tip && top.weight >= tip.weight && top.reps >= tip.reps;
    const beat = beats(top, lastTop);
    if (!followed && !beat) return null;
    const pastTip = followed && (top.weight > tip.weight || top.reps > tip.reps);

    // Streak: sessions in a row (ending today) where the top set went up.
    const tops = sessions.map(s => eng.topSetOf(s.sets)).concat([top]);
    let streak = 0;
    for (let i = tops.length - 1; i > 0; i--) {
      if (tops[i] && tops[i - 1] && progressed(tops[i], tops[i - 1])) streak++;
      else break;
    }

    let kind, delta, deltaUnit;
    if (top.weight > lastTop.weight) { kind = 'weight'; delta = _round(top.weight - lastTop.weight); deltaUnit = unit; }
    else if (top.reps > lastTop.reps) { kind = 'reps'; delta = top.reps - lastTop.reps; deltaUnit = delta === 1 ? 'rep' : 'reps'; }
    else { kind = 'e1rm'; delta = _round(_e1rm(top) - _e1rm(lastTop), 1); deltaUnit = unit; }

    return {
      exercise: name,
      unit,
      date,
      today: { weight: top.weight, reps: top.reps },
      last: { weight: lastTop.weight, reps: lastTop.reps, date: last.date },
      tip: tip ? { weight: tip.weight, reps: tip.reps } : null,
      followed,
      pastTip,
      beat,
      kind,
      delta,
      deltaUnit,
      e1rmDelta: _round(_e1rm(top) - _e1rm(lastTop), 1),
      streak: streak >= 2 ? streak : 0,
    };
  }

  /** Card copy for a win. */
  function describeWin(win) {
    const fmt = n => String(_round(n));
    let kicker, title;
    if (win.followed && win.pastTip) { kicker = 'Overload hit'; title = 'Plan beaten'; }
    else if (win.followed) { kicker = 'Overload hit'; title = 'You followed the plan'; }
    else { kicker = 'Beat last time'; title = 'More than last workout'; }

    let sub;
    if (win.followed && win.pastTip && win.tip) {
      const extra = win.today.reps - win.tip.reps;
      sub = win.today.weight > win.tip.weight
        ? `${fmt(win.today.weight - win.tip.weight)} ${win.unit} over the tip`
        : `+${extra} rep${extra === 1 ? '' : 's'} over the tip`;
    } else if (win.kind === 'weight') sub = 'on your top set';
    else if (win.kind === 'reps') sub = `at ${fmt(win.today.weight)} ${win.unit}`;
    else sub = 'estimated 1RM, top set';

    const chips = [];
    if (win.streak >= 2) chips.push({ text: `🔥 ${win.streak} sessions in a row`, fire: true });
    if (win.followed && !win.pastTip) chips.push({ text: 'Suggestion matched' });
    if (win.kind !== 'e1rm' && win.e1rmDelta > 0) chips.push({ text: `e1RM +${fmt(win.e1rmDelta)} ${win.unit}` });

    return {
      kicker,
      title,
      delta: `+${fmt(win.delta)}`,
      deltaUnit: win.kind === 'e1rm' ? `${win.deltaUnit} e1RM` : win.deltaUnit,
      sub,
      last: `${fmt(win.last.weight)} × ${win.last.reps}`,
      today: `${fmt(win.today.weight)} × ${win.today.reps}`,
      chips,
      prLine: `+${fmt(win.delta)} ${win.kind === 'e1rm' ? win.deltaUnit + ' e1RM' : win.deltaUnit} vs last time`,
    };
  }

  // ── Once per exercise per session ──────────────────────────────

  function _winKey(user) { return `${WIN_KEY}_${user || 'anon'}`; }

  function alreadyCelebrated(user, date, exercise) {
    try {
      const s = JSON.parse(localStorage.getItem(_winKey(user)) || 'null');
      return !!(s && s.date === date && Array.isArray(s.done) && s.done.includes(String(exercise).trim().toLowerCase()));
    } catch { return false; }
  }

  function markCelebrated(user, date, exercise) {
    try {
      let s = JSON.parse(localStorage.getItem(_winKey(user)) || 'null');
      if (!s || s.date !== date || !Array.isArray(s.done)) s = { date, done: [] };
      const k = String(exercise).trim().toLowerCase();
      if (!s.done.includes(k)) s.done.push(k);
      localStorage.setItem(_winKey(user), JSON.stringify(s));
    } catch { /* storage unavailable */ }
  }

  // ── UI ─────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _reducedMotion() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  }

  /** Success buzz: @capacitor/haptics in the native app (iOS + Android), else the web vibrate API. */
  function _haptic() {
    const vibrate = () => {
      try {
        if (global.navigator && typeof global.navigator.vibrate === 'function') global.navigator.vibrate([12, 40, 18]);
      } catch { /* optional */ }
    };
    try {
      const cap = global.Capacitor;
      const native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
      const H = native && cap.Plugins && cap.Plugins.Haptics;
      if (H && typeof H.notification === 'function') {
        Promise.resolve(H.notification({ type: 'SUCCESS' })).catch(vibrate);
        return;
      }
    } catch { /* fall back below */ }
    vibrate();
  }

  /** The PR card is up for this lift: add the overload line to it instead. */
  function _addToPRCard(win, copy) {
    const modal = document.getElementById('_prModal');
    if (!modal || modal._closed) return false;
    const target = String(win.exercise).trim().toLowerCase();
    const item = Array.from(modal.querySelectorAll('.pr-modal-item'))
      .find(el => (el.querySelector('.pr-modal-item-name')?.textContent || '').trim().toLowerCase() === target);
    if (!item) return false;
    const next = item.nextElementSibling;
    if (!(next && next.classList.contains('pr-modal-overload'))) {
      const line = document.createElement('div');
      line.className = 'pr-modal-overload';
      line.textContent = `↑ ${copy.prLine}`;
      item.insertAdjacentElement('afterend', line);
    }
    return true;
  }

  function _burst(card) {
    if (_reducedMotion() || typeof document.createElement('canvas').getContext !== 'function') return;
    const canvas = document.createElement('canvas');
    canvas.className = 'ow-burst';
    canvas.setAttribute('aria-hidden', 'true');
    card.parentNode.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }
    const box = canvas.getBoundingClientRect();
    const badge = card.querySelector('.ow-badge');
    const b = badge ? badge.getBoundingClientRect() : box;
    const dpr = global.devicePixelRatio || 1;
    canvas.width = Math.max(1, box.width * dpr);
    canvas.height = Math.max(1, box.height * dpr);
    ctx.scale(dpr, dpr);
    const ox = b.left - box.left + b.width / 2;
    const oy = b.top - box.top + b.height / 2;
    const colors = ['#8ec2a4', '#b9f0cf', '#5fb88a', '#2f8a63', '#e7c48c'];
    const parts = Array.from({ length: 46 }, () => {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      return { x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, r: 2 + Math.random() * 3, c: colors[Math.random() * colors.length | 0], life: 1, rect: Math.random() < 0.5, rot: Math.random() * 6 };
    });
    (function frame() {
      ctx.clearRect(0, 0, box.width, box.height);
      let alive = false;
      for (const p of parts) {
        if (p.life <= 0) continue;
        alive = true;
        p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.vx *= 0.985; p.life -= 0.016; p.rot += 0.2;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        if (p.rect) ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        else { ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      if (alive && canvas.isConnected) requestAnimationFrame(frame);
      else canvas.remove();
    })();
  }

  function _countUp(el, text, unit) {
    const target = parseFloat(text.replace('+', ''));
    const dec = (String(target).split('.')[1] || '').length;
    const paint = v => { el.innerHTML = `+${v.toFixed(dec)}<small>${_esc(unit)}</small>`; };
    if (_reducedMotion() || !Number.isFinite(target) || typeof requestAnimationFrame !== 'function') { paint(target || 0); return; }
    const t0 = performance.now();
    (function step(t) {
      const p = Math.min(1, (t - t0) / 700);
      paint(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  function showWinCard(win) {
    const copy = describeWin(win);
    document.getElementById('_overloadWin')?._close?.();
    document.getElementById('_overloadWin')?.remove();
    global.holdToastsForSpotlight?.();

    const overlay = document.createElement('div');
    overlay.className = 'overload-win-overlay';
    overlay.id = '_overloadWin';
    overlay.innerHTML = `
      <div class="overload-win" role="status" aria-live="polite" tabindex="0">
        <div class="ow-head">
          <span class="ow-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
          </span>
          <span class="ow-titles">
            <span class="ow-kicker">${_esc(copy.kicker)}</span>
            <span class="ow-title">${_esc(copy.title)}</span>
          </span>
          <span class="ow-skip">Tap to skip</span>
        </div>
        <div class="ow-delta-row">
          <span class="ow-delta">${_esc(copy.delta)}<small>${_esc(copy.deltaUnit)}</small></span>
          <span class="ow-delta-sub">${_esc(win.exercise)} · ${_esc(copy.sub)}</span>
        </div>
        <div class="ow-compare">
          <span class="ow-c"><span class="ow-lbl">Last time</span><span class="ow-val">${_esc(copy.last)}</span></span>
          <span class="ow-arrow" aria-hidden="true">→</span>
          <span class="ow-c ow-c--today"><span class="ow-lbl">Today</span><span class="ow-val">${_esc(copy.today)}</span></span>
        </div>
        ${copy.chips.length ? `<div class="ow-chips">${copy.chips.map(c => `<span class="ow-chip${c.fire ? ' ow-chip--fire' : ''}">${_esc(c.text)}</span>`).join('')}</div>` : ''}
        <span class="ow-meter" aria-hidden="true"><span></span></span>
      </div>
    `;

    const top = typeof global.notifyTopOffset === 'function' ? global.notifyTopOffset() : 0;
    if (top) overlay.style.setProperty('--ow-top', top + 'px');

    let timer = null;
    const close = () => {
      if (overlay._closed) return;
      overlay._closed = true;
      clearTimeout(timer);
      overlay.classList.remove('visible');
      overlay.classList.add('closing');
      setTimeout(() => {
        overlay.remove();
        global.flushToastQueue?.();
      }, 250);
    };
    overlay._close = close;

    const card = overlay.querySelector('.overload-win');
    card.style.setProperty('--ow-card-ms', CARD_MS + 'ms');
    card.addEventListener('click', close);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); close(); }
    });

    document.body.appendChild(overlay);
    const deltaEl = overlay.querySelector('.ow-delta');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.classList.add('visible');
      _countUp(deltaEl, copy.delta, copy.deltaUnit);
      setTimeout(() => { if (!overlay._closed) _burst(card); }, 280);
    }));
    _haptic();
    timer = setTimeout(close, CARD_MS);
    return overlay;
  }

  // ── Wiring ─────────────────────────────────────────────────────

  function _user() {
    return global.currentUser
      || (global.getActiveUsername && global.getActiveUsername())
      || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser'))
      || null;
  }

  function _history(user) {
    let workouts = [];
    try {
      workouts = typeof global.getOverloadWorkouts === 'function'
        ? global.getOverloadWorkouts(user)
        : (JSON.parse(localStorage.getItem(`workouts_${user}`)) || []);
    } catch { workouts = []; }
    // Planned sessions only count the sets that were ticked.
    if (global.SetComplete && typeof global.SetComplete.completedWorkouts === 'function') {
      workouts = global.SetComplete.completedWorkouts(workouts);
    }
    return workouts;
  }

  /** Check the lift just logged and celebrate if it earned it. Returns the win or null. */
  function checkAndCelebrate(exercise, date) {
    if (global.coachLoggingClient) return null; // a coach logging for a client
    const user = _user();
    if (!user || !exercise || !date) return null;
    if (alreadyCelebrated(user, date, exercise)) return null;
    const win = evaluateWin(exercise, _history(user), date);
    if (!win) return null;
    markCelebrated(user, date, exercise);

    const copy = describeWin(win);
    if (_addToPRCard(win, copy)) return win; // the PR card outranks this one

    // Another celebration (PR on a different lift, badge) is up: wait for it.
    let waited = 0;
    (function tryShow() {
      if (document.getElementById('_prModal') || document.querySelector('.milestone-celebrate')) {
        waited += 500;
        if (waited <= 12000) setTimeout(tryShow, 500);
        return;
      }
      showWinCard(win);
    })();
    return win;
  }

  function _onSetLogged(e) {
    const d = (e && e.detail) || {};
    // Let the PR card open first (it's shown synchronously before the event).
    setTimeout(() => {
      try { checkAndCelebrate(d.exercise, d.date); } catch { /* never block logging */ }
    }, 60);
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('tl:set-logged', _onSetLogged);
  }

  const api = { evaluateWin, describeWin, beats, progressed, alreadyCelebrated, markCelebrated, checkAndCelebrate, showWinCard, haptic: _haptic };
  global.OverloadWin = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
