/**
 * exerciseAutoClassify.js
 *
 * The AI fallback for exercise names nothing local could place on a muscle
 * group. exerciseMuscleMap.js already tries the catalog, abbreviations, typo
 * correction and keyword rules; a name that still resolves to 'other'
 * ("Larsen press", a coach's house name) drops out of the per-muscle volume.
 *
 * After a workout is saved (and once after login, to catch old history),
 * this collects those names from the user's log and asks the server in one
 * batch (POST /api/ai/classify-exercises). Confident answers are saved as
 * custom exercises marked source: 'ai', so getMuscleGroup() picks them up
 * straight away and the AI is never asked about that name again. Names the
 * AI couldn't place are retried after a month.
 *
 * It runs in the background, so it never prompts: no request unless AI
 * consent is already granted and the account has Pro (the consent sheet
 * and upgrade modal belong to features the user tapped). A user's own
 * assignment always beats an AI guess, and Settings → Advanced lists the
 * guesses with an "AI guess" tag so a wrong one can be changed.
 */
(function (global) {
  'use strict';

  const BATCH_SIZE = 40;          // server cap, see exerciseClassify.js
  const MIN_CONFIDENCE = 0.6;
  const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
  const DELAY_MS = 4000;          // let the save/render finish first

  const attemptsKey = (user) => `exerciseAiAttempts_${user}`;

  function loadAttempts(user) {
    try {
      const data = JSON.parse(global.localStorage.getItem(attemptsKey(user)));
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  function saveAttempts(user, attempts) {
    try { global.localStorage.setItem(attemptsKey(user), JSON.stringify(attempts)); } catch { /* storage full */ }
  }

  // Distinct names in the user's log that nothing can place yet and the AI
  // hasn't been asked about recently, most recent workouts first.
  function unresolvedExerciseNames(user, now = Date.now()) {
    if (!user || typeof global.resolveExerciseMuscle !== 'function') return [];
    let workouts = [];
    try { workouts = JSON.parse(global.localStorage.getItem(`workouts_${user}`)) || []; } catch { /* corrupt */ }
    const attempts = loadAttempts(user);
    const seen = new Set();
    const names = [];
    (Array.isArray(workouts) ? workouts : []).slice().reverse().forEach((w) => {
      (Array.isArray(w && w.log) ? w.log : []).forEach((entry) => {
        const name = typeof entry?.exercise === 'string' ? entry.exercise.trim() : '';
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return;
        seen.add(key);
        if (attempts[key] && now - attempts[key] < RETRY_AFTER_MS) return;
        if (global.resolveExerciseMuscle(name).via === null) names.push(name);
      });
    });
    return names;
  }

  function canAskAi() {
    const consent = global.pocketCoachAIConsent && global.pocketCoachAIConsent.get();
    const paid = typeof global.hasPaidAccess === 'function' && global.hasPaidAccess();
    const online = !global.navigator || global.navigator.onLine !== false;
    return consent === 'granted' && paid && online;
  }

  function serverBase() {
    return ((typeof global.getServerUrl === 'function' ? global.getServerUrl() : null) || global.SERVER_URL || '').replace(/\/$/, '');
  }

  let inFlight = null;

  /**
   * Ask the AI about this user's unplaced names. Resolves to the guesses
   * saved (possibly none). Safe to call often: one request at a time, and
   * nothing is sent when there's nothing new to ask or AI isn't allowed.
   */
  function classifyUnresolvedExercises(user, { fetchImpl = global.fetch } = {}) {
    if (inFlight) return inFlight;
    if (!user || !canAskAi() || typeof global.saveAiExerciseGuesses !== 'function') return Promise.resolve([]);
    const names = unresolvedExerciseNames(user).slice(0, BATCH_SIZE);
    if (!names.length) return Promise.resolve([]);

    inFlight = (async () => {
      const token = global.localStorage.getItem('authToken') || global.localStorage.getItem('token') || '';
      const res = await fetchImpl(`${serverBase()}/api/ai/classify-exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) return []; // try again next time
      const body = await res.json();
      const results = Array.isArray(body && body.results) ? body.results : [];

      // Every name the server answered for counts as asked, placed or not.
      const attempts = loadAttempts(user);
      const now = Date.now();
      results.forEach((r) => { if (r && typeof r.name === 'string') attempts[r.name.toLowerCase()] = now; });
      saveAttempts(user, attempts);

      const guesses = results.filter((r) => r && r.muscleGroup && Number(r.confidence) >= MIN_CONFIDENCE);
      const added = guesses.length ? global.saveAiExerciseGuesses(user, guesses) : [];
      if (added.length) announce(added);
      return added;
    })().catch(() => []).finally(() => { inFlight = null; });
    return inFlight;
  }

  function announce(added) {
    if (typeof global.renderVolumeLandmarks === 'function') {
      try { global.renderVolumeLandmarks(); } catch { /* tab not mounted */ }
    }
    if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      global.dispatchEvent(new global.CustomEvent('pc:exercise-muscles-updated', { detail: { added } }));
    }
    if (typeof global.showToast === 'function') {
      const label = global.muscleGroupLabel ? global.muscleGroupLabel(added[0].muscleGroup) : added[0].muscleGroup;
      const msg = added.length === 1
        ? `"${added[0].name}" now counts toward ${label} (AI guess). Change it in Settings › Advanced.`
        : `${added.length} exercises now count toward a muscle group (AI guess). Check them in Settings › Advanced.`;
      global.showToast(msg);
    }
  }

  let timer = null;
  function scheduleExerciseAutoClassify(user) {
    if (!user) return;
    clearTimeout(timer);
    timer = setTimeout(() => { classifyUnresolvedExercises(user); }, DELAY_MS);
  }

  if (typeof module !== 'undefined') {
    module.exports = { unresolvedExerciseNames, classifyUnresolvedExercises, scheduleExerciseAutoClassify, MIN_CONFIDENCE };
  }
  if (typeof window !== 'undefined') {
    window.classifyUnresolvedExercises = classifyUnresolvedExercises;
    window.scheduleExerciseAutoClassify = scheduleExerciseAutoClassify;
  }
})(typeof window !== 'undefined' ? window : globalThis);
