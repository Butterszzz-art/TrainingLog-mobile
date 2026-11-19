/*
 * Detailed weekly check-in: the extra answers a coach needs to judge the
 * program, beyond the 1-10 scores (checkinEngine.js).
 *
 *   training   — program week/day, per-muscle recovery, per-session workload,
 *                joint pain, performance, pumps, cardio/steps adherence
 *   nutrition  — 1-5 ratings (hunger, appetite, digestion, adherence),
 *                off-plan meals, water target
 *   lifestyle  — physical fatigue, training energy, mental struggles, sleep
 *                insights, caffeine, supplements, medications, PEDs, other
 *
 * Stored on the check-in as `detail` (checkinEngine normalizeCheckIn), sent
 * to linked coaches in the share snapshot (client-coaching.js), cleaned
 * again by the backend (traininglog-backend src/coachShare.js keeps the same
 * option lists) and shown in the coach console (coach/coach.js).
 *
 * Pure functions only; every field is optional.
 */
(function (root) {
  'use strict';

  const MUSCLES = [
    ['chest', 'Chest'], ['back', 'Back'], ['biceps', 'Biceps'], ['triceps', 'Triceps'],
    ['delts', 'Delts'], ['quads', 'Quads'], ['hams', 'Hams'], ['adductors', 'Adductors'],
    ['glutes', 'Glutes'], ['calves', 'Calves']
  ];
  // How sore each muscle got between sessions, least to most.
  const RECOVERY = [
    ['none', 'Never sore'], ['day', 'Sore a day'], ['justInTime', 'Healed just in time'], ['stillSore', 'Still sore']
  ];
  // How each training day's workload felt.
  const WORKLOAD = [
    ['easy', 'Too easy'], ['good', 'Good', 'Could do more if needed'],
    ['limit', 'Pushed limits', 'Perfect volume, dead at the end'],
    ['tooMuch', 'Too much', 'Couldn\'t finish / junk volume']
  ];
  // Nutrition ratings: 5 = easily manageable, 1 = unmanageable.
  const NUTRITION = [
    ['hunger', 'Hunger', 'Fat loss'], ['appetite', 'Appetite', 'Surplus'],
    ['digestion', 'Digestion'], ['adherence', 'Adherence to plan']
  ];
  const WATER = [['yes', 'Every day'], ['most', 'Most days'], ['no', 'Rarely']];
  const PEDS = [['yes', 'Yes, as planned'], ['missed', 'Missed or mistimed'], ['na', 'Not applicable']];
  const MAX_DAYS = 7;
  const TEXT = { short: 60, mid: 300, long: 1000 };

  const keys = list => list.map(x => x[0]);
  const labelOf = (list, key) => (list.find(x => x[0] === key) || [])[1] || '';

  function text(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }

  function int(value, min, max) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }

  function pick(value, allowed) {
    return typeof value === 'string' && allowed.includes(value) ? value : null;
  }

  function put(out, key, value) {
    if (value !== null && value !== '' && value !== undefined) out[key] = value;
  }

  // → the detail with only valid, non-empty answers; null when none.
  function cleanDetail(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const t = src.training && typeof src.training === 'object' ? src.training : {};
    const n = src.nutrition && typeof src.nutrition === 'object' ? src.nutrition : {};
    const l = src.lifestyle && typeof src.lifestyle === 'object' ? src.lifestyle : {};

    const training = {};
    put(training, 'programWeek', text(t.programWeek, TEXT.short));
    const recovery = {};
    const r = t.recovery && typeof t.recovery === 'object' ? t.recovery : {};
    keys(MUSCLES).forEach(m => put(recovery, m, pick(r[m], keys(RECOVERY))));
    if (Object.keys(recovery).length) training.recovery = recovery;
    const workload = (Array.isArray(t.workload) ? t.workload : [])
      .slice(0, MAX_DAYS)
      .map((d, i) => ({ day: text(d && d.day, 40) || `Day ${i + 1}`, rating: pick(d && d.rating, keys(WORKLOAD)) }))
      .filter(d => d.rating);
    if (workload.length) training.workload = workload;
    put(training, 'workloadNotes', text(t.workloadNotes, TEXT.long));
    put(training, 'jointPain', text(t.jointPain, TEXT.long));
    put(training, 'performance', text(t.performance, TEXT.long));
    put(training, 'pump', int(t.pump, 1, 5));
    put(training, 'pumpNotes', text(t.pumpNotes, TEXT.mid));
    put(training, 'cardioAdherence', int(t.cardioAdherence, 1, 5));
    put(training, 'cardioNotes', text(t.cardioNotes, TEXT.mid));

    const nutrition = {};
    const ratings = {};
    const nr = n.ratings && typeof n.ratings === 'object' ? n.ratings : {};
    keys(NUTRITION).forEach(k => put(ratings, k, int(nr[k], 1, 5)));
    if (Object.keys(ratings).length) nutrition.ratings = ratings;
    put(nutrition, 'offPlanMeals', text(n.offPlanMeals, TEXT.long));
    put(nutrition, 'water', pick(n.water, keys(WATER)));

    const lifestyle = {};
    put(lifestyle, 'physicalFatigue', int(l.physicalFatigue, 1, 10));
    put(lifestyle, 'trainingEnergy', int(l.trainingEnergy, 1, 10));
    put(lifestyle, 'markerNotes', text(l.markerNotes, TEXT.long));
    put(lifestyle, 'mentalStruggles', text(l.mentalStruggles, TEXT.long));
    put(lifestyle, 'sleepInsights', text(l.sleepInsights, TEXT.mid));
    put(lifestyle, 'caffeineMg', int(l.caffeineMg, 0, 2000));
    put(lifestyle, 'supplementAdherence', int(l.supplementAdherence, 1, 5));
    put(lifestyle, 'medications', text(l.medications, TEXT.mid));
    put(lifestyle, 'peds', pick(l.peds, keys(PEDS)));
    put(lifestyle, 'pedNotes', text(l.pedNotes, TEXT.mid));
    put(lifestyle, 'otherFeedback', text(l.otherFeedback, TEXT.long));

    const out = {};
    if (Object.keys(training).length) out.training = training;
    if (Object.keys(nutrition).length) out.nutrition = nutrition;
    if (Object.keys(lifestyle).length) out.lifestyle = lifestyle;
    return Object.keys(out).length ? out : null;
  }

  // Training days to ask about: one per planned session (from the active
  // program), else 6. Labels are "Day 1".."Day n".
  function workloadDays(perWeek) {
    const n = int(perWeek, 1, MAX_DAYS) || 6;
    return Array.from({ length: n }, (_, i) => `Day ${i + 1}`);
  }

  // "Week n" of a program that started on startDate (ISO), as of date.
  function programWeekLabel(startDate, date) {
    const s = Date.parse(String(startDate || '').slice(0, 10) + 'T00:00:00Z');
    const d = Date.parse(String(date || '').slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(s) || !Number.isFinite(d) || d < s) return '';
    return `Week ${Math.floor((d - s) / (7 * 864e5)) + 1}`;
  }

  // What a coach should look at first: [{ level: 'warn'|'info', text }].
  function detailFlags(detail) {
    const d = cleanDetail(detail);
    if (!d) return [];
    const flags = [];
    const t = d.training || {};
    const n = d.nutrition || {};
    const l = d.lifestyle || {};
    const sore = MUSCLES.filter(([k]) => t.recovery && t.recovery[k] === 'stillSore').map(m => m[1]);
    if (sore.length) flags.push({ level: 'warn', text: `Still sore next session: ${sore.join(', ')}` });
    const never = MUSCLES.filter(([k]) => t.recovery && t.recovery[k] === 'none').map(m => m[1]);
    if (never.length) flags.push({ level: 'info', text: `Never sore: ${never.join(', ')}` });
    const tooMuch = (t.workload || []).filter(x => x.rating === 'tooMuch').map(x => x.day);
    if (tooMuch.length) flags.push({ level: 'warn', text: `Too much volume: ${tooMuch.join(', ')}` });
    const easy = (t.workload || []).filter(x => x.rating === 'easy').map(x => x.day);
    if (easy.length) flags.push({ level: 'info', text: `Too easy: ${easy.join(', ')}` });
    if (t.jointPain) flags.push({ level: 'warn', text: 'Joint pain reported' });
    if (t.pump != null && t.pump <= 2) flags.push({ level: 'info', text: `Weak pumps (${t.pump}/5)` });
    if (t.cardioAdherence != null && t.cardioAdherence <= 3) flags.push({ level: 'warn', text: `Cardio/steps adherence ${t.cardioAdherence}/5` });
    const lowNutrition = NUTRITION.filter(([k]) => n.ratings && n.ratings[k] != null && n.ratings[k] <= 2)
      .map(([k, label]) => `${label} ${n.ratings[k]}/5`);
    if (lowNutrition.length) flags.push({ level: 'warn', text: `Nutrition struggles: ${lowNutrition.join(', ')}` });
    if (n.water === 'no') flags.push({ level: 'info', text: 'Missed water target most days' });
    if (l.physicalFatigue != null && l.physicalFatigue >= 8) flags.push({ level: 'warn', text: `High physical fatigue (${l.physicalFatigue}/10)` });
    if (l.trainingEnergy != null && l.trainingEnergy <= 3) flags.push({ level: 'warn', text: `Low energy in training (${l.trainingEnergy}/10)` });
    if (l.mentalStruggles) flags.push({ level: 'warn', text: 'Mental struggles noted' });
    if (l.peds === 'missed') flags.push({ level: 'warn', text: 'PEDs missed or mistimed' });
    return flags;
  }

  // Plain-text lines for AI prompts and exports.
  function detailToText(detail) {
    const d = cleanDetail(detail);
    if (!d) return '';
    const lines = [];
    const t = d.training || {};
    const n = d.nutrition || {};
    const l = d.lifestyle || {};
    if (t.programWeek) lines.push(`Program week/day: ${t.programWeek}.`);
    if (t.recovery) {
      lines.push('Muscle recovery between sessions: ' + MUSCLES.filter(([k]) => t.recovery[k])
        .map(([k, label]) => `${label} ${labelOf(RECOVERY, t.recovery[k]).toLowerCase()}`).join('; ') + '.');
    }
    if (t.workload) lines.push('Session workload: ' + t.workload.map(x => `${x.day} ${labelOf(WORKLOAD, x.rating).toLowerCase()}`).join('; ') + '.');
    if (t.workloadNotes) lines.push(`Workload/soreness detail: ${t.workloadNotes}`);
    if (t.jointPain) lines.push(`Joint pain: ${t.jointPain}`);
    if (t.performance) lines.push(`Performance/progression: ${t.performance}`);
    if (t.pump != null) lines.push(`Pumps: ${t.pump}/5${t.pumpNotes ? ` (${t.pumpNotes})` : ''}.`);
    if (t.cardioAdherence != null) lines.push(`Cardio/steps adherence: ${t.cardioAdherence}/5${t.cardioNotes ? ` (${t.cardioNotes})` : ''}.`);
    else if (t.cardioNotes) lines.push(`Cardio/steps: ${t.cardioNotes}`);
    if (n.ratings) {
      lines.push('Nutrition (5 = easily manageable): ' + NUTRITION.filter(([k]) => n.ratings[k] != null)
        .map(([k, label]) => `${label.toLowerCase()} ${n.ratings[k]}/5`).join(', ') + '.');
    }
    if (n.offPlanMeals) lines.push(`Off-plan/missed meals: ${n.offPlanMeals}`);
    if (n.water) lines.push(`Water target: ${labelOf(WATER, n.water).toLowerCase()}.`);
    if (l.physicalFatigue != null) lines.push(`Physical fatigue: ${l.physicalFatigue}/10.`);
    if (l.trainingEnergy != null) lines.push(`Energy in training: ${l.trainingEnergy}/10.`);
    if (l.markerNotes) lines.push(`Notes on scores: ${l.markerNotes}`);
    if (l.mentalStruggles) lines.push(`Mental struggles: ${l.mentalStruggles}`);
    if (l.sleepInsights) lines.push(`Sleep insights: ${l.sleepInsights}`);
    if (l.caffeineMg != null) lines.push(`Caffeine: ~${l.caffeineMg} mg/day.`);
    if (l.supplementAdherence != null) lines.push(`Supplement adherence: ${l.supplementAdherence}/5.`);
    if (l.medications) lines.push(`Medications: ${l.medications}`);
    if (l.peds) lines.push(`PEDs taken and timed correctly: ${labelOf(PEDS, l.peds).toLowerCase()}${l.pedNotes ? ` (${l.pedNotes})` : ''}.`);
    if (l.otherFeedback) lines.push(`Other feedback: ${l.otherFeedback}`);
    return lines.join('\n');
  }

  const api = {
    MUSCLES, RECOVERY, WORKLOAD, NUTRITION, WATER, PEDS, MAX_DAYS,
    cleanDetail, workloadDays, programWeekLabel, detailFlags, detailToText, labelOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.checkInDetail = api;
})(typeof window !== 'undefined' ? window : null);
