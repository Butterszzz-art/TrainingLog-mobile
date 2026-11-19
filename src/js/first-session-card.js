/* =============================================================
   FIRST-SESSION CARD — make sessions 1-3 pay off straight away
   Most of what the app does (trends, PRs, progression) needs a few
   sessions of data, so early on a workout used to end with nothing
   coming back. After each of a user's first three sessions in this
   app, this sheet shows what it already learned:

   - sets, volume and time; muscles worked (exerciseMuscleMap.js);
   - each lift's best set and estimated 1RM, and for session 2+ which
     lifts went up since last time;
   - "Next time": the progression for the main lifts
     (progressiveOverload.js suggestNextSession), which is what gets
     pre-filled next session;
   - progress towards session 3, when Insights trends unlock.

   It opens after "End workout" (tl:workout-finished, workoutTimer.js),
   once the "How did it go?" rating sheet is closed. Once per day.
   The first "next time" line is kept (habit_<user>.nextHint) for the
   "Session 2 is ready" notification (habit-core.js planLifecycle).
   Rules: habit-core.js (summarizeSession, earlySessionNumber).
   Styles: css/habit.css (.fs-*).
   ============================================================= */
(function (global) {
  'use strict';

  const H = () => global.HabitCore;
  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const UP = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const MUSCLE_NAMES = {
    chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms',
    quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', abs: 'Abs', core: 'Core', traps: 'Traps',
    adductors: 'Adductors', abductors: 'Abductors', legs: 'Legs', arms: 'Arms',
  };

  function user() {
    return (typeof global.getActiveUsername === 'function' && global.getActiveUsername())
      || global.currentUser || localStorage.getItem('fitnessAppUser') || '';
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  const fmt = n => (Math.round(Number(n) * 10) / 10).toLocaleString();

  function readJSON(key) {
    try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : []; } catch { return []; }
  }

  function fullHistory(u) {
    if (typeof global.getFullWorkoutHistory === 'function') return global.getFullWorkoutHistory(u);
    return [...readJSON(`workoutHistory_${u}`), ...readJSON(`workouts_${u}`)];
  }

  function overloadHistory(u) {
    if (typeof global.getOverloadHistory === 'function') return global.getOverloadHistory(u);
    return fullHistory(u);
  }

  /** Best e1RM per exercise before `date` (own and imported sessions). */
  function previousBests(history, date) {
    const best = new Map();
    history.forEach(w => {
      if (!w || String(w.date || '').slice(0, 10) >= date) return;
      H().summarizeSession(w).exercises.forEach(x => {
        const k = x.name.toLowerCase();
        if (x.e1rm > (best.get(k) || 0)) best.set(k, x.e1rm);
      });
    });
    return best;
  }

  function nextTimeLines(summary, u) {
    if (typeof global.suggestNextSession !== 'function') return [];
    const hist = overloadHistory(u);
    return summary.exercises
      .slice()
      // Main lifts first: the heaviest estimated 1RMs, not accessories.
      .sort((a, b) => b.e1rm - a.e1rm || b.sets - a.sets)
      .slice(0, 3)
      .map(x => {
        let rec = null;
        try { rec = global.suggestNextSession(x.name, hist); } catch { rec = null; }
        if (!rec || !rec.topSet || rec.strategy === 'deload') return null;
        const w = Number(rec.topSet.weight) || 0;
        const what = w > 0 ? `${fmt(w)} ${rec.unit || summary.unit} × ${rec.topSet.reps}` : `${rec.topSet.reps} reps`;
        return { name: x.name, what, up: rec.strategy !== 'repeat' };
      })
      .filter(Boolean);
  }

  function headline(n, ups) {
    if (n === 1) return { kicker: 'Session 1 in the book', title: 'Your starting numbers are saved', lead: 'Next time, every lift below is filled in for you with a small step up. Beat it and you’re progressing.' };
    if (n === 2) {
      return ups
        ? { kicker: 'Session 2 done', title: `${ups} lift${ups === 1 ? '' : 's'} up on last time`, lead: 'That’s progressive overload, and the app is tracking it for you.' }
        : { kicker: 'Session 2 done', title: 'Two sessions logged', lead: 'Matching last time still counts. Next session, try the numbers below.' };
    }
    return { kicker: 'Session 3 done', title: 'Your trends are live', lead: 'Three sessions is enough to chart your strength and volume. Open Insights to see them.' };
  }

  /* ── Sheet ──────────────────────────────────────────────── */

  function close() { document.querySelectorAll('.fs-backdrop').forEach(n => n.remove()); }

  function show({ n, summary, ups, durationMin, next }) {
    close();
    const h = headline(n, ups.size);
    const total = H().EARLY_SESSIONS;
    const vol = summary.volume >= 10000 ? `${fmt(summary.volume / 1000)}k` : fmt(summary.volume);
    const overlay = document.createElement('div');
    overlay.className = 'mx-sheet-backdrop fs-backdrop';
    overlay.innerHTML = `
      <div class="mx-sheet fs-sheet" role="dialog" aria-modal="true" aria-labelledby="fsTitle">
        <div class="mx-sheet-head">
          <div>
            <div class="mx-kicker">${esc(h.kicker)}</div>
            <h3 class="pod-title mx-h3" id="fsTitle">${esc(h.title)}</h3>
          </div>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-fs-close aria-label="Close">${CLOSE}</button>
        </div>
        <p class="mx-sub fs-lead">${esc(h.lead)}</p>
        <div class="fs-stats">
          <div class="fs-stat"><b>${summary.sets}</b><span>sets</span></div>
          <div class="fs-stat"><b>${vol}</b><span>${esc(summary.unit)} moved</span></div>
          <div class="fs-stat"><b>${durationMin ? `${durationMin}<small>min</small>` : summary.exercises.length}</b><span>${durationMin ? 'time' : 'exercises'}</span></div>
        </div>
        ${summary.muscles.length ? `<div class="fs-muscles" aria-label="Muscles worked">${summary.muscles.map(m => `<span class="mx-chip mx-chip--sm">${esc(MUSCLE_NAMES[m.muscle] || m.muscle)} · ${m.sets}</span>`).join('')}</div>` : ''}
        <div class="fs-section">
          <div class="wk-cap">Best sets</div>
          <ul class="fs-list">
            ${summary.exercises.slice(0, 5).map(x => `
              <li class="fs-row">
                <span class="fs-name">${esc(x.name)}${ups.has(x.name.toLowerCase()) ? `<span class="fs-up">${UP}up</span>` : ''}</span>
                <span class="fs-val">${x.best.weight > 0 ? `${fmt(x.best.weight)} × ${x.best.reps}` : `${x.best.reps} reps`}${x.e1rm && x.best.reps > 1 ? `<small>e1RM ${fmt(x.e1rm)}</small>` : ''}</span>
              </li>`).join('')}
          </ul>
        </div>
        ${next.length ? `
        <div class="fs-section fs-next">
          <div class="wk-cap">Next time</div>
          <ul class="fs-list">
            ${next.map(x => `<li class="fs-row"><span class="fs-name">${esc(x.name)}</span><span class="fs-val fs-val--next">${esc(x.what)}</span></li>`).join('')}
          </ul>
        </div>` : ''}
        ${n < total ? `
        <div class="fs-unlock">
          <div class="mx-meter mx-meter--thin" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${n}" aria-label="Sessions until trends unlock"><i style="width:${Math.round((n / total) * 100)}%"></i></div>
          <span>${total - n} more session${total - n === 1 ? '' : 's'} and your strength trends unlock in Insights.</span>
        </div>` : ''}
        <div class="fs-foot">
          ${n >= total ? '<button type="button" class="gd-textbtn gd-dim" data-fs-close>Done</button><button type="button" class="gd-go" data-fs-insights>See my trends</button>' : '<button type="button" class="gd-go" data-fs-close>Nice</button>'}
        </div>
      </div>`;
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-fs-close]')) { close(); return; }
      if (e.target.closest('[data-fs-insights]')) {
        close();
        if (typeof global.showTab === 'function') global.showTab('progressTab');
      }
    });
    document.body.appendChild(overlay);
  }

  /* ── When a workout ends ────────────────────────────────── */

  function build(date, durationMin) {
    const u = user();
    if (!u || !H() || global.coachLoggingClient) return null;
    const workout = readJSON(`workouts_${u}`).find(w => w && w.date === date)
      || fullHistory(u).find(w => w && String(w.date || '').slice(0, 10) === date && !w.imported);
    if (!workout) return null;
    const history = fullHistory(u);
    const days = H().sessionDays(history);
    const early = H().earlySessionNumber(days.own, date);
    if (!early.show) return null;
    const state = global.Habit ? global.Habit.load(u) : {};
    if (state.cardsShown && state.cardsShown[date]) return null;

    const summary = H().summarizeSession(workout, global.getMuscleGroup);
    if (!summary.sets) return null;
    const before = previousBests(history, date);
    const ups = new Set(summary.exercises.filter(x => before.has(x.name.toLowerCase()) && x.e1rm > before.get(x.name.toLowerCase())).map(x => x.name.toLowerCase()));
    const next = nextTimeLines(summary, u);

    if (global.Habit) {
      global.Habit.update(s => {
        s.cardsShown = Object.assign({}, s.cardsShown, { [date]: early.n });
        if (next[0]) s.nextHint = `${next[0].name} ${next[0].what}`;
      }, u);
    }
    return { n: early.n, summary, ups, durationMin, next };
  }

  function ratingOpen() {
    return !!document.getElementById('sessionRatingModalOverlay');
  }

  // Wait for the rating sheet (opened right after End) to close first.
  function whenClear(fn, tries = 0) {
    if (tries > 600) return; // give up after ~5 minutes
    if (ratingOpen() || document.querySelector('.mx-sheet-backdrop:not(.fs-backdrop)')) {
      setTimeout(() => whenClear(fn, tries + 1), 500);
      return;
    }
    fn();
  }

  document.addEventListener('tl:workout-finished', e => {
    const d = (e && e.detail) || {};
    if (!d.date) return;
    setTimeout(() => whenClear(() => {
      const data = build(d.date, Number(d.durationMin) || 0);
      if (data) show(data);
    }), 700);
  });

  global.FirstSessionCard = { show, close, build };
})(typeof window !== 'undefined' ? window : globalThis);
