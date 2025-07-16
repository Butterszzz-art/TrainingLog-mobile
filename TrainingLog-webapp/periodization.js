export function buildPeriodizationTemplate(type, exercises) {
  const weeks = [];
  const loads = {
    linear: [70, 75, 80, 85],
    block: [60, 65, 70, 55],
    undulating: [60, 80, 70, 85],
    hybrid: [70, 80, 65, 90]
  };
  const template = loads[type] || loads.linear;
  for (let i = 0; i < template.length; i++) {
    weeks.push({ week: i + 1, load: template[i], exercises });
  }
  return weeks;
}

export function createSplitSchedule(days, exercises) {
  const schedule = [];
  const len = exercises.length;
  for (let i = 0; i < days; i++) {
    schedule.push({ day: i + 1, exercise: exercises[i % len] });
  }
  return schedule;
}

if (typeof window !== 'undefined') {
  window.buildPeriodizationTemplate = buildPeriodizationTemplate;
  window.createSplitSchedule = createSplitSchedule;
}
