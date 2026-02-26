const DEFAULT_EXERCISE_LIBRARY = [
  { name: "Bench Press", muscle: "Chest" },
  { name: "Incline Dumbbell Press", muscle: "Chest" },
  { name: "Overhead Press", muscle: "Shoulders" },
  { name: "Lateral Raise", muscle: "Shoulders" },
  { name: "Barbell Row", muscle: "Back" },
  { name: "Lat Pulldown", muscle: "Back" },
  { name: "Pull-Up", muscle: "Back" },
  { name: "Barbell Squat", muscle: "Legs" },
  { name: "Romanian Deadlift", muscle: "Legs" },
  { name: "Leg Press", muscle: "Legs" },
  { name: "Biceps Curl", muscle: "Arms" },
  { name: "Triceps Pressdown", muscle: "Arms" },
  { name: "Cable Crunch", muscle: "Core" }
];

const SPLIT_PRESETS = {
  blank: { label: "Start blank", days: [] },
  upperLower: { label: "Upper/Lower (4 days)", days: ["Upper A", "Lower A", "Upper B", "Lower B"] },
  ppl: { label: "PPL (6 days)", days: ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"] },
  fullBody: { label: "Full Body (3 days)", days: ["Full Body A", "Full Body B", "Full Body C"] }
};

function createEl(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (typeof text === "string") element.innerText = text;
  return element;
}

function createDefaultSet() {
  return { reps: "", weight: "" };
}

function createDraftDay(name, index) {
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    exercises: []
  };
}

function initProgramTabV2() {
  const root = document.getElementById("programTabReactRoot");
  if (!root) return;

  const state = {
    step: 1,
    selectedDayId: null,
    splitKey: "blank",
    customDaysPerWeek: 4,
    draft: {
      days: []
    },
    dayEditor: {
      search: "",
      muscle: "All"
    }
  };

  const muscleGroups = ["All", ...new Set(DEFAULT_EXERCISE_LIBRARY.map((exercise) => exercise.muscle))];

  function hydrateDays(dayNames) {
    state.draft.days = dayNames.map((name, index) => createDraftDay(name, index));
    state.selectedDayId = state.draft.days[0]?.id || null;
  }

  function getSelectedDay() {
    return state.draft.days.find((day) => day.id === state.selectedDayId) || null;
  }

  function addExerciseToDay(exerciseName) {
    const selectedDay = getSelectedDay();
    if (!selectedDay) return;

    selectedDay.exercises.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: exerciseName,
      sets: [createDefaultSet()],
      advanced: { rest: "", rpe: "", tempo: "", techniques: "" }
    });

    render();
  }

  function applyPreset(presetKey) {
    state.splitKey = presetKey;
    if (presetKey === "custom") {
      const daysPerWeek = Math.max(1, Math.min(7, Number(state.customDaysPerWeek) || 1));
      const customNames = Array.from({ length: daysPerWeek }, (_, index) => `Day ${index + 1}`);
      hydrateDays(customNames);
    } else {
      hydrateDays(SPLIT_PRESETS[presetKey].days);
    }
    state.step = 2;
    render();
  }

  function handleDayMenu(dayId) {
    const day = state.draft.days.find((item) => item.id === dayId);
    if (!day) return;

    const action = window.prompt("Day action: rename, duplicate, delete", "rename");
    if (!action) return;

    const normalized = action.trim().toLowerCase();

    if (normalized === "rename") {
      const nextName = window.prompt("New day name", day.name);
      if (nextName) day.name = nextName.trim();
    }

    if (normalized === "duplicate") {
      const duplicate = {
        ...day,
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: `${day.name} Copy`,
        exercises: day.exercises.map((exercise) => ({
          ...exercise,
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          sets: exercise.sets.map((setRow) => ({ ...setRow })),
          advanced: { ...exercise.advanced }
        }))
      };
      const index = state.draft.days.findIndex((item) => item.id === dayId);
      state.draft.days.splice(index + 1, 0, duplicate);
    }

    if (normalized === "delete") {
      if (state.draft.days.length <= 1) {
        alert("At least one day is required.");
        return;
      }
      state.draft.days = state.draft.days.filter((item) => item.id !== dayId);
      if (state.selectedDayId === dayId) state.selectedDayId = state.draft.days[0]?.id || null;
    }

    render();
  }

  function renderStepSplit(parent) {
    const card = createEl("div", "program-v2-step");
    card.appendChild(createEl("h3", "", "Step 1 — Pick your split"));
    card.appendChild(createEl("p", "", "Choose a preset to start quickly, or start blank."));

    const splitChoices = createEl("div", "split-choice-grid");

    const blankBtn = createEl("button", "split-choice split-choice-primary", "Start blank");
    blankBtn.onclick = () => applyPreset("blank");
    splitChoices.appendChild(blankBtn);

    ["upperLower", "ppl", "fullBody"].forEach((presetKey) => {
      const presetBtn = createEl("button", "split-choice", SPLIT_PRESETS[presetKey].label);
      presetBtn.onclick = () => applyPreset(presetKey);
      splitChoices.appendChild(presetBtn);
    });

    const customWrap = createEl("div", "split-custom");
    customWrap.appendChild(createEl("span", "", "Custom (choose days/week)"));
    const customInput = createEl("input");
    customInput.type = "number";
    customInput.min = "1";
    customInput.max = "7";
    customInput.value = String(state.customDaysPerWeek);
    customInput.onchange = (event) => {
      state.customDaysPerWeek = Number(event.target.value) || 1;
    };
    const customBtn = createEl("button", "split-choice", "Use custom");
    customBtn.onclick = () => applyPreset("custom");
    customWrap.append(customInput, customBtn);
    splitChoices.appendChild(customWrap);

    card.appendChild(splitChoices);
    parent.appendChild(card);
  }

  function renderStepDays(parent) {
    const wrapper = createEl("div", "program-v2-step");
    wrapper.appendChild(createEl("h3", "", "Step 2 — Build your days"));

    const paneLayout = createEl("div", "v2-pane-layout");
    const leftPane = createEl("div", "v2-pane v2-days-list");
    const middlePane = createEl("div", "v2-pane v2-day-editor");

    const leftHead = createEl("div", "v2-pane-head");
    leftHead.appendChild(createEl("h4", "", "Days"));
    leftPane.appendChild(leftHead);

    state.draft.days.forEach((day) => {
      const row = createEl("div", `day-row ${day.id === state.selectedDayId ? "is-active" : ""}`);
      const title = createEl("button", "day-row-main", `${day.name} (${day.exercises.length} exercises)`);
      title.onclick = () => {
        state.selectedDayId = day.id;
        render();
      };
      const menuBtn = createEl("button", "day-menu", "⋯");
      menuBtn.title = "Rename / duplicate / delete";
      menuBtn.onclick = () => handleDayMenu(day.id);
      row.append(title, menuBtn);
      leftPane.appendChild(row);
    });

    const addDayBtn = createEl("button", "add-day", "+ Add day");
    addDayBtn.onclick = () => {
      const nextName = `Day ${state.draft.days.length + 1}`;
      const newDay = createDraftDay(nextName, state.draft.days.length + 1);
      state.draft.days.push(newDay);
      state.selectedDayId = newDay.id;
      render();
    };
    leftPane.appendChild(addDayBtn);

    const selectedDay = getSelectedDay();
    if (!selectedDay) {
      middlePane.appendChild(createEl("p", "", "Select or create a day to begin."));
    } else {
      middlePane.appendChild(createEl("h4", "", selectedDay.name));

      const controls = createEl("div", "exercise-controls");
      const search = createEl("input");
      search.placeholder = "Exercise search";
      search.value = state.dayEditor.search;
      search.oninput = (event) => {
        state.dayEditor.search = event.target.value;
        render();
      };

      const muscleSelect = createEl("select");
      muscleGroups.forEach((group) => {
        const option = createEl("option");
        option.value = group;
        option.innerText = group;
        option.selected = group === state.dayEditor.muscle;
        muscleSelect.appendChild(option);
      });
      muscleSelect.onchange = (event) => {
        state.dayEditor.muscle = event.target.value;
        render();
      };

      controls.append(search, muscleSelect);
      middlePane.appendChild(controls);

      const exerciseList = createEl("div", "exercise-library");
      const results = DEFAULT_EXERCISE_LIBRARY.filter((exercise) => {
        const matchesSearch = exercise.name.toLowerCase().includes(state.dayEditor.search.trim().toLowerCase());
        const matchesMuscle = state.dayEditor.muscle === "All" || exercise.muscle === state.dayEditor.muscle;
        return matchesSearch && matchesMuscle;
      });

      results.forEach((exercise) => {
        const row = createEl("div", "exercise-library-row");
        row.appendChild(createEl("span", "", `${exercise.name} • ${exercise.muscle}`));
        const addBtn = createEl("button", "", "Add");
        addBtn.onclick = () => addExerciseToDay(exercise.name);
        row.appendChild(addBtn);
        exerciseList.appendChild(row);
      });
      middlePane.appendChild(exerciseList);

      const selectedTitle = createEl("h5", "", "Selected exercises");
      middlePane.appendChild(selectedTitle);

      selectedDay.exercises.forEach((exercise) => {
        const card = createEl("details", "exercise-card");
        card.open = true;

        const summary = createEl("summary", "", exercise.name);
        card.appendChild(summary);

        const setsTable = createEl("table", "sets-table");
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        ["Set", "Reps", "Weight"].forEach((label) => headRow.appendChild(createEl("th", "", label)));
        head.appendChild(headRow);
        setsTable.appendChild(head);

        const body = document.createElement("tbody");
        exercise.sets.forEach((setRow, index) => {
          const row = document.createElement("tr");
          row.appendChild(createEl("td", "", String(index + 1)));

          const repsCell = document.createElement("td");
          const repsInput = createEl("input");
          repsInput.type = "number";
          repsInput.min = "1";
          repsInput.value = setRow.reps;
          repsInput.oninput = (event) => {
            setRow.reps = event.target.value;
          };
          repsCell.appendChild(repsInput);
          row.appendChild(repsCell);

          const weightCell = document.createElement("td");
          const weightInput = createEl("input");
          weightInput.type = "number";
          weightInput.min = "0";
          weightInput.value = setRow.weight;
          weightInput.oninput = (event) => {
            setRow.weight = event.target.value;
          };
          weightCell.appendChild(weightInput);
          row.appendChild(weightCell);

          body.appendChild(row);
        });
        setsTable.appendChild(body);
        card.appendChild(setsTable);

        const addSetBtn = createEl("button", "", "Add set");
        addSetBtn.onclick = () => {
          exercise.sets.push(createDefaultSet());
          render();
        };
        card.appendChild(addSetBtn);

        const advanced = createEl("details", "advanced-accordion");
        const advancedSummary = createEl("summary", "", "Advanced (RPE / rest / tempo / techniques)");
        advanced.appendChild(advancedSummary);

        [
          ["RPE", "rpe"],
          ["Rest (seconds)", "rest"],
          ["Tempo", "tempo"],
          ["Techniques", "techniques"]
        ].forEach(([label, key]) => {
          const row = createEl("label", "advanced-field");
          row.appendChild(createEl("span", "", label));
          const input = createEl("input");
          input.value = exercise.advanced[key];
          input.oninput = (event) => {
            exercise.advanced[key] = event.target.value;
          };
          row.appendChild(input);
          advanced.appendChild(row);
        });

        card.appendChild(advanced);
        middlePane.appendChild(card);
      });
    }

    paneLayout.append(leftPane, middlePane);
    wrapper.appendChild(paneLayout);

    const footerActions = createEl("div", "v2-footer");
    const backBtn = createEl("button", "", "Back to split");
    backBtn.onclick = () => {
      state.step = 1;
      render();
    };
    footerActions.appendChild(backBtn);
    wrapper.appendChild(footerActions);

    parent.appendChild(wrapper);
  }

  function render() {
    root.innerHTML = "";
    const app = createEl("div", "program-tab-v2");
    const heading = createEl("h2", "", "Program Builder V2");
    app.appendChild(heading);

    if (state.step === 1) renderStepSplit(app);
    if (state.step === 2) renderStepDays(app);

    root.appendChild(app);
  }

  render();
}

window.initProgramTab = initProgramTabV2;
window.initProgramTabV2 = initProgramTabV2;

initProgramTabV2();
