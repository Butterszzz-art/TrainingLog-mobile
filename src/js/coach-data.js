/* =============================================================
   AI COACH — on-device data
   buildCoachDataPack() gathers what the coach may read from
   localStorage into one compact object that is sent with each chat
   message (the server's tools query it; see src/coach/tools.js).
   Sections the athlete switched off in coach settings are left out
   entirely, not just hidden.

   Also owns the coach's per-user memory and settings, and applies
   the proposal cards the athlete accepts (program / macro changes).
   Pure functions take a Storage-like object so jest can test them.
   ============================================================= */

(function (root) {
  'use strict';

  const WORKOUT_DAYS = 56;     // localStorage only keeps ~4 weeks anyway
  const BODYWEIGHT_DAYS = 120;
  const SLEEP_DAYS = 45;
  const MAX_MEMORY = 40;

  const ACCESS_KEYS = ['workouts', 'body', 'recovery', 'nutrition'];
  const DEFAULT_SETTINGS = {
    access: { workouts: true, body: true, recovery: true, nutrition: true },
    style: 'direct',
  };

  // ── storage helpers ──────────────────────────────────────────────

  function readJSON(store, key, fallback) {
    try {
      const raw = store.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function writeJSON(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); } catch { /* quota — ignore */ }
  }

  const arr = v => (Array.isArray(v) ? v : []);
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const day = d => (typeof d === 'string' ? d.slice(0, 10) : '');

  function isoDay(date) {
    const d = date instanceof Date ? date : new Date(date);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function withinDays(dateStr, now, days) {
    const t = Date.parse(dateStr);
    return Number.isFinite(t) && now - t <= days * 86400000 && t <= now + 86400000;
  }

  // ── settings & memory ────────────────────────────────────────────

  function loadCoachSettings(store, username) {
    const saved = readJSON(store, `coachSettings_${username}`, {});
    const access = { ...DEFAULT_SETTINGS.access };
    ACCESS_KEYS.forEach(k => {
      if (saved.access && typeof saved.access[k] === 'boolean') access[k] = saved.access[k];
    });
    const style = ['direct', 'balanced', 'hype'].includes(saved.style) ? saved.style : DEFAULT_SETTINGS.style;
    return { access, style };
  }

  function saveCoachSettings(store, username, settings) {
    writeJSON(store, `coachSettings_${username}`, settings);
  }

  function loadMemory(store, username) {
    return arr(readJSON(store, `coachMemory_${username}`, []))
      .filter(m => m && typeof m.text === 'string' && m.text.trim());
  }

  function addMemory(store, username, text, source, now) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) return loadMemory(store, username);
    const list = loadMemory(store, username);
    if (list.some(m => m.text.toLowerCase() === clean.toLowerCase())) return list;
    const stamp = now instanceof Date ? now : new Date();
    list.push({
      id: `m${stamp.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: clean,
      source: source === 'you' ? 'you' : 'chat',
      date: isoDay(stamp),
    });
    const trimmed = list.slice(-MAX_MEMORY);
    writeJSON(store, `coachMemory_${username}`, trimmed);
    return trimmed;
  }

  function removeMemory(store, username, id) {
    const list = loadMemory(store, username).filter(m => m.id !== id);
    writeJSON(store, `coachMemory_${username}`, list);
    return list;
  }

  // ── data pack ────────────────────────────────────────────────────

  function allWorkouts(store, username) {
    const seen = new Set();
    const out = [];
    [readJSON(store, `workoutHistory_${username}`, []), readJSON(store, `workouts_${username}`, [])]
      .forEach(list => arr(list).forEach(w => {
        if (!w) return;
        const key = w.id || `${w.date || ''}|${w.title || w.name || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(w);
      }));
    return out;
  }

  function packWorkouts(store, username, now) {
    return allWorkouts(store, username)
      .filter(w => withinDays(w.date, now, WORKOUT_DAYS))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      .map(w => ({
        date: day(w.date),
        title: w.title || w.name || w.templateName || 'Workout',
        exercises: arr(w.log)
          .filter(e => e && e.exercise)
          .map(e => {
            const reps = arr(e.repsArray);
            const weights = arr(e.weightsArray);
            const rpes = arr(e.rpeArray);
            return {
              name: String(e.exercise),
              sets: reps.map((r, i) => {
                const s = { w: num(weights[i]) || 0, r: num(r) || 0 };
                if (num(rpes[i])) s.rpe = num(rpes[i]);
                return s;
              }),
            };
          }),
      }));
  }

  function resolveProgram(store, username) {
    const active = readJSON(store, `activeProgram_${username}`, null) || readJSON(store, 'activeProgram', null);
    if (!active) return null;
    const programs = arr(readJSON(store, `programs_${username}`, null) || readJSON(store, 'programs', []));
    const id = active.programId || active.id;
    const program = programs.find(p => p && (p.id === id || p.programId === id)) || (Array.isArray(active.days) ? active : null);
    if (!program || !Array.isArray(program.days)) return null;
    return {
      id: program.id || program.programId || null,
      name: program.name || program.title || active.programName || 'Current program',
      startDate: active.startDate || program.startDate || null,
      days: program.days.map(d => ({
        name: d.name,
        exercises: arr(d.exercises).map(ex => ({
          name: ex.name,
          sets: arr(ex.sets).map(s => {
            const o = { reps: num(s.reps) };
            if (num(s.repsMax)) o.repsMax = num(s.repsMax);
            if (num(s.weight)) o.weight = num(s.weight);
            if (num(s.rpe)) o.rpe = num(s.rpe);
            return o;
          }),
          ...(ex.notes ? { notes: String(ex.notes).slice(0, 160) } : {}),
        })),
      })),
    };
  }

  /**
   * Everything the coach may read, for `username`, as of `now`.
   * Sections switched off in `access` are omitted (the server treats a
   * missing section as "not available").
   */
  function buildCoachDataPack(store, username, access, nowInput) {
    const now = nowInput instanceof Date ? nowInput.getTime() : (Number(nowInput) || Date.now());
    const a = { ...DEFAULT_SETTINGS.access, ...(access || {}) };
    const settings = readJSON(store, `settings_${username}`, {});
    const profile = settings.profile || {};

    const pack = {
      generatedAt: new Date(now).toISOString(),
      profile: {
        name: profile.athleteName || username,
        archetype: profile.archetype || null,
        phase: profile.currentPhase || profile.mode || null,
        goal: typeof profile.goals === 'string' ? profile.goals : (profile.goals ? JSON.stringify(profile.goals).slice(0, 200) : null),
        unit: settings.unit || 'kg',
      },
    };

    if (a.workouts) {
      pack.workouts = packWorkouts(store, username, now);
      pack.cardio = arr(readJSON(store, `cardioLog_${username}`, []))
        .filter(c => c && withinDays(c.date, now, WORKOUT_DAYS))
        .map(c => ({ date: day(c.date), type: c.type || 'cardio', durationMin: num(c.duration), distanceKm: num(c.distance) }));
      const program = resolveProgram(store, username);
      if (program) pack.program = program;
    }

    if (a.body) {
      pack.bodyweight = arr(readJSON(store, `bodyweightLog_${username}`, []))
        .filter(e => e && withinDays(e.date, now, BODYWEIGHT_DAYS))
        .map(e => ({ date: day(e.date), kg: num(e.weightKg) ?? num(e.weight) }))
        .filter(e => e.kg);
      pack.checkIns = arr(readJSON(store, `checkIns_${username}`, []))
        .filter(c => c && c.date)
        .sort((x, y) => (x.date < y.date ? -1 : 1))
        .slice(-12)
        .map(c => ({
          date: day(c.date),
          bodyweight: num(c.bodyweight),
          sleep: num(c.sleep), energy: num(c.energy), stress: num(c.stress),
          hunger: num(c.hunger), digestion: num(c.digestion), trainingPerformance: num(c.trainingPerformance),
          notes: typeof c.notes === 'string' ? c.notes.slice(0, 300) : '',
        }));
    }

    if (a.recovery) {
      pack.sleep = arr(readJSON(store, `sleepLog_${username}`, []))
        .filter(e => e && withinDays(e.date, now, SLEEP_DAYS))
        .map(e => ({ date: day(e.date), hours: num(e.duration), quality: num(e.quality), tags: arr(e.tags).slice(0, 6) }));
    }

    if (a.nutrition) {
      const t = readJSON(store, `macroTargets_${username}`, null);
      if (t && (num(t.calories) || num(t.protein))) {
        pack.macros = {
          targets: { calories: num(t.calories), protein: num(t.protein), carbs: num(t.carbs), fat: num(t.fat ?? t.fats) },
        };
      }
    }

    return pack;
  }

  // ── applying accepted proposals ──────────────────────────────────

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function toProgramSets(sets) {
    return arr(sets).map(s => {
      const out = { setType: 'straight', reps: num(s.reps), weight: num(s.weight), rpe: num(s.rpe), rir: null, restSec: 120 };
      if (num(s.repsMax)) out.repsMax = num(s.repsMax);
      return out;
    });
  }

  function applyToDay(dayObj, changes) {
    const exercises = arr(dayObj.exercises).slice();
    changes.forEach(c => {
      const i = exercises.findIndex(ex => norm(ex.name) === norm(c.exercise));
      if (c.op === 'add_exercise') {
        if (i !== -1) return;
        exercises.push({
          exerciseId: `ex-coach-${Date.now().toString(36)}-${exercises.length}`,
          name: c.exercise, notes: '', rirNote: '', rpeNote: '', progressionNotes: '', archetypeTags: [],
          sets: toProgramSets(c.sets),
        });
        return;
      }
      if (i === -1) return;
      const ex = { ...exercises[i] };
      if (c.op === 'remove_exercise') { exercises.splice(i, 1); return; }
      if (c.op === 'set_sets') {
        // Keep each set's rest time where there is one to keep.
        const next = toProgramSets(c.sets);
        next.forEach((s, j) => { if (ex.sets && ex.sets[j] && Number.isFinite(ex.sets[j].restSec)) s.restSec = ex.sets[j].restSec; });
        ex.sets = next;
      }
      if (c.op === 'replace_exercise') { ex.name = c.newExercise; ex.exerciseId = `ex-coach-${Date.now().toString(36)}-${i}`; }
      if (c.op === 'set_note') ex.notes = c.note || '';
      exercises[i] = ex;
    });
    return { ...dayObj, exercises };
  }

  /**
   * Apply a program_change card to the stored program. Returns
   * { ok: true } or { ok: false, reason }. Multi-week programs get the
   * change on every week that has its own copy of that day.
   */
  function applyProgramChange(store, username, card) {
    const key = `programs_${username}`;
    const programs = arr(readJSON(store, key, []));
    const active = readJSON(store, `activeProgram_${username}`, null) || {};
    const id = card.programId || active.programId;
    const idx = programs.findIndex(p => p && (p.id === id || p.programId === id));
    if (idx === -1) return { ok: false, reason: 'Could not find your current program.' };

    const program = { ...programs[idx] };
    const target = norm(card.day);
    let touched = false;
    const patchDays = days => arr(days).map(d => {
      if (norm(d.name) !== target) return d;
      touched = true;
      return applyToDay(d, arr(card.changes));
    });

    program.days = patchDays(program.days);
    if (Array.isArray(program.weeks)) {
      program.weeks = program.weeks.map(w => (w && Array.isArray(w.days) ? { ...w, days: patchDays(w.days) } : w));
    }
    if (!touched) return { ok: false, reason: `"${card.day}" is no longer in your program.` };

    program.updatedAt = new Date().toISOString();
    programs[idx] = program;
    writeJSON(store, key, programs);
    return { ok: true };
  }

  function applyMacroTargets(store, username, card) {
    const t = card && card.to;
    if (!t || !num(t.calories)) return { ok: false, reason: 'Those targets are incomplete.' };
    const targets = { calories: num(t.calories), protein: num(t.protein), carbs: num(t.carbs), fat: num(t.fat) };
    writeJSON(store, `macroTargets_${username}`, targets);
    writeJSON(store, `macroTargetsAdjustedDate_${username}`, isoDay(new Date()));
    return { ok: true };
  }

  // "3×5 @ 110 kg" style summary of a set list, merging identical sets.
  function describeSets(sets, unit) {
    const groups = [];
    arr(sets).forEach(s => {
      const reps = s.repsMax && s.repsMax !== s.reps ? `${s.reps}-${s.repsMax}` : `${s.reps ?? '?'}`;
      const load = num(s.weight) ? ` @ ${num(s.weight)} ${unit || 'kg'}` : '';
      const rpe = num(s.rpe) ? ` RPE ${num(s.rpe)}` : '';
      const label = `${reps}${load}${rpe}`;
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.count += 1;
      else groups.push({ label, count: 1 });
    });
    return groups.map(g => `${g.count}×${g.label}`).join(' + ');
  }

  // ── today's brief ────────────────────────────────────────────────
  // A rules-only read of the data pack: readiness, the few facts worth
  // mentioning this morning, and one thing that needs attention. The
  // Home card shows this as-is offline; the server hands the same digest
  // to Claude to word the brief, so the AI can't cite numbers not in it.

  const DAY = 86400000;
  const r1 = n => Math.round(n * 10) / 10;
  const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  function phaseDirection(phase) {
    const p = String(phase || '').toLowerCase();
    if (/cut|shred|diet|prep|lose|loss/.test(p)) return { dir: -1, word: 'cut' };
    if (/bulk|gain|build|improvement|off.?season/.test(p)) return { dir: 1, word: 'bulk' };
    if (/maint/.test(p)) return { dir: 0, word: 'maintenance phase' };
    return null;
  }

  function bestE1rm(sets) {
    let best = null;
    let top = 0;
    arr(sets).forEach(s => {
      const w = num(s.w) || 0;
      const r = num(s.r) || 0;
      if (w > top) top = w;
      if (w > 0 && r > 0 && r <= 12) {
        const e = r === 1 ? w : w * (1 + r / 30);
        if (best === null || e > best) best = e;
      }
    });
    return { e1rm: best, top };
  }

  // Exercises whose best estimated 1RM hasn't moved (within 1%) for 2+ weeks
  // across 3+ sessions — returns the most-trained one, or null.
  function findStall(workouts, now) {
    const byName = {};
    arr(workouts).forEach(w => {
      const t = Date.parse(w.date);
      if (!Number.isFinite(t) || now - t > 56 * DAY) return;
      arr(w.exercises).forEach(ex => {
        const { e1rm, top } = bestE1rm(ex.sets);
        if (!e1rm) return;
        const key = norm(ex.name);
        (byName[key] = byName[key] || { name: ex.name, sessions: [] }).sessions.push({ t, e1rm, top });
      });
    });
    let found = null;
    Object.values(byName).forEach(({ name, sessions }) => {
      sessions.sort((a, b) => a.t - b.t);
      if (sessions.length < 3) return;
      const latest = sessions[sessions.length - 1];
      if (now - latest.t > 14 * DAY) return; // not trained lately — not a live stall
      const peak = Math.max(...sessions.map(s => s.e1rm));
      if (latest.e1rm < peak * 0.99 && sessions.length > 3) return; // dropping, not flat — different problem
      let i = sessions.length - 1;
      while (i > 0 && sessions[i - 1].e1rm >= latest.e1rm * 0.99 && sessions[i - 1].e1rm <= latest.e1rm * 1.01) i--;
      const flat = sessions.slice(i);
      const weeks = Math.floor((latest.t - flat[0].t) / (7 * DAY));
      if (flat.length < 3 || weeks < 2) return;
      if (!found || flat.length > found.sessions) {
        found = { exercise: name, weeks, sessions: flat.length, topWeight: latest.top, e1rm: r1(latest.e1rm) };
      }
    });
    return found;
  }

  /**
   * @param pack   buildCoachDataPack() output
   * @param today  { session: "Push B" | null, restDay: bool }
   */
  function buildBriefDigest(pack, today) {
    const p = pack || {};
    const t = today || {};
    const now = Date.parse(p.generatedAt) || Date.now();
    const unit = (p.profile && p.profile.unit) || 'kg';
    const signals = []; // { key, text, tone: good|watch|info, weight }
    let score = 70;
    let inputs = 0;

    // Sleep: last night against the two weeks before it.
    const nights = arr(p.sleep).filter(n => num(n.hours)).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const last = nights[nights.length - 1];
    // "Last night" by calendar date (logged under today or yesterday), not a
    // rolling window — date-only strings parse as UTC midnight, so hour maths
    // drops yesterday's entry by evening in timezones behind UTC.
    const lastNight = last && (last.date === isoDay(new Date(now)) || last.date === isoDay(new Date(now - DAY)));
    if (lastNight) {
      inputs++;
      const prior = nights.slice(0, -1).filter(n => now - Date.parse(n.date) <= 15 * DAY).map(n => n.hours);
      const avg = prior.length >= 3 ? mean(prior) : null;
      const diff = avg === null ? 0 : last.hours - avg;
      if (last.hours < 6) score -= 12;
      else if (diff < -0.75) score -= 8;
      else if (last.hours >= 7.5) score += 6;
      const short = last.hours < 6.5 || diff < -0.75;
      signals.push({
        key: 'sleep',
        text: `Sleep ${r1(last.hours)} h` + (avg !== null ? `, ${diff < 0 ? 'under' : 'over'} your ${r1(avg)} h average` : ''),
        tone: short ? 'watch' : 'good',
        weight: short ? 3 : 1,
      });
    }

    // Latest check-in within a week.
    const checkIn = arr(p.checkIns).filter(c => now - Date.parse(c.date) <= 8 * DAY).slice(-1)[0];
    if (checkIn && (num(checkIn.energy) || num(checkIn.stress))) {
      inputs++;
      const energy = num(checkIn.energy);
      const stress = num(checkIn.stress);
      if (energy) score += (energy - 6) * 3;
      if (stress && stress > 6) score -= (stress - 6) * 3;
      if (energy !== null && energy <= 4) signals.push({ key: 'energy', text: `Energy ${energy}/10 on your last check-in`, tone: 'watch', weight: 2 });
      if (stress !== null && stress >= 7) signals.push({ key: 'stress', text: `Stress ${stress}/10 on your last check-in`, tone: 'watch', weight: 2 });
    }

    // Training load: last 7 days against the four weeks before.
    const sessions = arr(p.workouts).map(w => Date.parse(w.date)).filter(Number.isFinite);
    if (sessions.length) {
      inputs++;
      const last7 = sessions.filter(x => now - x < 7 * DAY).length;
      const before = sessions.filter(x => now - x >= 7 * DAY && now - x < 35 * DAY).length / 4;
      const daysSince = Math.floor((now - Math.max(...sessions)) / DAY);
      if (before > 0 && last7 > before + 1.5) {
        score -= 6;
        signals.push({ key: 'load', text: `${last7} sessions in 7 days, above your usual ${r1(before)}`, tone: 'watch', weight: 2 });
      } else if (daysSince >= 5) {
        signals.push({ key: 'gap', text: `Last session ${daysSince} days ago`, tone: 'watch', weight: 1 });
      } else if (last7 > 0) {
        signals.push({ key: 'load', text: `${last7} session${last7 === 1 ? '' : 's'} in the last 7 days`, tone: 'good', weight: 0 });
      }
      if (daysSince >= 2 && daysSince < 5) score += 4;
    }

    // Bodyweight trend against the phase goal.
    const bw = arr(p.bodyweight).filter(e => num(e.kg)).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      .filter(e => now - Date.parse(e.date) <= 28 * DAY);
    if (bw.length >= 4 && Date.parse(bw[bw.length - 1].date) - Date.parse(bw[0].date) >= 10 * DAY) {
      const half = Math.floor(bw.length / 2);
      const a = mean(bw.slice(0, half).map(e => e.kg));
      const b = mean(bw.slice(half).map(e => e.kg));
      const span = (mean(bw.slice(half).map(e => Date.parse(e.date))) - mean(bw.slice(0, half).map(e => Date.parse(e.date)))) / (7 * DAY);
      const rate = span > 0 ? Math.round(((b - a) / span) * 100) / 100 : 0;
      const phase = phaseDirection(p.profile && p.profile.phase);
      let tone = 'info';
      let tail = '';
      if (phase && phase.dir !== 0) {
        const onTrack = Math.sign(rate) === phase.dir && Math.abs(rate) >= 0.1;
        tone = onTrack ? 'good' : 'watch';
        tail = onTrack ? `, on track for your ${phase.word}` : `, not moving the way a ${phase.word} should`;
      } else if (phase && phase.dir === 0) {
        tone = Math.abs(rate) <= 0.25 ? 'good' : 'watch';
        tail = tone === 'good' ? ', steady for maintenance' : '';
      }
      signals.push({ key: 'weight', text: `Weight trend ${rate > 0 ? '+' : ''}${rate} kg/wk${tail}`, tone, weight: tone === 'watch' ? 2 : 1 });
    }

    const stall = findStall(p.workouts, now);
    const flag = stall ? {
      text: `${stall.exercise} stuck at ${stall.topWeight} ${unit} for ${stall.weeks} weeks`,
      question: `Why has my ${stall.exercise.toLowerCase()} stalled?`,
      stall,
    } : null;

    score = Math.max(20, Math.min(95, Math.round(score)));
    const readiness = inputs ? {
      score,
      label: score >= 75 ? 'Ready to push' : score >= 55 ? 'Train as planned' : 'Take it easier',
      short: score >= 75 ? 'Ready' : score >= 55 ? 'Steady' : 'Easy',
    } : null;

    const session = t.session || null;
    let headline;
    if (session) {
      headline = !readiness ? `${session} is on the plan today.`
        : readiness.score >= 75 ? `${readiness.label}. ${session} is on the plan.`
        : readiness.score >= 55 ? `${session} is on the plan. Train it as written.`
        : `${session} is on the plan, but keep the top sets a notch lighter today.`;
    } else if (t.restDay) {
      headline = readiness && readiness.score < 55 ? 'Rest day. Recovery is the priority today.' : 'Rest day. A walk and some mobility will help.';
    } else {
      headline = readiness ? `${readiness.label} today.` : 'Log a session or a check-in and your coach will brief you here each morning.';
    }

    const bullets = signals.slice()
      .sort((x, y) => (y.tone === 'watch') - (x.tone === 'watch') || y.weight - x.weight)
      .slice(0, 3)
      .map(s => ({ text: s.text, tone: s.tone }));

    return {
      date: isoDay(new Date(now)),
      session,
      restDay: Boolean(t.restDay),
      readiness,
      headline,
      bullets,
      flag,
      signals: signals.map(s => ({ text: s.text, tone: s.tone })),
      hasData: inputs > 0 || Boolean(flag),
    };
  }

  const api = {
    ACCESS_KEYS,
    buildBriefDigest,
    buildCoachDataPack,
    loadCoachSettings,
    saveCoachSettings,
    loadMemory,
    addMemory,
    removeMemory,
    applyProgramChange,
    applyMacroTargets,
    describeSets,
    resolveProgram,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CoachData = api;
})(typeof window !== 'undefined' ? window : null);
