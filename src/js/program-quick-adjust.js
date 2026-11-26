/* Program quick adjust — the phone UI.
 *
 * One small panel instead of a desktop builder: pick an action (add sets,
 * remove sets, weekly volume for a muscle), a target and a number, see what
 * will change, tap Apply. Undo puts the program back as it was.
 *
 *   ProgramQuickAdjust.render(host, {
 *     getRows: () => rows,            // ProgramQuickAdjustCore row list
 *     apply: async (plan, action) => {}, // write the plan into the program and save it
 *     undo: async () => {},           // put back what the last apply replaced
 *   })
 *
 * The planning itself is program-quick-adjust-core.js. Used by the Program
 * tab (ProgramTabV2.js) and the coach's Programs tab (coaching-enhanced.js)
 * on phones — see isPhone().
 */
(function () {
  'use strict';

  const Q = () => window.ProgramQuickAdjustCore;

  // The native app, or a browser window too narrow for the full builders.
  function isPhone() {
    const cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return true;
    return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
  }

  function muscleOf(name) {
    return typeof window.getMuscleGroup === 'function' ? window.getMuscleGroup(name) : 'other';
  }

  function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function ico(k) {
    return '<span class="ui-icon" aria-hidden="true">' + ((typeof ICONS !== 'undefined' && ICONS[k]) || '') + '</span>';
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  const MODES = [
    { id: 'add', label: 'Add sets' },
    { id: 'remove', label: 'Remove sets' },
    { id: 'volume', label: 'Weekly volume' },
  ];

  function render(host, opts) {
    if (!host || !Q()) return;
    const state = host.__pqa || (host.__pqa = { mode: 'add', exercise: '', muscle: '', dir: 1, n: 2, undo: '' , busy: false });

    function action() {
      return state.mode === 'volume'
        ? { mode: 'volume', muscle: state.muscle, n: state.dir * state.n }
        : { mode: state.mode, exercise: state.exercise, n: state.n };
    }
    function plan(rows) { return Q().plan(rows, action(), muscleOf); }

    function draw() {
      const rows = opts.getRows() || [];
      const exercises = Q().exercises(rows);
      const volume = Q().weeklyVolume(rows, muscleOf).filter(v => v.muscle !== 'other');

      if (!exercises.length) {
        host.innerHTML = `<section class="pod mx-pod pqa"><div class="mx-empty">This program has no exercises yet.</div></section>`;
        return;
      }
      if (!exercises.some(e => e.name.toLowerCase() === state.exercise.toLowerCase())) state.exercise = exercises[0].name;
      if (!volume.some(v => v.muscle === state.muscle)) state.muscle = volume.length ? volume[0].muscle : '';
      if (state.mode === 'volume' && !volume.length) state.mode = 'add';

      const p = plan(rows);
      const verb = state.mode === 'volume'
        ? (state.dir > 0 ? 'Add ' : 'Remove ') + plural(state.n, 'set') + ' of ' + Q().muscleLabel(state.muscle).toLowerCase() + ' a week'
        : (state.mode === 'add' ? 'Add ' : 'Remove ') + plural(state.n, 'set') + (state.mode === 'add' ? ' to ' : ' from ') + state.exercise;

      const target = state.mode === 'volume'
        ? `<div class="mx-field">
             <span class="mx-lbl">Weekly sets for</span>
             <div class="mx-segs pqa-dir" role="group" aria-label="More or less">
               <button type="button" data-dir="1" class="${state.dir > 0 ? 'active' : ''}" aria-pressed="${state.dir > 0}">More</button>
               <button type="button" data-dir="-1" class="${state.dir < 0 ? 'active' : ''}" aria-pressed="${state.dir < 0}">Less</button>
             </div>
             <div class="mx-well"><select class="pqa-muscle" aria-label="Muscle">
               ${volume.map(v => `<option value="${esc(v.muscle)}"${v.muscle === state.muscle ? ' selected' : ''}>${esc(v.label)} · ${v.sets} sets/week</option>`).join('')}
             </select></div>
           </div>`
        : `<div class="mx-field">
             <label class="mx-lbl" for="pqaExercise">Exercise</label>
             <div class="mx-well"><select id="pqaExercise" class="pqa-exercise">
               ${exercises.map(e => `<option value="${esc(e.name)}"${e.name.toLowerCase() === state.exercise.toLowerCase() ? ' selected' : ''}>${esc(e.name)} · ${e.weeklySets} sets/week${e.sessions > 1 ? ' (' + e.sessions + ' days)' : ''}</option>`).join('')}
             </select></div>
           </div>`;

      host.innerHTML = `
        <section class="pod mx-pod pqa" aria-label="Quick adjust">
          <div class="pod-row"><h4 class="pod-title mx-h3">Quick adjust</h4></div>
          <div class="mx-segs pqa-modes" role="group" aria-label="What to change">
            ${MODES.filter(m => m.id !== 'volume' || volume.length).map(m => `<button type="button" data-mode="${m.id}" class="${m.id === state.mode ? 'active' : ''}" aria-pressed="${m.id === state.mode}">${m.label}</button>`).join('')}
          </div>
          ${target}
          <div class="mx-field">
            <span class="mx-lbl">${state.mode === 'volume' ? 'Sets a week' : 'Sets per session'}</span>
            <div class="mx-presets pqa-n" role="group" aria-label="How many sets">
              ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="mx-preset${n === state.n ? ' active' : ''}" data-n="${n}" aria-pressed="${n === state.n}">${n}</button>`).join('')}
            </div>
          </div>
          <p class="pqa-preview${p.changes.length ? '' : ' is-empty'}" aria-live="polite">${esc(Q().describe(p)).replace(/\n/g, '<br>')}</p>
          <button type="button" class="mx-cta pqa-apply"${p.changes.length && !state.busy ? '' : ' disabled'}><span>${esc(verb)}</span><span class="mx-cta-icon">${ico('check')}</span></button>
          ${state.undo ? `<div class="pqa-undo"><span>${esc(state.undo)}</span><button type="button" class="mx-outline pqa-undo-btn">Undo</button></div>` : ''}
        </section>
        ${volume.length ? `
        <section class="pod mx-pod pqa-volume" aria-label="Weekly sets per muscle">
          <div class="pod-row"><h4 class="pod-title mx-h3">Sets per week</h4></div>
          <div class="pqa-chips">
            ${volume.map(v => `<button type="button" class="pqa-chip" data-muscle="${esc(v.muscle)}"><span>${esc(v.label)}</span><strong>${v.sets}</strong></button>`).join('')}
          </div>
        </section>` : ''}`;
    }

    host.onclick = async e => {
      const t = e.target.closest('button');
      if (!t || state.busy) return;
      if (t.dataset.mode) { state.mode = t.dataset.mode; return draw(); }
      if (t.dataset.dir) { state.dir = Number(t.dataset.dir); return draw(); }
      if (t.dataset.n) { state.n = Number(t.dataset.n); return draw(); }
      if (t.dataset.muscle) { state.mode = 'volume'; state.muscle = t.dataset.muscle; draw(); host.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (t.classList.contains('pqa-apply')) {
        const p = plan(opts.getRows() || []);
        if (!p.changes.length) return;
        state.busy = true; draw();
        try {
          await opts.apply(p, action());
          const n = Math.abs(p.delta);
          state.undo = (p.delta > 0 ? 'Added ' : 'Removed ') + plural(n, 'set') + ' a week.';
        } catch (err) {
          if (window.showToast) window.showToast((err && err.message) || 'Could not save that change.', 'error');
        }
        state.busy = false; draw();
        return;
      }
      if (t.classList.contains('pqa-undo-btn')) {
        state.busy = true; draw();
        try { await opts.undo(); state.undo = ''; } catch (err) {
          if (window.showToast) window.showToast((err && err.message) || 'Could not undo.', 'error');
        }
        state.busy = false; draw();
      }
    };
    host.onchange = e => {
      if (e.target.matches('.pqa-exercise')) { state.exercise = e.target.value; draw(); }
      if (e.target.matches('.pqa-muscle')) { state.muscle = e.target.value; draw(); }
    };

    // Switching programs drops the Undo for the previous one.
    if (opts.resetUndo) state.undo = '';
    draw();
  }

  window.ProgramQuickAdjust = { render, isPhone, muscleOf };
})();
