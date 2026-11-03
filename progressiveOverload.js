function normalizeExerciseName(entry) {
  return String(entry?.exercise || '').trim().toLowerCase();
}

/**
 * Which "gym" an entry's numbers belong to, for comparisons:
 *   ''    — the usual gym (no tag)
 *   'x'   — a saved alt gym, by normalised name
 *   null  — not comparable with anything: a different machine, or an alt
 *           gym with no name
 *
 * New entries carry their own `sessionCtx`. Older workouts were tagged as a
 * whole via `workout._sessionCtx`, which applies when the entry has no tag.
 */
function normalizeGymName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function entryGymKey(entry, workout) {
  const ctx = (entry && entry.sessionCtx) || (workout && workout._sessionCtx);
  if (!ctx) return '';
  if (ctx.altMachine) return null;
  if (ctx.altGym) return normalizeGymName(ctx.gymName) || null;
  return '';
}

/** True when an entry's numbers can be compared with sessions at `gymKey`. */
function isComparableEntry(entry, workout, gymKey = '') {
  const key = entryGymKey(entry, workout);
  return key !== null && gymKey !== null && key === gymKey;
}

/**
 * True for anything not logged normally at the usual gym. PRs only count
 * usual-gym, usual-machine sets.
 */
function isAltSessionEntry(entry, workout) {
  return entryGymKey(entry, workout) !== '';
}

/** The gym being trained at right now ('' usual, null unnamed alt gym). */
function currentGymKey() {
  if (typeof window !== 'undefined' && typeof window.getCurrentGymKey === 'function') {
    return window.getCurrentGymKey();
  }
  return '';
}


/* =============================================================
   PROGRESSION RULES
   Source: Butters University (Personal Training Science Hub):
   - "Exercise execution": leave 1–3 reps in reserve (RIR) on most sets;
     ~2 RIR on heavy compound lifts, closer to failure (0–1 RIR) only on
     isolation work. No failure on the heavy compounds.
   - "Periodization": autoregulate with RPE/RIR and adjust load set by
     set from performance (APRE). Treat a stall as a decision point;
     deload only when lifts stall for 2+ sessions with high effort, not
     on a calendar ("cut volume/intensity for 5–7 days").
   - "Structuring a session": ~2–3 min rest on main compound lifts;
     little extra growth benefit past ~90 s on smaller lifts.

   App defaults (not in BU):
   - Weight steps: 2.5 kg / 5 lb; 1 kg / 2.5 lb on isolation and
     dumbbell lifts.
   - Back-off drop from today's top set: −10% on target, −15% if the top
     set was harder than planned, −5% if easier.
   - In-session drop after a set that went badly: −5%.
   - With no rep range set, the range is the reps first hit at the
     current weight, up to 2 more.

   Effort: RIR per set from the reps-left chips (rirArray), then per-set
   RPE (RIR = 10 − RPE), then the entry's RIR / RPE fields, then the
   "How did that feel?" check-in (feltRIR).
   ============================================================= */

const ISOLATION_RE = /\b(curls?|extensions?|raises?|fl(y|ies|yes)|kickbacks?|push-?downs?|crunch(es)?|calf|calves|shrugs?|pullovers?|face ?pulls?|adduct|abduct|leg curl|pec deck|wrist)\b/i;
const DUMBBELL_RE = /\b(dumbbells?|db)\b/i;
const NON_WORK_TYPES = new Set(['warmup', 'warm-up']);

const TARGETS = {
  // target RIR, then the band counted as "on target"
  compound: { target: 2, low: 1, high: 2 },
  isolation: { target: 1, low: 0, high: 2 },
  backoff: { target: 2, low: 1, high: 2 }
};

const BACKOFF_DROP = { harder: 0.15, on: 0.10, unknown: 0.10, easier: 0.05, 'way-easier': 0.05 };
const IN_SESSION_DROP = 0.05;

function liftType(name) {
  return ISOLATION_RE.test(String(name || '')) ? 'isolation' : 'compound';
}

function weightStep(name, unit) {
  const small = liftType(name) === 'isolation' || DUMBBELL_RE.test(String(name || ''));
  const lbs = /^lb/i.test(String(unit || 'kg'));
  if (lbs) return small ? 2.5 : 5;
  return small ? 1 : 2.5;
}

function roundTo(value, step) {
  if (!step) return Number(value.toFixed(2));
  return Number((Math.round(value / step) * step).toFixed(2));
}

function finite(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Reps in reserve for set i of an entry, or null when nothing was logged. */
function setRir(entry, i) {
  const pick = (arr) => (Array.isArray(arr) ? finite(arr[i]) : null);
  let rir = pick(entry && entry.rirArray);
  if (rir === null) {
    const rpe = pick(entry && entry.rpeArray);
    if (rpe !== null && rpe > 0) rir = 10 - rpe;
  }
  if (rir === null) rir = finite(entry && entry.targetRIR);
  if (rir === null) {
    const rpe = finite(entry && (entry.targetRPE ?? entry.targetRpe));
    if (rpe !== null && rpe > 0) rir = 10 - rpe;
  }
  if (rir === null) rir = finite(entry && entry.feltRIR);
  return rir === null ? null : Math.max(0, rir);
}

/** 'unknown' | 'harder' | 'on' | 'easier' | 'way-easier' */
function classifyEffort(rir, band) {
  if (rir === null || rir === undefined) return 'unknown';
  if (rir < band.low) return 'harder';
  if (rir >= band.target + 2) return 'way-easier';
  if (rir > band.high) return 'easier';
  return 'on';
}

function parseRepRange(entry) {
  const raw = entry && entry.repRange;
  if (raw !== undefined && raw !== null && raw !== '') {
    const m = String(raw).match(/(\d+)\s*(?:[-–—to]+\s*(\d+))?/i);
    if (m) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      if (a > 0 && b > 0) return [Math.min(a, b), Math.max(a, b)];
    }
  }
  const goal = finite(entry && entry.repGoal);
  if (goal && goal > 0) return [goal, goal];
  return null;
}

function e1rm(set) {
  if (!set || !set.weight || !set.reps) return 0;
  return set.weight * (1 + set.reps / 30);
}

function entrySets(entry) {
  const reps = Array.isArray(entry && entry.repsArray) ? entry.repsArray : [];
  const weights = Array.isArray(entry && entry.weightsArray) ? entry.weightsArray : [];
  const types = Array.isArray(entry && entry.setTypeArray) ? entry.setTypeArray : [];
  const skipped = Array.isArray(entry && entry.skippedArray) ? entry.skippedArray : [];
  const out = [];
  const n = Math.max(reps.length, weights.length);
  for (let i = 0; i < n; i++) {
    const type = types[i] || 'standard';
    if (NON_WORK_TYPES.has(type)) continue;
    out.push({
      weight: Number(weights[i]) || 0,
      reps: Number(reps[i]) || 0,
      rir: setRir(entry, i),
      type,
      skipped: !!skipped[i]
    });
  }
  return out;
}

/**
 * All sets of one exercise in one workout, merged. Quick Log saves each
 * set as its own entry, so a day can hold several entries of one lift.
 */
function buildSession(entries, workout) {
  const sets = [];
  let range = null;
  let maxedOut = false;
  let unit = 'kg';
  entries.forEach((entry) => {
    sets.push(...entrySets(entry));
    range = parseRepRange(entry) || range;
    if (entry.maxedOut) maxedOut = true;
    if (entry.unit) unit = entry.unit;
  });
  return { date: (workout && workout.date) || (entries[0] && entries[0].date) || '', unit, sets, range, maxedOut, entries };
}

function collectSessions(name, workouts, gymKey, stopAtEntry) {
  const target = String(name || '').trim().toLowerCase();
  const sessions = [];
  if (!target || !Array.isArray(workouts)) return sessions;
  for (const w of workouts) {
    if (!w || !Array.isArray(w.log)) continue;
    let entries = w.log.filter(e => normalizeExerciseName(e) === target && isComparableEntry(e, w, gymKey));
    let stop = false;
    if (stopAtEntry) {
      const idx = w.log.indexOf(stopAtEntry);
      if (idx !== -1) {
        entries = entries.filter(e => w.log.indexOf(e) <= idx);
        stop = true;
      }
    }
    if (entries.length) {
      const s = buildSession(entries, w);
      if (s.sets.length) sessions.push(s);
    }
    if (stop) return sessions;
  }
  if (stopAtEntry) {
    // The entry isn't saved in `workouts` yet: judge it as the newest session.
    const s = buildSession([stopAtEntry], null);
    if (s.sets.length) sessions.push(s);
  }
  return sessions;
}

/** The set that drives progression: a tagged Top Set, else the heaviest non-back-off set. */
function topSetOf(sets) {
  const tagged = sets.filter(s => s.type === 'top-set');
  const pool = tagged.length ? tagged : (sets.filter(s => s.type !== 'backoff').length ? sets.filter(s => s.type !== 'backoff') : sets);
  return pool.reduce((best, s) => (!best || s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps) ? s : best), null);
}

/** Rep range for a lift: the set range, else "reps first hit at this weight, up to 2 more". */
function resolveRange(sessions, top) {
  const last = sessions[sessions.length - 1];
  if (last.range) return { range: last.range, isDefault: false };
  let base = top.reps;
  for (let i = sessions.length - 2; i >= 0; i--) {
    const t = topSetOf(sessions[i].sets);
    if (!t || t.weight !== top.weight) break;
    base = t.reps;
  }
  base = Math.max(1, base);
  return { range: [base, base + 2], isDefault: true };
}

/** No top-set e1RM gain for 2 sessions in a row. */
function isStalled(sessions) {
  if (sessions.length < 3) return false;
  const [a, b, c] = sessions.slice(-3).map(s => e1rm(topSetOf(s.sets)));
  return b <= a && c <= a;
}

function fmt(n) {
  return String(Math.round((Number(n) || 0) * 100) / 100);
}

function rangeText(range) {
  return range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`;
}

function restFor(type) {
  return type === 'compound'
    ? { restSeconds: 150, restLabel: '2–3 min' }
    : { restSeconds: 90, restLabel: '~90 s' };
}

function backoffWeight(topWeight, effort, step) {
  const drop = BACKOFF_DROP[effort] ?? BACKOFF_DROP.on;
  return Math.max(0, roundTo(topWeight * (1 - drop), step));
}

function resolveTarget(exercise, workouts, options) {
  const exerciseName = typeof exercise === 'string' ? exercise : exercise && exercise.exercise;
  const name = String(exerciseName || '').trim();
  if (!name) return null;
  const isEntry = typeof exercise === 'object' && exercise;
  // Only compare like with like: an entry is judged against sessions at
  // its own gym; a name alone against the gym being trained at now.
  const gymKey = isEntry
    ? entryGymKey(exercise)
    : (options.gymKey !== undefined ? options.gymKey : currentGymKey());
  if (gymKey === null) return null;
  return { name, gymKey, entry: isEntry ? exercise : null };
}

/**
 * What to do next session, judged on the top set (BU autoregulation +
 * double progression). Back-offs follow the next top set.
 */
function suggestNextSession(exercise, workouts = [], options = {}) {
  const t = resolveTarget(exercise, workouts, options);
  if (!t) return null;
  const sessions = collectSessions(t.name, workouts, t.gymKey, t.entry);
  if (!sessions.length) return null;

  const last = sessions[sessions.length - 1];
  const unit = last.unit || 'kg';
  const type = liftType(t.name);
  const step = weightStep(t.name, unit);
  const top = topSetOf(last.sets);
  if (!top) return null;

  const { range, isDefault } = resolveRange(sessions, top);
  const effort = classifyEffort(top.rir, TARGETS[type]);
  const missed = top.reps < range[0] || last.sets.some(s => s.skipped);
  const stalled = isStalled(sessions);
  const hasTaggedTop = last.sets.some(s => s.type === 'top-set');
  const hasBackoffs = last.sets.some(s => s.type === 'backoff');

  let strategy;
  let next = { weight: top.weight, reps: top.reps };
  let message;
  const u = unit;

  if (last.maxedOut) {
    strategy = 'maxed-out';
    next.reps = top.reps + 1;
    message = 'Marked as maxed out — no more weight to add. Add 1 rep per set instead, or switch to a harder variation.';
  } else if (stalled && (missed || effort === 'harder')) {
    strategy = 'deload';
    next.weight = roundTo(top.weight * 0.9, step);
    message = `No progress for 2 sessions and effort is high. Deload for 5–7 days: about ${fmt(next.weight)} ${u} and a third fewer sets, then build back up.`;
  } else if (missed || effort === 'harder') {
    strategy = 'repeat';
    message = missed
      ? `Reps fell short of ${rangeText(range)}. Repeat ${fmt(top.weight)} ${u} and aim to hit the range.`
      : `That was harder than planned (target ~${TARGETS[type].target} reps left). Repeat ${fmt(top.weight)} ${u} × ${top.reps} before adding more.`;
  } else if (effort === 'way-easier') {
    strategy = 'increase';
    next.weight = roundTo(top.weight + step, step);
    message = `Far more than ${TARGETS[type].target} reps left — the weight is too light. Go up to ${fmt(next.weight)} ${u} × ${top.reps}.`;
  } else if (top.reps >= range[1]) {
    strategy = 'increase';
    next.weight = roundTo(top.weight + step, step);
    next.reps = range[0];
    message = `Top of the rep range hit. Add weight: ${fmt(next.weight)} ${u} × ${range[0]}, then build reps back up.`;
  } else {
    strategy = 'increase-reps';
    next.reps = top.reps + 1;
    message = `Same weight, one more rep: ${fmt(top.weight)} ${u} × ${next.reps} (working up to ${range[1]} before adding weight).`;
  }

  if (stalled && strategy !== 'deload') {
    message += ' No progress for 2 sessions — watch sleep and soreness; deload only if effort keeps climbing.';
  }
  if (effort === 'unknown' && strategy !== 'maxed-out') {
    message += ' Log reps left in reserve for sharper advice.';
  }

  const nextBackoff = backoffWeight(next.weight, 'on', step);
  const dW = next.weight - top.weight;
  const sets = last.sets.map((s) => {
    if (s === top) return { reps: next.reps, weight: next.weight, setType: s.type };
    if (s.type === 'backoff') {
      const reps = strategy === 'deload' ? s.reps : Math.max(s.reps, range[0]);
      return { reps, weight: nextBackoff, setType: 'backoff' };
    }
    // Straight sets move with the top set.
    let reps = s.reps;
    if (strategy === 'increase' && next.reps !== top.reps) reps = range[0];
    else if (strategy === 'maxed-out') reps = s.reps + 1;
    else if (strategy === 'increase-reps' && s.reps < range[1]) reps = s.reps + 1;
    return { reps, weight: Math.max(0, roundTo(s.weight + dW, step)), setType: s.type };
  });
  if (strategy === 'deload') {
    const keep = Math.max(1, Math.round(sets.length * 2 / 3));
    sets.length = keep;
  }
  if (hasBackoffs && strategy !== 'deload' && strategy !== 'maxed-out') {
    message += ` Back-offs: ~${fmt(nextBackoff)} ${u}.`;
  }

  return {
    exercise: t.name,
    unit,
    strategy,
    liftType: type,
    effort,
    repRange: range,
    repRangeIsDefault: isDefault,
    stalled,
    hasTaggedTop,
    basedOnSessions: sessions.length,
    topSet: { reps: next.reps, weight: next.weight },
    sets,
    previousSets: last.sets.map(s => ({ reps: s.reps, weight: s.weight })),
    message
  };
}

/**
 * Advice for the next set of an exercise already started today
 * (BU APRE-style set-by-set adjustment). Null before the first work set.
 */
function suggestNextSet(exercise, workouts = [], options = {}) {
  const t = resolveTarget(exercise, workouts, options);
  if (!t) return null;
  const date = options.date;
  const today = (Array.isArray(workouts) ? workouts : []).filter(w => w && (!date || w.date === date));
  const workout = date ? today[today.length - 1] : (today.length ? today[today.length - 1] : null);
  if (!workout || !Array.isArray(workout.log)) return null;
  const entries = workout.log.filter(e => normalizeExerciseName(e) === t.name.toLowerCase() && isComparableEntry(e, workout, t.gymKey));
  if (!entries.length) return null;
  const session = buildSession(entries, workout);
  if (!session.sets.length) return null;

  const unit = session.unit || 'kg';
  const type = liftType(t.name);
  const step = weightStep(t.name, unit);
  const lastSet = session.sets[session.sets.length - 1];
  const taggedTop = session.sets.filter(s => s.type === 'top-set').pop() || null;
  const ref = taggedTop || session.sets[0];
  const range = session.range || [Math.max(1, ref.reps), Math.max(1, ref.reps) + 2];
  const rest = restFor(type);
  const u = unit;
  let kind, setType, weight, reps, message, warn = false;

  if (lastSet.type === 'top-set') {
    const effort = classifyEffort(lastSet.rir, TARGETS[type]);
    weight = backoffWeight(lastSet.weight, effort, step);
    const pct = Math.round((BACKOFF_DROP[effort] ?? 0.1) * 100);
    const boRange = session.range || [Math.max(1, lastSet.reps), Math.max(1, lastSet.reps) + 2];
    reps = boRange[0];
    kind = 'backoff';
    setType = 'backoff';
    const why = {
      harder: 'top set was harder than planned',
      on: 'top set on target',
      easier: 'top set felt easy — add weight to it next time',
      'way-easier': 'top set felt easy — add weight to it next time',
      unknown: 'log reps left for a sharper drop'
    }[effort];
    message = `Back-offs: ${fmt(weight)} ${u} × ${rangeText(boRange)} (−${pct}%, ${why}). Aim for ~2 reps left.`;
    if (effort === 'harder') warn = true;
    return { kind, setType, weight, reps, repRange: boRange, unit, effort, warn, ...rest, message };
  }

  kind = lastSet.type === 'backoff' ? 'backoff' : 'straight';
  setType = lastSet.type === 'backoff' ? 'backoff' : null;
  const band = kind === 'backoff' ? TARGETS.backoff : TARGETS[type];
  const effort = classifyEffort(lastSet.rir, band);
  const short = lastSet.reps < range[0];
  reps = Math.max(lastSet.reps, range[0]);
  if (short || effort === 'harder') {
    weight = Math.max(0, roundTo(lastSet.weight * (1 - IN_SESSION_DROP), step));
    reps = range[0];
    warn = true;
    message = `Drop to ${fmt(weight)} ${u} × ${rangeText(range)}, or stop here if that was your last planned set — save energy for the next exercises.`;
  } else if (effort === 'way-easier') {
    weight = roundTo(lastSet.weight + step, step);
    message = `Plenty left in the tank. Next set: ${fmt(weight)} ${u} × ${rangeText(range)}.`;
  } else {
    weight = lastSet.weight;
    reps = lastSet.reps;
    message = effort === 'unknown'
      ? `Keep ${fmt(weight)} ${u} × ${rangeText(range)}. Log reps left for sharper advice.`
      : `On target. Keep ${fmt(weight)} ${u} × ${rangeText(range)}.`;
  }
  if (type === 'compound' && lastSet.rir === 0) {
    warn = true;
    message += ' Leave 1–3 reps in reserve on compound lifts; save failure for the last set of isolation work.';
  }
  return { kind, setType, weight, reps, repRange: range, unit, effort, warn, ...rest, message };
}

function getProgressiveOverloadSuggestion(exerciseName, workouts) {
  const next = suggestNextSession(exerciseName, workouts);
  return next ? next.message : null;
}

if (typeof module !== 'undefined') {
  module.exports = {
    getProgressiveOverloadSuggestion, suggestNextSession, suggestNextSet,
    isAltSessionEntry, isComparableEntry, entryGymKey, normalizeGymName,
    liftType, weightStep, setRir, classifyEffort
  };
}
if (typeof window !== 'undefined') {
  window.getProgressiveOverloadSuggestion = getProgressiveOverloadSuggestion;
  window.suggestNextSession = suggestNextSession;
  window.suggestNextSet = suggestNextSet;
  window.isAltSessionEntry = isAltSessionEntry;
  window.isComparableEntry = isComparableEntry;
  window.entryGymKey = entryGymKey;
  window.normalizeGymName = normalizeGymName;
}
