/* =============================================================
   HISTORY IMPORT — core (pure, tested: tests/historyImportCore.test.js)
   Turns a CSV export from another training app into this app's
   workout objects, so a new user's charts, PRs and "last time"
   suggestions work from day one instead of after weeks of logging.

   Formats (detected from the header row):
   - strong: Strong app export. "Date, Workout Name, Exercise Name,
     Set Order, Weight | Weight (kg) | Weight (lbs), Reps, RPE, …".
     Comma or semicolon separated. Set Order "W" = warm-up, "D" = drop.
   - hevy:   Hevy export. "title, start_time, exercise_title,
     set_type, weight_kg | weight_lbs, reps, rpe, …".
   - fitbod: Fitbod export. "Date, Exercise, Reps, Weight(kg),
     isWarmup, …".
   - generic: any sheet with a date, exercise, reps and weight column
     (plus optional unit / workout name), for people who logged in a
     spreadsheet.

   Rows with no reps and no weight (cardio: distance / time only) are
   skipped and counted. Weights are converted to the user's unit.
   Workout ids are `imp_` + a hash of the session, so importing the
   same file twice overwrites rather than duplicates (the backend's
   POST /workouts/import requires the prefix).

   history-import.js is the screen; this file never touches the DOM.
   ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HistoryImportCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const LB_PER_KG = 2.20462262;
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const SOURCE_LABELS = { strong: 'Strong', hevy: 'Hevy', fitbod: 'Fitbod', generic: 'spreadsheet' };

  /* ── CSV ─────────────────────────────────────────────────── */

  function detectDelimiter(text) {
    const first = String(text || '').split(/\r?\n/, 1)[0] || '';
    const counts = [',', ';', '\t'].map(d => [d, first.split(d).length - 1]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ',';
  }

  /** RFC 4180-ish: quoted fields, "" escapes, newlines inside quotes. */
  function parseCsv(text, delimiter) {
    const src = String(text || '').replace(/^﻿/, '');
    const d = delimiter || detectDelimiter(src);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += ch;
      } else if (ch === '"' && field === '') {
        quoted = true;
      } else if (ch === d) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
  }

  /* ── Header mapping ──────────────────────────────────────── */

  const norm = h => String(h || '').trim().toLowerCase().replace(/[\s_]+/g, ' ');

  function findCol(headers, names) {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  }

  /** → { format, cols, unit } or null when the columns can't be placed. */
  function detectFormat(headerRow) {
    const h = (headerRow || []).map(norm);
    const has = n => h.includes(n);

    if (has('exercise title') && has('start time')) {
      const kg = findCol(h, ['weight kg']);
      const lbs = findCol(h, ['weight lbs']);
      return {
        format: 'hevy',
        unit: kg !== -1 ? 'kg' : lbs !== -1 ? 'lbs' : null,
        cols: {
          date: findCol(h, ['start time']), title: findCol(h, ['title']), exercise: findCol(h, ['exercise title']),
          weight: kg !== -1 ? kg : lbs, reps: findCol(h, ['reps']), rpe: findCol(h, ['rpe']),
          type: findCol(h, ['set type']), session: findCol(h, ['start time']),
        },
      };
    }
    if (has('exercise name') && (has('workout name') || has('set order'))) {
      const wi = h.findIndex(x => /^weight( \((kg|lbs?)\))?$/.test(x));
      const unitMatch = wi !== -1 && /\((kg|lbs?)\)/.exec(h[wi]);
      return {
        format: 'strong',
        unit: unitMatch ? (unitMatch[1] === 'kg' ? 'kg' : 'lbs') : null,
        cols: {
          date: findCol(h, ['date']), title: findCol(h, ['workout name']), exercise: findCol(h, ['exercise name']),
          weight: wi, reps: findCol(h, ['reps']), rpe: findCol(h, ['rpe']),
          type: findCol(h, ['set order']), session: findCol(h, ['workout #', 'date']),
        },
      };
    }
    if (has('exercise') && has('iswarmup')) {
      const wi = h.findIndex(x => /^weight ?\((kg|lbs?)\)$/.test(x));
      const unitMatch = wi !== -1 && /\((kg|lbs?)\)/.exec(h[wi]);
      return {
        format: 'fitbod',
        unit: unitMatch ? (unitMatch[1] === 'kg' ? 'kg' : 'lbs') : 'kg',
        cols: {
          date: findCol(h, ['date']), title: -1, exercise: findCol(h, ['exercise']),
          weight: wi, reps: findCol(h, ['reps']), rpe: -1, type: findCol(h, ['iswarmup']), session: -1,
        },
      };
    }

    const date = findCol(h, ['date', 'day', 'workout date', 'start time', 'datetime']);
    const exercise = findCol(h, ['exercise', 'exercise name', 'lift', 'movement']);
    const reps = findCol(h, ['reps', 'rep', 'repetitions']);
    let weight = findCol(h, ['weight', 'load', 'kg', 'lbs', 'weight kg', 'weight lbs']);
    if (weight === -1) weight = h.findIndex(x => /^weight ?\((kg|lbs?)\)$/.test(x));
    if (date === -1 || exercise === -1 || reps === -1 || weight === -1) return null;
    const wh = h[weight];
    const unit = /kg/.test(wh) ? 'kg' : /lb/.test(wh) ? 'lbs' : null;
    return {
      format: 'generic',
      unit,
      cols: {
        date, exercise, reps, weight, title: findCol(h, ['workout', 'workout name', 'session', 'title', 'name']),
        rpe: findCol(h, ['rpe']), type: findCol(h, ['set type', 'type']), unitCol: findCol(h, ['unit', 'units']), session: -1,
        // One row per exercise ("3 sets of 5 at 100") rather than per set.
        sets: findCol(h, ['sets', 'set count', 'number of sets']),
      },
    };
  }

  /* ── Values ──────────────────────────────────────────────── */

  const pad = n => String(n).padStart(2, '0');
  const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  /** Local YYYY-MM-DD from the date formats these apps export, else null. */
  function parseDate(value) {
    const s = String(value || '').trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return key(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(s); // 15 Jan 2023, 08:30
    if (m && MONTHS[m[2].toLowerCase()] != null) return key(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s); // Jan 15, 2023
    if (m && MONTHS[m[1].toLowerCase()] != null) return key(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
    if (m) return key(+m[1], +m[2] - 1, +m[3]);
    return null;
  }

  function num(value) {
    const s = String(value == null ? '' : value).trim().replace(/\s/g, '');
    if (!s) return NaN;
    // "102,5" (decimal comma, as in semicolon-separated exports)
    const n = Number(/^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function convert(weight, from, to) {
    if (!from || !to || from === to || !weight) return weight;
    const out = from === 'kg' ? weight * LB_PER_KG : weight / LB_PER_KG;
    return Math.round(out * 10) / 10;
  }

  function setType(format, raw) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    if (format === 'fitbod') return v === 'true' || v === '1' ? 'warmup' : 'standard';
    if (v === 'w' || v.startsWith('warm')) return 'warmup';
    if (v === 'd' || v.startsWith('drop')) return 'dropset';
    return 'standard';
  }

  function hash(str) {
    // Two FNV-1a passes with different seeds → 16 hex chars.
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }

  function blankEntry(exercise, unit, date) {
    return {
      exercise, sets: 0, repsArray: [], weightsArray: [], rpeArray: [], rirArray: [], dropsetArray: [],
      restPauseArray: [], unilateralArray: [], sideRepsArray: [], skippedArray: [], completedArray: [],
      setTypeArray: [], unit, date, goal: 0, repGoal: 0, targetRPE: null, targetRIR: null, maxedOut: false,
    };
  }

  /* ── Rows → workouts ─────────────────────────────────────── */

  /**
   * Parse a whole export.
   * opts.unit  the user's unit ('kg' | 'lbs'); weights are converted to it
   *            (a file that doesn't say its unit is taken to be in it).
   * → { ok, format, source, workouts, sets, exercises, skippedRows, firstDate, lastDate }
   *   or { ok: false, error }.
   */
  function parseExport(text, opts) {
    const o = opts || {};
    const unit = o.unit === 'lbs' ? 'lbs' : 'kg';
    const rows = parseCsv(text);
    if (rows.length < 2) return { ok: false, error: 'That file has no rows to import.' };
    const fmt = detectFormat(rows[0]);
    if (!fmt) return { ok: false, error: 'We couldn’t find date, exercise, reps and weight columns in that file.' };
    const { cols, format } = fmt;
    const at = (r, i) => (i >= 0 && i < r.length ? r[i] : '');

    const sessions = new Map();
    let skippedRows = 0;
    let sets = 0;
    const exerciseNames = new Set();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDate(at(r, cols.date));
      const exercise = String(at(r, cols.exercise)).trim().slice(0, 80);
      const reps = num(at(r, cols.reps));
      let weight = num(at(r, cols.weight));
      if (!Number.isFinite(weight)) weight = 0;
      if (!date || !exercise || !(reps > 0 || weight > 0) || reps < 0 || weight < 0) { skippedRows++; continue; }

      let fromUnit = fmt.unit;
      if (cols.unitCol >= 0) {
        const u = String(at(r, cols.unitCol)).trim().toLowerCase();
        fromUnit = u.startsWith('lb') ? 'lbs' : u.startsWith('kg') ? 'kg' : fromUnit;
      }
      weight = convert(weight, fromUnit || unit, unit);

      const title = String(at(r, cols.title)).trim().slice(0, 80);
      const sessionKey = `${date}|${cols.session >= 0 ? String(at(r, cols.session)).trim() : ''}|${title}`;
      let s = sessions.get(sessionKey);
      if (!s) {
        s = { date, title: title || `Workout on ${date}`, entries: new Map() };
        sessions.set(sessionKey, s);
      }
      let e = s.entries.get(exercise.toLowerCase());
      if (!e) {
        e = blankEntry(exercise, unit, date);
        s.entries.set(exercise.toLowerCase(), e);
      }
      const type = setType(format, at(r, cols.type));
      const rpe = num(at(r, cols.rpe));
      const setCount = cols.sets >= 0 ? Math.min(20, Math.max(1, Math.round(num(at(r, cols.sets)) || 1))) : 1;
      for (let k = 0; k < setCount; k++) {
        e.repsArray.push(reps > 0 ? Math.round(reps) : 0);
        e.weightsArray.push(weight);
        e.rpeArray.push(rpe >= 1 && rpe <= 10 ? rpe : null);
        e.rirArray.push(null);
        e.dropsetArray.push(type === 'dropset');
        e.restPauseArray.push(false);
        e.unilateralArray.push(false);
        e.sideRepsArray.push(null);
        e.skippedArray.push(false);
        e.completedArray.push(true);
        e.setTypeArray.push(type);
        sets++;
      }
      e.sets = e.repsArray.length;
      exerciseNames.add(exercise.toLowerCase());
    }

    const workouts = [...sessions.values()].map(s => {
      const log = [...s.entries.values()];
      const sig = log.map(e => `${e.exercise}:${e.repsArray.join(',')}:${e.weightsArray.join(',')}`).join(';');
      return {
        id: 'imp_' + hash(`${format}|${s.date}|${s.title}|${sig}`),
        title: s.title,
        date: s.date,
        log,
        restBreaks: [],
        imported: true,
        importSource: format,
      };
    }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (!workouts.length) return { ok: false, error: 'No lifting sets found in that file (cardio-only rows are skipped).' };
    return {
      ok: true,
      format,
      source: SOURCE_LABELS[format],
      workouts,
      sets,
      exercises: exerciseNames.size,
      skippedRows,
      firstDate: workouts[0].date,
      lastDate: workouts[workouts.length - 1].date,
    };
  }

  /** Request bodies for POST /workouts/import, at most `size` workouts each. */
  function toImportChunks(workouts, format, size) {
    const n = Math.max(1, Math.min(200, size || 100));
    const out = [];
    for (let i = 0; i < workouts.length; i += n) {
      out.push({
        source: format,
        workouts: workouts.slice(i, i + n).map(w => ({ date: `${w.date}T12:00:00.000Z`, title: w.title, workout: w })),
      });
    }
    return out;
  }

  return { parseCsv, detectDelimiter, detectFormat, parseDate, parseExport, toImportChunks, convert, hash };
});
