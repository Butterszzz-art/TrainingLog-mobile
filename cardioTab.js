(function (global) {
  const MET_VALUES = {
    run: 9.8,
    running: 9.8,
    jog: 7,
    jogging: 7,
    walk: 3.8,
    walking: 3.8,
    bike: 7.5,
    cycling: 7.5,
    swim: 8,
    swimming: 8,
    row: 7,
    rowing: 7,
    hiit: 10,
    stair: 8.8,
    elliptical: 5.5,
    jump: 8.5,
    default: 6,
  };

  function normalizeType(type) {
    return String(type || '').trim().toLowerCase();
  }

  function resolveMET(type) {
    const value = MET_VALUES[normalizeType(type)];
    return Number.isFinite(value) ? value : MET_VALUES.default;
  }

  function estimateCardioCalories({ type, durationMinutes, weightKg }) {
    const duration = Number(durationMinutes);
    const weight = Number(weightKg);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(weight) || weight <= 0) return 0;
    const met = resolveMET(type);
    const kcalPerMinute = (met * 3.5 * weight) / 200;
    return Math.round(kcalPerMinute * duration);
  }

  function computeDailyCardioExpenditure(log, date, weightKg) {
    const entries = Array.isArray(log) ? log : [];
    return entries
      .filter((entry) => entry?.date === date)
      .reduce((sum, entry) => {
        const manualCalories = Number(entry?.calories);
        const estimatedCalories = estimateCardioCalories({
          type: entry?.type,
          durationMinutes: entry?.duration,
          weightKg,
        });
        const calories = Number.isFinite(manualCalories) && manualCalories > 0 ? manualCalories : estimatedCalories;
        return sum + calories;
      }, 0);
  }

  function applyCardioMacroAdjustment(targets, cardioCalories) {
    const base = {
      calories: Number(targets?.calories) || 0,
      protein: Number(targets?.protein) || 0,
      carbs: Number(targets?.carbs) || 0,
      fat: Number(targets?.fat) || 0,
    };
    const extra = Math.max(0, Math.round(Number(cardioCalories) || 0));
    if (!extra) return { ...base, cardioCalories: 0 };

    return {
      calories: base.calories + extra,
      protein: base.protein + Math.round((extra * 0.2) / 4),
      carbs: base.carbs + Math.round((extra * 0.65) / 4),
      fat: base.fat + Math.round((extra * 0.15) / 9),
      cardioCalories: extra,
    };
  }

  const api = {
    MET_VALUES,
    normalizeType,
    resolveMET,
    estimateCardioCalories,
    computeDailyCardioExpenditure,
    applyCardioMacroAdjustment,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.cardioTab = api;
})(typeof window !== 'undefined' ? window : globalThis);
