/**
 * session-grouping.js
 *
 * One workout session (`workouts_<user>[i]`) stores its exercises in
 * `workout.log`: one entry per exercise, each with parallel per-set arrays
 * (repsArray, weightsArray, rirArray, setTypeArray, ...). Quick log used to
 * push a NEW entry for every single set, so older sessions hold the same
 * exercise as several one-set entries (e.g. Pendulum, Hamstring Curl,
 * Pendulum). Nothing here rewrites stored data: these helpers group entries
 * at read time so every screen shows one block per exercise with numbered
 * sets, while each set still points at its own stored entry/set index for
 * editing and deleting.
 *
 * Grouping key: `entry.exerciseId` when present; entries without one (old
 * data) fall back to a case-insensitive name match. New entries get an
 * `exerciseId` derived from the name (exerciseIdFor), so old and new sets of
 * the same exercise land in the same block.
 *
 * Volume, PRs and set counts are computed from the stored entries, never
 * from these blocks, so grouping can't change them.
 */
(function (global) {
  'use strict';

  const normName = name => String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();

  /** Stable id for an exercise name: same name (any case/spacing) → same id. */
  function exerciseIdFor(name) {
    const n = normName(name);
    if (!n) return '';
    const slug = n.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'ex_' + (slug || encodeURIComponent(n));
  }

  function entryName(entry) {
    return String((entry && (entry.exercise || entry.name)) || '').trim();
  }

  /** The id an entry groups by: its own exerciseId, else one derived from its name. */
  function exerciseKeyOf(entry) {
    const own = entry && typeof entry.exerciseId === 'string' ? entry.exerciseId.trim() : '';
    return own || exerciseIdFor(entryName(entry));
  }

  /** Lazily give an entry an exerciseId (additive; returns true when it changed). */
  function ensureExerciseId(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.exerciseId === 'string' && entry.exerciseId.trim()) return false;
    const id = exerciseIdFor(entryName(entry));
    if (!id) return false;
    entry.exerciseId = id;
    return true;
  }

  const SET_TYPE_TAGS = {
    'top-set': 'Top',
    backoff: 'BO',
    dropset: 'Drop',
    'rest-pause': 'RP',
    warmup: 'Warm-up',
    'warm-up': 'Warm-up',
  };

  function _num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** One stored set as a display row. */
  function setView(entry, setIndex) {
    const at = (key) => (Array.isArray(entry[key]) ? entry[key][setIndex] : undefined);
    const type = String(at('setTypeArray') || 'standard');
    const tags = [];
    if (SET_TYPE_TAGS[type]) tags.push(SET_TYPE_TAGS[type]);
    else {
      if (at('dropsetArray')) tags.push('Drop');
      if (at('restPauseArray')) tags.push('RP');
    }
    const sideReps = at('sideRepsArray') || null;
    const unilateral = !!at('unilateralArray');
    if (unilateral) tags.push(sideReps ? `L ${sideReps.left} / R ${sideReps.right}` : 'L/R');
    return {
      weight: _num(at('weightsArray')),
      reps: _num(at('repsArray')),
      rir: _num(at('rirArray')),
      rpe: _num(at('rpeArray')),
      setType: type,
      tags,
      unilateral,
      sideReps,
      completed: !!at('completedArray'),
      skipped: !!at('skippedArray'),
    };
  }

  function _setCount(entry) {
    if (!entry) return 0;
    if (Array.isArray(entry.repsArray)) return entry.repsArray.length;
    if (Array.isArray(entry.weightsArray)) return entry.weightsArray.length;
    return 0;
  }

  /**
   * Group one session's log into exercise blocks.
   * Returns [{ key, exerciseId, name, unit, entryIndexes, sets }] where each
   * set is { entryIndex, setIndex, number, ...setView }. Blocks are ordered by
   * when the exercise was first logged (log order), sets by when they were
   * logged (entry order, then position in the entry — log entries are only
   * ever appended, so storage order is time order). Entries with an id group
   * by id; entries without one join the block whose name matches.
   */
  function groupSessionLog(log) {
    const blocks = [];
    const byId = new Map();
    const byName = new Map();
    (Array.isArray(log) ? log : []).forEach((entry, entryIndex) => {
      if (!entry || typeof entry !== 'object') return;
      const name = entryName(entry);
      const nameKey = normName(name);
      const ownId = typeof entry.exerciseId === 'string' ? entry.exerciseId.trim() : '';
      const derived = exerciseIdFor(name);
      let block = (ownId && byId.get(ownId))
        || (nameKey && byName.get(nameKey))
        || (derived && byId.get(derived))
        || null;
      if (!block) {
        const id = ownId || derived;
        block = {
          key: id || `entry_${entryIndex}`,
          exerciseId: id,
          name: name || 'Exercise',
          unit: entry.unit || 'kg',
          entryIndexes: [],
          sets: [],
        };
        blocks.push(block);
        if (id) byId.set(id, block);
      }
      if (ownId && !byId.has(ownId)) byId.set(ownId, block);
      if (derived && !byId.has(derived)) byId.set(derived, block);
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, block);
      block.entryIndexes.push(entryIndex);
      const n = _setCount(entry);
      for (let setIndex = 0; setIndex < n; setIndex++) {
        block.sets.push({ entryIndex, setIndex, number: block.sets.length + 1, ...setView(entry, setIndex) });
      }
    });
    return blocks;
  }

  const PER_SET_ARRAYS = [
    'repsArray', 'weightsArray', 'rpeArray', 'rirArray', 'dropsetArray', 'restPauseArray',
    'unilateralArray', 'sideRepsArray', 'skippedArray', 'completedArray', 'setTypeArray', 'advancedArray',
  ];

  const PER_SET_DEFAULTS = {
    repsArray: 0, weightsArray: 0, rpeArray: null, rirArray: null, dropsetArray: false, restPauseArray: false,
    unilateralArray: false, sideRepsArray: null, skippedArray: false, completedArray: false, setTypeArray: 'standard',
  };

  /**
   * A read-only entry that combines every stored entry of a block, in block
   * set order — for display only (trend, progress strip, chips). Never save it.
   */
  function mergedBlockEntry(log, block) {
    const entries = block.entryIndexes.map(i => log[i]).filter(Boolean);
    const first = entries[0] || {};
    if (entries.length === 1) return first;
    const merged = { ...first, exercise: block.name };
    PER_SET_ARRAYS.forEach(key => { merged[key] = []; });
    block.sets.forEach(s => {
      const e = log[s.entryIndex];
      PER_SET_ARRAYS.forEach(key => {
        const v = Array.isArray(e[key]) ? e[key][s.setIndex] : undefined;
        merged[key].push(v === undefined ? (key === 'advancedArray' ? {} : PER_SET_DEFAULTS[key]) : v);
      });
    });
    merged.sets = block.sets.length;
    const withGoal = entries.find(e => Number(e.goal)) || null;
    merged.goal = withGoal ? withGoal.goal : first.goal;
    const withRepGoal = entries.find(e => Number(e.repGoal)) || null;
    merged.repGoal = withRepGoal ? withRepGoal.repGoal : first.repGoal;
    merged.maxedOut = entries.some(e => e.maxedOut);
    const withRec = entries.slice().reverse().find(e => e.nextSessionRecommendation);
    merged.nextSessionRecommendation = withRec ? withRec.nextSessionRecommendation : undefined;
    // The newest in-session advice (set-complete.js stampSetAdvice).
    const withAdvice = entries.filter(e => e.setAdvice).sort((a, b) => (a.setAdvice.at || 0) - (b.setAdvice.at || 0)).pop();
    merged.setAdvice = withAdvice ? withAdvice.setAdvice : undefined;
    return merged;
  }

  /** The block in `log` for `name` (by id, falling back to name), or null. */
  function findBlockFor(log, name, exerciseId) {
    const id = exerciseId || exerciseIdFor(name);
    const derived = exerciseIdFor(name);
    return groupSessionLog(log).find(b => b.exerciseId === id || exerciseIdFor(b.name) === derived) || null;
  }

  /**
   * Session log with one entry per exercise (copies; the input is untouched).
   * For templates, "repeat" and summaries that used to treat every stored
   * entry as its own exercise.
   */
  function collapseSessionLog(log) {
    const list = Array.isArray(log) ? log : [];
    return groupSessionLog(list).map(block => {
      const merged = mergedBlockEntry(list, block);
      const copy = { ...merged };
      PER_SET_ARRAYS.forEach(key => { if (Array.isArray(merged[key])) copy[key] = merged[key].slice(); });
      copy.exercise = block.name;
      copy.exerciseId = block.exerciseId;
      copy.sets = block.sets.length;
      return copy;
    });
  }

  /**
   * Group History-style exercises ({ name, repsArray, weightsArray, exerciseId? })
   * into one per exercise, keeping first-seen order and set order.
   */
  function groupHistoryExercises(exercises) {
    const out = [];
    const byKey = new Map();
    (Array.isArray(exercises) ? exercises : []).forEach(ex => {
      if (!ex) return;
      const name = String(ex.name || ex.exercise || 'Exercise').trim() || 'Exercise';
      const key = exerciseIdFor(name);
      let target = byKey.get(key);
      if (!target) {
        target = { ...ex, name, repsArray: [], weightsArray: [] };
        byKey.set(key, target);
        out.push(target);
      }
      const reps = Array.isArray(ex.repsArray) ? ex.repsArray : [];
      const weights = Array.isArray(ex.weightsArray) ? ex.weightsArray : [];
      const n = Math.max(reps.length, weights.length);
      for (let i = 0; i < n; i++) {
        target.repsArray.push(reps[i] ?? 0);
        target.weightsArray.push(weights[i] ?? 0);
      }
    });
    return out;
  }

  /** "20 kg × 8 · RIR 2 · Top" for one set row. */
  function formatSetLine(set, unit) {
    const parts = [];
    const w = set.weight != null ? `${set.weight} ${unit || 'kg'}` : null;
    const r = set.reps != null ? `${set.reps}` : '?';
    parts.push(w ? `${w} × ${r}` : `${r} reps`);
    if (set.rir != null) parts.push(`RIR ${set.rir}`);
    else if (set.rpe != null && set.rpe > 0) parts.push(`RPE ${set.rpe}`);
    (set.tags || []).forEach(t => parts.push(t));
    return parts.join(' · ');
  }

  /**
   * Move one exercise (the card holding `entryIndexes`) up (dir -1) or down
   * (dir +1) past its neighbour. Returns the reordered log (a new array of the
   * same entries, each exercise's entries kept together and in order), or
   * null when it can't move that way.
   */
  function moveExercise(log, entryIndexes, dir) {
    const blocks = groupSessionLog(log);
    const first = Array.isArray(entryIndexes) ? entryIndexes[0] : entryIndexes;
    const at = blocks.findIndex(b => b.entryIndexes.includes(first));
    const to = at + (dir < 0 ? -1 : 1);
    if (at === -1 || to < 0 || to >= blocks.length) return null;
    const order = blocks.slice();
    [order[at], order[to]] = [order[to], order[at]];
    const out = [];
    const placed = new Set();
    order.forEach(b => b.entryIndexes.forEach(i => { out.push(log[i]); placed.add(i); }));
    // Anything groupSessionLog skipped (non-objects) keeps its place at the end.
    log.forEach((e, i) => { if (!placed.has(i)) out.push(e); });
    return out;
  }

  const api = {
    moveExercise,
    normName,
    exerciseIdFor,
    exerciseKeyOf,
    ensureExerciseId,
    setView,
    groupSessionLog,
    mergedBlockEntry,
    findBlockFor,
    collapseSessionLog,
    groupHistoryExercises,
    formatSetLine,
    PER_SET_ARRAYS,
    PER_SET_DEFAULTS,
  };

  global.sessionGrouping = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
