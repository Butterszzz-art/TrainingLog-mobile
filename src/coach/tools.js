/* =============================================================
   AI COACH — tools
   Claude answers questions by calling these tools. The "read" tools
   query the data pack the phone sends with each request (built by
   src/js/coach-data.js from localStorage, filtered by the user's
   data-access switches), so only what the model asks for enters the
   prompt. The "propose_*" / "remember" tools change nothing on the
   server: they hand a card or a memory back to the phone, and the
   user decides whether to apply it.
   ============================================================= */

'use strict';

const DAY_MS = 86400000;

// ── Tool definitions (sent to the API — keep order and text stable so the
//    prompt cache prefix stays valid) ────────────────────────────────────────

const SET_SCHEMA = {
  type: 'object',
  properties: {
    reps: { type: 'integer', minimum: 1, maximum: 100 },
    repsMax: { type: 'integer', minimum: 1, maximum: 100, description: 'Upper end of a rep range, e.g. 10 for "8-10".' },
    weight: { type: 'number', minimum: 0, description: 'Load in kg. Omit for bodyweight or when the athlete picks.' },
    rpe: { type: 'number', minimum: 5, maximum: 10 },
  },
  required: ['reps'],
  additionalProperties: false,
};

const TOOL_DEFS = [
  {
    name: 'get_training_summary',
    description: 'Overview of recent training: sessions and tonnage per week, plus the most recent sessions with their exercises. Start here for broad questions about consistency, volume or what was trained.',
    input_schema: {
      type: 'object',
      properties: { weeks: { type: 'integer', minimum: 1, maximum: 12, description: 'How many weeks back. Default 4.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_exercise_history',
    description: 'Every logged set of one exercise, session by session, with top set, estimated 1RM (Epley) and volume. Use for progress, stalls and load choices. Matching is fuzzy ("squat" matches "Back Squat"); when nothing matches, the result lists the exercise names that exist.',
    input_schema: {
      type: 'object',
      properties: {
        exercise: { type: 'string', description: 'Exercise name or part of it.' },
        sessions: { type: 'integer', minimum: 1, maximum: 30, description: 'Most recent sessions to return. Default 10.' },
      },
      required: ['exercise'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_body_metrics',
    description: 'Bodyweight entries, 7-day-average trend and weekly rate of change, plus weekly check-in answers (hunger, energy, digestion, performance, notes).',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 7, maximum: 180, description: 'Default 60.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_recovery',
    description: 'Sleep log (hours, quality, tags like caffeine or stress) and check-in sleep, energy and stress scores.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 3, maximum: 60, description: 'Default 21.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_nutrition',
    description: "The athlete's current daily macro targets.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_program',
    description: 'The program the athlete is currently running: each day with its exercises and prescribed sets.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_program_change',
    description: 'Show the athlete a concrete change to one day of their current program as a card with an Apply button. Nothing changes unless they tap Apply. Call get_program first and use the exact day and exercise names from it. Keep each proposal to one day; call again for another day.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short card title, e.g. "Restart squat progress".' },
        day: { type: 'string', description: 'Exact day name from get_program.' },
        changes: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['set_sets', 'add_exercise', 'remove_exercise', 'replace_exercise', 'set_note'] },
              exercise: { type: 'string', description: 'Exact exercise name from get_program (for add_exercise: the new exercise).' },
              newExercise: { type: 'string', description: 'replace_exercise only: the exercise that takes its place (keeps the sets).' },
              sets: { type: 'array', minItems: 1, maxItems: 10, items: SET_SCHEMA, description: 'set_sets and add_exercise: the full new list of sets.' },
              note: { type: 'string', description: 'set_note only.' },
            },
            required: ['op', 'exercise'],
            additionalProperties: false,
          },
        },
        rationale: { type: 'string', description: 'One or two sentences on why, citing the data.' },
      },
      required: ['title', 'day', 'changes', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_macro_targets',
    description: 'Show the athlete new daily macro targets as a card with an Apply button. Nothing changes unless they tap Apply. Call get_nutrition first so the card can show old against new.',
    input_schema: {
      type: 'object',
      properties: {
        calories: { type: 'integer', minimum: 1000, maximum: 7000 },
        protein: { type: 'integer', minimum: 30, maximum: 500 },
        carbs: { type: 'integer', minimum: 0, maximum: 1000 },
        fat: { type: 'integer', minimum: 20, maximum: 300 },
        rationale: { type: 'string' },
      },
      required: ['calories', 'protein', 'carbs', 'fat', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description: 'Save one lasting fact about the athlete (an injury, a preference, a schedule constraint, a goal date) so future conversations know it. Only for things that stay true for weeks; not for today\'s numbers. The athlete can see and delete what you save.',
    input_schema: {
      type: 'object',
      properties: { fact: { type: 'string', description: 'One short sentence, e.g. "Left shoulder: avoid behind-the-neck pressing".' } },
      required: ['fact'],
      additionalProperties: false,
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const arr = v => (Array.isArray(v) ? v : []);
const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

function clampInt(v, min, max, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function toTime(date) {
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : null;
}

// Pack dates are YYYY-MM-DD; "now" is the pack's generatedAt so results are
// deterministic for a given request.
function sinceDays(pack, days) {
  const now = toTime(pack && pack.generatedAt) || Date.now();
  return now - days * DAY_MS;
}

function inWindow(list, pack, days) {
  const from = sinceDays(pack, days);
  return arr(list).filter(e => {
    const t = toTime(e && e.date);
    return t !== null && t >= from;
  });
}

// Epley estimate; unreliable past ~12 reps, so those sets don't count.
function e1rm(weight, reps) {
  if (!(weight > 0) || !(reps > 0) || reps > 12) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fmtSet(s) {
  const w = num(s.w);
  const r = num(s.r);
  let out = w ? `${round(w, 2)}×${r ?? '?'}` : `BW×${r ?? '?'}`;
  if (num(s.rpe)) out += ` @${s.rpe}`;
  return out;
}

function unavailable(what) {
  return { unavailable: `No ${what} available: the athlete has none logged or has turned off coach access to it.` };
}

// ── Read tools ──────────────────────────────────────────────────────────────

function getTrainingSummary(input, pack) {
  if (!Array.isArray(pack.workouts)) return { result: unavailable('workouts'), trace: 'Training' };
  const weeks = clampInt(input.weeks, 1, 12, 4);
  const recent = inWindow(pack.workouts, pack, weeks * 7);
  const now = toTime(pack.generatedAt) || Date.now();

  const byWeek = [];
  for (let i = 0; i < weeks; i++) byWeek.push({ weeksAgo: i, sessions: 0, sets: 0, tonnageKg: 0 });
  recent.forEach(w => {
    const i = Math.floor((now - toTime(w.date)) / (7 * DAY_MS));
    const bucket = byWeek[Math.min(Math.max(i, 0), weeks - 1)];
    bucket.sessions += 1;
    arr(w.exercises).forEach(ex => arr(ex.sets).forEach(s => {
      bucket.sets += 1;
      bucket.tonnageKg += (num(s.w) || 0) * (num(s.r) || 0);
    }));
  });
  byWeek.forEach(b => { b.tonnageKg = Math.round(b.tonnageKg); });

  const cardio = Array.isArray(pack.cardio) ? inWindow(pack.cardio, pack, weeks * 7) : null;

  return {
    result: {
      weeks: byWeek,
      recentSessions: recent.slice(-8).reverse().map(w => ({
        date: w.date,
        title: w.title || 'Workout',
        exercises: arr(w.exercises).map(ex => `${ex.name} (${arr(ex.sets).length} sets)`),
      })),
      cardioSessions: cardio ? cardio.map(c => ({ date: c.date, type: c.type, minutes: c.durationMin })) : undefined,
    },
    trace: `Training · ${recent.length} sessions`,
  };
}

function getExerciseHistory(input, pack) {
  if (!Array.isArray(pack.workouts)) return { result: unavailable('workouts'), trace: 'Exercise history' };
  const wanted = normName(input.exercise);
  const limit = clampInt(input.sessions, 1, 30, 10);
  if (!wanted) return { result: { error: 'exercise is required' }, trace: 'Exercise history', isError: true };

  const allNames = new Set();
  const matchedNames = new Set();
  const sessions = [];
  arr(pack.workouts).forEach(w => {
    const hits = arr(w.exercises).filter(ex => {
      allNames.add(ex.name);
      const n = normName(ex.name);
      const hit = n === wanted || n.includes(wanted) || wanted.includes(n);
      if (hit) matchedNames.add(ex.name);
      return hit;
    });
    if (!hits.length) return;
    const sets = hits.flatMap(ex => arr(ex.sets));
    let top = null;
    let best = null;
    let volume = 0;
    sets.forEach(s => {
      const w0 = num(s.w) || 0;
      const r0 = num(s.r) || 0;
      volume += w0 * r0;
      if (!top || w0 > top.w || (w0 === top.w && r0 > top.r)) top = { w: w0, r: r0 };
      const est = e1rm(w0, r0);
      if (est && (!best || est > best)) best = est;
    });
    sessions.push({
      date: w.date,
      sets: sets.map(fmtSet).join(', '),
      topSet: top && top.w ? `${round(top.w, 2)}×${top.r}` : null,
      e1rmKg: best ? round(best) : null,
      volumeKg: Math.round(volume),
    });
  });

  if (!sessions.length) {
    return {
      result: { noMatch: input.exercise, exercisesLogged: [...allNames].sort().slice(0, 60) },
      trace: `${input.exercise} · no match`,
    };
  }

  const shown = sessions.slice(-limit);
  const name = [...matchedNames][0];
  return {
    result: { matched: [...matchedNames], sessionsLogged: sessions.length, sessions: shown },
    trace: `${name} · ${shown.length} session${shown.length === 1 ? '' : 's'}`,
    chart: shown.some(s => s.e1rmKg) ? {
      kind: 'e1rm',
      exercise: name,
      points: shown.filter(s => s.e1rmKg).map(s => ({ date: s.date, value: s.e1rmKg })),
    } : null,
  };
}

// Mean of the 7 days ending on each entry's date — smooths water noise.
function trend7(entries) {
  return entries.map((e, i) => {
    const t = toTime(e.date);
    const win = entries.slice(0, i + 1).filter(x => t - toTime(x.date) < 7 * DAY_MS);
    return win.reduce((s, x) => s + x.kg, 0) / win.length;
  });
}

function getBodyMetrics(input, pack) {
  const days = clampInt(input.days, 7, 180, 60);
  const out = {};
  let trace = 'Body metrics';

  if (Array.isArray(pack.bodyweight)) {
    const bw = inWindow(pack.bodyweight, pack, days)
      .filter(e => num(e.kg))
      .map(e => ({ date: e.date, kg: Number(e.kg) }))
      .sort((a, b) => toTime(a.date) - toTime(b.date));
    if (bw.length) {
      const t = trend7(bw);
      const spanDays = (toTime(bw[bw.length - 1].date) - toTime(bw[0].date)) / DAY_MS;
      // Thin long logs so the prompt stays small; keep first and last.
      const step = Math.max(1, Math.ceil(bw.length / 40));
      out.bodyweight = bw.filter((_, i) => i % step === 0 || i === bw.length - 1);
      out.trendStartKg = round(t[0]);
      out.trendNowKg = round(t[t.length - 1]);
      out.ratePerWeekKg = spanDays >= 7 ? round(((t[t.length - 1] - t[0]) / spanDays) * 7, 2) : null;
      trace = `Bodyweight · ${days} days`;
    } else {
      out.bodyweight = [];
    }
  } else {
    out.bodyweight = unavailable('bodyweight').unavailable;
  }

  if (Array.isArray(pack.checkIns)) {
    out.checkIns = inWindow(pack.checkIns, pack, days).slice(-8);
    if (out.checkIns.length) trace += ` · ${out.checkIns.length} check-ins`;
  }
  return { result: out, trace };
}

function getRecovery(input, pack) {
  const days = clampInt(input.days, 3, 60, 21);
  const out = {};
  if (Array.isArray(pack.sleep)) {
    const nights = inWindow(pack.sleep, pack, days);
    out.sleep = nights;
    const hrs = nights.map(n => num(n.hours)).filter(Boolean);
    const q = nights.map(n => num(n.quality)).filter(Boolean);
    out.avgHours = hrs.length ? round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
    out.avgQualityOf5 = q.length ? round(q.reduce((a, b) => a + b, 0) / q.length) : null;
  } else {
    out.sleep = unavailable('sleep log').unavailable;
  }
  if (Array.isArray(pack.checkIns)) {
    out.checkInScores = inWindow(pack.checkIns, pack, Math.max(days, 28))
      .map(c => ({ date: c.date, sleep: c.sleep, energy: c.energy, stress: c.stress }));
  }
  const n = Array.isArray(out.sleep) ? out.sleep.length : 0;
  return { result: out, trace: `Sleep · ${n} nights` };
}

function getNutrition(_input, pack) {
  if (!pack.macros || !pack.macros.targets) return { result: unavailable('macro targets'), trace: 'Macros' };
  return { result: pack.macros, trace: 'Macro targets' };
}

function getProgram(_input, pack) {
  if (!pack.program || !Array.isArray(pack.program.days)) return { result: unavailable('active program'), trace: 'Program' };
  return { result: pack.program, trace: `Program · ${pack.program.name || 'current'}` };
}

// ── Action tools ────────────────────────────────────────────────────────────

function findDay(pack, dayName) {
  const days = arr(pack.program && pack.program.days);
  const n = normName(dayName);
  return days.find(d => normName(d.name) === n) || null;
}

function cleanSets(sets) {
  return arr(sets).slice(0, 10).map(s => {
    const out = { reps: clampInt(s.reps, 1, 100, 8) };
    if (num(s.repsMax) && s.repsMax > out.reps) out.repsMax = clampInt(s.repsMax, 1, 100, out.reps);
    if (num(s.weight) !== null && s.weight >= 0) out.weight = round(Number(s.weight), 2);
    if (num(s.rpe)) out.rpe = Math.min(10, Math.max(5, Number(s.rpe)));
    return out;
  });
}

function proposeProgramChange(input, pack) {
  const day = findDay(pack, input.day);
  if (!day) {
    const names = arr(pack.program && pack.program.days).map(d => d.name);
    return {
      result: { error: `No day named "${input.day}". Days in the program: ${names.join(', ') || 'none (no active program)'}.` },
      trace: 'Program change',
      isError: true,
    };
  }
  const exerciseNames = arr(day.exercises).map(e => normName(e.name));
  const changes = [];
  const problems = [];
  arr(input.changes).forEach((c, i) => {
    const exercise = String(c.exercise || '').trim().slice(0, 80);
    const exists = exerciseNames.includes(normName(exercise));
    if (!exercise) return problems.push(`change ${i + 1}: exercise is required`);
    if (c.op !== 'add_exercise' && !exists) return problems.push(`change ${i + 1}: "${exercise}" is not on ${day.name}`);
    if (c.op === 'add_exercise' && exists) return problems.push(`change ${i + 1}: "${exercise}" is already on ${day.name}`);
    const change = { op: c.op, exercise };
    if (c.op === 'set_sets' || c.op === 'add_exercise') {
      change.sets = cleanSets(c.sets);
      if (!change.sets.length) return problems.push(`change ${i + 1}: sets are required for ${c.op}`);
    } else if (c.op === 'replace_exercise') {
      change.newExercise = String(c.newExercise || '').trim().slice(0, 80);
      if (!change.newExercise) return problems.push(`change ${i + 1}: newExercise is required`);
    } else if (c.op === 'set_note') {
      change.note = String(c.note || '').trim().slice(0, 240);
    } else if (c.op !== 'remove_exercise') {
      return problems.push(`change ${i + 1}: unknown op ${c.op}`);
    }
    changes.push(change);
  });
  if (problems.length || !changes.length) {
    return { result: { error: problems.join('; ') || 'No valid changes.' }, trace: 'Program change', isError: true };
  }

  const card = {
    type: 'program_change',
    title: String(input.title || 'Program change').slice(0, 80),
    programId: pack.program.id || null,
    day: day.name,
    changes,
    rationale: String(input.rationale || '').slice(0, 400),
  };
  return {
    result: { shown: true, note: 'Shown to the athlete as a card with Apply and Dismiss. Do not repeat its contents in full; refer to it.' },
    trace: null,
    card,
  };
}

function proposeMacroTargets(input, pack) {
  const t = {
    calories: clampInt(input.calories, 1000, 7000, null),
    protein: clampInt(input.protein, 30, 500, null),
    carbs: clampInt(input.carbs, 0, 1000, null),
    fat: clampInt(input.fat, 20, 300, null),
  };
  if (Object.values(t).some(v => v === null)) {
    return { result: { error: 'calories, protein, carbs and fat must all be numbers.' }, trace: 'Macro change', isError: true };
  }
  const current = pack.macros && pack.macros.targets;
  if (current && Math.abs(t.calories - (current.calories || 0)) <= 25 &&
      ['protein', 'carbs', 'fat'].every(k => Math.abs(t[k] - (current[k] || 0)) <= 5)) {
    return {
      result: { error: 'These are essentially the current targets. If the issue is hitting them rather than the targets themselves, say so in text instead of proposing.' },
      trace: 'Macro change',
      isError: true,
    };
  }
  const fromMacros = t.protein * 4 + t.carbs * 4 + t.fat * 9;
  if (Math.abs(fromMacros - t.calories) > t.calories * 0.1) {
    return {
      result: { error: `Macros add up to ${fromMacros} kcal but calories is ${t.calories}. Make them agree within 10%.` },
      trace: 'Macro change',
      isError: true,
    };
  }
  return {
    result: { shown: true, note: 'Shown to the athlete as a card with Apply and Dismiss.' },
    trace: null,
    card: {
      type: 'macro_targets',
      title: 'New macro targets',
      from: (pack.macros && pack.macros.targets) || null,
      to: t,
      rationale: String(input.rationale || '').slice(0, 400),
    },
  };
}

function remember(input) {
  const fact = String(input.fact || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!fact) return { result: { error: 'fact is required' }, trace: null, isError: true };
  return { result: { saved: true }, trace: null, memory: fact };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

const HANDLERS = {
  get_training_summary: getTrainingSummary,
  get_exercise_history: getExerciseHistory,
  get_body_metrics: getBodyMetrics,
  get_recovery: getRecovery,
  get_nutrition: getNutrition,
  get_program: getProgram,
  propose_program_change: proposeProgramChange,
  propose_macro_targets: proposeMacroTargets,
  remember,
};

/**
 * Run one tool call against the request's data pack.
 * Returns { result, trace, isError?, card?, memory?, chart? } — `result` goes
 * back to Claude as the tool_result; the rest are UI events for the phone.
 */
function runTool(name, input, pack) {
  const handler = HANDLERS[name];
  if (!handler) return { result: { error: `Unknown tool ${name}` }, trace: null, isError: true };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { result: { error: 'Tool input must be an object.' }, trace: null, isError: true };
  }
  try {
    return handler(input, pack || {});
  } catch (err) {
    return { result: { error: `Tool failed: ${err.message}` }, trace: null, isError: true };
  }
}

module.exports = { TOOL_DEFS, runTool, e1rm, trend7 };
