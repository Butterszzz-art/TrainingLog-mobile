/* Coach dashboard program builder (pocketcoach.program/2).
 *
 * Week tabs, day cards with a weekday and label, and one row per exercise
 * with real fields: type, sets, rep range, target RIR, last-set RIR, rest,
 * notes. "Copy week → next" carries a week forward so the RIR can be
 * changed per week. The quick-entry line under each day ("Squat 4x6-8 @2
 * 2-3min") fills a new row's fields; it uses the same parser as the file
 * import (src/js/program-model.js).
 *
 *   ProgramBuilder.mount(container, program | null, { onSave(v2) → Promise, onCancel })
 *
 * The program in the builder is always "expanded" (weeks that were sameAs
 * hold their own copy) so any week can be edited; it is saved that way.
 * Text inputs update the state in place; structural changes re-render. */
(function (root) {
  'use strict';

  const M = root.ProgramModel;
  const WEEKDAY_OPTIONS = [['', '—']].concat(M.WEEKDAYS.map((d, i) => [String(i + 1), d]));
  const TYPE_OPTIONS = [['', 'Type'], ['compound', 'Compound'], ['isolation', 'Isolation'], ['core', 'Core']];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function options(list, selected) {
    return list.map(([v, label]) => '<option value="' + esc(v) + '"' + (String(selected == null ? '' : selected) === v ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
  }

  /** Any program shape → v2 with every week holding its own days. */
  function expand(program) {
    const p = M.readProgram(program) || M.readProgram({ schema: M.SCHEMA, name: 'New program', weeks: [{ days: [] }] });
    p.weeks = p.weeks.map(w => ({ week: w.week, label: w.label, note: w.note || '', days: JSON.parse(JSON.stringify(M.weekDays(p, w.week))) }));
    return p;
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
    const state = { program: expand(program), week: 1, saving: false, message: '' };

    function week() { return state.program.weeks[state.week - 1]; }
    function warnings() { return M.validate(M.readProgram(state.program) || state.program); }

    function numberCell(field, value, attrs) {
      return '<input class="pb-in pb-in--num" type="number" inputmode="numeric" data-f="' + field + '" value="' + esc(value == null ? '' : value) + '"' + (attrs || '') + '>';
    }

    function rowHtml(e, di, ei, warnedIds) {
      const warned = warnedIds.has(e.id);
      return '<tr class="pb-row' + (warned ? ' is-warned' : '') + '" data-d="' + di + '" data-e="' + ei + '">'
        + '<td><input class="pb-in pb-in--name" data-f="name" value="' + esc(e.name) + '" placeholder="Exercise" maxlength="80" aria-label="Exercise"></td>'
        + '<td><select class="pb-in" data-f="type" aria-label="Type">' + options(TYPE_OPTIONS, e.type) + '</select></td>'
        + '<td>' + numberCell('sets', e.sets, ' min="1" max="20" aria-label="Sets"') + '</td>'
        + '<td class="pb-range">' + numberCell('repsMin', e.repsMin, ' min="1" max="100" aria-label="Reps from"') + '<span>–</span>' + numberCell('repsMax', e.repsMax, ' min="1" max="100" aria-label="Reps to"') + '</td>'
        + '<td>' + numberCell('rir', e.rir, ' min="0" max="10" step="0.5" aria-label="Target RIR"') + '</td>'
        + '<td>' + numberCell('lastSetRir', e.lastSetRir, ' min="0" max="10" step="0.5" placeholder="=" aria-label="Last-set RIR"') + '</td>'
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
        + '<select class="pb-in pb-in--weekday" data-f="weekday" aria-label="Weekday">' + options(WEEKDAY_OPTIONS, d.weekday) + '</select>'
        + '<input class="pb-in pb-in--label" data-f="label" value="' + esc(d.label) + '" placeholder="Lower A" maxlength="40" aria-label="Day name">'
        + '<input class="pb-in pb-in--focus" data-f="focus" value="' + esc(d.focus) + '" placeholder="Focus (optional)" maxlength="60" aria-label="Focus">'
        + '<button type="button" class="pb-link" data-act="del-day">Remove day</button>'
        + '</header>'
        + '<table class="pb-table"><thead><tr><th>Exercise</th><th>Type</th><th>Sets</th><th>Reps</th><th>RIR</th><th title="RIR on the last set; empty = same">Last set</th><th>Rest</th><th>Notes</th><th></th></tr></thead>'
        + '<tbody>' + d.exercises.map((e, ei) => rowHtml(e, di, ei, warnedIds)).join('') + '</tbody></table>'
        + '<input class="pb-in pb-quick" data-quick="' + di + '" placeholder="Quick add: Squat 4x6-8 @2 2-3min — Enter" aria-label="Quick add exercise">'
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
      if (stats) stats.textContent = s.weekCount + ' wk · ' + s.dayCount + ' days/wk · ' + s.exerciseCount + ' rows';
    }

    function render() {
      const p = state.program;
      const w = week();
      const list = warnings();
      const here = list.filter(x => x.week === state.week);
      const warnedIds = new Set(here.map(x => x.exerciseId).filter(Boolean));
      const dayWarned = new Set(here.filter(x => x.dayId && !x.exerciseId).map(x => x.dayId));
      const otherWeeks = Array.from(new Set(list.filter(x => x.week !== state.week).map(x => x.week)));
      const tabs = p.weeks.map((wk, i) => '<button type="button" role="tab" class="pb-tab' + (i + 1 === state.week ? ' is-active' : '') + (list.some(x => x.week === i + 1) ? ' has-warn' : '')
        + '" aria-selected="' + (i + 1 === state.week) + '" data-week="' + (i + 1) + '">W' + (i + 1) + '</button>').join('');
      const s = M.stats(M.readProgram(p) || p);

      container.innerHTML = '<div class="pb">'
        + '<div class="pb-top">'
        + '<label class="mp-field pb-name"><span class="mp-field-label">Program name</span><input class="mp-input mp-input--text" data-pf="name" value="' + esc(p.name) + '" maxlength="80"></label>'
        + '<div class="pb-stats">' + s.weekCount + ' wk · ' + s.dayCount + ' days/wk · ' + s.exerciseCount + ' rows</div>'
        + '</div>'
        + '<details class="pb-notes"><summary>Notes, progression &amp; rules</summary>'
        + '<label class="mp-field"><span class="mp-field-label">Notes (block)</span><textarea class="coach-input" data-pf="notes" rows="2" maxlength="4000">' + esc(p.notes) + '</textarea></label>'
        + '<label class="mp-field"><span class="mp-field-label">Progression</span><textarea class="coach-input" data-pf="progressionNotes" rows="2" maxlength="4000">' + esc(p.progressionNotes) + '</textarea></label>'
        + '<label class="mp-field"><span class="mp-field-label">Rules (one per line)</span><textarea class="coach-input" data-pf="rules" rows="3">' + esc((p.rules || []).join('\n')) + '</textarea></label>'
        + '</details>'
        + '<div class="pb-weekbar"><div class="pb-tabs" role="tablist" aria-label="Program week">' + tabs + '</div>'
        + '<div class="pb-weekacts">'
        + '<button type="button" class="pb-link" data-act="copy-week">Copy W' + state.week + ' → W' + (state.week + 1) + '</button>'
        + '<button type="button" class="pb-link" data-act="add-week">+ Empty week</button>'
        + (p.weeks.length > 1 ? '<button type="button" class="pb-link pb-link--danger" data-act="del-week">Delete W' + state.week + '</button>' : '')
        + '</div></div>'
        + '<div class="pb-warn-slot">' + warnHtml(here, otherWeeks) + '</div>'
        + '<div class="pb-days">' + w.days.map((d, di) => dayHtml(d, di, warnedIds, dayWarned)).join('') + '</div>'
        + '<button type="button" class="pb-link" data-act="add-day">+ Add training day</button>'
        + '<div class="pb-foot">'
        + '<button type="button" class="mp-btn" data-act="save"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'Saving…' : 'Save to library') + '</button>'
        + '<button type="button" class="pb-link" data-act="cancel">Cancel</button>'
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
      if (t.dataset.pf) {
        if (t.dataset.pf === 'rules') state.program.rules = t.value.split('\n').map(s => s.trim()).filter(Boolean);
        else state.program[t.dataset.pf] = t.value;
        return;
      }
      const f = t.dataset.f;
      if (!f) return;
      const { day, ex } = rowAt(t);
      if (ex) {
        if (f === 'name' || f === 'notes') ex[f] = t.value;
        else if (f !== 'rest' && f !== 'type') ex[f] = numOrNull(t.value);
      } else if (day && (f === 'label' || f === 'focus')) day[f] = t.value;
    });

    // Committed changes (selects, rest text, number fields): re-render for warnings.
    container.addEventListener('change', ev => {
      const t = ev.target;
      const f = t.dataset.f;
      if (!f) return;
      const { day, ex } = rowAt(t);
      if (!ex && day && f === 'weekday') {
        day.weekday = numOrNull(t.value);
        week().days.sort((a, b) => (a.weekday || 99) - (b.weekday || 99));
        render();
        return;
      }
      if (ex && f === 'type') ex.type = t.value || null;
      else if (ex && f === 'rest') { Object.assign(ex, M.parseRest(t.value)); t.value = restText(ex); }
      if (ex && f === 'name' && !ex.type && ex.name) {
        ex.type = M.guessType(ex.name);
        const sel = t.closest('tr').querySelector('[data-f="type"]');
        if (sel) sel.value = ex.type;
      }
      refresh();
    });

    container.addEventListener('keydown', ev => {
      const t = ev.target;
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
        p.weeks.push({ week: p.weeks.length + 1, label: '', note: '', days: [] });
        renumber(p);
        state.week = p.weeks.length;
      } else if (act === 'del-week') {
        if (!root.confirm('Delete week ' + state.week + '? Later weeks move up one.')) return;
        p.weeks.splice(state.week - 1, 1);
        renumber(p);
        state.week = Math.min(state.week, p.weeks.length);
      } else if (act === 'cancel') {
        if (options_.onCancel) options_.onCancel();
        return;
      } else if (act === 'save') {
        const clean = M.readProgram(p);
        if (!clean) { state.message = 'Give the program a name.'; render(); return; }
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
      setWeek: n => { state.week = Math.max(1, Math.min(n, state.program.weeks.length)); render(); },
    };
  }

  root.ProgramBuilder = { mount, expand };
})(typeof window !== 'undefined' ? window : globalThis);
