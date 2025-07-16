function simpleInsights(prsHistory, weeks=3) {
  const tips = [];
  Object.entries(prsHistory).forEach(([exercise, records]) => {
    const arr = records.slice(-weeks);
    if (arr.length >= 2) {
      const first = arr[0].oneRM || 0;
      const last = arr[arr.length - 1].oneRM || 0;
      if (first && last > first) {
        const pct = ((last - first) / first) * 100;
        if (pct >= 5) {
          tips.push(`You improved ${exercise} 1RM by ${pct.toFixed(1)}% in ${weeks} weeks—consider increasing accessory sets.`);
        }
      }
    }
  });
  return tips;
}

if (typeof module !== 'undefined') {
  module.exports = { simpleInsights };
}
if (typeof window !== 'undefined') {
  window.simpleInsights = simpleInsights;
}
