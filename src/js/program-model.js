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
 *     blocks?: [{ id, name, goal }],
 *     volume?: { [muscle]: { mev, mav, mrv } },
 *     weeks: [{ week, label, note, block?, deload?, days: [{ dayId, weekday 1-7, label, focus, notes,
 *       exercises: [{ id, name, type, sets, repsMin, repsMax, rir, lastSetRir,
 *                     restSec, restSecMax, notes, loadPct?, loadKg?, muscle? }] }] }
 *             | { week, sameAs, block?, deload? } ] }
 *
 * Blocks are mesocycles: each week names the block it belongs to (`block` =
 * a block id) and may be a deload week. A block's weeks are the weeks that
 * name it, normally one consecutive run. `loadPct` (% of 1RM) or `loadKg` is
 * an optional load target on a row.
 *
 * Volume landmarks: `volume` holds the coach's MEV / MAV / MRV (weekly hard
 * sets per muscle: minimum effective, maximum adaptive, maximum recoverable)
 * for muscles where they differ from DEFAULT_LANDMARKS. A row's `muscle`
 * overrides the muscle the caller's name lookup would give it. The model has
 * no exercise→muscle table: callers pass `muscleOf(row)`.
 *
 * The optional keys are left out when not set, so programs without them
 * read exactly as before.
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
  const MUSCLES = ['chest', 'back', 'shoulders', 'traps', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors', 'abs'];
  // Weekly hard sets per muscle. Commonly published ballparks
  // (Renaissance Periodization style), a starting point the coach edits per
  // program: MEV = least that grows, MAV = where most growth happens,
  // MRV = most that can be recovered from.
  const DEFAULT_LANDMARKS = {
    chest: { mev: 8, mav: 16, mrv: 22 },
    back: { mev: 10, mav: 18, mrv: 25 },
    shoulders: { mev: 8, mav: 19, mrv: 26 },
    traps: { mev: 4, mav: 16, mrv: 26 },
    biceps: { mev: 8, mav: 17, mrv: 26 },
    triceps: { mev: 6, mav: 12, mrv: 18 },
    forearms: { mev: 2, mav: 10, mrv: 20 },
    quads: { mev: 8, mav: 15, mrv: 20 },
    hamstrings: { mev: 6, mav: 13, mrv: 20 },
    glutes: { mev: 4, mav: 8, mrv: 16 },
    calves: { mev: 8, mav: 14, mrv: 20 },
    adductors: { mev: 2, mav: 8, mrv: 14 },
    abductors: { mev: 2, mav: 8, mrv: 14 },
    abs: { mev: 4, mav: 16, mrv: 25 },
  };
  const LIMITS = { weeks: 52, days: 7, exercises: 20, name: 80, label: 40, focus: 60, notes: 300, programNotes: 4000, rules: 20, blocks: 16, blockGoal: 200 };

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

  /** "75%" → {loadPct:75}; "100kg" / "100 kg" / "100" → {loadKg:100}; "" / "-" → nulls. */
  function parseLoad(text) {
    const s = String(text == null ? '' : text).trim().toLowerCase().replace(',', '.');
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(%|kg|kgs)?(?:\s*1rm)?$/);
    if (!m) return { loadPct: null, loadKg: null };
    if (m[2] === '%') return { loadPct: roundTo(num(m[1], 1, 120), 0.5), loadKg: null };
    return { loadPct: null, loadKg: roundTo(num(m[1], 0, 1000), 0.25) };
  }

  function roundTo(n, step) {
    return n === null ? null : Math.round(n / step) * step;
  }

  /**
   * One sheet cell: "4x6-8 @2/1 75%" → only the fields it names
   * ({ sets, repsMin, repsMax, rir, lastSetRir, loadPct | loadKg }).
   * Returns null for a blank cell or "-" (no row that week).
   */
  function parseCell(text) {
    let s = String(text == null ? '' : text).trim();
    if (!s || /^[-–—x]+$/i.test(s)) return null;
    const out = {};
    const load = s.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(%|kg)(?=\s|$)/i);
    if (load) { Object.assign(out, parseLoad(load[1] + load[2])); s = (s.slice(0, load.index) + ' ' + s.slice(load.index + load[0].length)).trim(); }
    const rir = s.match(/(?:^|\s)(?:@\s*|rir\s*)(\d(?:\.\d)?(?:\s*\/\s*\d(?:\.\d)?)?)/i);
    if (rir) { Object.assign(out, parseRir(rir[1])); s = (s.slice(0, rir.index) + ' ' + s.slice(rir.index + rir[0].length)).trim(); }
    const sr = s.match(/^(\d{1,2})\s*[x×]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/i);
    if (sr) {
      out.sets = int(sr[1], 1, 20) || 3;
      out.repsMin = int(sr[2], 1, 100);
      out.repsMax = sr[3] && Number(sr[3]) > Number(sr[2]) ? int(sr[3], 1, 100) : null;
    } else if (s) {
      const sets = s.match(/^(\d{1,2})\s*(?:sets?)?$/i);
      if (sets) out.sets = int(sets[1], 1, 20) || 3;
    }
    return out;
  }

  /** Row → sheet cell text, the inverse of parseCell: "4×6-8 @2/1 75%". */
  function formatCell(e) {
    const reps = e.repsMin === null || e.repsMin === undefined ? '?' : (e.repsMax ? e.repsMin + '-' + e.repsMax : String(e.repsMin));
    let out = e.sets + '×' + reps;
    if (e.rir !== null && e.rir !== undefined) out += ' @' + e.rir + (e.lastSetRir !== null && e.lastSetRir !== undefined ? '/' + e.lastSetRir : '');
    const load = formatLoad(e);
    return load ? out + ' ' + load : out;
  }

  function formatLoad(e) {
    if (e && e.loadPct !== null && e.loadPct !== undefined) return e.loadPct + '%';
    if (e && e.loadKg !== null && e.loadKg !== undefined) return e.loadKg + 'kg';
    return '';
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
   * RIR ("@3", "@3/2" = last set 2, "RIR 2"), rest ("90s", "2-3 min"),
   * load ("75%" of 1RM or "100kg").
   * Anything not recognised stays in the name. Sets×reps optional (3×10).
   */
  function parseQuickEntry(line) {
    let s = String(line == null ? '' : line).trim();
    const row = { name: '', sets: 3, repsMin: 10, repsMax: null, rir: null, lastSetRir: null, restSec: null, restSecMax: null };
    const rest = s.match(/\s+(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:s|sec|secs|m|min|mins)\b\.?)/i);
    if (rest) { Object.assign(row, parseRest(rest[1])); s = (s.slice(0, rest.index) + s.slice(rest.index + rest[0].length)).trim(); }
    const load = s.match(/\s+(\d+(?:[.,]\d+)?)\s*(%|kg)(?=\s|$)/i);
    if (load) {
      const l = parseLoad(load[1] + load[2]);
      if (l.loadPct !== null) row.loadPct = l.loadPct;
      if (l.loadKg !== null) row.loadKg = l.loadKg;
      s = (s.slice(0, load.index) + s.slice(load.index + load[0].length)).trim();
    }
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
    const loadPct = roundTo(num(e.loadPct, 1, 120), 0.5);
    const loadKg = loadPct === null ? roundTo(num(e.loadKg, 0, 1000), 0.25) : null;
    // Superset letter: rows in a day with the same letter are done back to
    // back (the app alternates them and shortens the rest between them).
    const superset = typeof e.superset === 'string' && /^[A-H]$/.test(e.superset.trim().toUpperCase()) ? e.superset.trim().toUpperCase() : null;
    return Object.assign({
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
    }, loadPct !== null ? { loadPct } : {}, loadKg !== null ? { loadKg } : {}, MUSCLES.includes(e.muscle) ? { muscle: e.muscle } : {},
    superset ? { superset } : {});
  }

  /** { chest: { mev, mav, mrv }, … } → only known muscles, whole sets 0–60, mev ≤ mav ≤ mrv. */
  function normalizeVolume(src) {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    MUSCLES.forEach(m => {
      const v = src[m];
      if (!v || typeof v !== 'object') return;
      const vals = [int(v.mev, 0, 60), int(v.mav, 0, 60), int(v.mrv, 0, 60)];
      if (vals.some(x => x === null)) return;
      vals.sort((a, b) => a - b);
      out[m] = { mev: vals[0], mav: vals[1], mrv: vals[2] };
    });
    return out;
  }

  /** The MEV / MAV / MRV in use for a muscle: the program's own, else the default, else null. */
  function landmarks(program, muscle) {
    return (program && program.volume && program.volume[muscle]) || DEFAULT_LANDMARKS[muscle] || null;
  }

  /** Where `sets` sits: 'below' MEV, 'productive' (MEV–MAV), 'high' (MAV–MRV) or 'over' MRV. */
  function volumeZone(sets, lm) {
    if (!lm) return null;
    if (sets < lm.mev) return 'below';
    if (sets <= lm.mav) return 'productive';
    if (sets <= lm.mrv) return 'high';
    return 'over';
  }

  function rowMuscle(row, muscleOf) {
    if (row && MUSCLES.includes(row.muscle)) return row.muscle;
    const m = typeof muscleOf === 'function' ? muscleOf(row) : null;
    return MUSCLES.includes(m) ? m : 'other';
  }

  /** Weekly sets per muscle in `week`: { quads: 12, other: 2, … }. */
  function muscleSets(program, week, muscleOf) {
    const out = {};
    weekDays(program, week).forEach(d => d.exercises.forEach(e => {
      const m = rowMuscle(e, muscleOf);
      out[m] = (out[m] || 0) + (Number(e.sets) || 0);
    }));
    return out;
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
      loadPct: first.percent1RM,
      loadKg: first.percent1RM ? null : first.weight,
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
    const blocks = [];
    (Array.isArray(p.blocks) ? p.blocks : []).forEach((b, i) => {
      if (!b || typeof b !== 'object' || blocks.length >= LIMITS.blocks) return;
      const name = str(b.name, LIMITS.label);
      if (!name) return;
      let id = str(b.id, 24).replace(/[^a-zA-Z0-9_-]/g, '') || 'b' + (i + 1);
      while (blocks.some(x => x.id === id)) id += 'x';
      blocks.push({ id, name, goal: str(b.goal, LIMITS.blockGoal) });
    });
    const blockIds = new Set(blocks.map(b => b.id));
    const weekExtras = src2 => Object.assign({},
      typeof src2.block === 'string' && blockIds.has(src2.block) ? { block: src2.block } : {},
      src2.deload === true ? { deload: true } : {});
    const rawWeeks = (Array.isArray(p.weeks) ? p.weeks : []).slice(0, LIMITS.weeks);
    const weeks = [];
    rawWeeks.forEach((w, i) => {
      const src2 = w && typeof w === 'object' ? w : {};
      const week = i + 1; // weeks are always 1..N in order
      const label = str(src2.label, LIMITS.label) || 'Week ' + week;
      const sameAs = int(src2.sameAs, 1, LIMITS.weeks);
      if (sameAs && sameAs < week && weeks[sameAs - 1] && weeks[sameAs - 1].days) {
        weeks.push(Object.assign({ week, label, sameAs }, weekExtras(src2)));
        return;
      }
      const days = sortDays((Array.isArray(src2.days) ? src2.days : []).slice(0, LIMITS.days).map((d, j) => normalizeDay(d, j, week)));
      weeks.push(Object.assign({ week, label, note: str(src2.note, LIMITS.notes) }, weekExtras(src2), { days }));
    });
    if (!weeks.length) weeks.push({ week: 1, label: 'Week 1', note: '', days: [] });
    // Blocks no week belongs to are dropped.
    const used = blocks.filter(b => weeks.some(w => w.block === b.id));
    const volume = normalizeVolume(p.volume);
    return Object.assign({
      schema: SCHEMA,
      name,
      notes: str(p.notes, LIMITS.programNotes),
      progressionNotes: str(p.progressionNotes, LIMITS.programNotes),
      rules: (Array.isArray(p.rules) ? p.rules : []).map(r => str(r, LIMITS.notes)).filter(Boolean).slice(0, LIMITS.rules),
    }, used.length ? { blocks: used } : {}, Object.keys(volume).length ? { volume } : {}, { weeks });
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
    return { weekCount, dayCount, exerciseCount, weekdays, blockCount: (program.blocks || []).length };
  }

  /**
   * The program's mesocycles in week order: one entry per consecutive run of
   * weeks in the same block, { block: {id,name,goal} | null, from, to, deloads: [week] }.
   * Weeks outside any block form runs with block null.
   */
  function blockRuns(program) {
    const byId = new Map((program.blocks || []).map(b => [b.id, b]));
    const runs = [];
    program.weeks.forEach(w => {
      const block = (w.block && byId.get(w.block)) || null;
      const last = runs[runs.length - 1];
      if (last && last.block === block) last.to = w.week;
      else runs.push({ block, from: w.week, to: w.week, deloads: [] });
      if (w.deload) runs[runs.length - 1].deloads.push(w.week);
    });
    return runs;
  }

  /** Total sets per week (sameAs resolved): [{ week, sets }]. */
  function weeklySets(program) {
    return program.weeks.map(w => ({
      week: w.week,
      sets: weekDays(program, w.week).reduce((n, d) => n + d.exercises.reduce((m, e) => m + e.sets, 0), 0),
    }));
  }

  /**
   * Fill weeks from..to from week `from` (the template), the way a coach
   * would drag a progression across a spreadsheet. Returns a new program.
   *   opts.rirStart / rirEnd   RIR on the first / last training week (linear
   *                            in between, steps of 0.5). Null keeps each row's RIR.
   *   opts.setsPerWeek         sets added per week (0 = same), capped at opts.setsMax
   *                            (also the most sets one row gets in a volume ramp).
   *   opts.pctPerWeek          %1RM added per week on rows with a % load.
   *   opts.kgPerWeek           kg added per week on rows with a kg load.
   *   opts.repsPerWeek         reps added per week to both ends of each row's
   *                            range (-1: 10-12 → 9-11 → 8-10), at least 1.
   *   opts.volumeFrom / volumeTo   'mev' | 'mav' | 'mrv': each muscle's weekly
   *                            sets go from that landmark on the first week to
   *                            the other on the last training week, shared
   *                            over the muscle's rows by their template sets.
   *                            Replaces setsPerWeek for muscles with landmarks;
   *                            opts.muscleOf(row) names a row's muscle.
   *   opts.deloadLast          the last week is a deload: about half the sets
   *                            (opts.deloadSetsFactor, default 0.5), RIR +2 on
   *                            the template, loads -10%.
   * Rows without a RIR (e.g. core) keep none. Last-set RIR keeps its gap to
   * the other sets. Week labels, notes and blocks are kept.
   */
  function progressWeeks(program, from, to, opts) {
    const o = opts || {};
    const next = clone(program);
    const start = Math.max(1, from);
    const end = Math.min(to, next.weeks.length);
    if (end < start) return next;
    const template = clone(weekDays(program, start));
    const deloadLast = !!o.deloadLast && end > start;
    const training = (deloadLast ? end - 1 : end) - start + 1;
    const rirStart = num(o.rirStart, 0, 10);
    const rirEnd = num(o.rirEnd, 0, 10);
    const setsPerWeek = int(o.setsPerWeek, -5, 5) || 0;
    const setsMax = int(o.setsMax, 1, 20) || 20;
    const pctPerWeek = num(o.pctPerWeek, -20, 20) || 0;
    const kgPerWeek = num(o.kgPerWeek, -50, 50) || 0;
    const factor = num(o.deloadSetsFactor, 0.1, 1) || 0.5;
    const repsPerWeek = int(o.repsPerWeek, -10, 10) || 0;
    const half = x => Math.round(x * 2) / 2;
    const LANDMARK_KEYS = ['mev', 'mav', 'mrv'];
    const ramp = LANDMARK_KEYS.includes(o.volumeFrom) && LANDMARK_KEYS.includes(o.volumeTo);
    // Template sets per muscle (rows across every day of the template week).
    const muscleOfRow = new Map();
    const templateSets = {};
    template.forEach(d => d.exercises.forEach(e => {
      const m = rowMuscle(e, o.muscleOf);
      muscleOfRow.set(e, m);
      templateSets[m] = (templateSets[m] || 0) + e.sets;
    }));
    const rampSets = new Map(); // week → Map(row → sets)
    if (ramp) {
      for (let week = start; week <= end - (deloadLast ? 1 : 0); week++) {
        const t = training > 1 ? (week - start) / (training - 1) : 0;
        const sets = new Map();
        Object.keys(templateSets).forEach(m => {
          const lm = landmarks(program, m);
          if (!lm || m === 'other' || !templateSets[m]) return;
          const target = Math.round(lm[o.volumeFrom] + (lm[o.volumeTo] - lm[o.volumeFrom]) * t);
          const rows = [];
          template.forEach(d => d.exercises.forEach(e => { if (muscleOfRow.get(e) === m) rows.push(e); }));
          // Share the target by template sets (largest remainder), at least 1
          // and at most setsMax a row: one exercise never carries a whole MRV.
          // Past what the rows can hold, the muscle stays short of its target
          // (the coach adds an exercise).
          const cap = setsMax;
          const raw = rows.map(e => target * e.sets / templateSets[m]);
          const got = raw.map(x => Math.max(1, Math.min(cap, Math.floor(x))));
          let left = target - got.reduce((a, b) => a + b, 0);
          const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
          for (let i = 0; left > 0 && i < order.length * cap; i++) {
            const j = order[i % order.length][1];
            if (got[j] < cap) { got[j]++; left--; }
          }
          rows.forEach((e, i) => sets.set(e, got[i]));
        });
        rampSets.set(week, sets);
      }
    }

    for (let week = start; week <= end; week++) {
      const k = week - start;
      const isDeload = deloadLast && week === end;
      const t = training > 1 ? Math.min(1, k / (training - 1)) : 0;
      const days = template.map(td => Object.assign(clone(td), {
        exercises: td.exercises.map((e, j) => {
          const row = Object.assign({}, e, { id: 'w' + week + '-' + td.dayId + '-e' + (j + 1) });
          const gap = e.rir !== null && e.lastSetRir !== null ? e.rir - e.lastSetRir : null;
          if (isDeload) {
            row.sets = Math.max(1, Math.round(e.sets * factor));
            if (e.rir !== null) row.rir = Math.min(10, (rirStart !== null ? rirStart : e.rir) + 2);
            row.lastSetRir = null;
            // 90% of the template load, rounded down to a 2.5 step.
            if (e.loadPct != null) row.loadPct = Math.max(1, Math.floor(e.loadPct * 0.9 / 2.5) * 2.5);
            if (e.loadKg != null) row.loadKg = Math.floor(e.loadKg * 0.9 / 2.5) * 2.5;
            return row;
          }
          const ramped = rampSets.get(week) && rampSets.get(week).get(e);
          row.sets = ramped !== undefined ? ramped : Math.max(1, Math.min(Math.max(setsMax, e.sets), e.sets + setsPerWeek * k));
          if (repsPerWeek && e.repsMin !== null) {
            row.repsMin = Math.max(1, Math.min(100, e.repsMin + repsPerWeek * k));
            row.repsMax = e.repsMax !== null ? Math.max(row.repsMin + 1, Math.min(100, e.repsMax + repsPerWeek * k)) : null;
          }
          if (e.rir !== null && rirStart !== null) {
            row.rir = half(rirStart + ((rirEnd !== null ? rirEnd : rirStart) - rirStart) * t);
            row.lastSetRir = gap !== null ? Math.max(0, half(row.rir - gap)) : null;
            if (row.lastSetRir === row.rir) row.lastSetRir = null;
          }
          if (e.loadPct != null && pctPerWeek) row.loadPct = Math.max(1, Math.min(120, half(e.loadPct + pctPerWeek * k)));
          if (e.loadKg != null && kgPerWeek) row.loadKg = Math.max(0, Math.round((e.loadKg + kgPerWeek * k) * 4) / 4);
          return row;
        }),
      }));
      const w = next.weeks[week - 1];
      const keep = { week, label: w.label, note: w.note || '' };
      if (w.block) keep.block = w.block;
      if (isDeload) keep.deload = true;
      else if (w.deload && !(deloadLast)) keep.deload = true;
      next.weeks[week - 1] = Object.assign(keep, { days });
    }
    return readProgram(next) || next;
  }

  /** Things worth a second look, each pinned to where it is. */
  function validate(program) {
    const warnings = [];
    const add = (where, message) => warnings.push(Object.assign({ message }, where));
    const seenBlocks = new Set();
    blockRuns(program).forEach(r => {
      if (!r.block) return;
      if (seenBlocks.has(r.block.id)) add({ week: r.from }, r.block.name + ' is split: weeks ' + r.from + '–' + r.to + ' are apart from its other weeks.');
      seenBlocks.add(r.block.id);
    });
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
    const existing = next.weeks[week];
    if (existing) {
      next.weeks[week] = Object.assign(target, { label: existing.label || target.label, note: existing.note || '' },
        existing.block ? { block: existing.block } : {}, existing.deload ? { deload: true } : {});
    } else if (next.weeks.length < LIMITS.weeks) {
      const src = program.weeks[week - 1];
      if (src && src.block) target.block = src.block;
      next.weeks.push(target);
    }
    return next;
  }

  /** Row → one line: "Squat 4×6–8 · RIR 2 (last set 1) · rest 2–3 min". */
  function formatRow(e) {
    const reps = e.repsMin === null ? '?' : (e.repsMax ? e.repsMin + '–' + e.repsMax : String(e.repsMin));
    let out = e.name + ' ' + e.sets + '×' + reps;
    if (e.rir !== null) out += ' · RIR ' + e.rir + (e.lastSetRir !== null ? ' (last set ' + e.lastSetRir + ')' : '');
    if (formatLoad(e)) out += ' · ' + (e.loadPct != null ? e.loadPct + '% 1RM' : e.loadKg + ' kg');
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
            ...(e.loadKg !== undefined && e.loadKg !== null ? { weight: e.loadKg } : {}),
            ...(e.loadPct !== undefined && e.loadPct !== null ? { percent1RM: e.loadPct } : {}),
          };
        };
        return {
          exerciseId: e.id || ('w' + week + '-' + d.dayId + '-' + slug(e.name)),
          name: e.name,
          ...(e.type ? { type: e.type } : {}),
          // The app shows notes with every exercise: a % of 1RM goes there too.
          ...(e.notes || e.loadPct ? { notes: [e.loadPct ? e.loadPct + '% of 1RM' : '', e.notes].filter(Boolean).join(' · ') } : {}),
          sets: Array.from({ length: e.sets }, (_, i) => set(i)),
          ...(e.superset ? { supersetGroup: e.superset } : {}),
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
      // `phase` is what the app shows above each week (and groups weeks by):
      // the block's name, "Deload", then the week's note.
      const blockName = id => ((program.blocks || []).find(b => b.id === id) || {}).name || '';
      const phase = w => [blockName(w.block), w.deload ? 'Deload' : '', w.note || ''].filter(Boolean).join(' · ');
      out.weeks = program.weeks.map(w => Object.assign(w.sameAs
        ? { week: w.week, label: w.label, sameAs: w.sameAs }
        : { week: w.week, label: w.label, phase: phase(w), days: w.days.map(d => libraryDay(d, w.week)) },
      w.sameAs && phase(w) ? { phase: phase(w) } : {}, w.deload ? { deload: true } : {}));
      out.durationWeeks = program.weeks.length;
      if (program.blocks && program.blocks.length) {
        out.blocks = blockRuns(program).filter(r => r.block).map(r => ({ name: r.block.name, goal: r.block.goal, fromWeek: r.from, toWeek: r.to }));
      }
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
    SCHEMA, WEEKDAYS, TYPES, LIMITS, MUSCLES, DEFAULT_LANDMARKS,
    landmarks, volumeZone, muscleSets,
    readProgram, weekDays, stats, validate, copyWeek, toLibrary, toV1Days,
    blockRuns, weeklySets, progressWeeks,
    parseQuickEntry, parseReps, parseRir, parseRest, parseDayLabel, parseWeek, parseLoad, parseCell,
    formatRow, formatRest, formatCell, formatLoad, weekdayNumber, guessType,
  };
});
