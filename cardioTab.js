(function (global) {
  const MET_VALUES = {
    run: 9.8, running: 9.8,
    jog: 7, jogging: 7,
    walk: 3.8, walking: 3.8,
    bike: 7.5, cycling: 7.5, cycle: 7.5,
    swim: 8, swimming: 8,
    row: 7, rowing: 7,
    hiit: 10,
    stair: 8.8, stairs: 8.8,
    elliptical: 5.5,
    jump: 8.5, 'jump rope': 8.5,
    hike: 5.3, hiking: 5.3,
    yoga: 2.5,
    pilates: 3.0,
    dance: 5.5,
    other: 6,
    default: 6,
  };

  /* Activity display config — icon, colour accent, metric type */
  const ACTIVITY_CONFIG = {
    run:        { label: 'Run',        icon: '🏃', metric: 'pace',  color: '#e05252' },
    walk:       { label: 'Walk',       icon: '🚶', metric: 'pace',  color: '#52c078' },
    cycle:      { label: 'Cycle',      icon: '🚴', metric: 'speed', color: '#5295e0' },
    swim:       { label: 'Swim',       icon: '🏊', metric: 'pace',  color: '#52c0d8' },
    row:        { label: 'Row',        icon: '🚣', metric: 'speed', color: '#9070d8' },
    hiit:       { label: 'HIIT',       icon: '💪', metric: null,    color: '#e0943a' },
    hike:       { label: 'Hike',       icon: '🥾', metric: 'pace',  color: '#7ab848' },
    yoga:       { label: 'Yoga',       icon: '🧘', metric: null,    color: '#a07dc0' },
    elliptical: { label: 'Elliptical', icon: '⚙️', metric: 'speed', color: '#7f9891' },
    other:      { label: 'Other',      icon: '🏅', metric: null,    color: '#8c9891' },
  };

  function normalizeType(type) {
    return String(type || '').trim().toLowerCase();
  }

  function resolveMET(type) {
    const value = MET_VALUES[normalizeType(type)];
    return Number.isFinite(value) ? value : MET_VALUES.default;
  }

  /**
   * Compute pace (min/km → "M:SS /km") or speed (km/h → "X.X km/h")
   * based on the activity type. Returns null when not applicable.
   */
  function computePaceOrSpeed({ type, durationMinutes, distanceKm }) {
    const dur  = Number(durationMinutes);
    const dist = Number(distanceKm);
    if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(dist) || dist <= 0) return null;

    const norm = normalizeType(type);
    const cfg  = ACTIVITY_CONFIG[norm] || ACTIVITY_CONFIG.other;

    if (cfg.metric === 'pace') {
      const totalSec = (dur / dist) * 60;
      const mins = Math.floor(totalSec / 60);
      const secs = Math.round(totalSec % 60).toString().padStart(2, '0');
      return { value: `${mins}:${secs} /km`, label: 'Pace', icon: '⚡' };
    }
    if (cfg.metric === 'speed') {
      const kmh = dist / (dur / 60);
      return { value: `${kmh.toFixed(1)} km/h`, label: 'Speed', icon: '🚀' };
    }
    return null;
  }

  /** Return the ACTIVITY_CONFIG entry for a type, falling back gracefully */
  function getActivityConfig(type) {
    return ACTIVITY_CONFIG[normalizeType(type)] || { label: type || 'Other', icon: '🏅', metric: null, color: '#8c9891' };
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
    ACTIVITY_CONFIG,
    normalizeType,
    resolveMET,
    estimateCardioCalories,
    computeDailyCardioExpenditure,
    applyCardioMacroAdjustment,
    computePaceOrSpeed,
    getActivityConfig,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.cardioTab = api;
})(typeof window !== 'undefined' ? window : globalThis);
