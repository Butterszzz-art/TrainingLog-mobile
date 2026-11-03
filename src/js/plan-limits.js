// Free-plan limits, in one place.
//
//   Programs — free accounts can build one custom program. Programs that came
//     from somewhere else (the Library, a coach, a file import) carry a
//     `source` and don't count. Library programs themselves are Pro (gated in
//     premium-library.js and on the server).
//   History — free accounts see summaries and charts for the last 4 weeks.
//     Pro sees everything. The data itself is never deleted, so upgrading
//     shows the full history straight away.
//
// "Paid" means window.hasPaidAccess() (Pro, Coach or admin), the same rule
// the rest of the app uses.
(function (global) {
  'use strict';

  const FREE_CUSTOM_PROGRAMS = 1;
  const FREE_HISTORY_DAYS = 28;

  function isPaid() {
    return typeof global.hasPaidAccess === 'function' && global.hasPaidAccess() === true;
  }

  function upgrade() {
    if (typeof global.openUpgradeModal === 'function') global.openUpgradeModal('pro');
  }

  /* ── Programs ─────────────────────────────────────────────── */

  function programId(p) {
    return p && (p.programId || p.id) || null;
  }

  function isCustomProgram(p) {
    return !!p && typeof p === 'object' && !p.source;
  }

  function customProgramCount(programs) {
    return (Array.isArray(programs) ? programs : []).filter(isCustomProgram).length;
  }

  // Whether `program` may be saved into `programs`. Updating a program that is
  // already saved is always allowed, as is anything with a source.
  function canSaveProgram(programs, program, paid) {
    if (paid === undefined ? isPaid() : paid) return true;
    if (!isCustomProgram(program)) return true;
    const id = programId(program);
    const list = Array.isArray(programs) ? programs : [];
    if (id && list.some(function (p) { return programId(p) === id; })) return true;
    return customProgramCount(list) < FREE_CUSTOM_PROGRAMS;
  }

  /* ── History ──────────────────────────────────────────────── */

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Earliest date (YYYY-MM-DD, local) a free account sees: today and the 27
  // days before it. null means no limit.
  function historyCutoff(now, paid) {
    if (paid === undefined ? isPaid() : paid) return null;
    const d = now ? new Date(now) : new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (FREE_HISTORY_DAYS - 1));
    return ymd(d);
  }

  function dateKey(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const d = new Date(value);
    return isNaN(d) ? '' : ymd(d);
  }

  // Keeps the items inside the free window. getDate(item) returns a date
  // string or timestamp; items without a date are kept.
  // Returns { items, hidden } where hidden is how many were left out.
  function clipHistory(items, getDate, opts) {
    const list = Array.isArray(items) ? items : [];
    const cutoff = historyCutoff(opts && opts.now, opts && opts.paid);
    if (!cutoff) return { items: list, hidden: 0 };
    const pick = typeof getDate === 'function' ? getDate : function (x) { return x && x.date; };
    const kept = list.filter(function (item) {
      const key = dateKey(pick(item));
      return !key || key >= cutoff;
    });
    return { items: kept, hidden: list.length - kept.length };
  }

  // One-line banner under a chart or list. Empty when nothing was hidden.
  function historyNoteHtml(hidden) {
    if (!hidden) return '';
    return '<div class="plan-history-note" role="note">'
      + '<span>Free shows your last 4 weeks.</span>'
      + '<button type="button" class="plan-history-link" onclick="PlanLimits.upgrade()">See full history with Pro</button>'
      + '</div>';
  }

  // Puts the banner right before `anchor` (or removes it), keyed by `id`.
  function setHistoryNote(anchor, id, hidden) {
    if (!anchor || !anchor.parentNode || typeof document === 'undefined') return;
    let el = document.getElementById(id);
    if (!hidden) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      anchor.parentNode.insertBefore(el, anchor);
    }
    el.innerHTML = historyNoteHtml(hidden);
  }

  const api = {
    FREE_CUSTOM_PROGRAMS: FREE_CUSTOM_PROGRAMS,
    FREE_HISTORY_DAYS: FREE_HISTORY_DAYS,
    isPaid: isPaid,
    upgrade: upgrade,
    isCustomProgram: isCustomProgram,
    customProgramCount: customProgramCount,
    canSaveProgram: canSaveProgram,
    historyCutoff: historyCutoff,
    clipHistory: clipHistory,
    historyNoteHtml: historyNoteHtml,
    setHistoryNote: setHistoryNote,
  };

  global.PlanLimits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
