/* Coach dashboard program builder (pocketcoach.program/2).
 *
 * Week tabs, day cards with a weekday and label, and one row per exercise
 * with real fields: type, sets, rep range, target RIR, last-set RIR, rest,
 * notes. "Copy week → next" carries a week forward so the RIR can be
 * changed per week. The quick-entry line under each day ("Squat 4x6-8 @2
 * 2-3min") fills a new row's fields; it uses the same parser as the file
 * import (src/js/program-model.js).
 *
 *   ProgramBuilder.mount(container, program | null, { onSave(v2) → Promise, onCancel,
 *     single?, workouts?() → [workout], onSaveWorkout?(day) → Promise<message> })
 *
 * `single` edits one session (a library workout): no week bar, no weekday,
 * no adding or removing days. `workouts` lists the coach's saved workouts
 * for "Insert workout" under a day; `onSaveWorkout` adds "Save as workout".
 *
 * The program in the builder is always "expanded" (weeks that were sameAs
 * hold their own copy) so any week can be edited; it is saved that way.
 * Text inputs update the state in place; structural changes re-render.
 *
 * Long-term programs: weeks are grouped into mesocycles (blocks) with a
 * name and goal, and any week can be a deload. "+ Mesocycle" appends a block
 * of weeks; "Progression" fills a block from its first week (RIR from → to,
 * sets and load per week, deload last week). The Sheet view shows a block
 * (or every week) as one grid like a spreadsheet: a row per exercise, a
 * column per week, each cell "4×6-8 @2 75%" editable in place. "Export CSV"
 * writes the Week | Day | Exercise | … sheet the import reads back.
 *
 * Volume: each row counts toward a muscle (exerciseMuscleMap.js's
 * getMuscleGroup, or the row's Muscle column). The Volume view holds the
 * program's MEV / MAV / MRV per muscle and colours each week's sets by zone;
 * Progression can ramp each muscle from one landmark to another. */
(function (root) {
  'use strict';

  const M = root.ProgramModel;
  const WEEKDAY_OPTIONS = [['', '—']].concat(M.WEEKDAYS.map((d, i) => [String(i + 1), d]));
  const TYPE_OPTIONS = [['', 'Type'], ['compound', 'Compound'], ['isolation', 'Isolation'], ['core', 'Core']];
  const ZONE_TEXT = { below: 'below MEV', productive: 'MEV–MAV', high: 'MAV–MRV', over: 'over MRV' };
  const LANDMARK_LABEL = { mev: 'MEV', mav: 'MAV', mrv: 'MRV' };

  function muscleLabel(m) {
    return m === 'other' ? 'Other' : m.charAt(0).toUpperCase() + m.slice(1);
  }

  /** The muscle a row counts toward: its own pick, else the exercise-name lookup. */
  function muscleOf(e) {
    if (e && M.MUSCLES.includes(e.muscle)) return e.muscle;
    const m = typeof root.getMuscleGroup === 'function' && e && e.name ? root.getMuscleGroup(e.name) : 'other';
    return M.MUSCLES.includes(m) ? m : 'other';
  }

  function autoMuscle(e) {
    return muscleOf(Object.assign({}, e, { muscle: null }));
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function options(list, selected) {
    return list.map(([v, label]) => '<option value="' + esc(v) + '"' + (String(selected == null ? '' : selected) === v ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
  }

  /** Any program shape → v2 with every week holding its own days. */
  function expand(program) {
    const p = M.readProgram(program) || M.readProgram({ schema: M.SCHEMA, name: 'New program', weeks: [{ days: [] }] });
    p.weeks = p.weeks.map(w => Object.assign({ week: w.week, label: w.label, note: w.note || '' },
      w.block ? { block: w.block } : {}, w.deload ? { deload: true } : {},
      { days: JSON.parse(JSON.stringify(M.weekDays(p, w.week))) }));
    p.blocks = p.blocks || [];
    p.volume = p.volume || {};
    return p;
  }

  function nextBlockId(p) {
    let n = p.blocks.length + 1;
    while (p.blocks.some(b => b.id === 'b' + n)) n++;
    return 'b' + n;
  }

  function loadText(e) {
    return M.formatLoad(e);
  }

  /** Week | Day | Exercise | … rows, the layout the sheet import reads. */
  function toCsv(program) {
    const p = M.readProgram(program);
    if (!p) return '';
    const blockName = id => ((p.blocks || []).find(b => b.id === id) || {}).name || '';
    const cell = v => {
      const t = String(v == null ? '' : v);
      return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const lines = [['Block', 'Week', 'Day', 'Exercise', 'Sets', 'Reps', 'RIR', 'Load', 'Rest', 'Notes']];
    p.weeks.forEach(w => {
      M.weekDays(p, w.week).forEach(d => {
        const day = (d.weekday ? M.WEEKDAYS[d.weekday - 1] + ' - ' : '') + d.label + (d.focus ? ' (' + d.focus + ')' : '');
        d.exercises.forEach(e => {
          lines.push([
            blockName(w.block), 'Week ' + w.week + (w.deload ? ' (deload)' : ''), day, e.name, e.sets,
            e.repsMin === null ? '' : e.repsMin + (e.repsMax ? '-' + e.repsMax : ''),
            e.rir === null ? '' : e.rir + (e.lastSetRir !== null ? ' (last set ' + e.lastSetRir + ')' : ''),
            loadText(e), e.restSec === null ? '' : M.formatRest(e.restSec, e.restSecMax), e.notes,
          ]);
        });
      });
    });
    return lines.map(l => l.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  function renumber(p) {
    p.weeks.forEach((w, i) => {
      const n = i + 1;
      if (/^Week \d+$/.test(w.label) || !w.label) w.label = 'Week ' + n;
      w.week = n;
    });
  }

  function nextDayId(p) {
    let max = 0;
    p.weeks.forEach(w => w.days.forEach(d => { const n = Number(String(d.dayId).replace(/\D/g, '')); if (n > max) max = n; }));
    return 'd' + (max + 1);
  }

  function newRow(week, day, fields) {
    return Object.assign({
      id: 'w' + week + '-' + day.dayId + '-e' + Date.now().toString(36) + Math.floor(Math.random() * 1e4),
      name: '', type: null, sets: 3, repsMin: 10, repsMax: null, rir: null, lastSetRir: null, restSec: null, restSecMax: null, notes: '',
    }, fields || {});
  }

  function restText(e) {
    return e.restSec == null ? '' : M.formatRest(e.restSec, e.restSecMax);
  }

  function mount(container, program, opts) {
    const options_ = opts || {};
    const state = { program: expand(program), week: 1, saving: false, message: '', view: 'week', sheetAll: false, panel: null };
    const single = !!options_.single;
    const savedWorkouts = () => (typeof options_.workouts === 'function' ? options_.workouts() || [] : []);

    function week() { return state.program.weeks[state.week - 1]; }
    function warnings() { return M.validate(M.readProgram(state.program) || state.program); }

    function numberCell(field, value, attrs) {
      return '<input class="pb-in pb-in--num" type="number" inputmode="numeric" data-f="' + field + '" value="' + esc(value == null ? '' : value) + '"' + (attrs || '') + '>';
    }

    function rowHtml(e, di, ei, warnedIds) {
      const warned = warnedIds.has(e.id);
      return '<tr class="pb-row' + (warned ? ' is-warned' : '') + '" data-d="' + di + '" data-e="' + ei + '">'
        + '<td class="pb-name-cell"><input class="pb-in pb-in--name" data-f="name" value="' + esc(e.name) + '" placeholder="Exercise" maxlength="80" aria-label="Exercise">'
        + (root.ExerciseVideos ? root.ExerciseVideos.button(e.name, root.coachExerciseVideos || []) : '') + '</td>'
        + '<td><select class="pb-in" data-f="type" aria-label="Type">' + options(TYPE_OPTIONS, e.type) + '</select></td>'
        + '<td><select class="pb-in pb-in--muscle" data-f="muscle" aria-label="Muscle the sets count toward">'
        + options([['', 'Auto · ' + muscleLabel(autoMuscle(e))]].concat(M.MUSCLES.map(m => [m, muscleLabel(m)])), e.muscle || '') + '</select></td>'
        + '<td>' + numberCell('sets', e.sets, ' min="1" max="20" aria-label="Sets"') + '</td>'
        + '<td class="pb-range">' + numberCell('repsMin', e.repsMin, ' min="1" max="100" aria-label="Reps from"') + '<span>–</span>' + numberCell('repsMax', e.repsMax, ' min="1" max="100" aria-label="Reps to"') + '</td>'
        + '<td>' + numberCell('rir', e.rir, ' min="0" max="10" step="0.5" aria-label="Target RIR"') + '</td>'
        + '<td>' + numberCell('lastSetRir', e.lastSetRir, ' min="0" max="10" step="0.5" placeholder="=" aria-label="Last-set RIR"') + '</td>'
        + '<td><input class="pb-in pb-in--load" data-f="load" value="' + esc(loadText(e)) + '" placeholder="75% / 100kg" aria-label="Load"></td>'
        + '<td><input class="pb-in pb-in--rest" data-f="rest" value="' + esc(restText(e)) + '" placeholder="2-3 min" aria-label="Rest"></td>'
        + '<td><input class="pb-in pb-in--notes" data-f="notes" value="' + esc(e.notes) + '" placeholder="Notes" maxlength="300" aria-label="Notes"></td>'
        + '<td class="pb-row-act">'
        + '<button type="button" class="pb-icon" data-act="up" title="Move up" aria-label="Move up"' + (ei === 0 ? ' disabled' : '') + '>↑</button>'
        + '<button type="button" class="pb-icon" data-act="down" title="Move down" aria-label="Move down">↓</button>'
        + '<button type="button" class="pb-icon" data-act="del-row" title="Remove" aria-label="Remove exercise">✕</button>'
        + '</td></tr>';
    }

    function dayHtml(d, di, warnedIds, dayWarned) {
      return '<section class="pb-day' + (dayWarned.has(d.dayId) ? ' is-warned' : '') + '" data-d="' + di + '">'
        + '<header class="pb-day-head">'
        + (single ? '' : '<select class="pb-in pb-in--weekday" data-f="weekday" aria-label="Weekday">' + options(WEEKDAY_OPTIONS, d.weekday) + '</select>'
          + '<input class="pb-in pb-in--label" data-f="label" value="' + esc(d.label) + '" placeholder="Lower A" maxlength="40" aria-label="Day name">')
        + '<input class="pb-in pb-in--focus" data-f="focus" value="' + esc(d.focus) + '" placeholder="Focus (optional)" maxlength="60" aria-label="Focus">'
        + (!single && options_.onSaveWorkout && d.exercises.length ? '<button type="button" class="pb-link" data-act="save-workout">Save as workout</button>' : '')
        + (single ? '' : '<button type="button" class="pb-link" data-act="del-day">Remove day</button>')
        + '</header>'
        + '<table class="pb-table"><thead><tr><th>Exercise</th><th>Type</th><th title="The muscle these sets count toward for MEV / MAV / MRV">Muscle</th><th>Sets</th><th>Reps</th><th>RIR</th><th title="RIR on the last set; empty = same">Last set</th><th title="% of 1RM or kg">Load</th><th>Rest</th><th>Notes</th><th></th></tr></thead>'
        + '<tbody>' + d.exercises.map((e, ei) => rowHtml(e, di, ei, warnedIds)).join('') + '</tbody></table>'
        + '<input class="pb-in pb-quick" data-quick="' + di + '" placeholder="Quick add: Squat 4x6-8 @2 75% 2-3min — Enter" aria-label="Quick add exercise">'
        + (!single && savedWorkouts().length ? '<select class="pb-in pb-insert" data-insert="' + di + '" aria-label="Insert a saved workout"><option value="">+ Insert a saved workout…</option>'
          + savedWorkouts().map(w => '<option value="' + esc(w.id) + '">' + esc(w.name) + ' (' + w.exercises.length + ')</option>').join('') + '</select>' : '')
        + '</section>';
    }

    function warnHtml(here, otherWeeks) {
      if (!here.length && !otherWeeks.length) return '';
      return '<div class="pb-warn"><strong>Check before saving</strong><ul>' + here.map(x => '<li>' + esc(x.message) + '</li>').join('')
        + (otherWeeks.length ? '<li>Also warnings in ' + otherWeeks.map(n => 'W' + n).join(', ') + '.</li>' : '') + '</ul></div>';
    }

    // After a row edit: update warnings, highlights and counts without
    // replacing the inputs (a full render would drop keyboard focus).
    function refresh() {
      const list = warnings();
      const here = list.filter(x => x.week === state.week);
      const otherWeeks = Array.from(new Set(list.filter(x => x.week !== state.week).map(x => x.week)));
      const slot = container.querySelector('.pb-warn-slot');
      if (slot) slot.innerHTML = warnHtml(here, otherWeeks);
      const ids = new Set(here.map(x => x.exerciseId).filter(Boolean));
      const days = new Set(here.filter(x => x.dayId && !x.exerciseId).map(x => x.dayId));
      container.querySelectorAll('.pb-day').forEach(sec => {
        const day = week().days[Number(sec.dataset.d)];
        if (!day) return;
        sec.classList.toggle('is-warned', days.has(day.dayId));
        sec.querySelectorAll('.pb-row').forEach(tr => {
          const ex = day.exercises[Number(tr.dataset.e)];
          tr.classList.toggle('is-warned', !!ex && ids.has(ex.id));
        });
      });
      container.querySelectorAll('.pb-tab').forEach(tab => tab.classList.toggle('has-warn', list.some(x => x.week === Number(tab.dataset.week))));
      const s = M.stats(M.readProgram(state.program) || state.program);
      const stats = container.querySelector('.pb-stats');
      if (stats) stats.textContent = statsText(s);
    }

    function statsText(s) {
      if (single) return s.exerciseCount + ' rows';
      return (s.blockCount ? s.blockCount + (s.blockCount === 1 ? ' block · ' : ' blocks · ') : '') + s.weekCount + ' wk · ' + s.dayCount + ' days/wk · ' + s.exerciseCount + ' rows';
    }

    function blockIndex(id) {
      return state.program.blocks.findIndex(b => b.id === id);
    }

    function runs() {
      return M.blockRuns(M.readProgram(state.program) || state.program);
    }

    function currentRun() {
      return runs().find(r => r.from <= state.week && state.week <= r.to);
    }

    // Week tabs grouped by mesocycle.
    function tabsHtml(list) {
      return runs().map(r => {
        const bi = r.block ? blockIndex(r.block.id) : -1;
        const tabs = [];
        for (let n = r.from; n <= r.to; n++) {
          const wk = state.program.weeks[n - 1];
          tabs.push('<button type="button" role="tab" class="pb-tab' + (n === state.week ? ' is-active' : '') + (list.some(x => x.week === n) ? ' has-warn' : '') + (wk.deload ? ' is-deload' : '')
            + '" aria-selected="' + (n === state.week) + '" data-week="' + n + '"' + (wk.deload ? ' title="Deload week"' : '') + '>W' + n + (wk.deload ? '<small>D</small>' : '') + '</button>');
        }
        return '<div class="pb-run' + (r.block ? ' pb-run--b' + (bi % 6) : '') + '">'
          + (r.block ? '<div class="pb-run-head" title="' + esc(r.block.goal) + '">' + esc(r.block.name) + ' <span>W' + r.from + (r.to > r.from ? '–' + r.to : '') + '</span></div>' : (state.program.blocks.length ? '<div class="pb-run-head pb-run-head--none">No block</div>' : ''))
          + '<div class="pb-run-tabs">' + tabs.join('') + '</div></div>';
      }).join('');
    }

    // Label, block, deload and note of the open week; name and goal of its block.
    function weekMetaHtml() {
      const w = week();
      const blk = w.block ? state.program.blocks.find(b => b.id === w.block) : null;
      return '<div class="pb-weekmeta">'
        + '<label class="pb-meta"><span>Week name</span><input class="pb-in" data-wf="label" value="' + esc(w.label) + '" maxlength="40"></label>'
        + '<label class="pb-meta"><span>Mesocycle</span><select class="pb-in" data-wf="block"><option value="">No block</option>'
        + state.program.blocks.map(b => '<option value="' + esc(b.id) + '"' + (b.id === w.block ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select></label>'
        + '<label class="pb-meta pb-meta--check"><input type="checkbox" data-wf="deload"' + (w.deload ? ' checked' : '') + '><span>Deload week</span></label>'
        + '<label class="pb-meta pb-meta--grow"><span>Week note (the client sees it)</span><input class="pb-in" data-wf="note" value="' + esc(w.note) + '" maxlength="300" placeholder="e.g. Push the last set of each lift"></label>'
        + (blk ? '<label class="pb-meta"><span>Block name</span><input class="pb-in" data-bf="name" value="' + esc(blk.name) + '" maxlength="40"></label>'
          + '<label class="pb-meta pb-meta--grow"><span>Block goal</span><input class="pb-in" data-bf="goal" value="' + esc(blk.goal) + '" maxlength="200" placeholder="e.g. Volume: 10 → 16 sets for quads"></label>'
          + '<button type="button" class="pb-link pb-link--danger" data-act="del-block" title="The weeks stay; they just leave the block">Remove block</button>' : '')
        + '</div>';
    }

    function numField(key, label, value, attrs) {
      return '<label class="pb-meta"><span>' + label + '</span><input class="pb-in pb-in--num" type="number" data-pp="' + key + '" value="' + esc(value == null ? '' : value) + '"' + (attrs || '') + '></label>';
    }

    function panelHtml() {
      const pn = state.panel;
      if (!pn) return '';
      if (pn.kind === 'meso') {
        return '<div class="pb-panel" data-panel="meso"><div class="pb-panel-title">New mesocycle</div>'
          + '<div class="pb-panel-grid">'
          + '<label class="pb-meta pb-meta--grow"><span>Name</span><input class="pb-in" data-pp="name" value="' + esc(pn.name) + '" maxlength="40" placeholder="Accumulation"></label>'
          + numField('weeks', 'Weeks', pn.weeks, ' min="1" max="16"')
          + '<label class="pb-meta"><span>Start from</span><select class="pb-in" data-pp="from"><option value="copy"' + (pn.from === 'copy' ? ' selected' : '') + '>Copy of W' + state.week + '</option><option value="empty"' + (pn.from === 'empty' ? ' selected' : '') + '>Empty weeks</option></select></label>'
          + '<label class="pb-meta pb-meta--check"><input type="checkbox" data-pp="deloadLast"' + (pn.deloadLast ? ' checked' : '') + '><span>Last week is a deload</span></label>'
          + '<label class="pb-meta pb-meta--wide"><span>Goal</span><input class="pb-in" data-pp="goal" value="' + esc(pn.goal) + '" maxlength="200" placeholder="e.g. Build volume, RIR 3 → 1"></label>'
          + '</div>'
          + '<p class="pb-panel-note">' + (mesoReusesFirst(pn)
            ? 'W1' + ((pn.weeks || 0) > 1 ? '–W' + Math.min(16, pn.weeks) : '') + ' become this block'
            : 'Adds ' + (pn.weeks || 0) + ' weeks after W' + state.program.weeks.length + (state.program.weeks.length + (pn.weeks || 0) > M.LIMITS.weeks ? ' (only up to ' + M.LIMITS.weeks + ' weeks fit)' : ''))
          + '. Set the progression across them next.</p>'
          + '<div class="pb-panel-acts"><button type="button" class="mp-btn" data-act="meso-create">Add mesocycle</button><button type="button" class="pb-link" data-act="panel-close">Cancel</button></div></div>';
      }
      const deloadOk = pn.to > pn.from;
      return '<div class="pb-panel" data-panel="progress"><div class="pb-panel-title">Progression · W' + pn.from + ' → W' + pn.to + '</div>'
        + '<p class="pb-panel-note">Rebuilds W' + (pn.from + 1) + '–W' + pn.to + ' from W' + pn.from + ' (exercises, reps, rest and notes as in W' + pn.from + '). Edit single weeks afterwards as you like.</p>'
        + '<div class="pb-panel-grid">'
        + numField('from', 'From week', pn.from, ' min="1" max="' + state.program.weeks.length + '"')
        + numField('to', 'To week', pn.to, ' min="1" max="' + state.program.weeks.length + '"')
        + numField('rirStart', 'RIR first wk', pn.rirStart, ' min="0" max="10" step="0.5" placeholder="keep"')
        + numField('rirEnd', 'RIR last wk', pn.rirEnd, ' min="0" max="10" step="0.5" placeholder="keep"')
        + '<label class="pb-meta"><span>Sets</span><select class="pb-in" data-pp="volume">'
        + options([['', '+ sets / wk (below)'], ['mev-mav', 'MEV → MAV'], ['mev-mrv', 'MEV → MRV'], ['mav-mrv', 'MAV → MRV']], pn.volume || '') + '</select></label>'
        + (pn.volume ? '' : numField('setsPerWeek', '+ sets / wk', pn.setsPerWeek, ' min="-5" max="5"'))
        + numField('setsMax', 'Max sets / exercise', pn.setsMax, ' min="1" max="20"')
        + numField('repsPerWeek', '± reps / wk', pn.repsPerWeek, ' min="-10" max="10" title="Moves each rep range, e.g. -1: 10-12 → 9-11 → 8-10"')
        + numField('pctPerWeek', '+ %1RM / wk', pn.pctPerWeek, ' min="-20" max="20" step="0.5"')
        + numField('kgPerWeek', '+ kg / wk', pn.kgPerWeek, ' min="-50" max="50" step="0.25"')
        + '<label class="pb-meta pb-meta--check"><input type="checkbox" data-pp="deloadLast"' + (pn.deloadLast && deloadOk ? ' checked' : '') + (deloadOk ? '' : ' disabled') + '><span>Last week is a deload (½ sets, RIR +2, load −10%)</span></label>'
        + '</div>'
        + (pn.volume ? '<p class="pb-panel-note">Each muscle\'s weekly sets go from its ' + pn.volume.split('-').map(k => LANDMARK_LABEL[k]).join(' on W' + pn.from + ' to its ') + ' on the last training week, shared over its exercises (see Volume for the numbers). Rows counted as Other keep their sets.</p>' : '')
        + '<div class="pb-panel-acts"><button type="button" class="mp-btn" data-act="progress-apply"' + (pn.to > pn.from ? '' : ' disabled') + '>Fill W' + (pn.from + 1) + '–W' + pn.to + '</button><button type="button" class="pb-link" data-act="panel-close">Cancel</button></div></div>';
    }

    function progressPanelFor(run) {
      const r = run || currentRun() || { from: state.week, to: state.program.weeks.length, deloads: [] };
      const rows = (week() && M.weekDays(M.readProgram(state.program) || state.program, r.from)) || [];
      const firstRir = rows.reduce((v, d) => (v !== null ? v : (d.exercises.find(e => e.rir !== null) || {}).rir ?? null), null);
      return {
        kind: 'progress', from: r.from, to: r.to,
        rirStart: firstRir !== null ? firstRir : 3, rirEnd: firstRir !== null ? Math.max(0, firstRir - 2) : 1,
        setsPerWeek: 0, setsMax: 8, repsPerWeek: 0, volume: '', pctPerWeek: 0, kgPerWeek: 0,
        deloadLast: r.deloads.includes(r.to) || r.to - r.from >= 3,
      };
    }

    // Titles and button labels that follow the panel's numbers.
    function updatePanelText() {
      const el = container.querySelector('.pb-panel');
      if (!el) return;
      const fresh = container.ownerDocument.createElement('div');
      fresh.innerHTML = panelHtml();
      ['.pb-panel-title', '.pb-panel-note', '.pb-panel-acts .mp-btn'].forEach(sel => {
        const a = el.querySelector(sel);
        const b = fresh.querySelector(sel);
        if (a && b) { a.innerHTML = b.innerHTML; if ('disabled' in a) a.disabled = b.disabled; }
      });
    }

    // ── Volume (MEV / MAV / MRV) ────────────────────────────────────────────
    function lmFor(m) {
      return M.landmarks(state.program, m);
    }

    function setsCell(n, lm) {
      const zone = M.volumeZone(n, lm);
      return '<span class="pb-vz pb-vz--' + (zone || 'none') + '" title="' + esc(zone ? n + ' sets: ' + ZONE_TEXT[zone] : n + ' sets') + '">' + n + '</span>';
    }

    // One line under the week bar: this week's sets per muscle, coloured by zone.
    function weekVolumeHtml() {
      const sets = M.muscleSets(state.program, state.week, muscleOf);
      const list = Object.keys(sets).filter(m => sets[m] > 0).sort((a, b) => (a === 'other') - (b === 'other') || sets[b] - sets[a]);
      if (!list.length) return '';
      return '<div class="pb-volline" data-volline><span class="pb-volline-label">Sets this week</span>'
        + list.map(m => {
          const lm = lmFor(m);
          return '<span class="pb-volchip pb-vz--' + (M.volumeZone(sets[m], lm) || 'none') + '" title="' + esc(lm ? 'MEV ' + lm.mev + ' · MAV ' + lm.mav + ' · MRV ' + lm.mrv : 'No landmarks') + '">'
            + esc(muscleLabel(m)) + ' <strong>' + sets[m] + '</strong>' + (lm ? '<small>/' + lm.mrv + '</small>' : '') + '</span>';
        }).join('')
        + '<button type="button" class="pb-link" data-act="view-volume">Volume…</button></div>';
    }

    function refreshWeekVolume() {
      const el = container.querySelector('[data-volline]');
      if (!el) return;
      const fresh = container.ownerDocument.createElement('div');
      fresh.innerHTML = weekVolumeHtml();
      if (fresh.firstChild) el.replaceWith(fresh.firstChild);
    }

    // Volume view: landmarks per muscle (editable) and each week's sets.
    function volumeHtml() {
      const { from, to } = sheetRange();
      const cols = [];
      for (let n = from; n <= to; n++) cols.push(n);
      const perWeek = cols.map(n => M.muscleSets(state.program, n, muscleOf));
      const used = M.MUSCLES.filter(m => perWeek.some(w => w[m] > 0));
      const other = perWeek.some(w => w.other > 0);
      const custom = Object.keys(state.program.volume || {}).length;
      const head = '<tr><th class="pb-sheet-ex">Muscle</th><th title="Minimum effective volume">MEV</th><th title="Maximum adaptive volume">MAV</th><th title="Maximum recoverable volume">MRV</th>'
        + cols.map(n => '<th class="' + (state.program.weeks[n - 1].deload ? 'is-deload' : '') + '">W' + n + (state.program.weeks[n - 1].deload ? ' · D' : '') + '</th>').join('') + '</tr>';
      const rows = used.map(m => {
        const lm = lmFor(m);
        const own = !!(state.program.volume && state.program.volume[m]);
        return '<tr><td class="pb-sheet-ex">' + esc(muscleLabel(m)) + (own ? ' <small class="pb-own" title="Set for this program">●</small>' : '') + '</td>'
          + ['mev', 'mav', 'mrv'].map(k => '<td><input class="pb-in pb-in--num pb-lm" type="number" min="0" max="60" data-lm="' + m + '" data-lk="' + k + '" value="' + esc(lm ? lm[k] : '') + '" aria-label="' + esc(muscleLabel(m) + ' ' + LANDMARK_LABEL[k]) + '"></td>').join('')
          + perWeek.map((w, i) => '<td data-vcell="' + m + '|' + cols[i] + '">' + setsCell(w[m] || 0, lm) + '</td>').join('') + '</tr>';
      }).join('');
      const otherRow = other ? '<tr><td class="pb-sheet-ex">Other</td><td colspan="3" class="pb-sheet-off">Pick a muscle in the Week view</td>'
        + perWeek.map(w => '<td>' + setsCell(w.other || 0, null) + '</td>').join('') + '</tr>' : '';
      return '<div class="pb-sheet-wrap">'
        + '<p class="pb-panel-note">Hard sets per muscle per week. <strong>MEV</strong> is the least that still grows, <strong>MAV</strong> where most growth happens, <strong>MRV</strong> the most that can be recovered from. '
        + 'The numbers start from common ballparks; change them for this client (the program keeps them).</p>'
        + '<div class="pb-legend"><span class="pb-vz pb-vz--below">below MEV</span><span class="pb-vz pb-vz--productive">MEV–MAV</span><span class="pb-vz pb-vz--high">MAV–MRV</span><span class="pb-vz pb-vz--over">over MRV</span>'
        + (custom ? '<button type="button" class="pb-link" data-act="lm-reset">Reset landmarks to defaults</button>' : '') + '</div>'
        + '<table class="pb-sheet pb-vol"><thead>' + head + '</thead><tbody>'
        + (rows + otherRow || '<tr><td colspan="' + (cols.length + 4) + '">No exercises yet.</td></tr>') + '</tbody></table></div>';
    }

    function refreshVolumeCells() {
      const fresh = container.ownerDocument.createElement('div');
      fresh.innerHTML = volumeHtml();
      container.querySelectorAll('[data-vcell]').forEach(td => {
        const twin = fresh.querySelector('[data-vcell="' + td.dataset.vcell + '"]');
        if (twin) td.innerHTML = twin.innerHTML;
      });
    }

    // A one-week program without a block becomes the block's first week.
    function mesoReusesFirst(pn) {
      const p = state.program;
      return p.weeks.length === 1 && !p.weeks[0].block && (pn.from === 'copy' || !p.weeks[0].days.some(d => d.exercises.length));
    }

    // ── Sheet: the open block (or every week) as one grid ──────────────────
    function sheetRange() {
      const r = currentRun();
      return state.sheetAll || !r ? { from: 1, to: state.program.weeks.length } : r;
    }

    // Rows of one day across weeks, matched by exercise name (the 2nd squat
    // in a day is its own row).
    function sheetRows(dayId, from, to) {
      const keys = [];
      const cells = new Map();
      for (let n = from; n <= to; n++) {
        const d = state.program.weeks[n - 1].days.find(x => x.dayId === dayId);
        if (!d) continue;
        const seen = {};
        d.exercises.forEach((e, i) => {
          const base = e.name.trim().toLowerCase();
          seen[base] = (seen[base] || 0) + 1;
          const key = base + '#' + seen[base];
          if (!cells.has(key)) { cells.set(key, { key, name: e.name, weeks: {} }); keys.push(key); }
          cells.get(key).weeks[n] = i;
        });
      }
      return keys.map(k => cells.get(k));
    }

    function sheetDays(from, to) {
      const out = [];
      for (let n = from; n <= to; n++) {
        state.program.weeks[n - 1].days.forEach(d => { if (!out.some(x => x.dayId === d.dayId)) out.push({ dayId: d.dayId, label: d.label, weekday: d.weekday }); });
      }
      return out.sort((a, b) => (a.weekday || 99) - (b.weekday || 99));
    }

    function sheetHtml() {
      const { from, to } = sheetRange();
      const cols = [];
      for (let n = from; n <= to; n++) cols.push(n);
      const p = state.program;
      const head = '<tr><th class="pb-sheet-ex">Exercise</th>' + cols.map(n => '<th class="' + (p.weeks[n - 1].deload ? 'is-deload' : '') + '">W' + n + (p.weeks[n - 1].deload ? ' · D' : '') + '</th>').join('') + '</tr>';
      const days = sheetDays(from, to);
      const totals = cols.map(n => p.weeks[n - 1].days.reduce((t, d) => t + d.exercises.reduce((m, e) => m + (Number(e.sets) || 0), 0), 0));
      const body = days.map(d => {
        const rows = sheetRows(d.dayId, from, to);
        const dayHead = '<tr class="pb-sheet-day"><th colspan="' + (cols.length + 1) + '">' + esc((d.weekday ? M.WEEKDAYS[d.weekday - 1] + ' · ' : '') + d.label) + '</th></tr>';
        const lines = rows.map(r => '<tr><td class="pb-sheet-ex"><input class="pb-in pb-in--name" data-sn="' + esc(d.dayId) + '" data-key="' + esc(r.key) + '" value="' + esc(r.name) + '" aria-label="Exercise name"></td>'
          + cols.map(n => {
            const wd = p.weeks[n - 1].days.find(x => x.dayId === d.dayId);
            if (!wd) return '<td class="pb-sheet-off">—</td>';
            const i = r.weeks[n];
            const e = i !== undefined ? wd.exercises[i] : null;
            return '<td><input class="pb-in pb-cell" data-sw="' + n + '" data-sd="' + esc(d.dayId) + '" data-key="' + esc(r.key) + '" value="' + esc(e ? M.formatCell(e) : '') + '" placeholder="—" aria-label="' + esc(r.name) + ' week ' + n + '"></td>';
          }).join('') + '</tr>').join('');
        const setRow = '<tr class="pb-sheet-sum"><td>Sets</td>' + cols.map(n => {
          const wd = p.weeks[n - 1].days.find(x => x.dayId === d.dayId);
          return '<td>' + (wd ? wd.exercises.reduce((m, e) => m + (Number(e.sets) || 0), 0) : '') + '</td>';
        }).join('') + '</tr>';
        const add = '<tr><td colspan="' + (cols.length + 1) + '"><input class="pb-in pb-quick" data-sadd="' + esc(d.dayId) + '" placeholder="+ Exercise in every week shown: Squat 3x8 @3 — Enter" aria-label="Add exercise to every week"></td></tr>';
        return dayHead + lines + setRow + add;
      }).join('');
      const foot = '<tr class="pb-sheet-total"><td>Total sets</td>' + totals.map(t => '<td>' + t + '</td>').join('') + '</tr>';
      return '<div class="pb-sheet-wrap"><p class="pb-panel-note">Each cell is sets×reps @RIR/last-set RIR and an optional load (75% or 100kg), e.g. <code>4×6-8 @2/1 75%</code>. Clear a cell to drop the exercise from that week. Rest and notes are edited in the Week view.</p>'
        + '<table class="pb-sheet"><thead>' + head + '</thead><tbody>' + (days.length ? body : '<tr><td>No training days yet.</td></tr>') + foot + '</tbody></table></div>';
    }

    function findCell(n, dayId, key) {
      const d = state.program.weeks[n - 1] && state.program.weeks[n - 1].days.find(x => x.dayId === dayId);
      if (!d) return { day: null, index: -1 };
      const seen = {};
      const index = d.exercises.findIndex(e => {
        const base = e.name.trim().toLowerCase();
        seen[base] = (seen[base] || 0) + 1;
        return base + '#' + seen[base] === key;
      });
      return { day: d, index };
    }

    function render() {
      const p = state.program;
      const w = week();
      const list = warnings();
      const here = list.filter(x => x.week === state.week);
      const warnedIds = new Set(here.map(x => x.exerciseId).filter(Boolean));
      const dayWarned = new Set(here.filter(x => x.dayId && !x.exerciseId).map(x => x.dayId));
      const otherWeeks = Array.from(new Set(list.filter(x => x.week !== state.week).map(x => x.week)));
      const tabs = single ? '' : tabsHtml(list);
      const s = M.stats(M.readProgram(p) || p);
      const sheet = !single && (state.view === 'sheet' || state.view === 'volume');
      const vol = !single && state.view === 'volume';

      container.innerHTML = '<div class="pb">'
        + '<div class="pb-top">'
        + '<label class="mp-field pb-name"><span class="mp-field-label">' + (single ? 'Workout name' : 'Program name') + '</span><input class="mp-input mp-input--text" data-pf="name" value="' + esc(p.name) + '" maxlength="80"></label>'
        + '<div class="pb-stats">' + statsText(s) + '</div>'
        + (single ? '' : '<div class="pb-view" role="radiogroup" aria-label="View"><button type="button" role="radio" class="pb-view-btn' + (sheet ? '' : ' is-on') + '" aria-checked="' + !sheet + '" data-act="view-week">Week</button>'
          + '<button type="button" role="radio" class="pb-view-btn' + (sheet && !vol ? ' is-on' : '') + '" aria-checked="' + (sheet && !vol) + '" data-act="view-sheet">Sheet</button>'
          + '<button type="button" role="radio" class="pb-view-btn' + (vol ? ' is-on' : '') + '" aria-checked="' + vol + '" data-act="view-volume">Volume</button></div>')
        + '</div>'
        + '<details class="pb-notes"' + (single ? ' hidden' : '') + '><summary>Notes, progression &amp; rules</summary>'
        + '<label class="mp-field"><span class="mp-field-label">Notes (block)</span><textarea class="coach-input" data-pf="notes" rows="2" maxlength="4000">' + esc(p.notes) + '</textarea></label>'
        + '<label class="mp-field"><span class="mp-field-label">Progression</span><textarea class="coach-input" data-pf="progressionNotes" rows="2" maxlength="4000">' + esc(p.progressionNotes) + '</textarea></label>'
        + '<label class="mp-field"><span class="mp-field-label">Rules (one per line)</span><textarea class="coach-input" data-pf="rules" rows="3">' + esc((p.rules || []).join('\n')) + '</textarea></label>'
        + '</details>'
        + '<div class="pb-weekbar"' + (single ? ' hidden' : '') + '><div class="pb-tabs" role="tablist" aria-label="Program week">' + tabs + '</div>'
        + '<div class="pb-weekacts">'
        + '<button type="button" class="pb-link" data-act="meso-open">+ Mesocycle</button>'
        + '<button type="button" class="pb-link" data-act="progress-open"' + (p.weeks.length > 1 ? '' : ' disabled') + '>Progression…</button>'
        + '<button type="button" class="pb-link" data-act="copy-week">Copy W' + state.week + ' → W' + (state.week + 1) + '</button>'
        + '<button type="button" class="pb-link" data-act="add-week">+ Empty week</button>'
        + (p.weeks.length > 1 ? '<button type="button" class="pb-link pb-link--danger" data-act="del-week">Delete W' + state.week + '</button>' : '')
        + '</div></div>'
        + (single ? '' : panelHtml())
        + (single || sheet ? '' : weekMetaHtml() + weekVolumeHtml())
        + '<div class="pb-warn-slot">' + warnHtml(here, otherWeeks) + '</div>'
        + (sheet
          ? '<div class="pb-sheet-bar"><span>' + (state.sheetAll || !currentRun() ? 'All weeks' : (currentRun().block ? esc(currentRun().block.name) : 'Weeks') + ' · W' + sheetRange().from + '–W' + sheetRange().to) + '</span>'
            + '<label class="pb-meta--check"><input type="checkbox" data-act="sheet-all"' + (state.sheetAll ? ' checked' : '') + '> Show every week</label></div>' + (vol ? volumeHtml() : sheetHtml())
          : '<div class="pb-days">' + w.days.map((d, di) => dayHtml(d, di, warnedIds, dayWarned)).join('') + '</div>'
            + (single ? '' : '<button type="button" class="pb-link" data-act="add-day">+ Add training day</button>'))
        + '<div class="pb-foot">'
        + '<button type="button" class="mp-btn" data-act="save"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'Saving…' : single ? 'Save workout' : 'Save to library') + '</button>'
        + '<button type="button" class="pb-link" data-act="cancel">Cancel</button>'
        + (single ? '' : '<button type="button" class="pb-link" data-act="export-csv" title="Opens in Excel or Google Sheets; Import file reads it back">Export CSV</button>')
        + '<span class="pb-msg" role="status">' + esc(state.message) + '</span>'
        + '</div></div>';
    }

    function rowAt(el) {
      const tr = el.closest('[data-e]');
      const sec = el.closest('[data-d]');
      const day = sec ? week().days[Number(sec.dataset.d)] : null;
      const ex = tr && day ? day.exercises[Number(tr.dataset.e)] : null;
      return { day, ex, di: sec ? Number(sec.dataset.d) : -1, ei: tr ? Number(tr.dataset.e) : -1 };
    }

    function numOrNull(v) {
      return v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    }

    // Typing: update the state, no re-render (keeps focus).
    container.addEventListener('input', ev => {
      const t = ev.target;
      if (t.dataset.wf === 'label' || t.dataset.wf === 'note') { week()[t.dataset.wf] = t.value; return; }
      if (t.dataset.bf) {
        const blk = state.program.blocks.find(b => b.id === week().block);
        if (blk) blk[t.dataset.bf] = t.value;
        return;
      }
      if (t.dataset.lm) {
        const n = numOrNull(t.value);
        if (n === null) return;
        const m = t.dataset.lm;
        const cur = Object.assign({}, lmFor(m) || { mev: 0, mav: 0, mrv: 0 });
        cur[t.dataset.lk] = Math.max(0, Math.min(60, Math.round(n)));
        state.program.volume[m] = cur;
        refreshVolumeCells();
        return;
      }
      if (t.dataset.pp && state.panel && t.type !== 'checkbox') {
        state.panel[t.dataset.pp] = t.type === 'number' ? numOrNull(t.value) : t.value;
        return;
      }
      if (t.dataset.pf) {
        if (t.dataset.pf === 'rules') state.program.rules = t.value.split('\n').map(s => s.trim()).filter(Boolean);
        else state.program[t.dataset.pf] = t.value;
        if (single && t.dataset.pf === 'name' && week().days[0]) week().days[0].label = t.value;
        return;
      }
      const f = t.dataset.f;
      if (!f) return;
      const { day, ex } = rowAt(t);
      if (ex) {
        if (f === 'name' || f === 'notes') ex[f] = t.value;
        else if (f !== 'rest' && f !== 'type' && f !== 'load') ex[f] = numOrNull(t.value);
      } else if (day && (f === 'label' || f === 'focus')) day[f] = t.value;
    });

    // Committed changes (selects, rest text, number fields): re-render for warnings.
    container.addEventListener('change', ev => {
      const t = ev.target;
      if (t.dataset.wf === 'block') {
        if (t.value) week().block = t.value; else delete week().block;
        render();
        return;
      }
      if (t.dataset.wf === 'deload') {
        if (t.checked) week().deload = true; else delete week().deload;
        render();
        return;
      }
      if (t.dataset.bf === 'name') {
        const blk = state.program.blocks.find(b => b.id === week().block);
        if (blk && !t.value.trim()) blk.name = 'Block';
        render();
        return;
      }
      if (t.dataset.pp && state.panel) {
        // No re-render for typed values: the change fires as the coach clicks
        // the panel's button, and a re-render would swallow that click.
        if (t.type === 'checkbox') { state.panel[t.dataset.pp] = t.checked; render(); }
        else if (t.tagName === 'SELECT') { state.panel[t.dataset.pp] = t.value; render(); }
        else updatePanelText();
        return;
      }
      if (t.dataset.sw) { sheetCellChanged(t); return; }
      if (t.dataset.sn !== undefined) { sheetRename(t); return; }
      if (t.dataset.insert !== undefined && t.value) {
        const w = savedWorkouts().find(x => x.id === t.value);
        const target = week().days[Number(t.dataset.insert)];
        if (w && target) {
          w.exercises.forEach(e => target.exercises.push(newRow(state.week, target, Object.assign({}, e, { id: undefined }))));
          target.exercises.forEach(e => { if (!e.id) e.id = newRow(state.week, target).id; });
          if (!target.label) target.label = w.name;
          if (!target.focus && w.focus) target.focus = w.focus;
          state.message = 'Inserted ' + w.name + '.';
        }
        render();
        return;
      }
      const f = t.dataset.f;
      if (!f) return;
      const { day, ex } = rowAt(t);
      if (!ex && day && f === 'weekday') {
        day.weekday = numOrNull(t.value);
        week().days.sort((a, b) => (a.weekday || 99) - (b.weekday || 99));
        render();
        return;
      }
      if (ex && f === 'muscle') { if (t.value) ex.muscle = t.value; else delete ex.muscle; refreshWeekVolume(); return; }
      if (ex && f === 'type') ex.type = t.value || null;
      else if (ex && f === 'rest') { Object.assign(ex, M.parseRest(t.value)); t.value = restText(ex); }
      else if (ex && f === 'load') { Object.assign(ex, M.parseLoad(t.value)); t.value = loadText(ex); }
      if (ex && f === 'name' && !ex.type && ex.name) {
        ex.type = M.guessType(ex.name);
        const sel = t.closest('tr').querySelector('[data-f="type"]');
        if (sel) sel.value = ex.type;
      }
      refresh();
      refreshWeekVolume();
    });

    // ── Sheet edits ─────────────────────────────────────────────────────────
    function sheetNameOf(t) {
      const input = t.closest('tr') && t.closest('tr').querySelector('[data-sn]');
      return input ? input.value.trim() : '';
    }

    function updateSheetSums() {
      const table = container.querySelector('.pb-sheet');
      if (!table) return;
      const wrap = table.closest('.pb-sheet-wrap');
      const fresh = container.ownerDocument.createElement('div');
      fresh.innerHTML = sheetHtml();
      const sums = [...fresh.querySelectorAll('.pb-sheet-sum td, .pb-sheet-total td')];
      [...table.querySelectorAll('.pb-sheet-sum td, .pb-sheet-total td')].forEach((td, i) => { if (sums[i]) td.textContent = sums[i].textContent; });
      const stats = container.querySelector('.pb-stats');
      if (stats) stats.textContent = statsText(M.stats(M.readProgram(state.program) || state.program));
      return wrap;
    }

    function sheetCellChanged(t) {
      const n = Number(t.dataset.sw);
      const { day, index } = findCell(n, t.dataset.sd, t.dataset.key);
      if (!day) return;
      const parsed = M.parseCell(t.value);
      if (!parsed) {
        if (index !== -1) day.exercises.splice(index, 1);
        t.value = '';
      } else if (index !== -1) {
        const ex = day.exercises[index];
        if ('loadPct' in parsed || 'loadKg' in parsed) { ex.loadPct = null; ex.loadKg = null; }
        Object.assign(ex, parsed);
        if (ex.repsMax !== null && ex.repsMin !== null && ex.repsMax <= ex.repsMin) ex.repsMax = null;
        t.value = M.formatCell(ex);
      } else {
        const name = sheetNameOf(t);
        if (!name || day.exercises.length >= M.LIMITS.exercises) { t.value = ''; return; }
        const row = newRow(n, day, Object.assign({ name, type: M.guessType(name) }, parsed));
        day.exercises.push(row);
        t.value = M.formatCell(row);
      }
      updateSheetSums();
    }

    function sheetRename(t) {
      const name = t.value.trim();
      const { from, to } = sheetRange();
      if (!name) { render(); return; }
      const hits = [];
      for (let n = from; n <= to; n++) {
        const { day, index } = findCell(n, t.dataset.sn, t.dataset.key);
        if (day && index !== -1) hits.push(day.exercises[index]);
      }
      hits.forEach(e => { e.name = name; e.type = e.type || M.guessType(name); });
      // Re-key the row in place when the new name is unique in the day (no
      // re-render: keeps focus and the next click); otherwise redraw.
      const base = name.toLowerCase() + '#';
      const same = sheetRows(t.dataset.sn, from, to).filter(r => r.key.startsWith(base));
      if (same.length === 1 && same[0].key === base + '1') {
        t.closest('tr').querySelectorAll('[data-key]').forEach(el => { el.dataset.key = base + '1'; });
      } else {
        render();
      }
    }

    function download(name, text) {
      const URL_ = root.URL;
      if (!URL_ || typeof URL_.createObjectURL !== 'function' || typeof root.Blob !== 'function') return false;
      const url = URL_.createObjectURL(new root.Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }));
      const doc = container.ownerDocument;
      const a = doc.createElement('a');
      a.href = url;
      a.download = name;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL_.revokeObjectURL(url), 1000);
      return true;
    }

    container.addEventListener('keydown', ev => {
      const t = ev.target;
      if (ev.key === 'Enter' && t.dataset.sadd !== undefined) {
        ev.preventDefault();
        const row = M.parseQuickEntry(t.value.trim());
        if (!row.name) return;
        const { from, to } = sheetRange();
        for (let n = from; n <= to; n++) {
          const day = state.program.weeks[n - 1].days.find(d => d.dayId === t.dataset.sadd);
          if (day && day.exercises.length < M.LIMITS.exercises) day.exercises.push(newRow(n, day, Object.assign({}, row, { type: M.guessType(row.name) })));
        }
        const dayId = t.dataset.sadd;
        render();
        const again = [...container.querySelectorAll('[data-sadd]')].find(x => x.dataset.sadd === dayId);
        if (again) again.focus();
        return;
      }
      if (ev.key === 'Enter' && t.dataset.sw) { ev.preventDefault(); t.blur(); return; }
      if (ev.key !== 'Enter' || t.dataset.quick === undefined) return;
      ev.preventDefault();
      const text = t.value.trim();
      if (!text) return;
      const day = week().days[Number(t.dataset.quick)];
      const row = M.parseQuickEntry(text);
      if (!row.name) return;
      day.exercises.push(newRow(state.week, day, Object.assign(row, { type: M.guessType(row.name) })));
      render();
      const again = container.querySelector('[data-quick="' + t.dataset.quick + '"]');
      if (again) again.focus();
    });

    container.addEventListener('click', async ev => {
      const tab = ev.target.closest('[data-week]');
      if (tab && container.contains(tab)) { state.week = Number(tab.dataset.week); render(); return; }
      const btn = ev.target.closest('[data-act]');
      if (!btn || !container.contains(btn)) return;
      const act = btn.dataset.act;
      const p = state.program;
      const { day, di, ei } = rowAt(btn);
      if (act === 'view-week' || act === 'view-sheet' || act === 'view-volume') { state.view = act.slice(5); render(); return; }
      if (act === 'lm-reset') {
        if (!root.confirm('Use the default MEV / MAV / MRV for every muscle in this program?')) return;
        state.program.volume = {};
        render();
        return;
      }
      if (act === 'sheet-all') { state.sheetAll = !!btn.checked; render(); return; }
      if (act === 'panel-close') { state.panel = null; render(); return; }
      if (act === 'meso-open') {
        state.panel = { kind: 'meso', name: 'Mesocycle ' + (p.blocks.length + 1), goal: '', weeks: 4, from: 'copy', deloadLast: true };
        render();
        const input = container.querySelector('[data-pp="name"]');
        if (input) { input.focus(); input.select(); }
        return;
      }
      if (act === 'progress-open') { state.panel = progressPanelFor(); render(); return; }
      if (act === 'meso-create') {
        const pn = state.panel;
        const name = String(pn.name || '').trim();
        const reuseFirst = mesoReusesFirst(pn);
        const room = M.LIMITS.weeks - p.weeks.length + (reuseFirst ? 1 : 0);
        const count = Math.min(Math.max(1, Math.round(Number(pn.weeks) || 0)), 16, room);
        if (!name) { state.message = 'Give the mesocycle a name.'; render(); return; }
        if (room <= 0) { state.message = 'A program holds up to ' + M.LIMITS.weeks + ' weeks.'; render(); return; }
        if (p.blocks.length >= M.LIMITS.blocks) { state.message = 'A program holds up to ' + M.LIMITS.blocks + ' mesocycles.'; render(); return; }
        const id = nextBlockId(p);
        p.blocks.push({ id, name: name.slice(0, 40), goal: String(pn.goal || '').trim().slice(0, 200) });
        const template = pn.from === 'copy' ? week().days : [];
        const first = reuseFirst ? 1 : p.weeks.length + 1;
        if (reuseFirst) p.weeks[0].block = id;
        for (let i = reuseFirst ? 1 : 0; i < count; i++) {
          const n = p.weeks.length + 1;
          const days = JSON.parse(JSON.stringify(template)).map(d => Object.assign(d, {
            exercises: d.exercises.map((e, j) => Object.assign(e, { id: 'w' + n + '-' + d.dayId + '-e' + (j + 1) })),
          }));
          p.weeks.push({ week: n, label: '', note: '', block: id, days });
        }
        const last = first + count - 1;
        if (pn.deloadLast && count > 1) p.weeks[last - 1].deload = true;
        renumber(p);
        state.week = first;
        state.panel = pn.from === 'copy' && count > 1 ? progressPanelFor() : null;
        state.message = 'Added ' + name + ' (W' + first + '–W' + last + ').' + (state.panel ? ' Set its progression below.' : '');
        render();
        return;
      }
      if (act === 'progress-apply') {
        const pn = state.panel;
        const from = Math.max(1, Math.round(Number(pn.from) || 1));
        const to = Math.min(p.weeks.length, Math.round(Number(pn.to) || 1));
        if (to <= from) return;
        if (!root.confirm('Rebuild W' + (from + 1) + '–W' + to + ' from W' + from + '? Changes made by hand in those weeks are replaced.')) return;
        const clean = M.readProgram(p);
        if (!clean) { state.message = 'Give the program a name first.'; render(); return; }
        const [volumeFrom, volumeTo] = pn.volume ? pn.volume.split('-') : [null, null];
        state.program = expand(M.progressWeeks(clean, from, to, Object.assign({}, pn, {
          deloadLast: pn.deloadLast && to > from, volumeFrom, volumeTo, muscleOf,
        })));
        state.panel = null;
        state.message = 'Filled W' + (from + 1) + '–W' + to + '.';
        // Muscles the rows could not carry to their landmark (one exercise at
        // the per-exercise cap): say so, the coach adds an exercise or raises the cap.
        if (volumeTo) {
          const lastTraining = pn.deloadLast && to > from ? to - 1 : to;
          const got = M.muscleSets(state.program, lastTraining, muscleOf);
          const short = Object.keys(got).filter(m => m !== 'other' && lmFor(m) && got[m] < lmFor(m)[volumeTo]);
          if (short.length) {
            state.message += ' ' + short.map(m => muscleLabel(m) + ' ' + got[m] + '/' + lmFor(m)[volumeTo]).join(', ')
              + ' stop short of ' + LANDMARK_LABEL[volumeTo] + ': add an exercise or raise Max sets / exercise.';
          }
        }
        render();
        return;
      }
      if (act === 'del-block') {
        const id = week().block;
        const blk = p.blocks.find(b => b.id === id);
        if (!blk || !root.confirm('Remove the block "' + blk.name + '"? Its weeks stay in the program.')) return;
        p.blocks = p.blocks.filter(b => b.id !== id);
        p.weeks.forEach(w => { if (w.block === id) delete w.block; });
        render();
        return;
      }
      if (act === 'export-csv') {
        const clean = M.readProgram(p);
        if (!clean) { state.message = 'Give the program a name first.'; render(); return; }
        const file = (clean.name.replace(/[^\w\- ]+/g, '').trim() || 'program') + '.csv';
        state.message = download(file, toCsv(clean)) ? 'Exported ' + file + '.' : 'Export is not available in this browser.';
        render();
        return;
      }
      if (act === 'up' && ei > 0) { const [r] = day.exercises.splice(ei, 1); day.exercises.splice(ei - 1, 0, r); }
      else if (act === 'down' && ei < day.exercises.length - 1) { const [r] = day.exercises.splice(ei, 1); day.exercises.splice(ei + 1, 0, r); }
      else if (act === 'del-row') day.exercises.splice(ei, 1);
      else if (act === 'del-day') {
        if (day.exercises.length && !root.confirm('Remove ' + (day.label || 'this day') + ' from week ' + state.week + '?')) return;
        week().days.splice(di, 1);
      } else if (act === 'add-day') {
        const used = new Set(week().days.map(d => d.weekday));
        const weekday = [1, 2, 3, 4, 5, 6, 7].find(n => !used.has(n)) || null;
        week().days.push({ dayId: nextDayId(p), weekday, label: '', focus: '', notes: '', exercises: [] });
        week().days.sort((a, b) => (a.weekday || 99) - (b.weekday || 99));
      } else if (act === 'copy-week') {
        const next = p.weeks[state.week];
        if (next && next.days.some(d => d.exercises.length) && !root.confirm('Replace week ' + (state.week + 1) + ' with a copy of week ' + state.week + '?')) return;
        if (!next && p.weeks.length >= M.LIMITS.weeks) return;
        state.program = expand(M.copyWeek(M.readProgram(p), state.week));
        state.week += 1;
      } else if (act === 'add-week') {
        if (p.weeks.length >= M.LIMITS.weeks) return;
        const lastBlock = p.weeks.length ? p.weeks[p.weeks.length - 1].block : null;
        p.weeks.push(Object.assign({ week: p.weeks.length + 1, label: '', note: '' }, lastBlock ? { block: lastBlock } : {}, { days: [] }));
        renumber(p);
        state.week = p.weeks.length;
      } else if (act === 'del-week') {
        if (!root.confirm('Delete week ' + state.week + '? Later weeks move up one.')) return;
        p.weeks.splice(state.week - 1, 1);
        renumber(p);
        state.week = Math.min(state.week, p.weeks.length);
      } else if (act === 'save-workout') {
        try {
          state.message = (await options_.onSaveWorkout(JSON.parse(JSON.stringify(day)))) || '';
        } catch (err) {
          state.message = (err && err.message) || 'Could not save the workout.';
        }
      } else if (act === 'cancel') {
        if (options_.onCancel) options_.onCancel();
        return;
      } else if (act === 'save') {
        const clean = M.readProgram(p);
        if (!clean) { state.message = single ? 'Give the workout a name.' : 'Give the program a name.'; render(); return; }
        if (!M.stats(clean).exerciseCount) { state.message = 'Add at least one exercise.'; render(); return; }
        state.saving = true; state.message = ''; render();
        try {
          await options_.onSave(clean);
          state.message = 'Saved.';
        } catch (err) {
          state.message = (err && err.message) || 'Could not save.';
        }
        state.saving = false;
      }
      render();
    });

    render();
    return {
      getProgram: () => M.readProgram(state.program),
      refresh: render,
      setWeek: n => { state.week = Math.max(1, Math.min(n, state.program.weeks.length)); render(); },
    };
  }

  root.ProgramBuilder = { mount, expand, toCsv };
})(typeof window !== 'undefined' ? window : globalThis);
