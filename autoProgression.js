import { loadPRs } from './progressUtils.js';

export function analyzeProgress(user) {
  const prs = loadPRs(user);
  const results = [];
  Object.entries(prs).forEach(([exercise, data]) => {
    const progressionHistory = data.history || [];
    if (progressionHistory.length >= 4) {
      const last = progressionHistory[progressionHistory.length - 1];
      const fourAgo = progressionHistory[progressionHistory.length - 4];
      if (last.oneRM <= fourAgo.oneRM) {
        results.push({ type: 'deload', exercise });
        return;
      }
    }
    results.push({ type: 'progress', exercise });
  });
  return results;
}

if (typeof window !== 'undefined') {
  window.analyzeProgress = analyzeProgress;
}
