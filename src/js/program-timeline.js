/* Program timeline: a coach's per-client changes to a multi-week program,
 * and where the client is in it today.
 *
 * The coach's library program has weeks 1..N (grouped into mesocycles, some
 * weeks deloads). For one client the coach can add changes without editing
 * the program itself:
 *   { kind: 'repeat', afterWeek: 3 }  → week 3 is done twice
 *   { kind: 'pause',  afterWeek: 5 }  → a week without training after week 5
 *                                       (holiday, illness); afterWeek 0 = before week 1
 * stored as the client's programSchedule:
 *   { programId, startDate: 'YYYY-MM-DD' | '', changes: [{ id, kind, afterWeek, note }] }
 *
 * slots() lays that out as the client's real sequence of weeks ("slots"),
 * which program-schedule.js follows day by day (a slot is one round of the
 * program's training days) and the Your Coach tab and the coach dashboard
 * show ("Hypertrophy block · week 4 of 6").
 *
 * Pure: no DOM, no storage. Loaded by the app (index.html) and the coach
 * dashboard (coach/index.html); exported for tests.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProgramTimeline = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const MAX_CHANGES = 30;
  const MAX_WEEKS = 52;
  const KINDS = ['repeat', 'pause'];
  const WEEKDAY_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const DAY_MS = 86400000;

  function isoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const d = new Date(value + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? '' : value;
  }

  function parseDate(iso) {
    const v = isoDate(iso);
    if (!v) return null;
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function toIso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function midnight(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /**
   * Cleans a programSchedule. Changes are kept in the order given within the
   * same afterWeek (so two repeats after week 3 stay two), sorted by afterWeek.
   * A repeat needs a week before it (afterWeek ≥ 1). Returns null when there
   * is neither a start date nor a change.
   */
  function normalize(value, weekCount) {
    if (!value || typeof value !== 'object') return null;
    const maxWeek = Math.min(MAX_WEEKS, Number.isInteger(weekCount) && weekCount > 0 ? weekCount : MAX_WEEKS);
    const seen = new Set();
    const changes = (Array.isArray(value.changes) ? value.changes : []).map((c, i) => {
      if (!c || typeof c !== 'object' || !KINDS.includes(c.kind)) return null;
      const afterWeek = Number(c.afterWeek);
      if (!Number.isInteger(afterWeek) || afterWeek < (c.kind === 'repeat' ? 1 : 0) || afterWeek > maxWeek) return null;
      let id = typeof c.id === 'string' ? c.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) : '';
      if (!id || seen.has(id)) id = 'c' + (i + 1) + '-' + afterWeek;
      while (seen.has(id)) id += 'x';
      seen.add(id);
      const note = typeof c.note === 'string' ? c.note.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
      return { id, kind: c.kind, afterWeek, note, order: i };
    }).filter(Boolean)
      .sort((a, b) => a.afterWeek - b.afterWeek || a.order - b.order)
      .slice(0, MAX_CHANGES)
      .map(({ order, ...c }) => c);
    const startDate = isoDate(value.startDate);
    const programId = typeof value.programId === 'string' ? value.programId.slice(0, 64) : '';
    if (!startDate && !changes.length) return null;
    return { programId, startDate, changes };
  }

  /**
   * The client's sequence of weeks: [{ slot (1-based), week (program week, or
   * null for a pause), kind: 'week' | 'repeat' | 'pause', note, changeId }].
   */
  function slots(weekCount, schedule) {
    const n = Math.max(1, Math.min(MAX_WEEKS, Number(weekCount) || 1));
    const changes = (schedule && Array.isArray(schedule.changes)) ? schedule.changes : [];
    const out = [];
    const add = (week, kind, change) => out.push({ slot: out.length + 1, week, kind, note: change ? change.note || '' : '', changeId: change ? change.id : null });
    for (let w = 0; w <= n; w++) {
      if (w > 0) add(w, 'week', null);
      changes.filter(c => c.afterWeek === w).forEach(c => {
        if (c.kind === 'pause') add(null, 'pause', c);
        else if (w > 0) add(w, 'repeat', c);
      });
    }
    return out;
  }

  /**
   * Per program week: { week, block: { name, goal, fromWeek, toWeek } | null, deload }
   * from a program in the app's library shape (blocks: [{ name, goal,
   * fromWeek, toWeek }], weeks: [{ week, deload }]) or the coach's v2 shape
   * (blocks: [{ id, name, goal }], weeks: [{ block, deload }]).
   */
  function weekMeta(program) {
    const weeks = program && Array.isArray(program.weeks) && program.weeks.length ? program.weeks : [{ week: 1 }];
    const blocks = program && Array.isArray(program.blocks) ? program.blocks : [];
    const v2 = blocks.some(b => b && typeof b.id === 'string') && weeks.some(w => w && typeof w.block === 'string');
    let ranges;
    if (v2) {
      ranges = [];
      weeks.forEach((w, i) => {
        const b = blocks.find(x => x.id === w.block);
        const last = ranges[ranges.length - 1];
        if (b && last && last.id === b.id && last.toWeek === i) last.toWeek = i + 1;
        else if (b) ranges.push({ id: b.id, name: b.name, goal: b.goal || '', fromWeek: i + 1, toWeek: i + 1 });
      });
    } else {
      ranges = blocks.filter(b => b && b.name && Number.isInteger(b.fromWeek) && Number.isInteger(b.toWeek))
        .map(b => ({ name: b.name, goal: b.goal || '', fromWeek: b.fromWeek, toWeek: b.toWeek }));
    }
    return weeks.map((w, i) => {
      const week = i + 1;
      const r = ranges.find(x => x.fromWeek <= week && week <= x.toWeek) || null;
      return { week, block: r ? { name: r.name, goal: r.goal, fromWeek: r.fromWeek, toWeek: r.toWeek } : null, deload: !!(w && w.deload) };
    });
  }

  function countTrainingDays(from, until, trainingNums) {
    let count = 0;
    const cur = new Date(from);
    while (cur < until) {
      if (trainingNums.includes(cur.getDay())) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  function trainingNumsOf(weekdays) {
    return (Array.isArray(weekdays) ? weekdays : []).map(d => (typeof d === 'number' ? d % 7 : WEEKDAY_NUM[d])).filter(n => n !== undefined);
  }

  /** The 0-based slot a date falls in (-1 before the start), counted the way program-schedule.js does: every `sessionsPerWeek` training days is one slot. */
  function slotIndexAt(startDate, date, trainingNums, sessionsPerWeek) {
    const start = midnight(startDate);
    const day = midnight(date);
    if (day < start) return -1;
    const per = Math.max(1, sessionsPerWeek || trainingNums.length || 1);
    return Math.floor(countTrainingDays(start, day, trainingNums) / per);
  }

  /** The Monday of the week holding the first training day of slot `index`. */
  function slotMonday(startDate, index, trainingNums, sessionsPerWeek) {
    const per = Math.max(1, sessionsPerWeek || trainingNums.length || 1);
    const target = index * per;
    const cur = midnight(startDate);
    let seen = 0;
    for (let i = 0; i < 7 * (index + 2) + 7; i++) {
      if (trainingNums.includes(cur.getDay())) {
        if (seen === target) break;
        seen++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    const dow = cur.getDay();
    cur.setDate(cur.getDate() + (dow === 0 ? -6 : 1 - dow));
    return cur;
  }

  /**
   * Where the client is. opts: { program (library or v2 shape), weekCount?,
   * schedule, startDate ('YYYY-MM-DD'), today (Date), weekdays (['Mon',…] or
   * day numbers), sessionsPerWeek? }. Returns null without a start date.
   *   { before, finished, slotIndex, slotNumber, totalSlots, programWeek,
   *     weekCount, kind, pause, repeat, deload, note, block, blockIndex,
   *     blockCount, weekInBlock, blockSlots, weeksLeft, slots, dates(i) }
   */
  function locate(opts) {
    const o = opts || {};
    const start = parseDate(o.startDate);
    if (!start) return null;
    const meta = weekMeta(o.program);
    const weekCount = Number.isInteger(o.weekCount) && o.weekCount > 0 ? o.weekCount : meta.length;
    const list = slots(weekCount, o.schedule);
    const nums = trainingNumsOf(o.weekdays);
    const per = o.sessionsPerWeek || nums.length || 1;
    const idx = nums.length ? slotIndexAt(start, o.today || new Date(), nums, per) : Math.floor((midnight(o.today || new Date()) - start) / (7 * DAY_MS));
    const before = idx < 0;
    const finished = idx >= list.length;
    const at = before ? 0 : Math.min(idx, list.length - 1);
    const entry = list[at];
    // A pause belongs to the week before it (for the block shown).
    let refWeek = entry.week;
    for (let i = at; refWeek === null && i >= 0; i--) refWeek = list[i].week;
    if (refWeek === null) refWeek = 1;
    const m = meta[refWeek - 1] || { block: null, deload: false };
    const sameBlock = s => {
      if (s.week === null || !m.block) return false;
      const b = (meta[s.week - 1] || {}).block;
      return !!b && b.fromWeek === m.block.fromWeek && b.toWeek === m.block.toWeek;
    };
    const blockSlots = m.block ? list.filter(sameBlock) : [];
    const blockRanges = [];
    meta.forEach(x => { if (x.block && !blockRanges.some(b => b.fromWeek === x.block.fromWeek)) blockRanges.push(x.block); });
    return {
      before,
      finished,
      slotIndex: at,
      slotNumber: at + 1,
      totalSlots: list.length,
      programWeek: entry.week,
      weekCount,
      kind: entry.kind,
      pause: entry.kind === 'pause',
      repeat: entry.kind === 'repeat',
      deload: entry.week !== null && !!(meta[entry.week - 1] || {}).deload,
      note: entry.note,
      block: m.block,
      blockIndex: m.block ? blockRanges.findIndex(b => b.fromWeek === m.block.fromWeek) : -1,
      blockCount: blockRanges.length,
      weekInBlock: m.block && entry.week !== null ? blockSlots.indexOf(entry) + 1 : 0,
      blockSlots: blockSlots.length,
      weeksLeft: finished ? 0 : list.length - at - (before ? 0 : 1),
      slots: list,
      meta,
      monday: i => slotMonday(start, i, nums.length ? nums : [1], per),
    };
  }

  return { MAX_CHANGES, normalize, slots, weekMeta, locate, slotIndexAt, slotMonday, trainingNumsOf, isoDate, toIso };
});
