(function (global) {
  const RATE_TARGETS = {
    cut: { slow: -0.25, moderate: -0.5, aggressive: -0.75 },
    bulk: { slow: 0.15, moderate: 0.3, aggressive: 0.5 },
    maintain: { slow: 0, moderate: 0, aggressive: 0 },
  };

  function asDate(input) {
    return new Date(`${input}T00:00:00`);
  }

  function computeWeightChangeRate(entries, daysWindow = 21) {
    const rows = (Array.isArray(entries) ? entries : [])
      .filter((e) => Number.isFinite(Number(e?.weightKg || e?.weight)))
      .map((e) => ({ date: String(e.date), weightKg: Number(e.weightKg ?? e.weight) }))
      .sort((a, b) => asDate(a.date) - asDate(b.date));

    if (rows.length < 2) return { kgPerWeek: 0, days: 0, start: null, end: null };

    const latest = rows[rows.length - 1];
    const cutoff = asDate(latest.date);
    cutoff.setDate(cutoff.getDate() - daysWindow);

    const inWindow = rows.filter((r) => asDate(r.date) >= cutoff);
    if (inWindow.length < 2) return { kgPerWeek: 0, days: 0, start: null, end: null };

    const start = inWindow[0];
    const end = inWindow[inWindow.length - 1];
    const days = Math.max(1, Math.round((asDate(end.date) - asDate(start.date)) / 86400000));
    const kgPerWeek = ((end.weightKg - start.weightKg) / days) * 7;

    return { kgPerWeek, days, start, end };
  }

  function plannedRate(goal = 'maintain', rate = 'moderate') {
    return RATE_TARGETS[goal]?.[rate] ?? 0;
  }

  function suggestCalorieAdjustment({ kgPerWeek, goal = 'maintain', rate = 'moderate' }) {
    const target = plannedRate(goal, rate);
    const delta = kgPerWeek - target;
    const tolerance = goal === 'maintain' ? 0.15 : 0.12;

    if (goal === 'cut' && delta < -tolerance) {
      const amount = Math.min(350, Math.max(120, Math.round(Math.abs(delta) * 450)));
      return { caloriesDelta: amount, reason: 'Weight is dropping faster than planned. Increase calories slightly.' };
    }
    if (goal === 'bulk' && delta > tolerance) {
      const amount = Math.min(350, Math.max(120, Math.round(Math.abs(delta) * 450)));
      return { caloriesDelta: -amount, reason: 'Weight is increasing faster than planned. Reduce calories slightly.' };
    }
    if (goal === 'maintain' && Math.abs(kgPerWeek) > tolerance) {
      const amount = Math.min(250, Math.max(100, Math.round(Math.abs(kgPerWeek) * 400)));
      return {
        caloriesDelta: kgPerWeek > 0 ? -amount : amount,
        reason: kgPerWeek > 0 ? 'Weight is trending up during maintenance. Reduce calories a bit.' : 'Weight is trending down during maintenance. Increase calories a bit.',
      };
    }

    return { caloriesDelta: 0, reason: 'Weight trend is within your planned range.' };
  }

  function applyWeightTrendAdjustment(targets, suggestion) {
    const base = {
      calories: Number(targets?.calories) || 0,
      protein: Number(targets?.protein) || 0,
      carbs: Number(targets?.carbs) || 0,
      fat: Number(targets?.fat) || 0,
    };
    const delta = Number(suggestion?.caloriesDelta) || 0;
    if (!delta) return { ...base, caloriesDelta: 0 };

    return {
      calories: Math.max(0, base.calories + delta),
      protein: Math.max(0, base.protein + Math.round((delta * 0.2) / 4)),
      carbs: Math.max(0, base.carbs + Math.round((delta * 0.6) / 4)),
      fat: Math.max(0, base.fat + Math.round((delta * 0.2) / 9)),
      caloriesDelta: delta,
    };
  }

  function buildWeightVolumeIntakeInsight({ weightTrend, volumeTrend, intakeTrend }) {
    if (Math.abs(weightTrend) < 0.03 && volumeTrend > 0.08 && intakeTrend <= 0) {
      return 'Your weight plateaued while training volume increased; consider increasing calories.';
    }
    if (weightTrend < -0.2 && intakeTrend < -0.05) {
      return 'Weight is dropping quickly while intake trends down; increase calories to support recovery.';
    }
    if (weightTrend > 0.25 && volumeTrend < 0.03) {
      return 'Weight is rising while training volume is stable. Consider reducing calorie intake slightly.';
    }
    return 'Weight, training volume, and calorie intake are moving in a balanced range.';
  }

  const api = {
    RATE_TARGETS,
    computeWeightChangeRate,
    plannedRate,
    suggestCalorieAdjustment,
    applyWeightTrendAdjustment,
    buildWeightVolumeIntakeInsight,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.weightTab = api;
})(typeof window !== 'undefined' ? window : globalThis);
