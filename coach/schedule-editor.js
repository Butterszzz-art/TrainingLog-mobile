/* Coach dashboard: one client's weeks of their assigned program.
 *
 * Without touching the library program, the coach can, for this client:
 *   - set the start date,
 *   - repeat a week ("do week 3 again"),
 *   - put in a week off (holiday, illness) before any week,
 * and see every week with its dates, mesocycle and deload, the client's
 * current week marked. Saved as the client's programSchedule
 * (PATCH /api/coach/clients/:id), which the client's app follows
 * (src/js/program-timeline.js).
 *
 *   ScheduleEditor.mount(el, { clientName, program (pocketcoach.program/2),
 *     schedule, clientStart: { date, sameProgram } | null, onSave(schedule | null) → Promise })
 */
(function (root) {
  'use strict';

  const PT = () => root.ProgramTimeline;
  const M = () => root.ProgramModel;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const fmt = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  function newId() {
    return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  }

  function mount(el, opts) {
    const o = opts || {};
    const program = M().readProgram(o.program) || { weeks: [{ days: [] }] };
    const weekCount = program.weeks.length;
    const base = PT().normalize(o.schedule, weekCount) || { startDate: '', changes: [] };
    const state = { startDate: base.startDate, changes: base.changes.map(c => Object.assign({}, c)), message: '', saving: false, dirty: false };
    const stats = M().stats(program);
    const weekdays = stats.weekdays.length ? stats.weekdays : [1];
    const meta = PT().weekMeta(program);
    const clientStart = o.clientStart && o.clientStart.sameProgram ? o.clientStart.date : '';

    const effectiveStart = () => state.startDate || clientStart || '';

    function blockList() {
      const out = [];
      meta.forEach(m => { if (m.block && !out.some(b => b.fromWeek === m.block.fromWeek)) out.push(m.block); });
      return out;
    }

    function render() {
      el.innerHTML = html();
    }

    function html() {
      const start = effectiveStart();
      const schedule = { changes: state.changes };
      const pos = start ? PT().locate({ program, schedule, startDate: start, today: new Date(), weekdays, sessionsPerWeek: stats.dayCount || weekdays.length }) : null;
      const slots = pos ? pos.slots : PT().slots(weekCount, schedule);
      const blocks = blockList();
      const now = pos && !pos.before && !pos.finished ? pos.slotIndex : -1;
      const rows = slots.map((s, i) => {
        const m = s.week ? meta[s.week - 1] : null;
        const bi = m && m.block ? blocks.findIndex(b => b.fromWeek === m.block.fromWeek) : -1;
        const monday = pos ? pos.monday(i) : null;
        const sunday = monday ? new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6) : null;
        const past = now >= 0 && i < now;
        const label = s.kind === 'pause' ? 'Week off' : 'W' + s.week + (s.kind === 'repeat' ? ' again' : '');
        const change = s.changeId ? state.changes.find(c => c.id === s.changeId) : null;
        return '<tr class="se-row' + (i === now ? ' is-now' : '') + (past ? ' is-past' : '') + (s.kind !== 'week' ? ' is-change' : '') + '" data-i="' + i + '">'
          + '<td class="se-n">' + (i + 1) + '</td>'
          + '<td class="se-date">' + (monday ? esc(fmt(monday) + ' – ' + fmt(sunday)) : '') + (i === now ? ' <span class="se-now">This week</span>' : '') + '</td>'
          + '<td class="se-week"><span class="se-chip' + (s.kind === 'pause' ? ' se-chip--pause' : s.kind === 'repeat' ? ' se-chip--repeat' : '') + '">' + esc(label) + '</span>'
          + (m && m.deload ? ' <span class="se-chip se-chip--deload">Deload</span>' : '') + '</td>'
          + '<td class="se-block">' + (m && m.block ? '<span class="se-dot se-dot--b' + (bi % 6) + '"></span>' + esc(m.block.name) : (s.kind === 'pause' ? '' : '—')) + '</td>'
          + '<td class="se-note">' + (change ? '<input class="pb-in" data-note="' + esc(change.id) + '" value="' + esc(change.note) + '" maxlength="80" placeholder="' + (s.kind === 'pause' ? 'e.g. Holiday' : 'Why, e.g. missed sessions') + '" aria-label="Note">' : '') + '</td>'
          + '<td class="se-acts">'
          + (past ? '' : '<button type="button" class="pb-link" data-act="pause" title="A week without training before this week; everything after moves back a week">Week off here</button>')
          + (past || s.kind === 'pause' ? '' : '<button type="button" class="pb-link" data-act="repeat" title="Do this week once more right after it">Repeat</button>')
          + (change ? '<button type="button" class="pb-link pb-link--danger" data-act="remove">Remove</button>' : '')
          + '</td></tr>';
      }).join('');
      const pauses = slots.filter(s => s.kind === 'pause').length;
      const repeats = slots.filter(s => s.kind === 'repeat').length;
      const where = !pos ? 'Set a start date (or wait until ' + esc(o.clientName || 'the client') + ' starts the program) to see dates and the current week.'
        : pos.before ? 'Starts ' + esc(fmt(new Date(start + 'T00:00:00'))) + '.'
          : pos.finished ? 'The program has ended.'
            : 'This week: ' + esc(pos.pause ? 'week off' : (pos.block ? pos.block.name + ' · week ' + pos.weekInBlock + ' of ' + pos.blockSlots + ' · ' : '') + 'week ' + pos.slotNumber + ' of ' + pos.totalSlots) + '.';
      return '<div class="se">'
        + '<div class="se-top">'
        + '<label class="pb-meta"><span>Start date</span><input class="pb-in" type="date" data-start value="' + esc(state.startDate) + '"></label>'
        + '<div class="se-summary"><strong>' + slots.length + ' weeks</strong>' + (weekCount !== slots.length ? ' (program ' + weekCount + ' + ' + [repeats ? repeats + ' repeated' : '', pauses ? pauses + ' off' : ''].filter(Boolean).join(', ') + ')' : '')
        + '<br><span>' + where + '</span>'
        + (clientStart && !state.startDate ? '<br><span>' + esc(o.clientName || 'The client') + ' started on ' + esc(fmt(new Date(clientStart + 'T00:00:00'))) + '.</span>' : '')
        + '</div></div>'
        + '<div class="se-table-wrap"><table class="se-table"><thead><tr><th>#</th><th>Dates</th><th>Week</th><th>Mesocycle</th><th>Note</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        + '<div class="pb-foot">'
        + '<button type="button" class="mp-btn" data-act="save"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'Saving…' : 'Save weeks') + '</button>'
        + (state.changes.length ? '<button type="button" class="pb-link pb-link--danger" data-act="clear">Undo all changes</button>' : '')
        + '<span class="pb-msg" role="status">' + esc(state.message || (state.dirty ? 'Not saved yet.' : '')) + '</span>'
        + '</div>'
        + '<p class="ws-empty-note">' + esc(o.clientName || 'Your client') + ' sees where they are in Your Coach, and Today follows these weeks. The library program does not change.</p>'
        + '</div>';
    }

    function slotsNow() {
      return PT().slots(weekCount, { changes: state.changes });
    }

    // The week shown before slot i (0 when none): a change "after" it lands right before slot i.
    function weekBefore(list, i) {
      for (let j = i - 1; j >= 0; j--) if (list[j].week !== null) return list[j].week;
      return 0;
    }

    function insertAt(list, i, change, after) {
      // Changes with the same afterWeek keep their array order: place the new
      // one just before (or after) the change of slot i when it has one.
      const anchorId = list[i] && list[i].changeId;
      const anchor = anchorId ? state.changes.findIndex(c => c.id === anchorId) : -1;
      if (anchor === -1) {
        // Before a plain week: after every change with the same afterWeek.
        // Right after a plain week (repeat): before them.
        const same = state.changes.map((c, k) => (c.afterWeek === change.afterWeek ? k : -1)).filter(k => k !== -1);
        if (!same.length) state.changes.push(change);
        else if (after) state.changes.splice(same[0], 0, change);
        else state.changes.splice(same[same.length - 1] + 1, 0, change);
      } else {
        state.changes.splice(after ? anchor + 1 : anchor, 0, change);
      }
    }

    el.addEventListener('click', async ev => {
      const btn = ev.target.closest('[data-act]');
      if (!btn || !el.contains(btn)) return;
      const act = btn.dataset.act;
      const row = btn.closest('[data-i]');
      const i = row ? Number(row.dataset.i) : -1;
      const list = slotsNow();
      if (act === 'pause') {
        insertAt(list, i, { id: newId(), kind: 'pause', afterWeek: weekBefore(list, i), note: '' }, false);
      } else if (act === 'repeat') {
        insertAt(list, i, { id: newId(), kind: 'repeat', afterWeek: list[i].week, note: '' }, true);
      } else if (act === 'remove') {
        state.changes = state.changes.filter(c => c.id !== list[i].changeId);
      } else if (act === 'clear') {
        if (!root.confirm('Undo every repeat and week off for this client?')) return;
        state.changes = [];
      } else if (act === 'save') {
        state.saving = true; state.message = ''; render();
        const schedule = PT().normalize({ startDate: state.startDate, changes: state.changes }, weekCount);
        try {
          await o.onSave(schedule ? { startDate: schedule.startDate, changes: schedule.changes } : null);
          state.message = 'Saved. ' + (o.clientName || 'Your client') + '’s app follows these weeks now.';
          state.dirty = false;
        } catch (err) {
          state.message = (err && err.message) || 'Could not save.';
        }
        state.saving = false;
        render();
        return;
      } else return;
      state.dirty = true;
      state.message = '';
      render();
    });

    el.addEventListener('input', ev => {
      const t = ev.target;
      if (t.dataset.note) {
        const c = state.changes.find(x => x.id === t.dataset.note);
        if (c) c.note = t.value;
        state.dirty = true;
      }
    });

    // A new start date redraws the dates and the summary only: the change
    // fires as the coach clicks Save, and replacing the button would lose that click.
    el.addEventListener('change', ev => {
      if (ev.target.dataset.start === undefined) return;
      state.startDate = ev.target.value || '';
      state.dirty = true;
      state.message = '';
      const fresh = el.ownerDocument.createElement('div');
      fresh.innerHTML = html();
      ['.se-summary', '.se-table-wrap', '.pb-msg'].forEach(sel => {
        const a = el.querySelector(sel);
        const b = fresh.querySelector(sel);
        if (a && b) a.innerHTML = b.innerHTML;
      });
    });

    render();
    return { getSchedule: () => PT().normalize({ startDate: state.startDate, changes: state.changes }, weekCount) };
  }

  root.ScheduleEditor = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
