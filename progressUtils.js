function computeOneRepMax(weightsArray, repsArray) {
  if (!Array.isArray(weightsArray) || !Array.isArray(repsArray)) return 0;
  let best = 0;
  for (let i = 0; i < weightsArray.length; i++) {
    const w = +weightsArray[i];
    const r = +repsArray[i];
    if (!w || !r) continue;
    const est = w * (1 + r / 30);
    if (est > best) best = est;
  }
  return best;
}

function calculate1RM(reps, weight, method = 'epley') {
  const r = Number(reps);
  const w = Number(weight);
  if (!Number.isFinite(r) || !Number.isFinite(w) || r <= 0 || w <= 0) return 0;

  if (method === 'brzycki') {
    const denominator = 37 - r;
    if (denominator <= 0) return 0;
    return w * (36 / denominator);
  }

  return w * (1 + r / 30);
}

function calculateWorkoutMetrics(workout, method = 'epley') {
  const log = Array.isArray(workout?.log) ? workout.log : [];
  let sessionVolume = 0;
  let weightedIntensityTotal = 0;
  let totalValidSets = 0;
  let estimated1RM = 0;

  log.forEach(entry => {
    const repsArray = Array.isArray(entry?.repsArray) ? entry.repsArray : [];
    const weightsArray = Array.isArray(entry?.weightsArray) ? entry.weightsArray : [];
    const rpeArray = Array.isArray(entry?.rpeArray) ? entry.rpeArray : [];

    for (let i = 0; i < Math.max(repsArray.length, weightsArray.length); i++) {
      const reps = Number(repsArray[i]);
      const weight = Number(weightsArray[i]);
      if (!Number.isFinite(reps) || !Number.isFinite(weight) || reps <= 0 || weight <= 0) continue;

      const volume = reps * weight;
      sessionVolume += volume;

      const hasRpe = Number.isFinite(Number(rpeArray[i]));
      const set1RM = calculate1RM(reps, weight, hasRpe ? 'epley' : method);
      if (set1RM > estimated1RM) estimated1RM = set1RM;

      if (set1RM > 0) {
        weightedIntensityTotal += (weight / set1RM) * 100;
        totalValidSets += 1;
      }
    }
  });

  const averageIntensity = totalValidSets > 0 ? weightedIntensityTotal / totalValidSets : 0;
  return {
    sessionVolume,
    averageIntensity,
    estimated1RM
  };
}

function loadPRs(user) {
  if (typeof localStorage === 'undefined') return {};
  return JSON.parse(localStorage.getItem(`prs_${user}`)) || {};
}

function savePRs(user, prs) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`prs_${user}`, JSON.stringify(prs));
}

function formatDateStamp(value) {
  if (!value) return null;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp : null;
}

function getSessionDateStamp(workout, fallback = Date.now()) {
  const workoutDate = formatDateStamp(workout?.date);
  if (workoutDate) return workoutDate;
  const firstLogDate = Array.isArray(workout?.log)
    ? workout.log.map(entry => formatDateStamp(entry?.date)).find(Boolean)
    : null;
  return firstLogDate || fallback;
}

function notifyPR(message) {
  if (typeof window === 'undefined' || !message) return;
  if (typeof window.confetti === 'function') {
    window.confetti({
      particleCount: 100, spread: 70,
      origin: { x: 0.5, y: 0.85 },
      colors: ['#2d6a4f', '#52b788', '#95d5b2', '#ffd166', '#ffffff'],
      ticks: 180
    });
  }
  if (typeof window.showToast === 'function') {
    window.showToast(message);
    return;
  }
}

/**
 * True for a set logged at another gym or on a different machine (Alt Gym /
 * Alt Machine). Those never count for PRs. Mirrors isAltSessionEntry() in
 * progressiveOverload.js, kept inline so this file works on its own.
 */
function isTaggedEntry(entry, workout) {
  const ctx = (entry && entry.sessionCtx) || (workout && workout._sessionCtx);
  return !!(ctx && (ctx.altMachine || ctx.altGym));
}

function updatePRs(user, workout, volumeCalc) {
  if (!workout || !Array.isArray(workout.log)) return null;
  const prs = loadPRs(user);
  let updated = false;
  const sessionDate = getSessionDateStamp(workout);
  const groupedByExercise = {};
  const allPREvents = [];

  workout.log.forEach(entry => {
    const name = entry?.exercise;
    if (!name) return;
    if (isTaggedEntry(entry, workout)) return;
    if (!groupedByExercise[name]) groupedByExercise[name] = [];
    groupedByExercise[name].push(entry);
  });

  Object.entries(groupedByExercise).forEach(([exercise, entries]) => {
    const existing = prs[exercise] || {
      heaviestSet: null,
      repPRsByWeight: {},
      highestVolumeSession: null,
      history: []
    };
    const repPRsByWeight = { ...(existing.repPRsByWeight || {}) };
    let heaviestSet = existing.heaviestSet || null;
    const exerciseVolume = volumeCalc ? volumeCalc({ log: entries }) : 0;
    const prEvents = [];

    entries.forEach(entry => {
      const repsArray = Array.isArray(entry?.repsArray) ? entry.repsArray : [];
      const weightsArray = Array.isArray(entry?.weightsArray) ? entry.weightsArray : [];
      const setTypeArray = Array.isArray(entry?.setTypeArray) ? entry.setTypeArray : [];
      const size = Math.max(repsArray.length, weightsArray.length);

      for (let i = 0; i < size; i++) {
        // Back-off sets are deliberately submaximal follow-ups to the top
        // set, so they shouldn't be able to register a PR.
        if (setTypeArray[i] === 'backoff') continue;
        const reps = Number(repsArray[i]);
        const weight = Number(weightsArray[i]);
        if (!Number.isFinite(reps) || !Number.isFinite(weight) || reps <= 0 || weight <= 0) continue;

        if (!heaviestSet || weight > Number(heaviestSet.weight || 0)) {
          heaviestSet = { weight, reps, date: sessionDate };
          updated = true;
          prEvents.push(`${exercise}: New heaviest set ${weight} × ${reps}`);
        }

        const weightKey = String(weight);
        const existingAtWeight = repPRsByWeight[weightKey];
        if (!existingAtWeight || reps > Number(existingAtWeight.reps || 0)) {
          repPRsByWeight[weightKey] = { reps, date: sessionDate };
          updated = true;
          prEvents.push(`${exercise}: New rep PR ${weight} × ${reps}`);
        }
      }
    });

    let highestVolumeSession = existing.highestVolumeSession || null;
    if (!highestVolumeSession || exerciseVolume > Number(highestVolumeSession.volume || 0)) {
      highestVolumeSession = { volume: exerciseVolume, date: sessionDate };
      updated = true;
      prEvents.push(`${exercise}: New volume PR ${exerciseVolume.toFixed(1)}`);
    }

    const history = Array.isArray(existing.history) ? existing.history.slice(-29) : [];
    if (prEvents.length) {
      history.push({ date: sessionDate, events: prEvents });
      prEvents.forEach(notifyPR);
      allPREvents.push(...prEvents);
    }

    prs[exercise] = {
      heaviestSet,
      repPRsByWeight,
      highestVolumeSession,
      history
    };
  });

  if (updated) {
    savePRs(user, prs);
  }

  if (workout && typeof workout === 'object') {
    workout.prEvents = allPREvents.slice();
  }

  return updated ? prs : null;
}

/* ── Recalculate PRs after an Alt Gym / Alt Machine tag changes ────────────
   Rebuilds the affected exercises in both PR stores — `prBoard_<user>`
   (pr-tracker.js: best weight, e1RM and single-set volume) and
   `prs_<user>` (updatePRs above: heaviest set, reps per weight, session
   volume) — from the workouts kept on this device (`workouts_<user>` and
   `workoutHistory_<user>`), counting untagged sets only.

   A record that no local set accounts for came from a workout that only
   lives on the server now (purged after 4 weeks); it can't be re-checked,
   so it's kept, and only replaced if a local set beats it. */

function _normName(name) {
  return String(name || '').trim().toLowerCase();
}

function _readList(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function _readObject(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Same rounding as pr-tracker.js's _e1rm(). */
function _boardE1rm(weight, reps) {
  if (!weight || !reps || reps <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

/** Same sum as calculateWorkoutVolume({ log: entries }). */
function _entriesVolume(entries) {
  let total = 0;
  entries.forEach(entry => {
    const reps = entry.repsArray || [];
    const weights = entry.weightsArray || [];
    for (let i = 0; i < reps.length; i++) total += reps[i] * (weights[i] || 0);
  });
  return total;
}

function _collectExerciseStats(workouts, targets) {
  const stats = new Map();
  const statFor = (key, name) => {
    if (!stats.has(key)) {
      stats.set(key, {
        name,
        seen: { weights: new Set(), e1rms: new Set(), setVols: new Set(), repPairs: new Set(), sessionVols: new Set() },
        board: { weight: null, e1rm: null, volume: null },
        heaviest: null,
        repByWeight: {},
        sessionVol: null,
      });
    }
    return stats.get(key);
  };

  workouts.forEach(workout => {
    const date = String(workout?.date || '').slice(0, 10);
    const stamp = getSessionDateStamp(workout, 0);
    const byName = {};
    (Array.isArray(workout?.log) ? workout.log : []).forEach(entry => {
      const key = _normName(entry?.exercise || entry?.name);
      if (!targets.has(key)) return;
      (byName[key] = byName[key] || []).push(entry);
    });

    Object.entries(byName).forEach(([key, entries]) => {
      const s = statFor(key, String(entries[0].exercise || entries[0].name || '').trim());
      const counted = entries.filter(e => !isTaggedEntry(e, workout));
      // Session volume as updatePRs computes it now (untagged) and did
      // before tags were skipped (all entries) — either may be on record.
      s.seen.sessionVols.add(_entriesVolume(entries));
      s.seen.sessionVols.add(_entriesVolume(counted));
      if (counted.length) {
        const v = _entriesVolume(counted);
        if (!s.sessionVol || v > s.sessionVol.volume) s.sessionVol = { volume: v, date: stamp };
      }

      entries.forEach(entry => {
        const tagged = isTaggedEntry(entry, workout);
        const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
        const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
        const types = Array.isArray(entry.setTypeArray) ? entry.setTypeArray : [];
        const size = Math.max(reps.length, weights.length);
        for (let i = 0; i < size; i++) {
          if (types[i] === 'backoff') continue;
          const r = Number(reps[i]) || 0;
          const w = Number(weights[i]) || 0;
          if (r <= 0 || w <= 0) continue;
          const e1rm = _boardE1rm(w, r);
          const vol = w * r;
          s.seen.weights.add(w);
          s.seen.e1rms.add(e1rm);
          s.seen.setVols.add(vol);
          s.seen.repPairs.add(`${w}|${r}`);
          if (tagged) continue;

          if (!s.board.weight || w > s.board.weight.value) s.board.weight = { value: w, reps: r, date };
          if (!s.board.e1rm || e1rm > s.board.e1rm.value) s.board.e1rm = { value: e1rm, reps: r, weight: w, date };
          if (!s.board.volume || vol > s.board.volume.value) s.board.volume = { value: vol, date };
          if (!s.heaviest || w > s.heaviest.weight) s.heaviest = { weight: w, reps: r, date: stamp };
          const at = s.repByWeight[String(w)];
          if (!at || r > at.reps) s.repByWeight[String(w)] = { reps: r, date: stamp };
        }
      });
    });
  });
  return stats;
}

/**
 * Keep `current` only if no local set accounts for it (`seen` lacks it) and
 * no counted local set beats it; otherwise use the best counted local value.
 * → 'keep' | 'replace' | 'clear'
 */
function _decide(current, seen, best) {
  const cur = Number(current) || 0;
  const bestValue = best ? best.value : 0;
  if (cur > 0 && !seen.has(cur) && cur >= bestValue) return 'keep';
  return bestValue > 0 ? 'replace' : 'clear';
}

function _recalcBoardEntry(rec, s) {
  const out = { ...rec };
  const w = _decide(rec.weight, s.seen.weights, s.board.weight);
  if (w === 'replace') Object.assign(out, { weight: s.board.weight.value, weightReps: s.board.weight.reps, weightDate: s.board.weight.date });
  if (w === 'clear') { out.weight = 0; delete out.weightReps; delete out.weightDate; }
  const e = _decide(rec.e1rm, s.seen.e1rms, s.board.e1rm);
  if (e === 'replace') Object.assign(out, { e1rm: s.board.e1rm.value, e1rmReps: s.board.e1rm.reps, e1rmWeight: s.board.e1rm.weight, e1rmDate: s.board.e1rm.date });
  if (e === 'clear') { out.e1rm = 0; delete out.e1rmReps; delete out.e1rmWeight; delete out.e1rmDate; }
  const v = _decide(rec.volume, s.seen.setVols, s.board.volume);
  if (v === 'replace') Object.assign(out, { volume: s.board.volume.value, volumeDate: s.board.volume.date });
  if (v === 'clear') { out.volume = 0; delete out.volumeDate; }
  return out;
}

function _recalcPrsEntry(rec, s) {
  const out = { ...rec };
  const heavy = rec.heaviestSet || null;
  const h = _decide(heavy && heavy.weight, s.seen.weights, s.heaviest && { value: s.heaviest.weight });
  if (h === 'replace') out.heaviestSet = { ...s.heaviest };
  if (h === 'clear') out.heaviestSet = null;

  // Reps per weight: keep records no local set explains, then let counted
  // local sets set or beat each weight.
  const repByWeight = {};
  Object.entries(rec.repPRsByWeight || {}).forEach(([w, val]) => {
    if (!s.seen.repPairs.has(`${Number(w)}|${Number(val && val.reps)}`)) repByWeight[w] = val;
  });
  Object.entries(s.repByWeight).forEach(([w, val]) => {
    if (!repByWeight[w] || val.reps > Number(repByWeight[w].reps || 0)) repByWeight[w] = { ...val };
  });
  out.repPRsByWeight = repByWeight;

  const vol = rec.highestVolumeSession || null;
  const v = _decide(vol && vol.volume, s.seen.sessionVols, s.sessionVol && { value: s.sessionVol.volume });
  if (v === 'replace') out.highestVolumeSession = { ...s.sessionVol };
  if (v === 'clear') out.highestVolumeSession = null;
  return out;
}

/**
 * Recalculate PRs for the given exercise names after their Alt Gym /
 * Alt Machine tags changed. Returns true if either store changed.
 */
function recalculatePRs(user, exerciseNames) {
  if (!user || typeof localStorage === 'undefined') return false;
  const targets = new Set((exerciseNames || []).map(_normName).filter(Boolean));
  if (!targets.size) return false;

  const workouts = [..._readList(`workoutHistory_${user}`), ..._readList(`workouts_${user}`)];
  const stats = _collectExerciseStats(workouts, targets);

  const board = _readObject(`prBoard_${user}`);
  const prs = _readObject(`prs_${user}`);
  const boardBefore = JSON.stringify(board);
  const prsBefore = JSON.stringify(prs);

  targets.forEach(key => {
    const s = stats.get(key);
    if (!s) return; // nothing local to recalculate from

    const boardKeys = Object.keys(board).filter(k => _normName(k) === key);
    if (!boardKeys.length && s.board.weight) boardKeys.push(s.name);
    boardKeys.forEach(k => {
      const next = _recalcBoardEntry(board[k] || { weight: 0, e1rm: 0, volume: 0 }, s);
      if (!next.weight && !next.e1rm && !next.volume) delete board[k];
      else board[k] = next;
    });

    const prsKeys = Object.keys(prs).filter(k => _normName(k) === key);
    if (!prsKeys.length && s.heaviest) prsKeys.push(s.name);
    prsKeys.forEach(k => {
      const next = _recalcPrsEntry(prs[k] || { heaviestSet: null, repPRsByWeight: {}, highestVolumeSession: null, history: [] }, s);
      const empty = !next.heaviestSet && !next.highestVolumeSession && !Object.keys(next.repPRsByWeight || {}).length;
      if (empty) delete prs[k];
      else prs[k] = next;
    });
  });

  const boardChanged = JSON.stringify(board) !== boardBefore;
  const prsChanged = JSON.stringify(prs) !== prsBefore;
  if (boardChanged) localStorage.setItem(`prBoard_${user}`, JSON.stringify(board));
  if (prsChanged) localStorage.setItem(`prs_${user}`, JSON.stringify(prs));
  return boardChanged || prsChanged;
}

function calculateMonotony(dailyLoads) {
  if (!Array.isArray(dailyLoads) || dailyLoads.length === 0) return 0;
  const loads = dailyLoads
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v >= 0);
  if (!loads.length) return 0;
  const mean = loads.reduce((sum, value) => sum + value, 0) / loads.length;
  const variance = loads.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / loads.length;
  const standardDeviation = Math.sqrt(variance);
  if (!standardDeviation) return 0;
  return mean / standardDeviation;
}

function calculateStrain(weeklyMonotony, weeklyLoad) {
  const monotony = Number(weeklyMonotony);
  const load = Number(weeklyLoad);
  if (!Number.isFinite(monotony) || !Number.isFinite(load)) return 0;
  return monotony * load;
}

if (typeof module !== 'undefined') {
  module.exports = {
    computeOneRepMax,
    calculate1RM,
    calculateWorkoutMetrics,
    loadPRs,
    savePRs,
    updatePRs,
    recalculatePRs,
    isTaggedEntry,
    calculateMonotony,
    calculateStrain
  };
}
if (typeof window !== 'undefined') {
  window.computeOneRepMax = computeOneRepMax;
  window.calculate1RM = calculate1RM;
  window.calculateWorkoutMetrics = calculateWorkoutMetrics;
  window.loadPRs = loadPRs;
  window.savePRs = savePRs;
  window.updatePRs = updatePRs;
  window.recalculatePRs = recalculatePRs;
  window.calculateMonotony = calculateMonotony;
  window.calculateStrain = calculateStrain;
}

export {
  computeOneRepMax,
  calculate1RM,
  calculateWorkoutMetrics,
  loadPRs,
  savePRs,
  updatePRs,
  calculateMonotony,
  calculateStrain
};
