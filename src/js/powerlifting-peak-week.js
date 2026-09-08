/**
 * powerlifting-peak-week.js
 *
 * Pure, testable "nerdy stuff" for the Powerlifting tab's meet-prep flow —
 * taper scheduling, attempt selection, weight-class cutting, and caffeine
 * dosing. Sourced from the research-backed protocol in the team's
 * PowerliftingPTC2025 module (tapering, weight-class selection, and
 * attempt-selection lectures):
 *
 *  - Taper: short and sharp beats long and gradual. Drop accessories at
 *    T-7, keep intensity ≥85% 1RM / ≤5 reps with no volume increase, a
 *    normal (but conservative) session at T-3, an explosive single @ 85%
 *    at T-2, and full rest at T-1. Deadlift is the one lift it's fine to
 *    drop up to 7 days out if it isn't recovering well.
 *  - Attempts: opener ≈90% of a *tested* 1RM (a guaranteed number on the
 *    board), attempt 2 = your real/tested 1RM (often ~2.5% higher than
 *    what you hit in training thanks to the taper, caffeine, and time),
 *    attempt 3 held in reserve for a PR only if attempt 2 goes well.
 *  - Weight class: dehydration up to ~2.5% bodyweight has minimal strength
 *    cost; up to ~5% is a reasonable risk/reward with a rehydration
 *    window between weigh-in and the platform. Bigger cuts need real
 *    fat-loss time, not a water cut.
 *
 * No DOM access anywhere in this file — index.html wires these pure
 * functions into the Powerlifting tab's Meet Prep / Meet Day subviews.
 */
(function (global) {
  'use strict';

  const LIFTS = ['squat', 'bench', 'deadlift'];

  function roundToIncrement(value, increment) {
    const inc = increment > 0 ? increment : 2.5;
    return Math.round(value / inc) * inc;
  }

  function toKg(value, unit) {
    return unit === 'lbs' ? value * 0.453592 : value;
  }

  function toDateOnlyUTC(dateInput) {
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  function daysBetween(fromISO, toISO) {
    const from = toDateOnlyUTC(fromISO);
    const to = toDateOnlyUTC(toISO);
    if (!from || !to) return null;
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }

  // ── Attempt selection ──────────────────────────────────────────────
  // oneRM: your tested (training) 1RM for a lift. increment: plate jump
  // to round to (2.5kg / 5lbs are the common defaults).
  function suggestAttempts(oneRM, increment) {
    const inc = increment > 0 ? increment : 2.5;
    const rm = Number(oneRM);
    if (!Number.isFinite(rm) || rm <= 0) return null;

    const opener = roundToIncrement(rm * 0.90, inc);
    // Attempt 2 targets your *true* 1RM on the day — typically a touch
    // above the number you tested in training once taper/caffeine/time
    // are accounted for.
    const second = Math.max(opener + inc, roundToIncrement(rm * 1.025, inc));
    // Attempt 3 is a reserve PR try, only taken live if attempt 2 goes
    // well — this is a starting suggestion, not a commitment.
    const third = second + inc * 2;

    return { opener, second, third };
  }

  // attempts: { squat: [{weight, status}, ...], bench: [...], deadlift: [...] }
  // status is 'good' | 'no-lift' | 'pending'. Returns the best successful
  // weight per lift and the meet total (or null if any lift bombed out —
  // 0/3 on a lift zeroes the whole competition total per IPF rules).
  function computeMeetResult(attempts) {
    const bestByLift = {};
    let bombedOut = false;
    let anyAttempted = false;

    LIFTS.forEach((lift) => {
      const list = Array.isArray(attempts && attempts[lift]) ? attempts[lift] : [];
      const goodWeights = list
        .filter((a) => a && a.status === 'good' && Number.isFinite(Number(a.weight)) && Number(a.weight) > 0)
        .map((a) => Number(a.weight));
      const attemptedCount = list.filter((a) => a && a.status && a.status !== 'pending').length;
      if (attemptedCount > 0) anyAttempted = true;

      if (goodWeights.length) {
        bestByLift[lift] = Math.max(...goodWeights);
      } else {
        bestByLift[lift] = null;
        if (attemptedCount >= 3) bombedOut = true; // all 3 attempts missed
      }
    });

    const allLiftsHaveResult = LIFTS.every((lift) => bestByLift[lift] != null);
    const total = allLiftsHaveResult
      ? LIFTS.reduce((sum, lift) => sum + bestByLift[lift], 0)
      : null;

    return { bestByLift, total, bombedOut, anyAttempted };
  }

  // ── Taper / peak week plan ─────────────────────────────────────────
  // Returns an ordered list of day-cards from "today" through meet day
  // (inclusive), each with a phase label and concrete guidance. Days
  // further than 7 out are collapsed into a single lead-in card so the
  // UI isn't showing a 12-week wall of identical rows.
  function buildTaperPlan(meetDateISO, referenceDateISO) {
    const meetDate = toDateOnlyUTC(meetDateISO);
    if (!meetDate) return [];
    const refISO = referenceDateISO || new Date().toISOString().slice(0, 10);
    const daysOutToday = daysBetween(refISO, meetDateISO);
    if (daysOutToday === null) return [];

    const days = [];

    if (daysOutToday > 7) {
      days.push({
        date: null,
        daysOut: daysOutToday,
        phase: 'training',
        title: `${Math.ceil(daysOutToday / 7)} weeks out — normal training`,
        guidance: [
          'Keep training the powerlifts + accessories as usual — autoregulate volume and use reactive deloads rather than a pre-planned one.',
          'Schedule the powerlifts on your lowest-fatigue days; do accessory variations after the powerlift (or the next day), never the day before.',
          'If your meet is at an unusual time of day, start training at that time of day from 2 weeks out to adapt your circadian rhythm.'
        ],
        lifts: LIFTS,
        isTaper: false
      });
    }

    const startOffset = Math.min(daysOutToday, 7);
    for (let daysOut = startOffset; daysOut >= 0; daysOut -= 1) {
      const date = new Date(meetDate.getTime() - daysOut * 86400000).toISOString().slice(0, 10);
      days.push(buildTaperDay(daysOut, date));
    }

    if (daysOutToday < 0) {
      days.push({
        date: null,
        daysOut: daysOutToday,
        phase: 'done',
        title: 'Meet complete',
        guidance: ['Great lifting! Take a few caffeine-free days (5-9) before your next training block to reset tolerance.'],
        lifts: [],
        isTaper: false
      });
    }

    return days;
  }

  function buildTaperDay(daysOut, date) {
    if (daysOut >= 4) {
      return {
        date,
        daysOut,
        phase: 'taper',
        title: daysOut === 7 ? 'Taper begins — 7 days out' : `${daysOut} days out`,
        guidance: [
          'Drop every accessory — train only the 3 powerlifts this week.',
          'Keep intensity ≥85% 1RM or ≤5 reps/set. Do not add extra volume to compensate.',
          'This is the lowest-fatigue, highest-transfer training you can do this close to the meet.'
        ],
        lifts: LIFTS,
        liftNotes: { deadlift: 'Optional from here on — it\'s fine to stop deadlifting up to 7 days out if it isn\'t recovering well.' },
        isTaper: true
      };
    }
    if (daysOut === 3) {
      return {
        date,
        daysOut,
        phase: 'openers',
        title: '3 days out — openers session',
        guidance: [
          'One normal session with every powerlift you\'re still training (at least squat + bench).',
          'Conservative singles are fine — the goal is confidence, not a new 1RM.',
          'Do not fail a rep. If a weight feels shaky, stop there.'
        ],
        lifts: ['squat', 'bench', 'deadlift'],
        liftNotes: { deadlift: 'Optional — skip if you dropped deadlifting earlier in the taper.' },
        isTaper: true
      };
    }
    if (daysOut === 2) {
      return {
        date,
        daysOut,
        phase: 'primer',
        title: '2 days out — primer',
        guidance: [
          'No heavy training. Warm up and build to one explosive single at 85% 1RM per lift (at least squat + bench).',
          'This acts as active recovery and can sharpen power for meet day — it is not a training session.'
        ],
        lifts: ['squat', 'bench'],
        liftNotes: { deadlift: 'Skip — most lifters are better off resting the deadlift entirely in the last 2 days.' },
        isTaper: true
      };
    }
    if (daysOut === 1) {
      return {
        date,
        daysOut,
        phase: 'rest',
        title: '1 day out — rest & logistics',
        guidance: [
          'No training. Focus on sleep, hydration/weigh-in prep, and packing your meet-day kit.',
          'Confirm your opener weights and warm-up plan for tomorrow.'
        ],
        lifts: [],
        isTaper: true
      };
    }
    return {
      date,
      daysOut: 0,
      phase: 'meet',
      title: 'Meet day',
      guidance: [
        'If you use caffeine, take 3-6 mg/kg on an empty stomach ~1 hour before your first attempt.',
        'Confirm your opener (~90% 1RM), then decide attempt 2/3 live based on how the openers felt.'
      ],
      lifts: LIFTS,
      isTaper: true
    };
  }

  // ── Weight class cut planning ──────────────────────────────────────
  // Based on Matras et al. (2025): a ~4.8% bodyweight cut over 4 days
  // (low-carb <50g, low-sodium <1g, water manipulation, -10% kcal) held
  // no measurable strength cost once refed/rehydrated for ~2 hours
  // before lifting. Cuts above ~5% need real fat-loss time, not water.
  function planWeightCut(input) {
    const unit = input && input.unit === 'lbs' ? 'lbs' : 'kg';
    const currentWeight = toKg(Number(input && input.currentWeight), unit);
    const targetWeight = toKg(Number(input && input.targetWeight), unit);

    if (!Number.isFinite(currentWeight) || !Number.isFinite(targetWeight) || currentWeight <= 0 || targetWeight <= 0) {
      return null;
    }

    const cutKg = currentWeight - targetWeight;
    const cutPercent = (cutKg / currentWeight) * 100;

    if (cutPercent <= 0) {
      return { method: 'none', cutPercent, cutKg, message: 'You\'re already at or under your target weight class.' };
    }
    if (cutPercent <= 2.5) {
      return {
        method: 'minimal',
        cutPercent,
        cutKg,
        message: 'Under ~2.5% of bodyweight — research shows minimal strength impact. A light sodium/water taper the day before weigh-in is enough.',
        schedule: []
      };
    }
    if (cutPercent <= 5) {
      const waterTarget = Math.round(currentWeight * 100); // 100 ml/kg
      const lastDayWater = Math.round(currentWeight * 15); // 15 ml/kg
      return {
        method: 'dehydration',
        cutPercent,
        cutKg,
        message: `~${cutPercent.toFixed(1)}% of bodyweight is a reasonable water-cut range (up to ~5% held no measured strength cost in the reference study, with a rehydration window before lifting).`,
        schedule: [
          { day: -4, label: '4 days out', notes: [`Water: ~${waterTarget} ml/day (100 ml/kg)`, 'Carbs under 50g/day', 'Sodium under 1g/day', 'Calories: ~10% below maintenance'] },
          { day: -3, label: '3 days out', notes: [`Water: ~${waterTarget} ml/day (100 ml/kg)`, 'Carbs under 50g/day', 'Sodium under 1g/day'] },
          { day: -2, label: '2 days out', notes: [`Water: ~${waterTarget} ml/day (100 ml/kg)`, 'Carbs under 50g/day', 'Sodium under 1g/day'] },
          { day: -1, label: '1 day out (weigh-in)', notes: [`Water: ~${lastDayWater} ml (15 ml/kg) — optional dry sauna if needed`, 'Weigh in, then refeed/rehydrate for ~2 hours before you expect to lift'] }
        ]
      };
    }
    return {
      method: 'long-term',
      cutPercent,
      cutKg,
      message: `~${cutPercent.toFixed(1)}% of bodyweight is too large for a safe water cut. Start losing this as fat over the weeks/months before your meet and re-plan the final water cut once you're within ~5%.`,
      schedule: []
    };
  }

  // ── Caffeine dosing ─────────────────────────────────────────────────
  function getCaffeineDose(bodyweightKg) {
    const bw = Number(bodyweightKg);
    if (!Number.isFinite(bw) || bw <= 0) return null;
    return {
      minMg: Math.round(bw * 3),
      maxMg: Math.round(bw * 6),
      timingNote: 'On an empty stomach, ~1 hour before your first attempt.'
    };
  }

  const api = {
    roundToIncrement,
    suggestAttempts,
    computeMeetResult,
    buildTaperPlan,
    planWeightCut,
    getCaffeineDose
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof global !== 'undefined') {
    global.PowerliftingPeakWeek = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
