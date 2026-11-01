/* What a published coach plan (pocketcoach.plan/2) means for a given day.
 *
 *  resolve(plan, isoDate)  → { phase, planWeek, phaseWeek, program, programWeek,
 *                              repeatsLastWeek, day, dayType, targets }
 *      The phase whose dates hold the day; the linked program's week
 *      (weekOffset + phase week, and past the program's last week that last
 *      week repeats); the program day on that weekday (or null = rest day);
 *      and the phase's training-day or rest-day nutrition.
 *
 *  macroPhases(plan)       → [{ from, to, days: { training, rest }, schedule }]
 *      One date range per phase for the Macros tab's coach store
 *      (coachNutritionAssignments_v1). The weekly pattern comes from the
 *      phase's program (its training weekdays are training days).
 *
 *  composeProgram(plan)    → a Library-shape program covering every plan week,
 *      each week taken from its phase's program, started on plan.startDate.
 *      Following it in the Program tab gives the right session on the right
 *      date through every phase without tapping Start again.
 *
 *  exerciseTarget(ex)      → "2 × 6–10 · RIR 3 (last set 2) · rest 2–3 min"
 *
 * Pure: no storage, no DOM. */
(function (globalScope) {
  'use strict';

  const DAY_MS = 86400000;
  const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const WEEKDAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const PHASE_LABELS = { cut: 'Cut', maintain: 'Maintain', build: 'Build', deload: 'Deload' };

  function preview() {
    if (globalScope.PlanPreview) return globalScope.PlanPreview;
    if (typeof require === 'function') { try { return require('./plan-preview'); } catch (_e) { /* browser */ } }
    return null;
  }

  function upgrade(plan) {
    const pp = preview();
    return pp && pp.upgrade ? pp.upgrade(plan) : plan;
  }

  function dayIndex(iso) { return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS); }
  function addDays(iso, n) { return new Date((dayIndex(iso) + n) * DAY_MS).toISOString().slice(0, 10); }
  /** ISO weekday 1 (Mon) … 7 (Sun). */
  function isoWeekday(iso) { const d = new Date(`${iso}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; }

  function phaseStart(p) { return p.actualStart || p.plannedStart; }
  function phaseEnd(p) { return p.actualEnd || p.plannedEnd; }

  /** The days of 1-based `week` of a Library-shape program (sameAs resolved; single-week programs repeat). */
  function weekDays(program, week) {
    const weeks = program && Array.isArray(program.weeks) ? program.weeks : [];
    if (!weeks.length) return (program && program.days) || [];
    let w = weeks[week - 1] || weeks[weeks.length - 1];
    if (w && w.sameAs) w = weeks.find(x => x.week === w.sameAs && Array.isArray(x.days)) || w;
    return (w && w.days) || [];
  }

  function weekCount(program) {
    return program && Array.isArray(program.weeks) && program.weeks.length ? program.weeks.length : 1;
  }

  /** Training weekdays (ISO 1–7) of a Library-shape program. */
  function trainingWeekdays(program) {
    if (!program) return [];
    const fromSchedule = program.schedule && Array.isArray(program.schedule.weekdays) ? program.schedule.weekdays : [];
    if (fromSchedule.length) return fromSchedule.slice().sort((a, b) => a - b);
    return (program.frequency || []).map(d => WEEKDAY_ABBR.indexOf(d) + 1).filter(n => n > 0).sort((a, b) => a - b);
  }

  function dayOnWeekday(program, week, weekday) {
    const days = weekDays(program, week);
    const explicit = days.find(d => d.weekday === weekday);
    if (explicit) return explicit;
    if (days.some(d => d.weekday)) return null;
    const i = trainingWeekdays(program).indexOf(weekday); // older programs: days in weekday order
    return i === -1 ? null : days[i] || null;
  }

  function targetsFrom(day) {
    if (!day || day.kcal == null) return null;
    return { kcal: day.kcal, protein: day.proteinG, carbs: day.carbG, fat: day.fatG };
  }

  function resolve(input, isoDate) {
    const plan = upgrade(input);
    if (!plan || !Array.isArray(plan.phases) || !plan.phases.length) return null;
    const phase = plan.phases.find(p => phaseStart(p) <= isoDate && isoDate <= phaseEnd(p)) || null;
    if (!phase) return { phase: null, before: isoDate < phaseStart(plan.phases[0]), after: isoDate > phaseEnd(plan.phases[plan.phases.length - 1]) };
    const phaseWeek = Math.floor((dayIndex(isoDate) - dayIndex(phaseStart(phase))) / 7) + 1;
    const planWeek = phase.startWeek + phaseWeek - 1;
    const ref = phase.training && phase.training.programRef;
    const program = ref && plan.programs ? plan.programs[ref.programId] || null : null;
    let programWeek = null;
    let repeatsLastWeek = false;
    let day = null;
    let dayType = null;
    if (program) {
      const wanted = (ref.weekOffset || 0) + phaseWeek;
      const count = weekCount(program);
      programWeek = Math.min(wanted, count);
      repeatsLastWeek = wanted > count;
      day = dayOnWeekday(program, programWeek, isoWeekday(isoDate));
      dayType = day ? 'training' : 'rest';
    }
    const nutrition = phase.nutrition || {};
    return {
      phase, planWeek, phaseWeek, totalWeeks: plan.phases.reduce((n, p) => n + p.weeks, 0),
      program, programRef: ref || null, programWeek, programWeeks: program ? weekCount(program) : null, repeatsLastWeek,
      day, dayType,
      targets: dayType ? targetsFrom(dayType === 'rest' ? nutrition.restDay : nutrition.trainingDay) : null,
      trainingDayTargets: targetsFrom(nutrition.trainingDay),
      restDayTargets: targetsFrom(nutrition.restDay),
    };
  }

  function grams(day) {
    if (!day || day.proteinG == null || day.carbG == null || day.fatG == null) return null;
    const out = { protein: Math.round(day.proteinG), carbs: Math.round(day.carbG), fat: Math.round(day.fatG) };
    if (day.kcal != null) out.calories = Math.round(day.kcal);
    return out;
  }

  function macroPhases(input) {
    const plan = upgrade(input);
    if (!plan || !Array.isArray(plan.phases)) return [];
    return plan.phases.map(p => {
      const ref = p.training && p.training.programRef;
      const program = ref && plan.programs ? plan.programs[ref.programId] : null;
      const weekdays = trainingWeekdays(program);
      const schedule = weekdays.length
        ? Object.fromEntries(WEEKDAY_KEYS.map((k, i) => [k, weekdays.includes(i + 1) ? 'training' : 'rest']))
        : null;
      return {
        from: phaseStart(p), to: phaseEnd(p), type: p.type, phaseId: p.phaseId,
        days: { training: grams(p.nutrition && p.nutrition.trainingDay), rest: grams(p.nutrition && p.nutrition.restDay) },
        schedule,
      };
    }).filter(r => r.days.training);
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function composeProgram(input) {
    const plan = upgrade(input);
    if (!plan || !Array.isArray(plan.phases) || !plan.programs) return null;
    const firstRef = plan.phases.map(p => p.training && p.training.programRef).find(r => r && plan.programs[r.programId]);
    if (!firstRef) return null;
    const base = plan.programs[firstRef.programId];
    const weeks = [];
    let lastDays = weekDays(base, 1);
    plan.phases.forEach(p => {
      const ref = p.training && p.training.programRef;
      const program = ref ? plan.programs[ref.programId] : null;
      for (let w = 1; w <= p.weeks; w++) {
        const days = program ? weekDays(program, Math.min((ref.weekOffset || 0) + w, weekCount(program))) : lastDays;
        lastDays = days;
        weeks.push({ week: weeks.length + 1, label: `Week ${weeks.length + 1}`, phase: PHASE_LABELS[p.type] || p.type, days: clone(days) });
      }
    });
    const names = Array.from(new Set(plan.phases.map(p => p.training && p.training.programRef && p.training.programRef.name).filter(Boolean)));
    return {
      id: `plan-${String(plan.planId || '').replace(/^pln_/, '').slice(0, 8)}-v${plan.version || 1}`,
      title: names.join(' + ') || base.title || 'Coach program',
      summary: base.summary || '',
      progressionNotes: base.progressionNotes || '',
      frequency: trainingWeekdays(base).map(n => WEEKDAY_ABBR[n - 1]),
      schedule: { startDate: plan.startDate, weekdays: trainingWeekdays(base) },
      split: base.split || { type: 'custom', name: base.title, daysPerWeek: weeks[0].days.length },
      progressionType: base.progressionType || 'double-progression',
      days: clone(weeks[0].days),
      weeks,
      durationWeeks: weeks.length,
      assignedBy: base.assignedBy || '',
      planId: plan.planId,
      planVersion: plan.version || 1,
    };
  }

  function fmtRest(a, b) {
    if (a == null) return '';
    const m = s => (s % 60 === 0 ? String(s / 60) : (s / 60).toFixed(1).replace(/\.0$/, ''));
    if (a < 60 && !b) return `${a} s`;
    return `${m(a)}${b ? `–${m(b)}` : ''} min`;
  }

  /** RIR of a Library exercise: "RIR 3" or "RIR 3 (last set 2)", '' when none. */
  function rirLabel(ex) {
    const sets = ex && Array.isArray(ex.sets) ? ex.sets : [];
    if (!sets.length || sets[0].rir == null) return '';
    const last = sets[sets.length - 1].rir;
    return `RIR ${sets[0].rir}${sets.length > 1 && last != null && last !== sets[0].rir ? ` (last set ${last})` : ''}`;
  }

  function exerciseTarget(ex) {
    const sets = ex && Array.isArray(ex.sets) ? ex.sets : [];
    if (!sets.length) return '';
    const f = sets[0];
    const reps = f.reps == null ? '?' : (f.repsMax > f.reps ? `${f.reps}–${f.repsMax}` : String(f.reps));
    const parts = [`${sets.length} × ${reps}`];
    const rir = rirLabel(ex);
    if (rir) parts.push(rir);
    const rest = fmtRest(f.restSec, f.restSecMax);
    if (rest && (f.restSecMax || f.restSec !== 120)) parts.push(`rest ${rest}`);
    return parts.join(' · ');
  }

  const api = { resolve, macroPhases, composeProgram, exerciseTarget, rirLabel, weekDays, trainingWeekdays, isoWeekday, addDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PlanToday = api;
})(typeof window !== 'undefined' ? window : globalThis);
