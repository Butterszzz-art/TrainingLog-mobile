(function (global, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory(global || globalThis);
  } else {
    const api = factory(global || globalThis);
    if (global) {
      global.CrossFitModule = api;
    }
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function (global) {
  const STORAGE_KEY = "crossfitWorkouts";
  let crossfitExercises = [];

  function isBrowser() {
    return Boolean(global && global.document);
  }

  function getElement(id) {
    if (!isBrowser()) return null;
    return global.document.getElementById(id);
  }

  function getFirstExistingElement(ids) {
    if (!isBrowser()) return null;
    for (const id of ids) {
      const el = getElement(id);
      if (el) return el;
    }
    return null;
  }

  function getInputValue(id) {
    const el = getElement(id);
    if (!el) return "";
    return typeof el.value === "string" ? el.value : "";
  }

  function setInputValue(id, value) {
    const el = getElement(id);
    if (!el) return;
    el.value = value;
  }

  function parseInteger(value) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function loadSavedWorkouts() {
    if (!global || !global.localStorage) return [];
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Failed to load CrossFit workouts", error);
      return [];
    }
  }

  function persistWorkouts(workouts) {
    if (!global || !global.localStorage) return;
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(workouts));
    } catch (error) {
      console.error("Failed to save CrossFit workouts", error);
    }
  }

  function cloneExercise(exercise) {
    return {
      name: exercise.name || "",
      sets: Number(exercise.sets) || 0,
      reps: Number(exercise.reps) || 0,
      weight: Number(exercise.weight) || 0,
      notes: exercise.notes || "",
    };
  }

  function getCrossFitExercises() {
    return crossfitExercises.map(cloneExercise);
  }

  function setCrossFitExercises(exercises) {
    crossfitExercises = Array.isArray(exercises)
      ? exercises.map(cloneExercise)
      : [];
    renderCrossFitExerciseList();
    return getCrossFitExercises();
  }

  function addCrossFitExercise(exercise) {
    if (!exercise || typeof exercise !== "object") return getCrossFitExercises();
    crossfitExercises.push(cloneExercise(exercise));
    renderCrossFitExerciseList();
    return getCrossFitExercises();
  }

  function removeCrossFitExercise(index) {
    if (typeof index !== "number") return getCrossFitExercises();
    if (index < 0 || index >= crossfitExercises.length) return getCrossFitExercises();
    crossfitExercises.splice(index, 1);
    renderCrossFitExerciseList();
    return getCrossFitExercises();
  }

  function renderCrossFitExerciseList() {
    const container = getFirstExistingElement([
      "crossfitExerciseList",
      "crossfitExercisesList",
    ]);
    if (!container) return;

    if (!crossfitExercises.length) {
      container.innerHTML = "<p class=\"empty-state\">No exercises added yet.</p>";
      return;
    }

    container.innerHTML = crossfitExercises
      .map((exercise, index) => {
        const weight = exercise.weight ? ` @ ${exercise.weight}kg` : "";
        const notes = exercise.notes ? `<div class=\"notes\">${exercise.notes}</div>` : "";
        return `
          <div class="crossfit-exercise" data-index="${index}">
            <div class="summary">
              <strong>${exercise.name}</strong>
              <span>${exercise.sets} x ${exercise.reps}${weight}</span>
            </div>
            ${notes}
            <button type="button" class="remove-btn" data-index="${index}">Remove</button>
          </div>
        `;
      })
      .join("");

    Array.from(container.querySelectorAll(".remove-btn")).forEach((button) => {
      button.addEventListener("click", (event) => {
        const idx = parseInt(event.currentTarget.getAttribute("data-index"), 10);
        removeCrossFitExercise(Number.isNaN(idx) ? -1 : idx);
      });
    });
  }

  function renderSavedCrossFitWorkouts() {
    const container = getFirstExistingElement([
      "savedCrossfitWorkouts",
      "savedCrossFitWorkouts",
      "crossfitSavedWorkouts",
    ]);
    if (!container) return;

    const workouts = loadSavedWorkouts();

    if (!workouts.length) {
      container.innerHTML = "<p class=\"empty-state\">No CrossFit workouts saved yet.</p>";
      return;
    }

    container.innerHTML = workouts
      .map((workout, index) => {
        const timeParts = [];
        if (workout.time && (workout.time.minutes || workout.time.seconds)) {
          if (workout.time.minutes) timeParts.push(`${workout.time.minutes}m`);
          if (workout.time.seconds) timeParts.push(`${workout.time.seconds}s`);
        }
        const timeDisplay = timeParts.length ? timeParts.join(" ") : "-";
        const roundsDisplay = typeof workout.rounds === "number" && workout.rounds > 0 ? workout.rounds : "-";
        const notesDisplay = workout.notes ? workout.notes : "-";
        const exercisesList = Array.isArray(workout.exercises)
          ? workout.exercises
              .map((exercise) => {
                const weight = exercise.weight ? ` @ ${exercise.weight}kg` : "";
                return `<li><strong>${exercise.name}</strong>: ${exercise.sets} x ${exercise.reps}${weight}</li>`;
              })
              .join("")
          : "";

        return `
          <article class="crossfit-workout" data-index="${index}">
            <header>
              <h4>${workout.name || "Untitled WOD"}</h4>
            </header>
            <div class="details">
              <div><strong>Time:</strong> ${timeDisplay}</div>
              <div><strong>Rounds:</strong> ${roundsDisplay}</div>
              <div><strong>Notes:</strong> ${notesDisplay}</div>
            </div>
            <ul class="exercise-list">${exercisesList}</ul>
          </article>
        `;
      })
      .join("");
  }

  function resetCrossFitForm() {
    setInputValue("crossfitName", "");
    setInputValue("crossfitTimeMin", "");
    setInputValue("crossfitTimeSec", "");
    setInputValue("crossfitRounds", "");
    setInputValue("crossfitNotes", "");
    crossfitExercises = [];
    renderCrossFitExerciseList();
  }

  function showToast(message) {
    if (global && typeof global.showToast === "function") {
      global.showToast(message);
    } else if (global && typeof global.alert === "function") {
      global.alert(message);
    } else {
      console.log(message);
    }
  }

  function saveCrossFitWorkout() {
    const workout = {
      name: getInputValue("crossfitName").trim(),
      time: {
        minutes: parseInteger(getInputValue("crossfitTimeMin")),
        seconds: parseInteger(getInputValue("crossfitTimeSec")),
      },
      rounds: parseInteger(getInputValue("crossfitRounds")),
      notes: getInputValue("crossfitNotes"),
      exercises: getCrossFitExercises(),
    };

    const stored = loadSavedWorkouts();
    stored.push(workout);
    persistWorkouts(stored);
    renderSavedCrossFitWorkouts();
    resetCrossFitForm();
    showToast("CrossFit workout saved");

    return workout;
  }

  if (global) {
    global.saveCrossFitWorkout = saveCrossFitWorkout;
    global.renderSavedCrossFitWorkouts = renderSavedCrossFitWorkouts;
    global.resetCrossFitForm = resetCrossFitForm;
    global.addCrossFitExercise = addCrossFitExercise;
    global.removeCrossFitExercise = removeCrossFitExercise;
  }

  if (isBrowser()) {
    const ready = () => {
      renderSavedCrossFitWorkouts();
      renderCrossFitExerciseList();
    };
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", ready);
    } else {
      ready();
    }
  }

  return {
    saveCrossFitWorkout,
    renderSavedCrossFitWorkouts,
    resetCrossFitForm,
    addCrossFitExercise,
    removeCrossFitExercise,
    setCrossFitExercises,
    getCrossFitExercises,
  };
});
