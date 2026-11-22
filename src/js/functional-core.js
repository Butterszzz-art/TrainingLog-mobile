/* =============================================================
   FUNCTIONAL CORE — pure logic for the Hybrid (CrossFit / HYROX /
   circuits) training mode. No DOM, no storage: the UI in
   src/js/functional.js reads and writes localStorage and calls these.

   Data shapes (all stored per account, see functional.js):
     crossfitLog_<u>        [WodEntry]   (also synced to /crossfit/sync)
     hyroxLog_<u>           [HyroxSim]
     crossfitTemplates_<u>  [Template]
     functionalCircuits_<u> [Circuit]
     hyroxRace_<u>          RacePlan (single value)

   WodEntry keeps the legacy fields (date, name, minutes, seconds,
   rounds, notes, exercises[{exerciseName, sets, reps, weight}]) so old
   entries and the backend sync keep working, and adds: id, format,
   scoreType, scoreReps, scoreLoad, capped, rx, rpe, benchmark, source,
   durationMin.
   ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FunctionalCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ── Benchmarks ─────────────────────────────────────────────── */

  // type: time (lower is better) | amrap (rounds+reps) | load | reps
  const BENCHMARKS = [
    { key: 'fran',     name: 'Fran',         type: 'time',  group: 'girls', desc: '21-15-9 Thrusters (43/29 kg) and Pull-ups' },
    { key: 'grace',    name: 'Grace',        type: 'time',  group: 'girls', desc: '30 Clean & Jerks for time (61/43 kg)' },
    { key: 'isabel',   name: 'Isabel',       type: 'time',  group: 'girls', desc: '30 Snatches for time (61/43 kg)' },
    { key: 'diane',    name: 'Diane',        type: 'time',  group: 'girls', desc: '21-15-9 Deadlifts (102/70 kg) and Handstand Push-ups' },
    { key: 'elizabeth',name: 'Elizabeth',    type: 'time',  group: 'girls', desc: '21-15-9 Squat Cleans (61/43 kg) and Ring Dips' },
    { key: 'helen',    name: 'Helen',        type: 'time',  group: 'girls', desc: '3 rounds: 400 m Run, 21 KB Swings (24/16 kg), 12 Pull-ups' },
    { key: 'karen',    name: 'Karen',        type: 'time',  group: 'girls', desc: '150 Wall-ball Shots for time (9/6 kg)' },
    { key: 'annie',    name: 'Annie',        type: 'time',  group: 'girls', desc: '50-40-30-20-10 Double-unders and Sit-ups' },
    { key: 'jackie',   name: 'Jackie',       type: 'time',  group: 'girls', desc: '1000 m Row, 50 Thrusters (20/15 kg), 30 Pull-ups' },
    { key: 'cindy',    name: 'Cindy',        type: 'amrap', group: 'girls', capMin: 20, desc: 'AMRAP 20: 5 Pull-ups, 10 Push-ups, 15 Air Squats' },
    { key: 'mary',     name: 'Mary',         type: 'amrap', group: 'girls', capMin: 20, desc: 'AMRAP 20: 5 Handstand Push-ups, 10 Pistols, 15 Pull-ups' },
    { key: 'murph',    name: 'Murph',        type: 'time',  group: 'hero',  desc: '1 mile Run, 100 Pull-ups, 200 Push-ups, 300 Squats, 1 mile Run (vest 9/6 kg)' },
    { key: 'dt',       name: 'DT',           type: 'time',  group: 'hero',  desc: '5 rounds: 12 Deadlifts, 9 Hang Power Cleans, 6 Push Jerks (70/47 kg)' },
    { key: 'filthy50', name: 'Filthy Fifty', type: 'time',  group: 'hero',  desc: '50 each: Box Jumps, Jumping Pull-ups, KB Swings, Walking Lunges, K2E, Push Press, Back Ext, Wall Balls, Burpees, Double-unders' },
    { key: 'row2k',    name: '2k Row',       type: 'time',  group: 'tests', desc: '2000 m on the rower for time' },
    { key: 'run5k',    name: '5k Run',       type: 'time',  group: 'tests', desc: '5 km run for time' },
    { key: 'ski1k',    name: '1k Ski',       type: 'time',  group: 'tests', desc: '1000 m on the SkiErg for time' },
    { key: 'maxpullups', name: 'Max Pull-ups', type: 'reps', group: 'tests', desc: 'Max unbroken strict or kipping pull-ups' },
    { key: 'snatch1rm',  name: 'Snatch 1RM',   type: 'load', group: 'lifts', desc: 'Heaviest single snatch' },
    { key: 'cj1rm',      name: 'Clean & Jerk 1RM', type: 'load', group: 'lifts', desc: 'Heaviest single clean & jerk' },
    { key: 'clean1rm',   name: 'Clean 1RM',    type: 'load', group: 'lifts', desc: 'Heaviest single squat or power clean' },
  ];

  const BENCHMARK_GROUPS = { girls: 'The Girls', hero: 'Hero WODs', tests: 'Engine tests', lifts: 'Olympic lifts' };

  // Movements suggested in the movement name field.
  const MOVEMENTS = [
    'Thruster', 'Pull-up', 'Chest-to-Bar Pull-up', 'Bar Muscle-up', 'Ring Muscle-up', 'Toes-to-Bar',
    'Handstand Push-up', 'Push-up', 'Burpee', 'Bar-facing Burpee', 'Box Jump', 'Box Jump Over',
    'Double-under', 'Wall Ball', 'Kettlebell Swing', 'Goblet Squat', 'Air Squat', 'Pistol',
    'Deadlift', 'Power Clean', 'Squat Clean', 'Hang Power Clean', 'Clean & Jerk', 'Power Snatch',
    'Squat Snatch', 'Push Press', 'Push Jerk', 'Front Squat', 'Back Squat', 'Overhead Squat',
    'Dumbbell Snatch', 'Devil Press', 'Sit-up', 'GHD Sit-up', 'Rope Climb', 'Lunge',
    'Run', 'Row', 'SkiErg', 'Bike Erg', 'Assault Bike', 'Sled Push', 'Sled Pull',
    'Farmers Carry', 'Sandbag Lunge', 'Burpee Broad Jump',
  ];

  const FORMATS = {
    fortime:  { label: 'For Time', scoreType: 'time' },
    amrap:    { label: 'AMRAP',    scoreType: 'amrap' },
    emom:     { label: 'EMOM',     scoreType: 'none' },
    strength: { label: 'Strength', scoreType: 'load' },
    other:    { label: 'Other',    scoreType: 'none' },
  };

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function findBenchmark(keyOrName) {
    const n = norm(keyOrName);
    if (!n) return null;
    return BENCHMARKS.find(b => b.key === n || norm(b.name) === n) || null;
  }

  // Key that groups repeated attempts: the benchmark key, or the
  // normalised workout name for the user's own named WODs.
  function workoutKey(entry) {
    if (!entry) return '';
    if (entry.benchmark) return entry.benchmark;
    const b = findBenchmark(entry.name);
    return b ? b.key : (norm(entry.name) ? 'custom:' + norm(entry.name) : '');
  }

  /* ── Time helpers ───────────────────────────────────────────── */

  // "mm:ss", "h:mm:ss", "m" or plain seconds-ish numbers. "4:12" → 252.
  function parseTime(str) {
    if (str == null) return 0;
    const s = String(str).trim();
    if (!s) return 0;
    if (/^\d+$/.test(s)) {
      // Phone number pads have no ":" — "412" means 4:12, "45" means 0:45,
      // "12500" means 1:25:00.
      const n = Number(s);
      if (s.length >= 5) return Math.floor(n / 10000) * 3600 + Math.floor((n % 10000) / 100) * 60 + (n % 100);
      return s.length >= 3 ? Math.floor(n / 100) * 60 + (n % 100) : n;
    }
    if (/^\d+\.\d+$/.test(s)) return Math.round(Number(s) * 60); // decimal minutes
    const parts = s.split(':').map(p => Number(p));
    if (parts.some(p => !Number.isFinite(p) || p < 0)) return 0;
    if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
    if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    return 0;
  }

  function fmtTime(totalSec) {
    const t = Math.max(0, Math.round(Number(totalSec) || 0));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // Signed split difference: "+5s", "−1:05", "=".
  function fmtDelta(diffSec) {
    const d = Math.round(Number(diffSec) || 0);
    if (!d) return '=';
    const a = Math.abs(d);
    const body = a < 60 ? `${a}s` : `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
    return (d < 0 ? '\u2212' : '+') + body;
  }

  /* ── Scores ─────────────────────────────────────────────────── */

  function entrySeconds(e) {
    return (Number(e && e.minutes) || 0) * 60 + (Number(e && e.seconds) || 0);
  }

  function inferScoreType(e) {
    if (!e) return 'none';
    if (e.scoreType) return e.scoreType;
    const b = findBenchmark(e.benchmark || e.name);
    if (b) return b.type;
    if (e.format && FORMATS[e.format]) return FORMATS[e.format].scoreType;
    if (entrySeconds(e) > 0) return 'time';
    if (Number(e.rounds) > 0) return 'amrap';
    return 'none';
  }

  // Comparable number, higher = better for every type (time is negated).
  // Capped "for time" results rank below every finished time.
  function scoreValue(e) {
    const type = inferScoreType(e);
    if (type === 'time') {
      const secs = entrySeconds(e);
      if (!secs) return null;
      if (e.capped) return -1e9 + (Number(e.scoreReps) || 0);
      return -secs;
    }
    if (type === 'amrap') {
      const r = Number(e.rounds) || 0;
      const reps = Number(e.scoreReps) || 0;
      return r || reps ? r * 1000 + reps : null;
    }
    if (type === 'load') {
      const v = Number(e.scoreLoad);
      return v > 0 ? v : null;
    }
    if (type === 'reps') {
      const v = Number(e.scoreReps);
      return v > 0 ? v : null;
    }
    return null;
  }

  function formatScore(e, unit) {
    const type = inferScoreType(e);
    const u = unit || 'kg';
    if (type === 'time') {
      const secs = entrySeconds(e);
      if (!secs) return '—';
      return e.capped ? `Capped${Number(e.scoreReps) ? ' +' + e.scoreReps : ''}` : fmtTime(secs);
    }
    if (type === 'amrap') {
      const r = Number(e.rounds) || 0;
      const reps = Number(e.scoreReps) || 0;
      if (!r && !reps) return '—';
      return reps ? `${r} + ${reps}` : `${r} rds`;
    }
    if (type === 'load') return Number(e.scoreLoad) > 0 ? `${Number(e.scoreLoad)} ${u}` : '—';
    if (type === 'reps') return Number(e.scoreReps) > 0 ? `${Number(e.scoreReps)} reps` : '—';
    const secs = entrySeconds(e);
    if (secs) return fmtTime(secs);
    if (Number(e.durationMin) > 0) return `${Number(e.durationMin)} min`;
    return '—';
  }

  // Best previous attempt (same workout key, same Rx/scaled bucket),
  // excluding `entry` itself (matched by id or object identity).
  function previousBest(log, entry) {
    const key = workoutKey(entry);
    if (!key) return null;
    const rx = entry.rx !== false;
    let best = null;
    (log || []).forEach(e => {
      if (!e || e === entry || (entry.id && e.id === entry.id)) return;
      if (workoutKey(e) !== key || (e.rx !== false) !== rx) return;
      const v = scoreValue(e);
      if (v == null) return;
      if (!best || v > best.v) best = { v, entry: e };
    });
    return best ? best.entry : null;
  }

  function isPR(log, entry) {
    const v = scoreValue(entry);
    if (v == null) return false;
    const prev = previousBest(log, entry);
    return !!prev && v > scoreValue(prev);
  }

  /**
   * Groups the log by workout. Returns
   *   [{ key, name, type, benchmark, count, best, last, attempts[] }]
   * attempts are oldest-first.
   */
  function workoutBoard(log) {
    const map = new Map();
    (log || []).forEach(e => {
      if (!e || e.source === 'circuit') return;
      const key = workoutKey(e);
      if (!key) return;
      if (!map.has(key)) {
        const b = findBenchmark(key);
        map.set(key, { key, name: b ? b.name : (e.name || 'Workout'), type: b ? b.type : inferScoreType(e), benchmark: b, attempts: [] });
      }
      map.get(key).attempts.push(e);
    });
    return Array.from(map.values()).map(row => {
      row.attempts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      row.count = row.attempts.length;
      row.last = row.attempts[row.attempts.length - 1] || null;
      row.best = null;
      row.attempts.forEach(a => {
        const v = scoreValue(a);
        if (v != null && (!row.best || v > scoreValue(row.best))) row.best = a;
      });
      return row;
    });
  }

  /* ── Week stats ─────────────────────────────────────────────── */

  function toKey(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function mondayKey(dateKey) {
    const d = new Date(dateKey + 'T00:00:00');
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return toKey(d);
  }

  function addDaysKey(dateKey, n) {
    const d = new Date(dateKey + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return toKey(d);
  }

  function entryMinutes(e) {
    if (Number(e.durationMin) > 0) return Number(e.durationMin);
    const secs = entrySeconds(e);
    if (secs) return Math.round(secs / 60);
    if (Number(e.capMin) > 0) return Number(e.capMin);
    const b = findBenchmark(e.benchmark || e.name);
    return b && b.capMin ? b.capMin : 0;
  }

  /**
   * { sessions, minutes, prs30, streakWeeks, wods, hyrox, circuits }
   * sessions/minutes are for the week containing `today`; prs30 counts
   * PRs set in the last 30 days; streakWeeks counts consecutive weeks
   * (ending this week, or last week if this week is still empty) with
   * at least one session.
   */
  function weekStats(wodLog, hyroxLog, today) {
    const start = mondayKey(today);
    const end = addDaysKey(start, 6);
    const inWeek = d => d >= start && d <= end;
    const wods = (wodLog || []).filter(e => e && typeof e.date === 'string');
    const sims = (hyroxLog || []).filter(e => e && typeof e.date === 'string');

    const weekWods = wods.filter(e => inWeek(e.date));
    const weekSims = sims.filter(e => inWeek(e.date));
    const minutes = weekWods.reduce((s, e) => s + entryMinutes(e), 0) +
      weekSims.reduce((s, e) => s + Math.round((Number(e.total) || 0) / 60), 0);

    const since = addDaysKey(today, -30);
    const prs30 = wods.filter(e => e.date >= since && e.date <= today && isPR(wods, e)).length;

    const weeks = new Set([...wods, ...sims].map(e => mondayKey(e.date)));
    let streakWeeks = 0;
    let cursor = weeks.has(start) ? start : addDaysKey(start, -7);
    while (weeks.has(cursor)) { streakWeeks++; cursor = addDaysKey(cursor, -7); }

    return {
      sessions: weekWods.length + weekSims.length,
      minutes,
      prs30,
      streakWeeks,
      wods: weekWods.filter(e => e.source !== 'circuit').length,
      circuits: weekWods.filter(e => e.source === 'circuit').length,
      hyrox: weekSims.length,
    };
  }

  /* ── HYROX ──────────────────────────────────────────────────── */

  const HYROX_STATIONS = [
    { field: 'run1',      label: '1 km Run',          kind: 'run' },
    { field: 'skierg',    label: 'SkiErg',            kind: 'station', detail: '1000 m' },
    { field: 'run2',      label: '1 km Run',          kind: 'run' },
    { field: 'sledpush',  label: 'Sled Push',         kind: 'station', detail: '50 m' },
    { field: 'run3',      label: '1 km Run',          kind: 'run' },
    { field: 'sledpull',  label: 'Sled Pull',         kind: 'station', detail: '50 m' },
    { field: 'run4',      label: '1 km Run',          kind: 'run' },
    { field: 'burpees',   label: 'Burpee Broad Jump', kind: 'station', detail: '80 m' },
    { field: 'run5',      label: '1 km Run',          kind: 'run' },
    { field: 'row',       label: 'Rowing',            kind: 'station', detail: '1000 m' },
    { field: 'run6',      label: '1 km Run',          kind: 'run' },
    { field: 'farmers',   label: 'Farmers Carry',     kind: 'station', detail: '200 m' },
    { field: 'run7',      label: '1 km Run',          kind: 'run' },
    { field: 'lunges',    label: 'Sandbag Lunges',    kind: 'station', detail: '100 m' },
    { field: 'run8',      label: '1 km Run',          kind: 'run' },
    { field: 'wallballs', label: 'Wall Balls',        kind: 'station', detail: '100 reps' },
  ];

  // Standard loads per division. Check your event's rulebook — these
  // are the published standard weights at the time of writing.
  const HYROX_DIVISIONS = {
    open_m: { label: 'Open · Men',   sledpush: '152 kg', sledpull: '103 kg', farmers: '2 × 24 kg', lunges: '20 kg', wallballs: '6 kg · 3 m' },
    open_w: { label: 'Open · Women', sledpush: '102 kg', sledpull: '78 kg',  farmers: '2 × 16 kg', lunges: '10 kg', wallballs: '4 kg · 2.7 m' },
    pro_m:  { label: 'Pro · Men',    sledpush: '202 kg', sledpull: '153 kg', farmers: '2 × 32 kg', lunges: '30 kg', wallballs: '9 kg · 3 m' },
    pro_w:  { label: 'Pro · Women',  sledpush: '152 kg', sledpull: '103 kg', farmers: '2 × 24 kg', lunges: '20 kg', wallballs: '6 kg · 2.7 m' },
    doubles:{ label: 'Doubles',      sledpush: 'Division load', sledpull: 'Division load', farmers: 'Division load', lunges: 'Division load', wallballs: 'Division load' },
    relay:  { label: 'Relay',        sledpush: 'Division load', sledpull: 'Division load', farmers: 'Division load', lunges: 'Division load', wallballs: 'Division load' },
  };

  // Reference split shape (seconds) used to spread a goal time when the
  // athlete has no full simulation of their own yet.
  const HYROX_REFERENCE = {
    run1: 300, run2: 305, run3: 310, run4: 315, run5: 315, run6: 320, run7: 325, run8: 330,
    skierg: 270, sledpush: 200, sledpull: 270, burpees: 300, row: 285, farmers: 120, lunges: 300, wallballs: 360,
    roxzone: 480,
  };

  function simTotal(stations) {
    return Object.values(stations || {}).reduce((s, v) => s + (Number(v) > 0 ? Number(v) : 0), 0);
  }

  function isFullSim(sim) {
    const st = (sim && sim.stations) || {};
    return HYROX_STATIONS.every(s => Number(st[s.field]) > 0);
  }

  // Best (lowest) split per field across all sims, plus best full total.
  function hyroxBests(log) {
    const bests = {};
    let bestTotal = null;
    (log || []).forEach(sim => {
      const st = (sim && sim.stations) || {};
      Object.keys(st).forEach(f => {
        const v = Number(st[f]);
        if (v > 0 && (bests[f] == null || v < bests[f])) bests[f] = v;
      });
      if (isFullSim(sim)) {
        const t = Number(sim.total) || simTotal(st);
        if (t > 0 && (!bestTotal || t < bestTotal.total)) bestTotal = { total: t, sim };
      }
    });
    return { splits: bests, bestTotal };
  }

  /**
   * Spreads goalSec across the 16 segments (plus Roxzone) using the
   * shape of the athlete's best full simulation, or HYROX_REFERENCE.
   * Returns { splits: {field: sec}, avgRun, source: 'yours'|'reference' }.
   */
  function pacePlan(goalSec, log) {
    const goal = Number(goalSec) || 0;
    if (goal <= 0) return null;
    const { bestTotal } = hyroxBests(log);
    const shape = { ...HYROX_REFERENCE };
    let source = 'reference';
    if (bestTotal) {
      HYROX_STATIONS.forEach(s => { shape[s.field] = Number(bestTotal.sim.stations[s.field]); });
      const rox = Number(bestTotal.sim.stations.roxzone);
      shape.roxzone = rox > 0 ? rox : Math.round(bestTotal.total * 0.09);
      source = 'yours';
    }
    const fields = [...HYROX_STATIONS.map(s => s.field), 'roxzone'];
    const sum = fields.reduce((s, f) => s + shape[f], 0);
    const splits = {};
    let assigned = 0;
    fields.forEach((f, i) => {
      const v = i === fields.length - 1 ? goal - assigned : Math.round(goal * shape[f] / sum);
      splits[f] = v;
      assigned += v;
    });
    const runs = HYROX_STATIONS.filter(s => s.kind === 'run').map(s => splits[s.field]);
    return { splits, avgRun: Math.round(runs.reduce((a, b) => a + b, 0) / runs.length), source };
  }

  function daysUntil(dateKey, today) {
    if (!dateKey || !today) return null;
    const a = new Date(today + 'T00:00:00');
    const b = new Date(dateKey + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  // Training phase for the race countdown, like Meet Prep's timeline.
  function racePhase(days) {
    if (days == null) return null;
    if (days < 0) return { key: 'done', label: 'Race done', tip: 'Log your race result as a simulation to set your new baseline.' };
    if (days <= 7) return { key: 'taper', label: 'Race week', tip: 'Short, sharp sessions. Rehearse transitions, sleep, and carb up the last 2 days.' };
    if (days <= 21) return { key: 'peak', label: 'Peak', tip: 'One full or 3/4 simulation at goal pace, then back off volume by ~30%.' };
    if (days <= 56) return { key: 'specific', label: 'Race-specific', tip: 'Compromised running: pair every station with a 1 km run at goal pace.' };
    return { key: 'base', label: 'Base', tip: 'Build your engine (Zone 2 + intervals) and station strength. Test one half-sim a month.' };
  }

  /* ── Timer engine (wall-clock driven) ───────────────────────── */

  /**
   * Pure timer state from elapsed seconds, so the UI can compute it from
   * Date.now() and never drift when the phone sleeps.
   * cfg: { duration (sec), rounds, work, rest, cap (sec, fortime) }
   * Returns { clock (sec to show), phase, round, done, beep }
   *   beep: 'start' | 'end' | 'tick' | null for this second.
   */
  function timerState(format, cfg, elapsed) {
    const t = Math.max(0, Math.floor(elapsed));
    const c = cfg || {};
    if (format === 'amrap') {
      const dur = Math.max(1, c.duration || 0);
      const left = Math.max(0, dur - t);
      return { clock: left, phase: left ? 'AMRAP' : 'Time!', round: 0, done: left === 0,
        beep: left === 0 ? 'end' : (left <= 3 ? 'tick' : null) };
    }
    if (format === 'fortime') {
      const cap = c.cap || 0;
      if (cap && t >= cap) return { clock: cap, phase: 'Time cap', round: 0, done: true, beep: 'end' };
      return { clock: t, phase: cap ? `Cap ${fmtTime(cap)}` : 'For Time', round: 0, done: false,
        beep: cap && cap - t <= 3 ? 'tick' : null };
    }
    if (format === 'emom') {
      const rounds = Math.max(1, c.rounds || 1);
      const interval = Math.max(10, c.interval || 60);
      const idx = Math.floor(t / interval);
      if (idx >= rounds) return { clock: 0, phase: 'Done', round: rounds, done: true, beep: 'end' };
      const left = interval - (t % interval);
      return { clock: left, phase: `Round ${idx + 1} / ${rounds}`, round: idx + 1, done: false,
        beep: t > 0 && t % interval === 0 ? 'start' : (left <= 3 ? 'tick' : null) };
    }
    if (format === 'tabata') {
      const rounds = Math.max(1, c.rounds || 8);
      const work = Math.max(1, c.work || 20);
      const rest = Math.max(0, c.rest || 10);
      const cycle = work + rest;
      const idx = Math.floor(t / cycle);
      if (idx >= rounds) return { clock: 0, phase: 'Done', round: rounds, done: true, beep: 'end' };
      const into = t % cycle;
      const working = into < work;
      const left = working ? work - into : cycle - into;
      return { clock: left, phase: `${working ? 'Work' : 'Rest'} · ${idx + 1} / ${rounds}`, round: idx + 1, done: false,
        beep: into === 0 && t > 0 ? 'start' : (into === work ? 'end' : (left <= 3 ? 'tick' : null)) };
    }
    return { clock: t, phase: '', round: 0, done: false, beep: null };
  }

  // Circuit timeline: [{phase:'work'|'rest', exercise, round, index, sec}]
  function circuitSteps(circuit) {
    const steps = [];
    const ex = (circuit && circuit.exercises || []).filter(Boolean);
    const rounds = Math.max(1, Number(circuit && circuit.rounds) || 1);
    const work = Math.max(1, Number(circuit && circuit.work) || 40);
    const rest = Math.max(0, Number(circuit && circuit.rest) || 0);
    for (let r = 1; r <= rounds; r++) {
      ex.forEach((name, i) => {
        steps.push({ phase: 'work', exercise: name, round: r, index: i, sec: work });
        const last = r === rounds && i === ex.length - 1;
        if (rest && !last) steps.push({ phase: 'rest', exercise: ex[(i + 1) % ex.length], round: r, index: i, sec: rest });
      });
    }
    return steps;
  }

  function circuitTotalSeconds(circuit) {
    return circuitSteps(circuit).reduce((s, st) => s + st.sec, 0);
  }

  // Locate the step for `elapsed` seconds. Returns { step, left, i, done }.
  function circuitAt(steps, elapsed) {
    let t = Math.max(0, Math.floor(elapsed));
    for (let i = 0; i < steps.length; i++) {
      if (t < steps[i].sec) return { step: steps[i], left: steps[i].sec - t, i, done: false };
      t -= steps[i].sec;
    }
    return { step: steps[steps.length - 1] || null, left: 0, i: steps.length, done: true };
  }

  /* ── Misc ───────────────────────────────────────────────────── */

  function newId(prefix) {
    return (prefix || 'f') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Legacy templates lived in one unscoped `crossfitTemplates` key as
  // { name, workout: [{exercise, sets, reps, weight, notes}] }.
  function migrateTemplates(legacy, existing) {
    const out = Array.isArray(existing) ? existing.slice() : [];
    const names = new Set(out.map(t => norm(t.name)));
    (Array.isArray(legacy) ? legacy : []).forEach(t => {
      if (!t || !t.name || names.has(norm(t.name))) return;
      names.add(norm(t.name));
      out.push({
        id: newId('t'),
        name: String(t.name),
        format: 'other',
        exercises: (t.workout || t.exercises || []).map(x => ({
          exerciseName: x.exerciseName || x.exercise || x.name || '',
          sets: Number(x.sets) || 0,
          reps: Number(x.reps) || 0,
          weight: Number(x.weight) || 0,
        })).filter(x => x.exerciseName),
      });
    });
    return out;
  }

  return {
    BENCHMARKS, BENCHMARK_GROUPS, MOVEMENTS, FORMATS,
    HYROX_STATIONS, HYROX_DIVISIONS, HYROX_REFERENCE,
    norm, findBenchmark, workoutKey,
    parseTime, fmtTime, fmtDelta, entrySeconds, entryMinutes,
    inferScoreType, scoreValue, formatScore, previousBest, isPR, workoutBoard,
    weekStats, mondayKey, addDaysKey,
    simTotal, isFullSim, hyroxBests, pacePlan, daysUntil, racePhase,
    timerState, circuitSteps, circuitTotalSeconds, circuitAt,
    newId, migrateTemplates,
  };
});
