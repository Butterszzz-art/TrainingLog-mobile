/* Coach program model: "pocketcoach.program/2".
 *
 * ONE FILE, TWO REPOS. This exact file is src/js/program-model.js in
 * TrainingLog-mobile and src/programs/model.js in traininglog-backend. Edit
 * it in the app and copy it over with
 *   node scripts/sync-program-model.js ../TrainingLog-mobile/src/js/program-model.js
 * (both repos' tests pin its behaviour).
 *
 * v2 is the authoring shape for the coach library: weeks → days → rows with
 * explicit fields (no free-text parsing).
 *
 *   { schema, name, notes, progressionNotes, rules[],
 *     weeks: [{ week, label, note, days: [{ dayId, weekday 1-7, label, focus, notes,
 *       exercises: [{ id, name, type, sets, repsMin, repsMax, rir, lastSetRir,
 *                     restSec, restSecMax, notes }] }] }
 *             | { week, sameAs } ] }
 *
 * readProgram() also reads the v1 library shape { name, days: { Mon: [...] } }
 * (one repeating week) and the app's library shape (weeks/days with per-set
 * arrays, e.g. from the AI import). toLibrary() turns v2 back into the app's
 * library shape, which every app version already knows how to follow.
 *
 * Pure: no DOM, no storage, no network. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProgramModel = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const SCHEMA = 'pocketcoach.program/2';
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // ISO 1..7
  const TYPES = ['compound', 'isolation', 'core'];
  const LIMITS = { weeks: 52, days: 7, exercises: 20, name: 80, label: 40, focus: 60, notes: 300, programNotes: 4000, rules: 20 };

  // ── small helpers ─────────────────────────────────────────────────────────

  function str(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }

  // null for missing / blank / non-numeric / out of range (Number(null) is 0,
  // which must never turn into a real-looking value).
  function num(value, min, max) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return n;
  }

  function int(value, min, max) {
    const n = num(value, min, max);
    return n === null ? null : Math.round(n);
  }

  function weekdayNumber(value) {
    if (Number.isInteger(value) && value >= 1 && value <= 7) return value;
    if (typeof value !== 'string') return null;
    const key = value.trim().slice(0, 3).toLowerCase();
    const i = WEEKDAYS.findIndex(d => d.toLowerCase() === key);
    return i === -1 ? null : i + 1;
  }

  function slug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // ── text parsers (shared by quick entry and the table import) ─────────────

  /** "6-10" → {repsMin:6, repsMax:10}; "8" → {repsMin:8, repsMax:null}; "AMRAP" → nulls. */
  function parseReps(text) {
    const m = String(text == null ? '' : text).match(/(\d{1,3})(?:\s*[-–—to]+\s*(\d{1,3}))?/i);
    if (!m) return { repsMin: null, repsMax: null };
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : null;
    if (b !== null && b > a) return { repsMin: a, repsMax: b };
    return { repsMin: a, repsMax: null };
  }

  /** "3" → {rir:3}; "3 (last set 2)" → {rir:3, lastSetRir:2}; "-" / "" → nulls; "2/1" → 2 and 1. */
  function parseRir(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s || /^[-–—x]+$/i.test(s) || /^n\/?a$/i.test(s)) return { rir: null, lastSetRir: null };
    const last = s.match(/last(?:\s*set)?\s*[:=]?\s*(\d(?:\.\d)?)/i) || s.match(/^\s*\d(?:\.\d)?\s*\/\s*(\d(?:\.\d)?)/);
    const first = s.match(/(\d(?:\.\d)?)/);
    const rir = first ? num(first[1], 0, 10) : null;
    const lastSetRir = last ? num(last[1], 0, 10) : null;
    return { rir, lastSetRir: lastSetRir !== null && lastSetRir !== rir ? lastSetRir : null };
  }

  /** "2-3 min" → {restSec:120, restSecMax:180}; "90s" / "90 sec" → 90; "1:30" → 90; "2" → 120 (minutes). */
  function parseRest(text) {
    const s = String(text == null ? '' : text).trim().toLowerCase();
    if (!s || /^[-–—]+$/.test(s)) return { restSec: null, restSecMax: null };
    const clock = s.match(/^(\d{1,2}):(\d{2})$/);
    if (clock) return { restSec: Number(clock[1]) * 60 + Number(clock[2]), restSecMax: null };
    const m = s.match(/(\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*(\d+(?:[.,]\d+)?))?\s*(s|sec|secs|seconds|m|min|mins|minutes)?\b/);
    if (!m) return { restSec: null, restSecMax: null };
    const unit = m[3] && m[3][0] === 's' ? 1 : (m[3] ? 60 : (Number(m[1].replace(',', '.')) > 10 ? 1 : 60));
    const a = Math.round(Number(m[1].replace(',', '.')) * unit);
    const b = m[2] ? Math.round(Number(m[2].replace(',', '.')) * unit) : null;
    return { restSec: num(a, 0, 1800), restSecMax: b !== null && b > a ? num(b, 0, 1800) : null };
  }

  /** "Mon - Lower A (quads)" → {weekday:1, label:'Lower A', focus:'quads'}; "Lower A" → weekday null. */
  function parseDayLabel(text) {
    let s = String(text == null ? '' : text).trim();
    let weekday = null;
    const wd = s.match(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*(?:[-–—:|]\s*)?/i);
    if (wd) { weekday = weekdayNumber(wd[1]); s = s.slice(wd[0].length); }
    let focus = '';
    const f = s.match(/\(([^)]*)\)\s*$/);
    if (f) { focus = f[1].trim(); s = s.slice(0, f.index).trim(); }
    return { weekday, label: str(s, LIMITS.label), focus: str(focus, LIMITS.focus) };
  }

  /** "Week 3" / "W3" / 3 → 3. */
  function parseWeek(text) {
    const m = String(text == null ? '' : text).match(/(\d{1,2})/);
    return m ? int(m[1], 1, LIMITS.weeks) : null;
  }

  /**
   * Quick entry for one row: "Squat 4x6-8 @2 2-3min" → name, sets, reps,
   * RIR ("@3", "@3/2" = last set 2, "RIR 2"), rest ("90s", "2-3 min").
   * Anything not recognised stays in the name. Sets×reps optional (3×10).
   */
  function parseQuickEntry(line) {
    let s = String(line == null ? '' : line).trim();
    const row = { name: '', sets: 3, repsMin: 10, repsMax: null, rir: null, lastSetRir: null, restSec: null, restSecMax: null };
    const rest = s.match(/\s+(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:s|sec|secs|m|min|mins)\b\.?)/i);
    if (rest) { Object.assign(row, parseRest(rest[1])); s = (s.slice(0, rest.index) + s.slice(rest.index + rest[0].length)).trim(); }
    const rir = s.match(/\s+(?:@\s*|rir\s*)(\d(?:\.\d)?(?:\s*\/\s*\d(?:\.\d)?)?)/i);
    if (rir) { Object.assign(row, parseRir(rir[1])); s = (s.slice(0, rir.index) + s.slice(rir.index + rir[0].length)).trim(); }
    const sr = s.match(/\s+(\d{1,2})\s*[x×]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*$/i);
    if (sr) {
      row.sets = Number(sr[1]);
      row.repsMin = Number(sr[2]);
      row.repsMax = sr[3] && Number(sr[3]) > row.repsMin ? Number(sr[3]) : null;
      s = s.slice(0, sr.index).trim();
    }
    row.name = str(s, LIMITS.name);
    return row;
  }

  /** Best guess at compound / isolation / core from the exercise name; the coach can change it. */
  function guessType(name) {
    const n = String(name || '').toLowerCase();
    if (/\b(ab[- ]?wheel|roll-?out|plank|crunch|sit-?up|pallof|hanging (leg|knee) raise|leg raise|dead ?bug|hollow|side bend|woodchop|ab |abs\b|core)/.test(n)) return 'core';
    if (/(pressdown|push-?down|kickback|fly|flye|pec-?deck|raise|curl|extension|pullover|shrug|calf|adduct|abduct|face pull)/.test(n)
      && !/(hip thrust|back extension or|or hip thrust)/.test(n)) return 'isolation';
    if (/(squat|deadlift|\brdl\b|lunge|leg press|hip thrust|good ?morning|press|row|pulldown|pull-?down|pull-?up|chin-?up|dip|clean|snatch|step-?up|hack)/.test(n)) return 'compound';
    return 'isolation';
  }

  // ── normalisation ─────────────────────────────────────────────────────────

  function normalizeExercise(src, fallbackId) {
    const e = src && typeof src === 'object' ? src : (typeof src === 'string' ? { name: src } : null);
    if (!e) return null;
    const name = str(e.name, LIMITS.name);
    if (!name) return null;
    let repsMin = int(e.repsMin !== undefined ? e.repsMin : e.reps, 1, 100);
    let repsMax = int(e.repsMax, 1, 100);
    if (repsMin === null && repsMax !== null) { repsMin = repsMax; repsMax = null; }
    if (repsMax !== null && repsMin !== null && repsMax <= repsMin) repsMax = null;
    const rir = num(e.rir, 0, 10);
    let lastSetRir = num(e.lastSetRir, 0, 10);
    if (lastSetRir === rir) lastSetRir = null;
    const restSec = int(e.restSec, 0, 1800);
    let restSecMax = int(e.restSecMax, 0, 1800);
    if (restSecMax !== null && (restSec === null || restSecMax <= restSec)) restSecMax = null;
    return {
      id: str(e.id, 64) || fallbackId,
      name,
      type: TYPES.includes(e.type) ? e.type : null,
      sets: int(e.sets, 1, 20) || 3,
      repsMin: repsMin === null && e.repsMin === undefined && e.reps === undefined ? 10 : repsMin,
      repsMax,
      rir,
      lastSetRir,
      restSec,
      restSecMax,
      notes: str(e.notes, LIMITS.notes),
    };
  }

  function normalizeDay(src, index, weekNo) {
    const d = src && typeof src === 'object' ? src : {};
    const parsed = typeof d.name === 'string' && !d.label ? parseDayLabel(d.name) : null;
    const weekday = weekdayNumber(d.weekday) || (parsed && parsed.weekday) || null;
    const dayId = str(d.dayId, 64) || 'd' + (index + 1);
    const exercises = (Array.isArray(d.exercises) ? d.exercises : [])
      .map((e, j) => normalizeExercise(e, 'w' + weekNo + '-' + dayId + '-e' + (j + 1)))
      .filter(Boolean)
      .slice(0, LIMITS.exercises);
    return {
      dayId,
      weekday,
      label: str(d.label, LIMITS.label) || (parsed ? parsed.label : '') || (weekday ? WEEKDAYS[weekday - 1] : 'Day ' + (index + 1)),
      focus: str(d.focus, LIMITS.focus) || (parsed ? parsed.focus : ''),
      notes: str(d.notes, LIMITS.notes),
      exercises,
    };
  }

  function sortDays(days) {
    return days.slice().sort((a, b) => (a.weekday || 99) - (b.weekday || 99));
  }

  // Library-shape exercise (per-set array) → v2 row.
  function rowFromLibraryExercise(ex) {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    const first = sets[0] || {};
    const last = sets[sets.length - 1] || {};
    return {
      id: ex.exerciseId || ex.id,
      name: ex.name,
      type: ex.type,
      sets: sets.length || ex.sets,
      repsMin: first.reps,
      repsMax: first.repsMax,
      rir: first.rir,
      lastSetRir: sets.length > 1 ? last.rir : null,
      restSec: first.restSec,
      restSecMax: first.restSecMax,
      notes: ex.notes,
    };
  }

  function isLibraryShape(p) {
    const firstDays = Array.isArray(p.days) ? p.days : (Array.isArray(p.weeks) && p.weeks.find(w => Array.isArray(w && w.days)) || {}).days;
    const ex = Array.isArray(firstDays) && firstDays.find(d => d && Array.isArray(d.exercises) && d.exercises.length);
    return !!(ex && Array.isArray(ex.exercises[0].sets));
  }

  function fromLibrary(p) {
    const weekday = (p.schedule && Array.isArray(p.schedule.weekdays) ? p.schedule.weekdays : [])
      .concat((Array.isArray(p.frequency) ? p.frequency : []).map(weekdayNumber))
      .filter(Boolean);
    const convertDays = list => (Array.isArray(list) ? list : []).map((d, i) => ({
      dayId: d.dayId,
      weekday: d.weekday || weekday[i] || null,
      label: d.label,
      name: d.name,
      focus: d.focus,
      notes: d.notes,
      exercises: (d.exercises || []).map(rowFromLibraryExercise),
    }));
    const weeks = Array.isArray(p.weeks) && p.weeks.length
      ? p.weeks.map(w => (w && w.sameAs ? { week: w.week, sameAs: w.sameAs, label: w.label } : { week: w.week, label: w.label, note: w.phase || w.note || '', days: convertDays(w.days) }))
      : [{ week: 1, days: convertDays(p.days) }];
    return { name: p.title || p.name, notes: p.summary || p.notes, progressionNotes: p.progressionNotes, rules: p.rules, weeks };
  }

  function fromV1(p) {
    const days = [];
    const map = p.days && typeof p.days === 'object' && !Array.isArray(p.days) ? p.days : {};
    WEEKDAYS.forEach((d, i) => {
      const list = Array.isArray(map[d]) ? map[d] : [];
      if (list.length) days.push({ dayId: 'd' + (days.length + 1), weekday: i + 1, exercises: list });
    });
    return { name: p.name, notes: p.notes, weeks: [{ week: 1, days }] };
  }

  /** Any supported program shape → normalised v2, or null without a name. */
  function readProgram(input) {
    const src = input && typeof input === 'object' ? input : {};
    let p;
    // Library rows carry a per-set array; v2 rows carry a set count.
    if (isLibraryShape(src)) p = fromLibrary(src);
    else if (src.schema === SCHEMA || Array.isArray(src.weeks)) p = src;
    else p = fromV1(src);

    const name = str(p.name, LIMITS.name);
    if (!name) return null;
    const rawWeeks = (Array.isArray(p.weeks) ? p.weeks : []).slice(0, LIMITS.weeks);
    const weeks = [];
    rawWeeks.forEach((w, i) => {
      const src2 = w && typeof w === 'object' ? w : {};
      const week = i + 1; // weeks are always 1..N in order
      const label = str(src2.label, LIMITS.label) || 'Week ' + week;
      const sameAs = int(src2.sameAs, 1, LIMITS.weeks);
      if (sameAs && sameAs < week && weeks[sameAs - 1] && weeks[sameAs - 1].days) {
        weeks.push({ week, label, sameAs });
        return;
      }
      const days = sortDays((Array.isArray(src2.days) ? src2.days : []).slice(0, LIMITS.days).map((d, j) => normalizeDay(d, j, week)));
      weeks.push({ week, label, note: str(src2.note, LIMITS.notes), days });
    });
    if (!weeks.length) weeks.push({ week: 1, label: 'Week 1', note: '', days: [] });
    return {
      schema: SCHEMA,
      name,
      notes: str(p.notes, LIMITS.programNotes),
      progressionNotes: str(p.progressionNotes, LIMITS.programNotes),
      rules: (Array.isArray(p.rules) ? p.rules : []).map(r => str(r, LIMITS.notes)).filter(Boolean).slice(0, LIMITS.rules),
      weeks,
    };
  }

  // ── reading a normalised v2 program ───────────────────────────────────────

  /** The days of 1-based `week` (sameAs resolved), or [] past the end. */
  function weekDays(program, week) {
    const w = program && program.weeks ? program.weeks[week - 1] : null;
    if (!w) return [];
    if (w.days) return w.days;
    const target = program.weeks[w.sameAs - 1];
    return (target && target.days) || [];
  }

  function stats(program) {
    const weekCount = program.weeks.length;
    let exerciseCount = 0;
    let dayCount = 0;
    for (let i = 1; i <= weekCount; i++) {
      const days = weekDays(program, i);
      dayCount = Math.max(dayCount, days.length);
      days.forEach(d => { exerciseCount += d.exercises.length; });
    }
    const weekdays = Array.from(new Set(weekDays(program, 1).map(d => d.weekday).filter(Boolean))).sort();
    return { weekCount, dayCount, exerciseCount, weekdays };
  }

  /** Things worth a second look, each pinned to where it is. */
  function validate(program) {
    const warnings = [];
    const add = (where, message) => warnings.push(Object.assign({ message }, where));
    const firstWeekdays = JSON.stringify(weekDays(program, 1).map(d => d.weekday));
    program.weeks.forEach(w => {
      if (w.sameAs) return;
      if (!w.days.length) add({ week: w.week }, 'Week ' + w.week + ' has no training days.');
      if (JSON.stringify(w.days.map(d => d.weekday)) !== firstWeekdays) add({ week: w.week }, 'Week ' + w.week + ' trains on different weekdays than week 1.');
      const seen = new Set();
      w.days.forEach(d => {
        if (!d.weekday) add({ week: w.week, dayId: d.dayId }, d.label + ': pick a weekday.');
        else if (seen.has(d.weekday)) add({ week: w.week, dayId: d.dayId }, d.label + ': two days on ' + WEEKDAYS[d.weekday - 1] + '.');
        seen.add(d.weekday);
        if (!d.exercises.length) add({ week: w.week, dayId: d.dayId }, d.label + ' has no exercises.');
        d.exercises.forEach(e => {
          const at = { week: w.week, dayId: d.dayId, exerciseId: e.id };
          if (e.repsMin === null) add(at, e.name + ': no reps.');
          if (e.rir === null && e.type !== 'core') add(at, e.name + ': no target RIR.');
          if (e.lastSetRir !== null && e.rir !== null && e.lastSetRir > e.rir) add(at, e.name + ': last-set RIR is higher than the other sets.');
        });
      });
    });
    return warnings;
  }

  /** Copy week n onto week n+1 (replacing it, or appending). Returns a new program. */
  function copyWeek(program, week) {
    const next = clone(program);
    const days = clone(weekDays(program, week)).map(d => Object.assign(d, {
      exercises: d.exercises.map(e => Object.assign(e, { id: e.id.replace(/^w\d+-/, 'w' + (week + 1) + '-') })),
    }));
    const target = { week: week + 1, label: 'Week ' + (week + 1), note: '', days };
    if (next.weeks[week]) next.weeks[week] = Object.assign(target, { label: next.weeks[week].label || target.label });
    else if (next.weeks.length < LIMITS.weeks) next.weeks.push(target);
    return next;
  }

  /** Row → one line: "Squat 4×6–8 · RIR 2 (last set 1) · rest 2–3 min". */
  function formatRow(e) {
    const reps = e.repsMin === null ? '?' : (e.repsMax ? e.repsMin + '–' + e.repsMax : String(e.repsMin));
    let out = e.name + ' ' + e.sets + '×' + reps;
    if (e.rir !== null) out += ' · RIR ' + e.rir + (e.lastSetRir !== null ? ' (last set ' + e.lastSetRir + ')' : '');
    if (e.restSec !== null) out += ' · rest ' + formatRest(e.restSec, e.restSecMax);
    return out;
  }

  function formatRest(a, b) {
    const fmt = s => (s % 60 === 0 ? String(s / 60) : (s / 60).toFixed(1).replace(/\.0$/, ''));
    if (a === null || a === undefined) return '';
    if (a < 60 && !b) return a + ' s';
    return fmt(a) + (b ? '–' + fmt(b) : '') + ' min';
  }

  // ── v2 → the app's library program shape ──────────────────────────────────

  function libraryDay(d, week) {
    return {
      dayId: d.dayId,
      name: d.label,
      weekday: d.weekday,
      ...(d.focus ? { focus: d.focus } : {}),
      notes: d.notes,
      exercises: d.exercises.map(e => {
        const set = i => {
          const rir = i === e.sets - 1 && e.lastSetRir !== null ? e.lastSetRir : e.rir;
          return {
            reps: e.repsMin,
            ...(e.repsMax ? { repsMax: e.repsMax } : {}),
            rir,
            restSec: e.restSec === null ? 120 : e.restSec,
            ...(e.restSecMax ? { restSecMax: e.restSecMax } : {}),
          };
        };
        return {
          exerciseId: e.id || ('w' + week + '-' + d.dayId + '-' + slug(e.name)),
          name: e.name,
          ...(e.type ? { type: e.type } : {}),
          ...(e.notes ? { notes: e.notes } : {}),
          sets: Array.from({ length: e.sets }, (_, i) => set(i)),
        };
      }),
    };
  }

  /** meta: { id, coachUsername, rev } */
  function toLibrary(program, meta) {
    const m = meta || {};
    const s = stats(program);
    const days = weekDays(program, 1).map(d => libraryDay(d, 1));
    const out = {
      id: m.id || ('coach-' + slug(m.coachUsername) + '-' + slug(program.name)),
      authoredAs: SCHEMA,
      title: program.name,
      summary: program.notes,
      progressionNotes: [program.progressionNotes].concat(program.rules).filter(Boolean).join('\n'),
      frequency: s.weekdays.map(n => WEEKDAYS[n - 1]),
      schedule: { startDate: '', weekdays: s.weekdays },
      split: { type: 'custom', name: program.name, daysPerWeek: days.length },
      progressionType: 'double-progression',
      days,
      assignedBy: m.coachUsername || '',
      rev: m.rev || null,
    };
    if (program.weeks.length > 1) {
      out.weeks = program.weeks.map(w => (w.sameAs
        ? { week: w.week, label: w.label, sameAs: w.sameAs }
        : { week: w.week, label: w.label, phase: w.note || '', days: w.days.map(d => libraryDay(d, w.week)) }));
      out.durationWeeks = program.weeks.length;
    }
    return out;
  }

  /** Week 1 as the v1 { Mon: [{ name, sets, reps, repsMax }] } map, for app builds that only read that. */
  function toV1Days(program) {
    const days = {};
    WEEKDAYS.forEach(d => { days[d] = []; });
    weekDays(program, 1).forEach(d => {
      if (!d.weekday) return;
      days[WEEKDAYS[d.weekday - 1]] = d.exercises.map(e => Object.assign(
        { name: e.name, sets: e.sets, reps: e.repsMin === null ? 10 : e.repsMin },
        e.repsMax ? { repsMax: e.repsMax } : {},
        e.notes ? { notes: e.notes } : {}
      ));
    });
    return days;
  }

  return {
    SCHEMA, WEEKDAYS, TYPES, LIMITS,
    readProgram, weekDays, stats, validate, copyWeek, toLibrary, toV1Days,
    parseQuickEntry, parseReps, parseRir, parseRest, parseDayLabel, parseWeek,
    formatRow, formatRest, weekdayNumber, guessType,
  };
});
