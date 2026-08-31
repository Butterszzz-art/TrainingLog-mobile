/**
 * customExercises.js
 *
 * Backs the "Advanced" tab in Settings: lets a lifter type an exercise name
 * (brand new, or one already in their log) and assign its muscle group by
 * hand. This exists because the normal exercise-entry field is now
 * constrained to the known catalog (exerciseMuscleMap.js's ~1,000 names +
 * whatever's been created here) — see updateExerciseSuggestions() /
 * updateAddButtonState() in index.html. Anything a lifter needs that isn't
 * in that catalog goes through here instead of silently free-typing
 * something that would fall into the 'other' bucket in the volume block.
 *
 * Storage: one localStorage array per user, `customExercises_<user>`,
 * each entry `{ name, muscleGroup, createdAt }`. A custom assignment takes
 * priority over the built-in map (see exerciseMuscleMap.js's
 * setCustomExerciseMuscleMap) — so this doubles as a fix for a specific
 * exercise this app already grouped in a way the user disagrees with.
 */
(function (global) {
  'use strict';

  // Fine-grained muscle groups this app understands (matches the values
  // exerciseMuscleMap.js's hand-curated table and getMuscleGroup() use).
  // 'legs' and 'other' are intentionally excluded — they're internal
  // catch-alls, not something a user should hand-pick.
  const CUSTOM_MUSCLE_GROUPS = [
    { value: 'chest', label: 'Chest' },
    { value: 'back', label: 'Back' },
    { value: 'shoulders', label: 'Shoulders' },
    { value: 'traps', label: 'Traps' },
    { value: 'biceps', label: 'Biceps' },
    { value: 'triceps', label: 'Triceps' },
    { value: 'forearms', label: 'Forearms' },
    { value: 'quads', label: 'Quads' },
    { value: 'hamstrings', label: 'Hamstrings' },
    { value: 'glutes', label: 'Glutes' },
    { value: 'calves', label: 'Calves' },
    { value: 'abductors', label: 'Abductors (outer hip)' },
    { value: 'adductors', label: 'Adductors (inner thigh)' },
    { value: 'abs', label: 'Abs / Core' }
  ];
  const VALID_MUSCLE_GROUPS = new Set(CUSTOM_MUSCLE_GROUPS.map((g) => g.value));

  function customExerciseKey(user) {
    return `customExercises_${user}`;
  }

  function loadCustomExercises(user) {
    if (!user || typeof localStorage === 'undefined') return [];
    try {
      const data = JSON.parse(localStorage.getItem(customExerciseKey(user)));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function persistCustomExercises(user, list) {
    if (!user || typeof localStorage === 'undefined') return;
    localStorage.setItem(customExerciseKey(user), JSON.stringify(list));
  }

  function getCustomMuscleMapObject(user) {
    return Object.fromEntries(
      loadCustomExercises(user).map((entry) => [String(entry.name || '').toLowerCase(), entry.muscleGroup])
    );
  }

  // Pushes this user's saved overrides into exerciseMuscleMap.js's runtime
  // resolver so getMuscleGroup() picks them up immediately (no reload).
  function refreshRuntimeMuscleMap(user) {
    if (typeof global.setCustomExerciseMuscleMap === 'function') {
      global.setCustomExerciseMuscleMap(getCustomMuscleMapObject(user));
    }
  }

  function saveCustomExercise(user, name, muscleGroup) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!user) return { ok: false, error: 'No active user.' };
    if (!trimmedName) return { ok: false, error: 'Enter an exercise name.' };
    if (!VALID_MUSCLE_GROUPS.has(muscleGroup)) return { ok: false, error: 'Pick a muscle group.' };

    const list = loadCustomExercises(user);
    const lower = trimmedName.toLowerCase();
    const existingIndex = list.findIndex((entry) => String(entry.name || '').toLowerCase() === lower);
    const record = { name: trimmedName, muscleGroup, createdAt: new Date().toISOString() };
    if (existingIndex >= 0) {
      list[existingIndex] = record;
    } else {
      list.push(record);
    }
    persistCustomExercises(user, list);
    refreshRuntimeMuscleMap(user);

    // Also drop it into the regular per-user exercise history so it shows
    // up in the normal log-entry autocomplete right away.
    if (typeof global.saveUserExercise === 'function') {
      global.saveUserExercise(trimmedName);
    }

    return { ok: true, list };
  }

  function removeCustomExercise(user, name) {
    if (!user) return [];
    const lower = String(name || '').toLowerCase();
    const list = loadCustomExercises(user).filter((entry) => String(entry.name || '').toLowerCase() !== lower);
    persistCustomExercises(user, list);
    refreshRuntimeMuscleMap(user);
    return list;
  }

  // ── Settings → Advanced UI wiring ──────────────────────────────────────

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function muscleGroupLabel(value) {
    const found = CUSTOM_MUSCLE_GROUPS.find((g) => g.value === value);
    return found ? found.label : value;
  }

  function renderCustomExerciseList(user) {
    const listEl = document.getElementById('customExerciseList');
    if (!listEl) return;
    const entries = loadCustomExercises(user);
    if (!entries.length) {
      listEl.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);margin:0;">No custom assignments yet.</p>';
      return;
    }
    listEl.innerHTML = entries
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `
        <div class="custom-exercise-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-color);">
          <span style="font-size:0.9rem;">${escapeHtml(entry.name)} <span style="color:var(--secondary-text);">— ${escapeHtml(muscleGroupLabel(entry.muscleGroup))}</span></span>
          <button type="button" class="secondary" data-remove-custom-exercise="${escapeHtml(entry.name)}" style="padding:4px 10px;font-size:0.78rem;">Remove</button>
        </div>
      `)
      .join('');
  }

  function populateMuscleGroupSelect(selectEl) {
    if (!selectEl || selectEl.dataset.populated === 'true') return;
    selectEl.dataset.populated = 'true';
    selectEl.innerHTML = '<option value="">Select muscle group…</option>' +
      CUSTOM_MUSCLE_GROUPS.map((g) => `<option value="${g.value}">${g.label}</option>`).join('');
  }

  function populateNameSuggestions(datalistEl) {
    if (!datalistEl) return;
    const names = typeof global.getAllExerciseNames === 'function' ? global.getAllExerciseNames() : [];
    datalistEl.innerHTML = Array.from(new Set(names)).map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

  function getActiveUser() {
    return global.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser')) || null;
  }

  function handleSaveCustomExercise() {
    const nameInput = document.getElementById('customExerciseName');
    const groupSelect = document.getElementById('customExerciseMuscleGroup');
    const feedback = document.getElementById('customExerciseFeedback');
    if (!nameInput || !groupSelect) return;

    const user = getActiveUser();
    const result = saveCustomExercise(user, nameInput.value, groupSelect.value);

    if (!result.ok) {
      if (feedback) {
        feedback.textContent = result.error;
        feedback.style.color = 'var(--danger)';
      }
      return;
    }

    if (feedback) {
      feedback.textContent = `Saved — "${nameInput.value.trim()}" now counts toward ${muscleGroupLabel(groupSelect.value)}.`;
      feedback.style.color = 'var(--secondary-text)';
    }
    nameInput.value = '';
    groupSelect.value = '';
    renderCustomExerciseList(user);

    // The main log form's exercise suggestions/datalist need to know about
    // this new name immediately so it's selectable without a reload.
    if (typeof global.updateExerciseSuggestions === 'function') global.updateExerciseSuggestions();
  }

  function initCustomExerciseManager() {
    const saveBtn = document.getElementById('customExerciseSaveBtn');
    const nameList = document.getElementById('customExerciseNameSuggestions');
    const groupSelect = document.getElementById('customExerciseMuscleGroup');
    const listContainer = document.getElementById('customExerciseList');
    if (!saveBtn || !listContainer) return; // markup not present in this build

    populateMuscleGroupSelect(groupSelect);
    populateNameSuggestions(nameList);
    renderCustomExerciseList(getActiveUser());

    if (saveBtn.dataset.bound !== 'true') {
      saveBtn.dataset.bound = 'true';
      saveBtn.addEventListener('click', handleSaveCustomExercise);
    }
    if (listContainer.dataset.bound !== 'true') {
      listContainer.dataset.bound = 'true';
      listContainer.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-remove-custom-exercise]');
        if (!btn) return;
        const user = getActiveUser();
        removeCustomExercise(user, btn.getAttribute('data-remove-custom-exercise'));
        renderCustomExerciseList(user);
        if (typeof global.updateExerciseSuggestions === 'function') global.updateExerciseSuggestions();
      });
    }
  }

  if (typeof module !== 'undefined') {
    module.exports = {
      CUSTOM_MUSCLE_GROUPS,
      loadCustomExercises,
      saveCustomExercise,
      removeCustomExercise,
      getCustomMuscleMapObject
    };
  }
  if (typeof window !== 'undefined') {
    window.CUSTOM_MUSCLE_GROUPS = CUSTOM_MUSCLE_GROUPS;
    window.loadCustomExercises = loadCustomExercises;
    window.saveCustomExercise = saveCustomExercise;
    window.removeCustomExercise = removeCustomExercise;
    window.getCustomMuscleMapObject = getCustomMuscleMapObject;
    window.initCustomExerciseManager = initCustomExerciseManager;
  }
})(typeof window !== 'undefined' ? window : globalThis);
