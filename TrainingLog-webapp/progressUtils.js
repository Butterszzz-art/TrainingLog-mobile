function computeOneRepMax(weightsArray, repsArray) {
  if (!Array.isArray(weightsArray) || !Array.isArray(repsArray)) return 0;
  let best = 0;
  for (let i = 0; i < weightsArray.length; i++) {
    const w = +weightsArray[i];
    const r = +repsArray[i];
    if (!w || !r) continue;
    const est = w * (1 + r / 30);
    if (est > best) best = est;
  }
  return best;
}

function loadPRs(user) {
  if (typeof localStorage === 'undefined') return {};
  return JSON.parse(localStorage.getItem(`prs_${user}`)) || {};
}

function savePRs(user, prs) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`prs_${user}`, JSON.stringify(prs));
}

function updatePRs(user, workout, volumeCalc) {
  if (!workout || !Array.isArray(workout.log)) return null;
  const prs = loadPRs(user);
  let updated = false;
  workout.log.forEach(e => {
    const vol = volumeCalc ? volumeCalc({ log: [e] }) : 0;
    const orm = computeOneRepMax(e.weightsArray, e.repsArray);
    const pr = prs[e.exercise] || { oneRM: 0, volume: 0, history: [] };
    if (orm > pr.oneRM) {
      pr.oneRM = orm;
      updated = true;
    }
    if (vol > pr.volume) {
      pr.volume = vol;
      updated = true;
    }
    pr.history.push({ date: Date.now(), oneRM: orm });
    if (pr.history.length > 10) pr.history.shift();
    prs[e.exercise] = pr;
  });
  if (updated) savePRs(user, prs);
  return updated ? prs : null;
}

if (typeof module !== 'undefined') {
  module.exports = { computeOneRepMax, loadPRs, savePRs, updatePRs };
}
if (typeof window !== 'undefined') {
  window.computeOneRepMax = computeOneRepMax;
  window.loadPRs = loadPRs;
  window.savePRs = savePRs;
  window.updatePRs = updatePRs;
}

export { computeOneRepMax, loadPRs, savePRs, updatePRs };
