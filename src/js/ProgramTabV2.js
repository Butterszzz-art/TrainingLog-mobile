(function (global) {
  const core =
    (global && global.programBuilderV2Core) ||
    (typeof require === "function" ? require("./programBuilderV2Core") : {});

  const createEmptyDraft =
    core.createEmptyDraft ||
    function fallbackCreateEmptyDraft(userId) {
      return {
        schemaVersion: 2,
        userId: userId || null,
        name: "",
        goal: "hypertrophy",
        split: { type: "custom", daysPerWeek: 3 },
        days: [],
        schedule: { startDate: "", weekdays: [] },
      };
    };
  const loadDraft = core.loadDraft || function fallbackLoadDraft() { return createEmptyDraft(null); };
  const saveDraft = core.saveDraft || function fallbackSaveDraft(_userId, draft) { return draft; };
  const computeProgramSummary =
    core.computeProgramSummary ||
    function fallbackSummary(draft) {
      return {
        name: draft.name || "Untitled Program",
        split: draft.split && draft.split.type ? draft.split.type : "-",
        goal: draft.goal || "-",
        dayCount: Array.isArray(draft.days) ? draft.days.length : 0,
        exerciseCount: 0,
        scheduledDays: draft.schedule && Array.isArray(draft.schedule.weekdays) ? draft.schedule.weekdays.length : 0,
      };
    };
  const validateStep = core.validateStep || function fallbackValidateStep() { return true; };

  const STEPS = ["split", "days", "review", "schedule", "save"];
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function getActiveUsername() {
    if (global && typeof global.getActiveUsername === "function") {
      return global.getActiveUsername() || null;
    }
    if (global && global.localStorage) {
      return (
        global.localStorage.getItem("currentUser") ||
        global.localStorage.getItem("username") ||
        global.localStorage.getItem("Username") ||
        null
      );
    }
    return null;
  }

  function ensureDraftShape(draft, userId) {
    const safe = draft && typeof draft === "object" ? draft : createEmptyDraft(userId);
    safe.split = safe.split || { type: "custom", daysPerWeek: 3 };
    safe.days = Array.isArray(safe.days) ? safe.days : [];
    safe.schedule = safe.schedule || { startDate: "", weekdays: [] };
    safe.schedule.weekdays = Array.isArray(safe.schedule.weekdays) ? safe.schedule.weekdays : [];
    while (safe.days.length < safe.split.daysPerWeek) {
      safe.days.push({ name: "Day " + (safe.days.length + 1), exercises: [] });
    }
    return safe;
  }

  function initProgramTabV2(container) {
    if (!container || container.__mounted) return;
    container.__mounted = true;

    const userId = getActiveUsername();
    let draft = ensureDraftShape(loadDraft(userId), userId);
    let stepId = "split";
    let selectedDayIndex = 0;

    function persist() {
      draft = ensureDraftShape(saveDraft(userId, draft), userId);
    }

    function goToStep(nextStep) {
      stepId = nextStep;
      render();
    }

    function changeStep(delta) {
      const idx = STEPS.indexOf(stepId);
      const nextIdx = Math.max(0, Math.min(STEPS.length - 1, idx + delta));
      goToStep(STEPS[nextIdx]);
    }

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (typeof text === "string") node.textContent = text;
      return node;
    }

    function renderStepper(parent) {
      const stepper = el("div", "pbv2-stepper");
      STEPS.forEach(function (step) {
        const btn = el("button", "pbv2-step" + (step === stepId ? " active" : ""), step.toUpperCase());
        btn.type = "button";
        btn.onclick = function () { goToStep(step); };
        stepper.appendChild(btn);
      });
      parent.appendChild(stepper);
    }

    function renderDaysList(parent) {
      const left = el("div", "pbv2-left");
      left.appendChild(el("h4", "", "Days"));

      draft.days.forEach(function (day, index) {
        const dayBtn = el("button", "pbv2-day" + (index === selectedDayIndex ? " active" : ""), day.name || "Day " + (index + 1));
        dayBtn.type = "button";
        dayBtn.onclick = function () {
          selectedDayIndex = index;
          render();
        };
        left.appendChild(dayBtn);
      });

      const addDay = el("button", "pbv2-add-day", "+ Add Day");
      addDay.type = "button";
      addDay.onclick = function () {
        draft.days.push({ name: "Day " + (draft.days.length + 1), exercises: [] });
        draft.split.daysPerWeek = draft.days.length;
        selectedDayIndex = draft.days.length - 1;
        persist();
        render();
      };
      left.appendChild(addDay);
      parent.appendChild(left);
    }

    function renderEditor(parent) {
      const mid = el("div", "pbv2-middle");
      const day = draft.days[selectedDayIndex] || { name: "Day 1", exercises: [] };

      if (stepId === "split") {
        const splitLabel = el("label", "", "Split Type");
        const splitSelect = el("select");
        ["custom", "full-body", "upper-lower", "push-pull-legs"].forEach(function (type) {
          const option = el("option", "", type);
          option.value = type;
          option.selected = type === draft.split.type;
          splitSelect.appendChild(option);
        });
        splitSelect.onchange = function () {
          draft.split.type = splitSelect.value;
          persist();
        };

        const daysLabel = el("label", "", "Days per week");
        const daysInput = el("input");
        daysInput.type = "number";
        daysInput.min = "1";
        daysInput.max = "7";
        daysInput.value = String(draft.split.daysPerWeek || draft.days.length || 3);
        daysInput.onchange = function () {
          const count = Math.max(1, Math.min(7, Number(daysInput.value) || 1));
          draft.split.daysPerWeek = count;
          draft.days = draft.days.slice(0, count);
          while (draft.days.length < count) {
            draft.days.push({ name: "Day " + (draft.days.length + 1), exercises: [] });
          }
          selectedDayIndex = Math.min(selectedDayIndex, draft.days.length - 1);
          persist();
          render();
        };

        mid.append(splitLabel, splitSelect, daysLabel, daysInput);
      } else if (stepId === "days") {
        const nameLabel = el("label", "", "Day Name");
        const nameInput = el("input");
        nameInput.value = day.name || "";
        nameInput.oninput = function () {
          day.name = nameInput.value;
          draft.days[selectedDayIndex] = day;
          persist();
          render();
        };

        const exTitle = el("h4", "", "Exercises");
        const list = el("div", "pbv2-ex-list");
        (Array.isArray(day.exercises) ? day.exercises : []).forEach(function (exercise, exIdx) {
          const row = el("div", "pbv2-ex-row");
          const input = el("input");
          input.value = exercise;
          input.placeholder = "Exercise name";
          input.oninput = function () {
            day.exercises[exIdx] = input.value;
            persist();
          };
          const del = el("button", "", "Remove");
          del.type = "button";
          del.onclick = function () {
            day.exercises.splice(exIdx, 1);
            persist();
            render();
          };
          row.append(input, del);
          list.appendChild(row);
        });

        const addExercise = el("button", "", "+ Add Exercise");
        addExercise.type = "button";
        addExercise.onclick = function () {
          day.exercises = Array.isArray(day.exercises) ? day.exercises : [];
          day.exercises.push("");
          draft.days[selectedDayIndex] = day;
          persist();
          render();
        };

        mid.append(nameLabel, nameInput, exTitle, list, addExercise);
      } else if (stepId === "schedule") {
        const startLabel = el("label", "", "Start Date");
        const startInput = el("input");
        startInput.type = "date";
        startInput.value = draft.schedule.startDate || "";
        startInput.onchange = function () {
          draft.schedule.startDate = startInput.value;
          persist();
        };

        const weekdaysWrap = el("div", "pbv2-weekdays");
        WEEKDAYS.forEach(function (dayName) {
          const button = el(
            "button",
            "pbv2-weekday" + (draft.schedule.weekdays.indexOf(dayName) >= 0 ? " active" : ""),
            dayName
          );
          button.type = "button";
          button.onclick = function () {
            const index = draft.schedule.weekdays.indexOf(dayName);
            if (index >= 0) draft.schedule.weekdays.splice(index, 1);
            else draft.schedule.weekdays.push(dayName);
            persist();
            render();
          };
          weekdaysWrap.appendChild(button);
        });

        mid.append(startLabel, startInput, weekdaysWrap);
      } else if (stepId === "save") {
        const nameLabel = el("label", "", "Program Name");
        const nameInput = el("input");
        nameInput.value = draft.name || "";
        nameInput.oninput = function () {
          draft.name = nameInput.value;
          persist();
        };

        const goalLabel = el("label", "", "Goal");
        const goalInput = el("input");
        goalInput.value = draft.goal || "";
        goalInput.oninput = function () {
          draft.goal = goalInput.value;
          persist();
        };

        mid.append(nameLabel, nameInput, goalLabel, goalInput);
      } else {
        mid.appendChild(el("p", "", "Review your split, days, and schedule before saving."));
      }

      parent.appendChild(mid);
    }

    function renderSummary(parent) {
      const right = el("div", "pbv2-right");
      right.appendChild(el("h4", "", "Summary"));
      const summary = computeProgramSummary(draft);
      [
        "Name: " + summary.name,
        "Split: " + summary.split,
        "Goal: " + summary.goal,
        "Days: " + summary.dayCount,
        "Exercises: " + summary.exerciseCount,
        "Scheduled days: " + summary.scheduledDays,
      ].forEach(function (line) {
        right.appendChild(el("div", "pbv2-summary-row", line));
      });
      parent.appendChild(right);
    }

    function renderNav(parent) {
      const nav = el("div", "pbv2-nav");
      const back = el("button", "", "Back");
      back.type = "button";
      back.disabled = STEPS.indexOf(stepId) === 0;
      back.onclick = function () { changeStep(-1); };

      const next = el("button", "", "Next");
      next.type = "button";
      next.disabled = STEPS.indexOf(stepId) === STEPS.length - 1 || !validateStep(stepId, draft);
      next.onclick = function () { changeStep(1); };

      const save = el("button", "", "Save Draft");
      save.type = "button";
      save.onclick = function () { persist(); };

      nav.append(back, next, save);
      parent.appendChild(nav);
    }

    function render() {
      container.innerHTML = "";
      const app = el("div", "pbv2-root");
      renderStepper(app);

      const content = el("div", "pbv2-content");
      renderDaysList(content);
      renderEditor(content);
      renderSummary(content);

      app.append(content);
      renderNav(app);
      container.appendChild(app);
    }

    render();
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { initProgramTabV2: initProgramTabV2 };
  }

  global.initProgramTabV2 = initProgramTabV2;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
