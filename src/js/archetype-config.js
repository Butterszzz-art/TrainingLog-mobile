// =============================================================
// ARCHETYPE CONFIG
// Rule-based personalization per training archetype.
// Provides defaults, coaching cues, UI visibility, and metrics
// focus without any API calls.
// =============================================================

(function () {
  'use strict';

  const ARCHETYPE_CONFIG = {
    bodybuilder: {
      label: 'Bodybuilder',
      trainingMode: 'bodybuilding',
      defaults: {
        repRange: '8-12',
        restSeconds: 90,
        setsPerExercise: 4,
        defaultUnit: 'kg',
      },
      volume: {
        weeklySetTarget: 20,
        minSetsPerMuscle: 10,
        maxSetsPerMuscle: 25,
      },
      coachingCues: [
        'Focus on mind-muscle connection — control the eccentric',
        'Aim for 2-3 RIR on working sets',
        'Volume is king — track sets per muscle group',
        'Progressive overload via reps before weight',
        'Prioritise lagging body parts early in the session',
      ],
      progressMetrics: ['volume', 'muscleGroupBalance', 'bodyweight', 'measurements'],
      visibleTabs: ['posingTab'],
      hiddenTabs: ['powerliftingTab', 'functionalTab'],
      periodisation: {
        phases: ['hypertrophy', 'intensification', 'deload'],
        blockLengthWeeks: 6,
        deloadFrequency: 'Every 4-6 weeks',
      },
      nutritionFocus: {
        proteinPerKg: 2.2,
        mealFrequency: '4-6 meals',
        periWorkout: 'Fast carbs + protein post-training',
      },
      smartTips: {
        logScreen: 'Track tempo — 3-1-2 for hypertrophy',
        progressScreen: 'Compare weekly volume per muscle group',
        weightScreen: 'Weigh daily, use 7-day average for decisions',
        macroScreen: 'Protein timing matters — spread evenly across meals',
      },
    },

    powerlifter: {
      label: 'Powerlifter',
      trainingMode: 'powerlifting',
      defaults: {
        repRange: '1-5',
        restSeconds: 180,
        setsPerExercise: 5,
        defaultUnit: 'kg',
      },
      volume: {
        weeklySetTarget: 15,
        minSetsPerMuscle: 6,
        maxSetsPerMuscle: 15,
      },
      coachingCues: [
        'Specificity — squat, bench, deadlift are priority',
        'RPE 7-9 for main lifts, leave 1-2 reps in the tank',
        'Technique practice at sub-maximal loads builds strength',
        'Accessory work supports the big three — keep it simple',
        'Competition commands: start, press, rack',
      ],
      progressMetrics: ['estimated1RM', 'wilksScore', 'totalKg', 'bodyweight'],
      visibleTabs: ['powerliftingTab'],
      hiddenTabs: ['posingTab', 'functionalTab'],
      periodisation: {
        phases: ['accumulation', 'transmutation', 'realisation', 'deload'],
        blockLengthWeeks: 4,
        deloadFrequency: 'Every 3-4 weeks',
      },
      nutritionFocus: {
        proteinPerKg: 2.0,
        mealFrequency: '3-4 meals',
        periWorkout: 'Carbs pre-training for performance',
      },
      smartTips: {
        logScreen: 'Log RPE for every working set',
        progressScreen: 'Track estimated 1RM trends for SBD',
        weightScreen: 'Manage weight class — stay within 5% of target',
        macroScreen: 'Fuel performance — carbs are your friend',
      },
    },

    hybrid: {
      label: 'Hybrid Athlete',
      trainingMode: 'bodybuilding',
      defaults: {
        repRange: '6-10',
        restSeconds: 120,
        setsPerExercise: 3,
        defaultUnit: 'kg',
      },
      volume: {
        weeklySetTarget: 16,
        minSetsPerMuscle: 8,
        maxSetsPerMuscle: 18,
      },
      coachingCues: [
        'Balance strength and conditioning — neither dominates',
        'Compound movements are your bread and butter',
        'Monitor fatigue — recovery is your limiting factor',
        'Periodise cardio around strength blocks',
        'Functional carry-over matters — train movements, not muscles',
      ],
      progressMetrics: ['volume', 'estimated1RM', 'cardioCapacity', 'bodyweight'],
      visibleTabs: [],
      hiddenTabs: ['posingTab', 'powerliftingTab', 'functionalTab'],
      periodisation: {
        phases: ['strength', 'conditioning', 'hybrid', 'deload'],
        blockLengthWeeks: 4,
        deloadFrequency: 'Every 4 weeks',
      },
      nutritionFocus: {
        proteinPerKg: 2.0,
        mealFrequency: '4-5 meals',
        periWorkout: 'Balanced pre and post nutrition',
      },
      smartTips: {
        logScreen: 'Alternate heavy and volume days',
        progressScreen: 'Track both strength and endurance metrics',
        weightScreen: 'Body composition over scale weight',
        macroScreen: 'Higher carbs on conditioning days',
      },
    },

    recreational: {
      label: 'Recreational',
      trainingMode: 'bodybuilding',
      defaults: {
        repRange: '10-15',
        restSeconds: 60,
        setsPerExercise: 3,
        defaultUnit: 'kg',
      },
      volume: {
        weeklySetTarget: 12,
        minSetsPerMuscle: 6,
        maxSetsPerMuscle: 14,
      },
      coachingCues: [
        'Consistency beats intensity — show up and move',
        'Full-body sessions work great for 2-3 days per week',
        'Keep it fun — enjoyment drives adherence',
        'Progressive overload still matters — add a rep each week',
        'Recovery is part of the programme — rest days count',
      ],
      progressMetrics: ['streaks', 'totalWorkouts', 'bodyweight'],
      visibleTabs: [],
      hiddenTabs: ['posingTab', 'powerliftingTab', 'functionalTab'],
      periodisation: {
        phases: ['general', 'deload'],
        blockLengthWeeks: 8,
        deloadFrequency: 'Every 6-8 weeks or as needed',
      },
      nutritionFocus: {
        proteinPerKg: 1.6,
        mealFrequency: '3-4 meals',
        periWorkout: 'Just eat well — no strict timing needed',
      },
      smartTips: {
        logScreen: 'Simple is sustainable — pick 5-6 exercises per session',
        progressScreen: 'Your streak is your most important metric',
        weightScreen: 'Trends over time, not daily fluctuations',
        macroScreen: 'Hit protein target — flexible with the rest',
      },
    },
  };

  function getUserArchetype() {
    const user = window.currentUser || localStorage.getItem('fitnessAppUser');
    if (!user) return 'hybrid';
    try {
      const settings = JSON.parse(localStorage.getItem('settings_' + user) || '{}');
      return settings?.profile?.athleteArchetype || 'hybrid';
    } catch { return 'hybrid'; }
  }

  function getArchetypeConfig(archetype) {
    return ARCHETYPE_CONFIG[archetype] || ARCHETYPE_CONFIG.hybrid;
  }

  function getCurrentConfig() {
    return getArchetypeConfig(getUserArchetype());
  }

  function getRandomCue(archetype) {
    const cfg = getArchetypeConfig(archetype || getUserArchetype());
    return cfg.coachingCues[Math.floor(Math.random() * cfg.coachingCues.length)];
  }

  function getSmartTip(screen, archetype) {
    const cfg = getArchetypeConfig(archetype || getUserArchetype());
    return cfg.smartTips?.[screen] || null;
  }

  // Apply defaults to the log form based on archetype
  function applyArchetypeDefaults() {
    const cfg = getCurrentConfig();
    const setsInput = document.getElementById('sets');
    if (setsInput && !setsInput.value) {
      setsInput.placeholder = cfg.defaults.setsPerExercise + ' sets';
    }
    const unitSelect = document.getElementById('weightUnit');
    if (unitSelect) {
      const stored = localStorage.getItem('defaultWeightUnit');
      if (!stored) {
        unitSelect.value = cfg.defaults.defaultUnit;
        localStorage.setItem('defaultWeightUnit', cfg.defaults.defaultUnit);
      }
    }
  }

  // Expose globally
  window.ARCHETYPE_CONFIG = ARCHETYPE_CONFIG;
  window.getUserArchetype = getUserArchetype;
  window.getArchetypeConfig = getArchetypeConfig;
  window.getCurrentArchetypeConfig = getCurrentConfig;
  window.getRandomCoachingCue = getRandomCue;
  window.getSmartTip = getSmartTip;
  window.applyArchetypeDefaults = applyArchetypeDefaults;
})();
