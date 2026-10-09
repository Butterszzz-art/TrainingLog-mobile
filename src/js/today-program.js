/**
 * today-program.js
 * Home "Up today" card: today's program session at first glance.
 *
 *  - Banner on top (green with a Start button when there's a session to do,
 *    grey otherwise), the day's lifts with last time's weight underneath.
 *  - Swipe (or tap the week strip) to look at the other days of this week:
 *    past days show what was logged, future days offer "Do it today".
 *  - With no active program, programs saved in My Programs / from the
 *    Library are offered with a Start button.
 *
 * Which day falls on which date comes from program-schedule.js, shared with
 * the Log tab plan (session-queue.js). Start loads the day into the log the
 * same way a template loads (session-queue.js loadTodayProgramIntoLog).
 */
(function () {
  'use strict';

  const PICK_DISMISS_KEY = 'tpcPickDismissed_';

  function _ps() { return window.programSchedule || null; }
  function _core() { return window.programBuilderV2Core || null; }
  function _user() { return window.currentUser || localStorage.getItem('fitnessAppUser'); }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  // ── Data helpers ───────────────────────────────────────────────────────────

  function _setCount(ex) { return Array.isArray(ex.sets) ? ex.sets.length : (Number(ex.sets) || 0); }

  function _repsLabel(ex) {
    const first = Array.isArray(ex.sets) && ex.sets[0] ? ex.sets[0] : null;
    if (!first || first.reps == null) return '';
    return first.repsMax > first.reps ? `${first.reps}–${first.repsMax}` : String(first.reps);
  }

  /** Last time's top-set weight for a lift, else the planned weight, else ''. */
  function _weightHint(ex) {
    if (typeof window.getExerciseStats === 'function') {
      try {
        const stats = window.getExerciseStats(ex.name);
        const w = stats && stats.lastTopSet && Number(stats.lastTopSet.weight);
        if (w > 0) return `${w} kg`;
      } catch { /* no history */ }
    }
    const planned = Array.isArray(ex.sets) && ex.sets[0] ? Number(ex.sets[0].weight) : 0;
    return planned > 0 ? `${planned} kg` : '';
  }

  /** Rough session length: each set ~45 s of work plus its rest (default 2 min). */
  function _minutes(exercises) {
    let sec = 0;
    exercises.forEach(ex => (Array.isArray(ex.sets) ? ex.sets : []).forEach(s => {
      sec += 45 + (Number(s.restSec) > 0 ? Number(s.restSec) : 120);
    }));
    return Math.max(5, Math.round(sec / 300) * 5);
  }

  function _dayStats(day) {
    const exercises = day && Array.isArray(day.exercises) ? day.exercises : [];
    const sets = exercises.reduce((n, ex) => n + _setCount(ex), 0);
    return { exercises, lifts: exercises.length, sets, minutes: _minutes(exercises) };
  }

  /** What was actually lifted in a day's workouts (ticked sets for a loaded program day). */
  function _loggedSummary(workouts) {
    const names = [];
    let sets = 0;
    workouts.forEach(w => (w.log || []).forEach(entry => {
      const fromProgram = w.metadata && w.metadata.source === 'program';
      const n = fromProgram
        ? (entry.completedArray || []).filter(Boolean).length
        : (Array.isArray(entry.repsArray) ? entry.repsArray.length : 0);
      if (!n) return;
      sets += n;
      if (!names.includes(entry.exercise)) names.push(entry.exercise);
    }));
    return { names, sets };
  }

  // ── Slides ─────────────────────────────────────────────────────────────────

  function _banner({ tone, kicker, name, sub, action }) {
    return `
      <div class="tpc-bnr${tone === 'go' ? '' : ' tpc-bnr--muted'}">
        <div class="tpc-bnr-text">
          <span class="tpc-bnr-kicker">${kicker}</span>
          <span class="tpc-bnr-name">${name}</span>
          ${sub ? `<span class="tpc-bnr-sub">${sub}</span>` : ''}
        </div>
        ${action || ''}
      </div>`;
  }

  function _liftRows(exercises, progress, opts) {
    const options = opts || {};
    return exercises.map((ex, i) => {
      const lift = progress ? progress.lifts[i] : null;
      const done = !!(lift && lift.complete);
      const reps = _repsLabel(ex);
      const hint = options.hints === false ? '' : _weightHint(ex);
      return `
        <div class="tpc-ex${done ? ' is-done' : ''}">
          <span class="tpc-ex-name">${_esc(ex.name)}</span>
          <span class="tpc-ex-sets">${_setCount(ex)}${reps ? ` × ${_esc(reps)}` : ' sets'}${hint ? `<span class="tpc-ex-last">${_esc(hint)}</span>` : ''}${done ? '<span class="tpc-ex-tick" aria-label="done">✓</span>' : ''}</span>
        </div>`;
    }).join('');
  }

  function _nextUpRow(next, today, ps) {
    if (!next || !next.day) return '';
    const tomorrow = new Date(today.date);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const when = next.key === ps.localDateKey(tomorrow) ? 'Tomorrow' : next.abbr;
    return `<div class="tpc-next"><span>${when}: <b>${_esc(next.day.name)}</b></span><span>${_plural(_dayStats(next.day).lifts, 'lift')}</span></div>`;
  }

  function _weekLabel(schedule, d) {
    return schedule.weekCount > 1 ? `Week ${d.weekNum} of ${schedule.weekCount}` : `Week ${d.weekNum}`;
  }

  function _slideFor(d, ctx) {
    const { schedule, today, ps, user } = ctx;
    const isPast = d.date < today.date;
    const isToday = d.key === today.key;

    if (!d.isTraining) {
      const next = schedule.nextTrainingAfter(d.date);
      if (isToday) {
        const action = next ? `<button type="button" class="tpc-go tpc-go--ghost" data-tpc-swap="${next.key}">Train</button>` : '';
        return `<div class="tpc-slide">${_banner({
          tone: 'muted',
          kicker: `Rest day · ${_weekLabel(schedule, d)}`,
          name: 'Recover',
          sub: `${ctx.doneThisWeek} of ${ctx.plannedThisWeek} sessions done this week`,
          action,
        })}<div class="tpc-body">${_nextUpRow(next, today, ps)}</div></div>`;
      }
      return `<div class="tpc-slide">${_banner({ tone: 'muted', kicker: `${d.abbr} · Rest`, name: 'Rest day', sub: '' })}
        <div class="tpc-body">${next && next.day ? `<div class="tpc-next"><span>Next: <b>${_esc(next.day.name)}</b></span><span>${next.abbr}</span></div>` : ''}</div></div>`;
    }

    const stats = _dayStats(d.day);
    const subPlan = `${_plural(stats.lifts, 'lift')} · ${_plural(stats.sets, 'set')} · ~${stats.minutes} min`;

    if (isPast) {
      const logged = _loggedSummary(ps.workoutsOn(d.key, user));
      if (logged.sets) {
        return `<div class="tpc-slide">${_banner({
          tone: 'muted', kicker: `${d.abbr} · Done`, name: `${_esc(d.day.name)} ✓`,
          sub: `${_plural(logged.names.length, 'lift')} · ${_plural(logged.sets, 'set')} logged`,
        })}<div class="tpc-body">${logged.names.slice(0, 5).map(n => `<div class="tpc-ex is-done"><span class="tpc-ex-name">${_esc(n)}</span><span class="tpc-ex-sets">logged</span></div>`).join('')}</div></div>`;
      }
      return `<div class="tpc-slide">${_banner({ tone: 'muted', kicker: `${d.abbr} · Not logged`, name: _esc(d.day.name), sub: subPlan })}
        <div class="tpc-body">${_liftRows(stats.exercises, null, { hints: false })}</div></div>`;
    }

    if (isToday) {
      const progress = ps.dayProgress(d.day, ps.workoutsOn(d.key, user));
      if (progress.complete) {
        const next = schedule.nextTrainingAfter(d.date);
        return `<div class="tpc-slide">${_banner({
          tone: 'muted', kicker: 'Done today', name: `${_esc(d.day.name)} ✓`,
          sub: `${_plural(progress.totalLifts, 'lift')} · ${_plural(progress.doneSets, 'set')}`,
        })}<div class="tpc-body">${_nextUpRow(next, today, ps)}</div></div>`;
      }
      const sub = progress.started ? `${progress.doneLifts} of ${progress.totalLifts} lifts · ${progress.doneSets}/${progress.totalSets} sets` : subPlan;
      return `<div class="tpc-slide tpc-slide--today">${_banner({
        tone: 'go',
        kicker: `Up today · ${_weekLabel(schedule, d)}${d.phase ? ` · ${_esc(d.phase)}` : ''}`,
        name: _esc(d.day.name),
        sub,
        action: `<button type="button" class="tpc-go" data-tpc-start>${progress.started ? 'Continue' : 'Start'}</button>`,
      })}<div class="tpc-body">${_liftRows(stats.exercises, progress)}</div></div>`;
    }

    // Future training day
    return `<div class="tpc-slide">${_banner({
      tone: 'muted', kicker: `${d.abbr} · Coming up`, name: _esc(d.day.name), sub: subPlan,
      action: `<button type="button" class="tpc-go tpc-go--ghost" data-tpc-swap="${d.key}">Do it today</button>`,
    })}<div class="tpc-body">${_liftRows(stats.exercises, null)}</div></div>`;
  }

  /** Shorten day names for the narrow strip cells: "Upper Body A" → "Upper A". */
  function _short(name) {
    if (!name) return '';
    return String(name)
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\b(body|day)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 10);
  }

  // ── Not started: pick a saved program ──────────────────────────────────────

  function _savedPrograms() {
    const core = _core();
    if (!core || typeof core.loadPrograms !== 'function') return [];
    return core.loadPrograms(window)
      .filter(p => p && (p.id || p.programId) && Array.isArray(p.days) && p.days.length)
      .sort((a, b) => String(b.importedAt || b.updatedAt || '').localeCompare(String(a.importedAt || a.updatedAt || '')));
  }

  function _renderPick(el, user) {
    const programs = _savedPrograms();
    // "Not now" hides the card until another program is saved.
    let dismissedAt = -1;
    try { dismissedAt = Number(localStorage.getItem(PICK_DISMISS_KEY + user) || -1); } catch { /* ignore */ }
    if (!programs.length || programs.length <= dismissedAt) { el.innerHTML = ''; return; }

    const core = _core();
    const rows = programs.slice(0, 3).map((p, i) => {
      const weeks = core && typeof core.getWeekCount === 'function' ? core.getWeekCount(p) : 1;
      const freq = Array.isArray(p.frequency) && p.frequency.length ? p.frequency.join(' ') : _plural(p.days.length, 'day');
      const from = p.source && p.source.type === 'library' ? 'From Library · ' : '';
      return `
        <div class="tpc-pick">
          <span class="tpc-pick-text"><b>${_esc(p.name || p.title || 'Program')}</b><small>${from}${weeks > 1 ? `${weeks} weeks · ` : ''}${_esc(freq)}</small></span>
          <button type="button" class="tpc-go tpc-go--sm${i ? ' tpc-go--ghost' : ''}" data-tpc-pick="${_esc(p.id || p.programId)}">Start</button>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="tpc-card">
        <div class="tpc-slide">
          ${_banner({ tone: 'muted', kicker: 'In your programs', name: 'Pick a program', sub: "Start one and today's session shows up here", action: `<button type="button" class="tpc-dismiss" data-tpc-dismiss="${programs.length}">Not now</button>` })}
          <div class="tpc-body">${rows}</div>
        </div>
      </div>`;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderTodayProgramCard() {
    const el = document.getElementById('todayProgramCard');
    if (!el) return;
    const ps = _ps();
    const user = _user();
    if (!ps || !user) { el.innerHTML = ''; return; }
    _wire(el);

    const schedule = ps.getActiveSchedule(user);
    if (!schedule) { _renderPick(el, user); return; }

    const now = new Date();
    const today = schedule.dayFor(now);
    const week = schedule.weekOf(now);
    const todayIdx = week.findIndex(d => d.key === today.key);
    const loggedOn = d => _loggedSummary(ps.workoutsOn(d.key, user)).sets > 0;

    const plannedThisWeek = week.filter(d => d.isTraining).length;
    const doneThisWeek = week.filter(d => d.isTraining && d.date <= today.date && loggedOn(d)).length;
    const ctx = { schedule, today, ps, user, plannedThisWeek, doneThisWeek };

    // Keep the swiped-to day across re-renders within the same day.
    const keepIdx = el._tpcDay === today.key && Number.isInteger(el._tpcIndex) ? el._tpcIndex : todayIdx;

    const strip = week.map((d, i) => {
      const cls = ['tpc-cell'];
      if (!d.isTraining) cls.push('is-rest');
      if (d.key === today.key) cls.push('is-today');
      if (d.date < today.date && d.isTraining && loggedOn(d)) cls.push('is-done');
      return `<button type="button" class="${cls.join(' ')}" data-tpc-go="${i}" aria-label="${d.abbr}${d.isTraining ? ': ' + _esc(d.day.name) : ': rest'}">
          <span class="tpc-cell-abbr">${d.abbr}</span>
          <span class="tpc-cell-name">${d.isTraining ? _esc(_short(d.day.name)) : '–'}</span>
        </button>`;
    }).join('');

    el.innerHTML = `
      <div class="tpc-card">
        <div class="tpc-viewport">
          <div class="tpc-track">${week.map(d => _slideFor(d, ctx)).join('')}</div>
        </div>
        <div class="tpc-strip" aria-label="${_esc(schedule.program.name)}, this week">${strip}</div>
      </div>`;

    el._tpcDay = today.key;
    _go(el, keepIdx, false);
  }

  function _go(el, index, animate) {
    const track = el.querySelector('.tpc-track');
    const cells = el.querySelectorAll('.tpc-cell');
    if (!track || !cells.length) return;
    const i = Math.max(0, Math.min(cells.length - 1, index));
    el._tpcIndex = i;
    if (animate === false) track.style.transition = 'none';
    track.style.transform = `translateX(calc(${-i} * (100% + var(--tpc-gap, 10px))))`;
    if (animate === false) { void track.offsetWidth; track.style.transition = ''; }
    cells.forEach((c, j) => {
      c.classList.toggle('is-on', j === i);
      c.setAttribute('aria-pressed', j === i ? 'true' : 'false');
    });
    const slides = el.querySelectorAll('.tpc-slide');
    slides.forEach((s, j) => {
      s.setAttribute('aria-hidden', j === i ? 'false' : 'true');
      s.inert = j !== i;
    });
    _fitHeight(el);
  }

  /** Viewport height follows the day on screen, not the tallest day. While
   * Home is hidden nothing can be measured; the ResizeObserver in _wire()
   * refits once the card is visible again. */
  function _fitHeight(el) {
    const viewport = el.querySelector('.tpc-viewport');
    const slide = el.querySelectorAll('.tpc-slide')[el._tpcIndex || 0];
    if (!viewport || !slide) return;
    const h = slide.offsetHeight;
    viewport.style.height = h ? `${h}px` : '';
  }

  function _refreshAll() {
    renderTodayProgramCard();
    if (typeof window.renderSessionQueue === 'function') window.renderSessionQueue();
    if (typeof window.renderTrainHero === 'function') window.renderTrainHero();
  }

  /** Home Start: open the Log tab with today's day loaded like a template. */
  function startTodayProgramSession() {
    if (typeof window.showTab === 'function') window.showTab('logTab');
    if (typeof window.setActiveNavTab === 'function') window.setActiveNavTab('logTab');
    const logSubBtn = document.querySelector('#logSubtabNav .log-subtab[data-log-subtab="log"]');
    if (logSubBtn && !logSubBtn.classList.contains('active')) logSubBtn.click();
    if (typeof window.loadTodayProgramIntoLog === 'function') window.loadTodayProgramIntoLog();
    else if (typeof window.goToQuickLog === 'function') window.goToQuickLog();
  }

  function _toast(msg, type) { if (typeof window.showToast === 'function') window.showToast(msg, type || 'success'); }

  function _wire(el) {
    if (el._tpcWired) return;
    el._tpcWired = true;

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => { if (el.querySelector('.tpc-viewport')) _fitHeight(el); }).observe(el);
    }

    el.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || !el.contains(t)) return;
      if (t.hasAttribute('data-tpc-start')) { startTodayProgramSession(); return; }
      if (t.dataset.tpcGo != null) { _go(el, Number(t.dataset.tpcGo)); return; }
      if (t.dataset.tpcSwap) {
        const ps = _ps();
        const schedule = ps && ps.getActiveSchedule(_user());
        const target = schedule ? schedule.dayFor(ps.parseLocalDate(t.dataset.tpcSwap)) : null;
        if (target && target.day && ps.swapIntoToday(t.dataset.tpcSwap, { schedule })) {
          el._tpcIndex = null;
          _refreshAll();
          _toast(`${target.day.name} moved to today.`);
        }
        return;
      }
      if (t.dataset.tpcPick) {
        const core = _core();
        if (!core || typeof core.startProgram !== 'function') return;
        const started = core.startProgram(window, t.dataset.tpcPick, { userId: _user() });
        if (started) {
          _toast(`Started ${started.name || 'your program'}. Week 1 begins today.`);
          _refreshAll();
        }
        return;
      }
      if (t.dataset.tpcDismiss) {
        try { localStorage.setItem(PICK_DISMISS_KEY + _user(), t.dataset.tpcDismiss); } catch { /* ignore */ }
        el.innerHTML = '';
      }
    });

    // Horizontal swipe between days; vertical scrolling stays with the page.
    let sx = null, sy = null;
    el.addEventListener('touchstart', (e) => {
      if (!e.target.closest('.tpc-viewport')) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      sx = sy = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) _go(el, (el._tpcIndex || 0) + (dx < 0 ? 1 : -1));
    }, { passive: true });
    // Mouse drag in the browser build.
    let mx = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.target.closest('.tpc-viewport') && !e.target.closest('button')) mx = e.clientX;
    });
    el.addEventListener('pointerup', (e) => {
      if (mx == null) return;
      const dx = e.clientX - mx; mx = null;
      if (Math.abs(dx) > 40) _go(el, (el._tpcIndex || 0) + (dx < 0 ? 1 : -1));
    });
  }

  /** Today's program day name (e.g. "Push Day"), or null on a rest day / no active program. */
  function getTodayWorkoutName() {
    try {
      const ps = _ps();
      const schedule = ps && ps.getActiveSchedule(_user());
      if (!schedule) return null;
      const today = schedule.dayFor(new Date());
      return today.isTraining && today.day ? today.day.name : null;
    } catch {
      return null;
    }
  }

  window.renderTodayProgramCard = renderTodayProgramCard;
  window.startTodayProgramSession = startTodayProgramSession;
  window.getTodayWorkoutName = getTodayWorkoutName;
})();
