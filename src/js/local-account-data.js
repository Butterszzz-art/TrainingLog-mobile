/* Removes one account's data from this device. Used when the account is
   deleted: the server copy is gone at that point, but check-ins, phase
   state, weigh-ins, macros and progress photos also live in localStorage and
   IndexedDB, and delete-account.html promises those go too.

   Logging out does NOT call this: entries logged offline may not have
   synced yet (cloud-sync.js), so clearing them on logout could lose them.

   Another account signed in on the same device keeps its own data — only
   keys that belong to `username`, plus the unscoped keys that always hold
   whoever was signed in last, are removed. */
(function (globalScope) {
  'use strict';

  // Keys the app writes without an account name. They always describe the
  // last signed-in user, so they go with that user's account.
  const UNSCOPED_KEYS = [
    'personalDetails', 'dailyMacroProgress', 'dailyMacroMeals', 'dailyMacroDate',
    'macroResetTime', 'macroDayType', 'macroTargets', 'dailySteps',
    'workoutHistory', 'resistanceLogs', 'archivedWorkoutIds',
    'programs', 'activeProgram', 'trainingMode', 'plMeetDetails', 'plCutPlanInputs',
    'crossfitTemplates', 'pcProfiles_v1', 'pc.aiConsent.v1', 'pc.aiConsent.v2',
    'coachNutritionAssignments_v1', 'coachCustomExercises_v1', 'coachUser',
    'userPlan', 'billingCycle', 'userIsAdmin', '_localAuth',
    'fitnessAppUser', 'currentUser', 'username', 'Username', 'token', 'authToken'
  ];

  // Per-account keys are named `${prefix}${username}` with these separators
  // (e.g. bodyweightLog_ana, tl_checkins_v1_ana, programBuilderV2Draft:ana).
  function belongsToUser(key, username) {
    const lower = key.toLowerCase();
    const name = String(username).toLowerCase();
    return lower.endsWith('_' + name) || lower.endsWith(':' + name);
  }

  function clearLocalStorage(storage, username) {
    if (!storage) return [];
    const keys = [];
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
    const removed = keys.filter((key) =>
      key && (UNSCOPED_KEYS.includes(key) || (username && belongsToUser(key, username))));
    removed.forEach((key) => storage.removeItem(key));
    return removed;
  }

  async function clearLocalAccountData(username) {
    let removedKeys = [];
    try {
      removedKeys = clearLocalStorage(globalScope.localStorage, username);
    } catch (_error) {
      // Storage blocked (private mode) — nothing was stored there either.
    }
    try { globalScope.sessionStorage?.clear(); } catch (_error) { /* same */ }

    let removedPhotos = 0;
    const media = globalScope.posingMediaStore;
    if (username && media?.isAvailable?.() && typeof media.deleteUserPhotos === 'function') {
      try {
        removedPhotos = await media.deleteUserPhotos(username);
      } catch (error) {
        console.warn('[clearLocalAccountData] could not delete progress photos', error);
      }
    }
    return { removedKeys, removedPhotos };
  }

  const api = { clearLocalAccountData, clearLocalStorage, UNSCOPED_KEYS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.clearLocalAccountData = clearLocalAccountData;
})(typeof window !== 'undefined' ? window : globalThis);
