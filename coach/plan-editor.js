/* Coach dashboard master-plan editor (pocketcoach.plan/2).
 *
 * One card per phase: type, length, goal, the program it follows (and from
 * which program week), and nutrition for a training day and a rest day
 * (kcal, protein, carbs, fat). Phases can be added, removed and moved; dates
 * follow from the plan's start Monday. Nothing is sent until Save: the edits
 * become one PATCH { ops, reason } (traininglog-backend src/plan/lifecycle.js),
 * and the reason is required — it goes into the plan's change log.
 *
 *   PlanEditor.mount(container, plan, { programs, onSave(ops, reason) → Promise })
 *   PlanEditor.diffOps(originalPlan, editedState) → ops   (pure, tested)
 *   PlanEditor.suggestCarbs({ kcal, proteinG, fatG }) → g
 */
(function (root) {
  'use strict';

  const TYPES = [['cut', 'Cut'], ['maintain', 'Maintain'], ['build', 'Build'], ['deload', 'Deload']];
  const DAY_TYPES = [['trainingDay', 'Training day'], ['restDay', 'Rest day']];
  const MACROS = [['kcal', 'kcal'], ['proteinG', 'Protein g'], ['carbG', 'Carbs g'], ['fatG', 'Fat g']];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function addDays(iso, days) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function fmtDate(iso) {
    return iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }) : '';
  }

  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const day = d => ({ kcal: num(d && d.kcal), proteinG: num(d && d.proteinG), carbG: num(d && d.carbG), fatG: num(d && d.fatG) });
  const sameDay = (a, b) => MACROS.every(([k]) => num(a[k]) === num(b[k]));

  /** kcal from grams (4/4/9), or null when a gram value is missing. */
  function kcalFromGrams(d) {
    if ([d.proteinG, d.carbG, d.fatG].some(v => v == null)) return null;
    return Math.round(d.proteinG * 4 + d.carbG * 4 + d.fatG * 9);
  }

  /** Carbs that fill the kcal left after protein and fat. */
  function suggestCarbs({ kcal, proteinG, fatG }) {
    if ([kcal, proteinG, fatG].some(v => v == null)) return null;
    return Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  }

  // A cut's bodyweight target (endCriteria.any[].kind === 'target'), if any.
  function targetOf(p) {
    return ((p.endCriteria && p.endCriteria.any) || []).find(c => c.kind === 'target') || null;
  }

  /**
   * Target-weight edits as logged path changes, using the phase's index in the
   * saved plan (the server applies these before the ops).
   */
  function diffChanges(plan, edited, reason) {
    const out = [];
    (plan.phases || []).forEach((p, i) => {
      const target = targetOf(p);
      const now = edited.phases.find(x => x.phaseId === p.phaseId);
      if (!target || !now || now.type !== 'cut' || num(now.targetKg) === num(target.value)) return;
      const at = p.endCriteria.any.indexOf(target);
      out.push({ path: 'phases[' + i + '].endCriteria.any[' + at + '].value', value: num(now.targetKg), reason });
    });
    return out;
  }

  /** Editable state from a plan (upgraded /1 or /2). */
  function stateFrom(plan) {
    const phases = (plan.phases || []).map(p => ({
      phaseId: p.phaseId,
      isNew: false,
      type: p.type,
      weeks: p.weeks || (p.caps && p.caps.maxWeeks) || 1,
      goalText: p.goalText || '',
      nutrition: { trainingDay: day(p.nutrition && p.nutrition.trainingDay), restDay: day(p.nutrition && p.nutrition.restDay) },
      programRef: p.training && p.training.programRef ? { programId: p.training.programRef.programId, weekOffset: p.training.programRef.weekOffset || 0 } : null,
      targetKg: targetOf(p) ? targetOf(p).value : null,
    }));
    return { startDate: plan.startDate || (plan.phases && plan.phases[0] && plan.phases[0].plannedStart) || '', phases };
  }

  /**
   * Edits → ops, in an order the server can apply one by one: start date,
   * removals, additions (named, appended), moves into place, then per-phase
   * fields, nutrition and program links.
   */
  function diffOps(plan, edited) {
    const base = stateFrom(plan);
    const ops = [];
    if (edited.startDate && edited.startDate !== base.startDate) ops.push({ op: 'setStart', startDate: edited.startDate });

    const keep = new Set(edited.phases.map(p => p.phaseId));
    base.phases.filter(p => !keep.has(p.phaseId)).forEach(p => ops.push({ op: 'removePhase', phaseId: p.phaseId }));
    const order = base.phases.filter(p => keep.has(p.phaseId)).map(p => p.phaseId);
    edited.phases.filter(p => p.isNew).forEach(p => {
      ops.push({ op: 'addPhase', phaseId: p.phaseId, type: p.type, weeks: p.weeks, goalText: p.goalText });
      order.push(p.phaseId);
    });
    edited.phases.forEach((p, i) => {
      if (order[i] === p.phaseId) return;
      ops.push({ op: 'movePhase', phaseId: p.phaseId, toIndex: i });
      order.splice(order.indexOf(p.phaseId), 1);
      order.splice(i, 0, p.phaseId);
    });

    const byId = new Map(base.phases.map(p => [p.phaseId, p]));
    edited.phases.forEach(p => {
      const was = p.isNew ? null : byId.get(p.phaseId);
      if (was) {
        const change = {};
        if (p.type !== was.type) change.type = p.type;
        if (Number(p.weeks) !== Number(was.weeks)) change.weeks = Number(p.weeks);
        if ((p.goalText || '') !== (was.goalText || '')) change.goalText = p.goalText || '';
        if (Object.keys(change).length) ops.push(Object.assign({ op: 'setPhase', phaseId: p.phaseId }, change));
      }
      DAY_TYPES.forEach(([dt]) => {
        const now = day(p.nutrition[dt]);
        // A new phase starts as a copy of the one before it on the server: always say what it should be.
        if (!was || !sameDay(now, was.nutrition[dt])) ops.push(Object.assign({ op: 'setNutrition', phaseId: p.phaseId, dayType: dt }, now));
      });
      const ref = p.programRef && p.programRef.programId ? p.programRef : null;
      const wasRef = was ? was.programRef : undefined;
      const changed = !was || JSON.stringify(ref ? [ref.programId, Number(ref.weekOffset) || 0] : null) !== JSON.stringify(wasRef ? [wasRef.programId, wasRef.weekOffset || 0] : null);
      if (changed && (ref || was)) ops.push(ref ? { op: 'linkProgram', phaseId: p.phaseId, programId: ref.programId, weekOffset: Number(ref.weekOffset) || 0 } : { op: 'linkProgram', phaseId: p.phaseId, programId: null });
      if (!was && !ref) ops.push({ op: 'linkProgram', phaseId: p.phaseId, programId: null });
    });
    return ops;
  }

  function programWeeks(program) {
    const M = root.ProgramModel;
    if (!program || !M) return 0;
    const p = M.readProgram(program);
    return p ? M.stats(p).weekCount : 0;
  }

  /** Warnings for one phase: missing nutrition, kcal ≠ grams, program too short. */
  function phaseWarnings(p, programs) {
    const out = [];
    DAY_TYPES.forEach(([dt, label]) => {
      const d = p.nutrition[dt];
      if (MACROS.some(([k]) => d[k] == null)) out.push(label + ': fill in kcal, protein, carbs and fat before publishing.');
      else {
        const fromGrams = kcalFromGrams(d);
        if (Math.abs(fromGrams - d.kcal) / d.kcal > 0.03) out.push(label + ': the grams add up to ' + fromGrams + ' kcal, not ' + d.kcal + '.');
      }
    });
    if (p.programRef && p.programRef.programId) {
      const prog = (programs || []).find(x => x.id === p.programRef.programId);
      const n = programWeeks(prog);
      const needs = (Number(p.programRef.weekOffset) || 0) + Number(p.weeks);
      if (!prog) out.push('The linked program is no longer in your library.');
      else if (n && needs > n) out.push(prog.name + ' has ' + n + ' week' + (n === 1 ? '' : 's') + '; this phase runs to program week ' + needs + '. Until you add weeks, week ' + n + ' repeats.');
    }
    return out;
  }

  function mount(container, plan, opts) {
    const o = opts || {};
    const editable = plan.status === 'draft' || plan.status === 'approved';
    let state = stateFrom(plan);
    let counter = 0;
    let saving = false;
    let message = '';

    function dates() {
      let week = 1;
      return state.phases.map(p => {
        const start = state.startDate ? addDays(state.startDate, (week - 1) * 7) : '';
        const out = { from: week, to: week + Number(p.weeks) - 1, start, end: start ? addDays(start, Number(p.weeks) * 7 - 1) : '' };
        week += Number(p.weeks) || 0;
        return out;
      });
    }

    function programOptions(selected) {
      return '<option value="">No program</option>' + (o.programs || []).map(pr =>
        '<option value="' + esc(pr.id) + '"' + (pr.id === selected ? ' selected' : '') + '>' + esc(pr.name) + ' (' + programWeeks(pr) + ' wk)</option>').join('');
    }

    function nutritionTable(p, i) {
      const head = '<tr><th></th>' + MACROS.map(([, l]) => '<th>' + esc(l) + '</th>').join('') + '<th>From grams</th><th></th></tr>';
      const rows = DAY_TYPES.map(([dt, label]) => {
        const d = p.nutrition[dt];
        const g = kcalFromGrams(d);
        return '<tr><th scope="row">' + label + '</th>'
          + MACROS.map(([k]) => '<td><input class="pb-in pb-in--num pe-macro" type="number" inputmode="numeric" data-i="' + i + '" data-dt="' + dt + '" data-k="' + k + '" value="' + esc(d[k] == null ? '' : d[k]) + '"' + (editable ? '' : ' disabled') + ' aria-label="' + esc(label + ' ' + k) + '"></td>').join('')
          + '<td class="pe-derived">' + (g == null ? '—' : g + ' kcal') + '</td>'
          + '<td>' + (editable ? '<button type="button" class="pb-link" data-act="carbs" data-i="' + i + '" data-dt="' + dt + '" title="Carbs fill the kcal left after protein and fat">Suggest carbs</button>'
            + (dt === 'restDay' ? '<button type="button" class="pb-link pe-copy" data-act="same" data-i="' + i + '">Copy training day</button>' : '') : '') + '</td></tr>';
      }).join('');
      return '<table class="pe-nutrition">' + head + rows + '</table>';
    }

    function render() {
      const ds = dates();
      const total = ds.length ? ds[ds.length - 1].to : 0;
      const ops = editable ? diffOps(plan, state).concat(diffChanges(plan, state, '')) : [];
      const phases = state.phases.map((p, i) => {
        const w = phaseWarnings(p, o.programs);
        const ref = p.programRef || { programId: '', weekOffset: 0 };
        return '<section class="pe-phase pp-phase--' + esc(p.type) + '" data-i="' + i + '">'
          + '<header class="pe-head">'
          + (editable ? '<span class="pe-move"><button type="button" class="pb-icon" data-act="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">↑</button><button type="button" class="pb-icon" data-act="down" data-i="' + i + '"' + (i === state.phases.length - 1 ? ' disabled' : '') + ' aria-label="Move down">↓</button></span>' : '')
          + '<select class="pb-in pe-type" data-i="' + i + '" data-f="type"' + (editable ? '' : ' disabled') + ' aria-label="Phase type">' + TYPES.map(([v, l]) => '<option value="' + v + '"' + (v === p.type ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'
          + '<label class="pe-weeks"><input class="pb-in pb-in--num" type="number" min="1" max="52" data-i="' + i + '" data-f="weeks" value="' + esc(p.weeks) + '"' + (editable ? '' : ' disabled') + ' aria-label="Weeks"> wk</label>'
          + '<span class="pe-dates">Weeks ' + ds[i].from + '–' + ds[i].to + (ds[i].start ? ' · ' + esc(fmtDate(ds[i].start)) + ' – ' + esc(fmtDate(ds[i].end)) : '') + '</span>'
          + '<input class="pb-in pe-goal" data-i="' + i + '" data-f="goalText" value="' + esc(p.goalText) + '" placeholder="Goal for this phase" maxlength="300"' + (editable ? '' : ' disabled') + ' aria-label="Goal">'
          + (editable && state.phases.length > 1 ? '<button type="button" class="pb-icon" data-act="remove" data-i="' + i + '" aria-label="Remove phase">✕</button>' : '')
          + '</header>'
          + '<div class="pe-program"><label>Program <select class="pb-in" data-i="' + i + '" data-f="programId"' + (editable ? '' : ' disabled') + '>' + programOptions(ref.programId) + '</select></label>'
          + (ref.programId ? '<label>starting at program week <input class="pb-in pb-in--num" type="number" min="1" max="52" data-i="' + i + '" data-f="startProgramWeek" value="' + (Number(ref.weekOffset || 0) + 1) + '"' + (editable ? '' : ' disabled') + '></label>' : '')
          + (p.type === 'cut' && !p.isNew && targetOf((plan.phases || []).find(x => x.phaseId === p.phaseId) || {})
            ? '<label>Ends early at <input class="pb-in pb-in--num" type="number" step="0.1" min="30" max="250" data-i="' + i + '" data-f="targetKg" value="' + esc(p.targetKg == null ? '' : p.targetKg) + '"' + (editable ? '' : ' disabled') + '> kg (7-day average)</label>'
            : '')
          + '</div>'
          + nutritionTable(p, i)
          + (w.length ? '<ul class="pe-warn">' + w.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
          + '</section>';
      }).join('');

      container.innerHTML = '<div class="pe">'
        + '<div class="pe-top"><label class="mp-field"><span class="mp-field-label">Plan starts (Monday)</span><input type="date" class="mp-input" data-f="startDate" value="' + esc(state.startDate) + '"' + (editable ? '' : ' disabled') + '></label>'
        + '<span class="pb-stats">' + state.phases.length + ' phase' + (state.phases.length === 1 ? '' : 's') + ' · ' + total + ' weeks</span></div>'
        + phases
        + (editable
          ? '<div class="pe-add"><select class="pb-in" data-new="type">' + TYPES.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('') + '</select>'
            + '<input class="pb-in pb-in--num" type="number" min="1" max="52" value="4" data-new="weeks" aria-label="Weeks"> wk '
            + '<button type="button" class="pb-link" data-act="add">+ Add phase</button></div>'
            + '<div class="pe-save"><label class="mp-field mp-field--wide"><span class="mp-field-label">Reason (required, kept in the change log)</span>'
            + '<input class="mp-input mp-input--text" data-f="reason" placeholder="Why — e.g. agreed at intake call" maxlength="500" value="' + esc(state.reason || '') + '"></label>'
            + '<div class="mp-adjust-actions"><button type="button" class="mp-btn" data-act="save"' + (saving || !ops.length ? ' disabled' : '') + '>' + (saving ? 'Saving…' : 'Save changes') + '</button>'
            + '<button type="button" class="pb-link" data-act="reset"' + (ops.length ? '' : ' disabled') + '>Undo edits</button>'
            + '<span class="mp-adjust-count">' + (ops.length ? ops.length + ' change' + (ops.length === 1 ? '' : 's') + ' to save' : 'No changes yet') + '</span>'
            + '<span class="pb-msg" role="status">' + esc(message) + '</span></div></div>'
          : '<p class="ws-empty-note">This version is ' + esc(plan.status) + '. Make a new version to change it.</p>')
        + '</div>';
    }

    // Field edits that change only numbers: update counts and warnings without losing focus.
    function softRefresh() {
      const keep = document.activeElement && container.contains(document.activeElement) ? document.activeElement : null;
      const sel = keep ? { i: keep.dataset.i, dt: keep.dataset.dt, k: keep.dataset.k, f: keep.dataset.f, pos: keep.selectionStart } : null;
      render();
      if (sel) {
        const q = sel.k ? '[data-i="' + sel.i + '"][data-dt="' + sel.dt + '"][data-k="' + sel.k + '"]' : (sel.i !== undefined ? '[data-i="' + sel.i + '"][data-f="' + sel.f + '"]' : '[data-f="' + sel.f + '"]');
        const el = container.querySelector(q);
        if (el) { el.focus(); try { if (sel.pos != null) el.setSelectionRange(sel.pos, sel.pos); } catch (_e) { /* number inputs */ } }
      }
    }

    container.addEventListener('change', ev => {
      const t = ev.target;
      const i = Number(t.dataset.i);
      const p = state.phases[i];
      if (t.dataset.f === 'startDate') state.startDate = t.value;
      else if (p && t.dataset.f === 'type') p.type = t.value;
      else if (p && t.dataset.f === 'weeks') p.weeks = Math.max(1, Math.min(52, Math.round(Number(t.value) || 1)));
      else if (p && t.dataset.f === 'programId') p.programRef = t.value ? { programId: t.value, weekOffset: (p.programRef && p.programRef.weekOffset) || 0 } : null;
      else if (p && t.dataset.f === 'startProgramWeek' && p.programRef) p.programRef.weekOffset = Math.max(0, Math.round(Number(t.value) || 1) - 1);
      else if (p && t.dataset.f === 'targetKg') p.targetKg = num(t.value);
      else return;
      render();
    });

    container.addEventListener('input', ev => {
      const t = ev.target;
      if (t.dataset.f === 'reason') { state.reason = t.value; return; }
      const p = state.phases[Number(t.dataset.i)];
      if (!p) return;
      if (t.dataset.k) { p.nutrition[t.dataset.dt][t.dataset.k] = num(t.value); softRefresh(); }
      else if (t.dataset.f === 'goalText') { p.goalText = t.value; softRefresh(); }
    });

    container.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b || !container.contains(b) || b.disabled) return;
      const i = Number(b.dataset.i);
      const act = b.dataset.act;
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        const [p] = state.phases.splice(i, 1);
        state.phases.splice(j, 0, p);
      } else if (act === 'remove') {
        if (!root.confirm('Remove this ' + state.phases[i].type + ' phase?')) return;
        state.phases.splice(i, 1);
      } else if (act === 'add') {
        const type = container.querySelector('[data-new="type"]').value;
        const weeks = Math.max(1, Math.min(52, Math.round(Number(container.querySelector('[data-new="weeks"]').value) || 1)));
        const prev = state.phases[state.phases.length - 1];
        counter += 1;
        state.phases.push({
          phaseId: 'ph_n' + Date.now().toString(36) + counter,
          isNew: true, type, weeks, goalText: '',
          nutrition: prev ? JSON.parse(JSON.stringify(prev.nutrition)) : { trainingDay: day(), restDay: day() },
          programRef: prev && prev.programRef ? { programId: prev.programRef.programId, weekOffset: (prev.programRef.weekOffset || 0) + Number(prev.weeks) } : null,
        });
      } else if (act === 'carbs') {
        const d = state.phases[i].nutrition[b.dataset.dt];
        const c = suggestCarbs(d);
        if (c == null) { message = 'Fill in kcal, protein and fat first.'; render(); return; }
        d.carbG = c;
      } else if (act === 'same') {
        state.phases[i].nutrition.restDay = Object.assign({}, state.phases[i].nutrition.trainingDay);
      } else if (act === 'reset') {
        state = stateFrom(plan);
        message = '';
      } else if (act === 'save') {
        const reason = (state.reason || '').trim();
        if (!reason) { message = 'Give a reason first; it is kept in the plan’s change log.'; render(); container.querySelector('[data-f="reason"]').focus(); return; }
        const ops = diffOps(plan, state);
        const changes = diffChanges(plan, state, reason);
        if (!ops.length && !changes.length) return;
        saving = true; message = ''; render();
        try {
          await o.onSave({ ops, changes }, reason);
          return; // the caller re-mounts with the saved plan
        } catch (err) {
          message = (err && err.message) || 'Could not save.';
        }
        saving = false;
      }
      render();
    });

    render();
    return { state: () => state };
  }

  root.PlanEditor = { mount, diffOps, diffChanges, stateFrom, suggestCarbs, kcalFromGrams, phaseWarnings };
})(typeof window !== 'undefined' ? window : globalThis);
