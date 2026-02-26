const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_TO_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const HISTORY_KEYS = ["workoutHistory", "resistanceLogs", "tl_workout_history_v1"];

const GOAL_LIBRARY = {
  strength: { label: "Strength", sets: 4, reps: 5, intensity: 0.82 },
  hypertrophy: { label: "Hypertrophy", sets: 4, reps: 10, intensity: 0.7 },
  endurance: { label: "Endurance", sets: 3, reps: 15, intensity: 0.6 }
};

const PERIODISATION_LIBRARY = {
  linear: {
    label: "Linear",
    pattern: [
      { volume: 1.08, intensity: 0.92, focus: "Foundation" },
      { volume: 1.04, intensity: 0.96, focus: "Build" },
      { volume: 1.0, intensity: 1.0, focus: "Build" },
      { volume: 0.95, intensity: 1.04, focus: "Peak" },
      { volume: 0.78, intensity: 0.86, focus: "Deload" }
    ]
  },
  undulating: {
    label: "Undulating",
    pattern: [
      { volume: 1.08, intensity: 0.9, focus: "Volume" },
      { volume: 0.96, intensity: 1.04, focus: "Intensity" },
      { volume: 1.02, intensity: 0.96, focus: "Power" },
      { volume: 0.88, intensity: 1.08, focus: "Top set" },
      { volume: 0.8, intensity: 0.86, focus: "Deload" }
    ]
  },
  block: {
    label: "Block",
    pattern: [
      { volume: 1.15, intensity: 0.88, focus: "Accumulation" },
      { volume: 1.1, intensity: 0.92, focus: "Accumulation" },
      { volume: 0.96, intensity: 1.02, focus: "Intensification" },
      { volume: 0.88, intensity: 1.07, focus: "Realisation" },
      { volume: 0.76, intensity: 0.84, focus: "Deload" }
    ]
  },
  conjugate: {
    label: "Conjugate",
    pattern: [
      { volume: 1.0, intensity: 1.04, focus: "Max effort" },
      { volume: 1.12, intensity: 0.9, focus: "Dynamic effort" },
      { volume: 1.06, intensity: 0.95, focus: "Repeated effort" },
      { volume: 0.94, intensity: 1.06, focus: "Variation peak" },
      { volume: 0.8, intensity: 0.86, focus: "Deload" }
    ]
  }
};

const loadPrograms = () => JSON.parse(localStorage.getItem("programs") || "[]");
const savePrograms = (programs) => localStorage.setItem("programs", JSON.stringify(programs));

function parseArrayFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function loadWorkoutHistory() {
  return HISTORY_KEYS.flatMap(parseArrayFromStorage);
}

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildVarietyRecommendations(frequency) {
  if (!window.exerciseVarietyEngine || typeof window.exerciseVarietyEngine.buildProgramVarietyRecommendations !== "function") {
    return null;
  }

  const recommendations = window.exerciseVarietyEngine.buildProgramVarietyRecommendations(loadWorkoutHistory());
  const suggestions = Object.entries(recommendations.suggestedVarietyExercises || {}).flatMap(([muscle, list]) =>
    (Array.isArray(list) ? list : []).map((name) => ({ muscle, name }))
  );

  return {
    ...recommendations,
    autoInsertedExercises: suggestions.map((item, index) => ({
      day: frequency[index % Math.max(1, frequency.length)] || null,
      muscle: item.muscle,
      exercise: item.name
    }))
  };
}

function normalizeDate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().split("T")[0];
}

function nextDateForWeekday(anchorDate, weekdayLabel) {
  const date = new Date(anchorDate);
  const target = DAY_TO_INDEX[weekdayLabel];
  const diff = (target - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return date;
}

function generatePeriodisedWeeks({ goalKey, schemeKey, weeks, baseLoad }) {
  const goal = GOAL_LIBRARY[goalKey] || GOAL_LIBRARY.strength;
  const scheme = PERIODISATION_LIBRARY[schemeKey] || PERIODISATION_LIBRARY.linear;

  return Array.from({ length: weeks }, (_, index) => {
    const slot = scheme.pattern[index % scheme.pattern.length];
    const targetSets = Math.max(2, Math.round(goal.sets * slot.volume));
    const totalVolume = targetSets * goal.reps;
    const intensityPct = Math.round(goal.intensity * slot.intensity * 100);
    const suggestedLoad = Math.round(baseLoad * goal.intensity * slot.intensity * 10) / 10;

    return {
      week: index + 1,
      focus: slot.focus,
      sets: targetSets,
      reps: goal.reps,
      intensityPct,
      totalVolume,
      suggestedLoad
    };
  });
}

function generateSessions(startDate, frequency, generatedWeeks, goalKey, schemeKey, baseLoad) {
  if (!startDate || !Array.isArray(frequency) || !frequency.length) return [];

  const firstStart = new Date(startDate);
  const sessions = [];

  generatedWeeks.forEach((weekInfo, weekIndex) => {
    const weekStart = new Date(firstStart);
    weekStart.setDate(firstStart.getDate() + weekIndex * 7);

    frequency.forEach((weekday, dayIndex) => {
      const date = nextDateForWeekday(weekStart, weekday);
      if (date < weekStart) date.setDate(date.getDate() + 7);

      sessions.push({
        id: `${weekInfo.week}-${weekday}`,
        date: normalizeDate(date),
        dayName: `${weekday} · W${weekInfo.week}`,
        title: `${GOAL_LIBRARY[goalKey].label} ${PERIODISATION_LIBRARY[schemeKey].label}`,
        focus: weekInfo.focus,
        sets: weekInfo.sets,
        reps: weekInfo.reps,
        load: weekInfo.suggestedLoad,
        intensityPct: weekInfo.intensityPct,
        volume: weekInfo.totalVolume,
        goal: goalKey,
        sequence: dayIndex + 1,
        baseline1RM: baseLoad
      });
    });
  });

  return sessions.sort((a, b) => a.date.localeCompare(b.date));
}

function syncProgramToExistingScheduling(programName, sessions) {
  const currentUser = window.currentUser || localStorage.getItem("username") || localStorage.getItem("Username");
  if (!currentUser || !Array.isArray(sessions) || !sessions.length) return;

  const workoutsKey = `workouts_${currentUser}`;
  const workouts = JSON.parse(localStorage.getItem(workoutsKey) || "[]");
  const existingDates = new Set(workouts.map((w) => w && w.date));

  sessions.forEach((session) => {
    if (existingDates.has(session.date)) return;
    workouts.push({
      id: `program-${Date.now()}-${session.id}`,
      date: session.date,
      title: `${programName} · ${session.dayName}`,
      notes: `${session.focus} week • ${session.intensityPct}% intensity target`,
      log: [
        {
          exercise: "Primary Lift",
          sets: session.sets,
          repGoal: session.reps,
          goal: session.load,
          unit: "kg",
          weightsArray: Array(session.sets).fill(session.load),
          repsArray: Array(session.sets).fill(session.reps)
        }
      ]
    });
    existingDates.add(session.date);
  });

  localStorage.setItem(workoutsKey, JSON.stringify(workouts));

  if (typeof window.updateTrainingCalendar === "function") window.updateTrainingCalendar();
  if (typeof window.scheduleStreakReminderJob === "function") window.scheduleStreakReminderJob();
}

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (typeof text === "string") el.innerText = text;
  return el;
}

function initProgramTab() {
  const root = document.getElementById("programTabReactRoot");
  if (!root) return;

  const state = {
    programs: loadPrograms(),
    showDrawer: false,
    showShare: false,
    shareId: null,
    program: {
      name: "",
      startDate: "",
      frequency: [],
      progressionType: "linear",
      splitMode: "synchronous",
      autoInsertVariety: false,
      wizard: { goal: "strength", scheme: "linear", weeks: 8, baseLoad: 100 },
      generatedWeeks: [],
      generatedSessions: [],
      days: []
    }
  };

  function toggleFrequency(day) {
    const frequency = state.program.frequency.includes(day)
      ? state.program.frequency.filter((d) => d !== day)
      : [...state.program.frequency, day];
    state.program.frequency = frequency;
    render();
  }

  function runWizard() {
    const generatedWeeks = generatePeriodisedWeeks({
      goalKey: state.program.wizard.goal,
      schemeKey: state.program.wizard.scheme,
      weeks: Number(state.program.wizard.weeks) || 8,
      baseLoad: Number(state.program.wizard.baseLoad) || 100
    });

    const generatedSessions = generateSessions(
      state.program.startDate,
      state.program.frequency,
      generatedWeeks,
      state.program.wizard.goal,
      state.program.wizard.scheme,
      Number(state.program.wizard.baseLoad) || 100
    );

    state.program.generatedWeeks = generatedWeeks;
    state.program.generatedSessions = generatedSessions;
    state.program.progressionType = state.program.wizard.scheme;
    state.program.days = generatedSessions.map((session, index) => ({
      name: `${session.dayName} · ${session.focus} (${session.sets}x${session.reps} @ ${session.intensityPct}%)`,
      order: index + 1
    }));
    render();
  }

  async function saveProgram() {
    if (!state.program.name || !state.program.startDate || !state.program.frequency.length) {
      alert("Please set program name, start date, and frequency before saving.");
      return;
    }

    const payload = {
      id: Date.now(),
      name: state.program.name,
      startDate: state.program.startDate,
      frequency: state.program.frequency,
      progressionType: state.program.progressionType,
      splitMode: state.program.splitMode,
      days: state.program.days,
      generatedWeeks: state.program.generatedWeeks,
      generatedSessions: state.program.generatedSessions,
      varietySettings: { autoInsertSuggestions: state.program.autoInsertVariety }
    };

    const recommendations = buildVarietyRecommendations(state.program.frequency);
    if (recommendations) {
      payload.recommendations = recommendations;
      if (state.program.autoInsertVariety) payload.autoInsertedExercises = recommendations.autoInsertedExercises;
    }

    state.programs = [...state.programs, payload];
    savePrograms(state.programs);
    if (Array.isArray(state.program.generatedSessions) && state.program.generatedSessions.length) {
      syncProgramToExistingScheduling(state.program.name, state.program.generatedSessions);
    }

    if (window.SERVER_URL) {
      try {
        await fetch(`${window.SERVER_URL}/saveProgram`, {
          credentials: "include",
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify(payload)
        });
      } catch (_error) {
        // Local save is still authoritative.
      }
    }

    state.showDrawer = false;
    render();
  }

  async function shareProgram(username) {
    if (!state.shareId || !username || !window.SERVER_URL) {
      state.showShare = false;
      render();
      return;
    }
    await fetch(`${window.SERVER_URL}/shareProgram`, {
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ programId: state.shareId, recipientUsername: username })
    });
    state.showShare = false;
    render();
  }

  function renderPreview(parent) {
    if (!state.program.generatedWeeks.length) return;
    const wrapper = createEl("div", "wizard-preview");
    wrapper.appendChild(createEl("h4", "", "Generated Weekly Targets"));
    const table = createEl("table", "calendar-preview");
    const head = document.createElement("thead");
    const row = document.createElement("tr");
    ["Week", "Focus", "Sets×Reps", "Intensity", "Load", "Volume"].forEach((col) => {
      row.appendChild(createEl("th", "", col));
    });
    head.appendChild(row);
    table.appendChild(head);

    const body = document.createElement("tbody");
    state.program.generatedWeeks.forEach((item) => {
      const tr = document.createElement("tr");
      [
        `W${item.week}`,
        item.focus,
        `${item.sets}×${item.reps}`,
        `${item.intensityPct}%`,
        `${item.suggestedLoad} kg`,
        String(item.totalVolume)
      ].forEach((cell) => tr.appendChild(createEl("td", "", cell)));
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrapper.appendChild(table);
    parent.appendChild(wrapper);
  }

  function render() {
    root.innerHTML = "";
    const app = createEl("div", "program-tab-react");

    const newButton = createEl("button", "", "New Program");
    newButton.onclick = () => {
      state.showDrawer = true;
      render();
    };
    app.appendChild(newButton);

    const list = createEl("div", "program-list");
    state.programs.forEach((program) => {
      const row = createEl("div", "program-row");
      row.appendChild(createEl("span", "", program.name));
      const shareButton = createEl("button", "", "Share Program");
      shareButton.onclick = () => {
        state.shareId = program.id;
        state.showShare = true;
        render();
      };
      row.appendChild(shareButton);
      list.appendChild(row);
    });
    app.appendChild(list);

    if (state.showDrawer) {
      const drawer = createEl("div", "drawer");
      drawer.appendChild(createEl("h3", "", "Create Program"));

      const name = createEl("input");
      name.value = state.program.name;
      name.placeholder = "Program name";
      name.oninput = (e) => (state.program.name = e.target.value);
      drawer.appendChild(name);

      const start = createEl("input");
      start.type = "date";
      start.value = state.program.startDate;
      start.onchange = (e) => (state.program.startDate = e.target.value);
      drawer.appendChild(start);

      const freq = createEl("div", "frequency-grid");
      DAYS.forEach((day) => {
        const label = createEl("label");
        const check = createEl("input");
        check.type = "checkbox";
        check.checked = state.program.frequency.includes(day);
        check.onchange = () => toggleFrequency(day);
        label.append(check, document.createTextNode(` ${day}`));
        freq.appendChild(label);
      });
      drawer.appendChild(freq);

      const wizardRow = createEl("div");
      const goalSelect = createEl("select");
      Object.entries(GOAL_LIBRARY).forEach(([key, value]) => {
        const option = createEl("option");
        option.value = key;
        option.innerText = value.label;
        option.selected = key === state.program.wizard.goal;
        goalSelect.appendChild(option);
      });
      goalSelect.onchange = (e) => (state.program.wizard.goal = e.target.value);
      wizardRow.appendChild(goalSelect);

      const schemeSelect = createEl("select");
      Object.entries(PERIODISATION_LIBRARY).forEach(([key, value]) => {
        const option = createEl("option");
        option.value = key;
        option.innerText = value.label;
        option.selected = key === state.program.wizard.scheme;
        schemeSelect.appendChild(option);
      });
      schemeSelect.onchange = (e) => (state.program.wizard.scheme = e.target.value);
      wizardRow.appendChild(schemeSelect);
      drawer.appendChild(wizardRow);

      const weeksInput = createEl("input");
      weeksInput.type = "number";
      weeksInput.min = "1";
      weeksInput.max = "24";
      weeksInput.value = String(state.program.wizard.weeks);
      weeksInput.onchange = (e) => (state.program.wizard.weeks = Number(e.target.value) || 1);
      drawer.appendChild(weeksInput);

      const baseLoadInput = createEl("input");
      baseLoadInput.type = "number";
      baseLoadInput.min = "1";
      baseLoadInput.value = String(state.program.wizard.baseLoad);
      baseLoadInput.onchange = (e) => (state.program.wizard.baseLoad = Number(e.target.value) || 1);
      drawer.appendChild(baseLoadInput);

      const autoVarietyLabel = createEl("label");
      const autoVariety = createEl("input");
      autoVariety.type = "checkbox";
      autoVariety.checked = state.program.autoInsertVariety;
      autoVariety.onchange = (e) => (state.program.autoInsertVariety = e.target.checked);
      autoVarietyLabel.append(autoVariety, document.createTextNode(" Auto-insert variety suggestions"));
      drawer.appendChild(autoVarietyLabel);

      const runButton = createEl("button", "", "Auto-generate Schedule");
      runButton.onclick = runWizard;
      drawer.appendChild(runButton);

      renderPreview(drawer);

      const days = createEl("div", "day-order");
      state.program.days.forEach((day) => {
        days.appendChild(createEl("div", "day-card", day.name));
      });
      drawer.appendChild(days);

      const actions = createEl("div");
      const saveBtn = createEl("button", "", "Save Program");
      saveBtn.onclick = saveProgram;
      const closeBtn = createEl("button", "", "Close");
      closeBtn.onclick = () => {
        state.showDrawer = false;
        render();
      };
      actions.append(saveBtn, closeBtn);
      drawer.appendChild(actions);
      app.appendChild(drawer);
    }

    if (state.showShare) {
      const modal = createEl("div", "share-modal");
      const input = createEl("input");
      input.placeholder = "Username";
      modal.appendChild(input);
      const send = createEl("button", "", "Send");
      send.onclick = () => shareProgram(input.value.trim());
      const cancel = createEl("button", "", "Cancel");
      cancel.onclick = () => {
        state.showShare = false;
        render();
      };
      modal.append(send, cancel);
      app.appendChild(modal);
    }

    root.appendChild(app);
  }

  render();
}

window.initProgramTab = initProgramTab;
window.generateProgramSessions = generateSessions;

initProgramTab();
