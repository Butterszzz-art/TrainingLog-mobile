import {
  createEmptyDraft,
  loadDraft,
  saveDraft,
  clearDraft,
  computeProgramSummary,
  validateStep
} from "./src/js/programBuilderV2Core.js";

const STEPS = ["split", "days", "review", "schedule", "save"];

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (typeof text === "string") el.innerText = text;
  return el;
}

export function initProgramTabV2(rootEl) {
  if (!rootEl) return;

  const state = {
    stepId: "split",
    selectedDayId: null,
    draft: loadDraft()
  };

  if (!state.draft || typeof state.draft !== "object") state.draft = createEmptyDraft();
  if (!Array.isArray(state.draft.days) || !state.draft.days.length) state.draft = createEmptyDraft();
  if (!state.selectedDayId) state.selectedDayId = state.draft.days[0]?.id || null;

  function setStep(direction) {
    const index = STEPS.indexOf(state.stepId);
    const nextIndex = direction === "next" ? Math.min(STEPS.length - 1, index + 1) : Math.max(0, index - 1);
    state.stepId = STEPS[nextIndex];
    render();
  }

  function renderStepper(parent) {
    const stepper = createEl("div", "program-v2-stepper");
    STEPS.forEach((step) => {
      const item = createEl(
        "button",
        `program-v2-step ${state.stepId === step ? "active" : ""}`.trim(),
        step.toUpperCase()
      );
      item.onclick = () => {
        state.stepId = step;
        render();
      };
      stepper.appendChild(item);
    });
    parent.appendChild(stepper);
  }

  function renderLeftPane(parent) {
    const pane = createEl("div", "program-v2-pane left");
    pane.appendChild(createEl("h4", "", "Days"));
    (state.draft.days || []).forEach((day) => {
      const row = createEl(
        "button",
        `program-v2-day-row ${state.selectedDayId === day.id ? "selected" : ""}`.trim(),
        `${day.name} · ${day.focus || "Focus"}`
      );
      row.onclick = () => {
        state.selectedDayId = day.id;
        render();
      };
      pane.appendChild(row);
    });
    parent.appendChild(pane);
  }

  function renderMiddlePane(parent) {
    const pane = createEl("div", "program-v2-pane middle");
    pane.appendChild(createEl("h4", "", `Editor · ${state.stepId.toUpperCase()}`));

    if (state.stepId === "split") {
      const select = createEl("select");
      ["upper-lower", "push-pull-legs", "full-body"].forEach((value) => {
        const option = createEl("option");
        option.value = value;
        option.innerText = value;
        option.selected = value === state.draft.split;
        select.appendChild(option);
      });
      select.onchange = (event) => {
        state.draft.split = event.target.value;
        saveDraft(state.draft);
      };
      pane.appendChild(select);
    }

    if (state.stepId === "days") {
      const selectedDay = state.draft.days.find((day) => day.id === state.selectedDayId) || state.draft.days[0];
      if (selectedDay) {
        const dayName = createEl("input");
        dayName.value = selectedDay.name || "";
        dayName.placeholder = "Day name";
        dayName.oninput = (event) => {
          selectedDay.name = event.target.value;
          saveDraft(state.draft);
          render();
        };
        pane.appendChild(dayName);

        const focus = createEl("input");
        focus.value = selectedDay.focus || "";
        focus.placeholder = "Focus";
        focus.oninput = (event) => {
          selectedDay.focus = event.target.value;
          saveDraft(state.draft);
          render();
        };
        pane.appendChild(focus);
      }
    }

    if (state.stepId === "schedule") {
      const scheduleInput = createEl("input");
      scheduleInput.placeholder = "Training days (comma separated, e.g. Mon,Wed,Fri)";
      scheduleInput.value = (state.draft.schedule?.trainingDays || []).join(",");
      scheduleInput.oninput = (event) => {
        state.draft.schedule.trainingDays = event.target.value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        saveDraft(state.draft);
      };
      pane.appendChild(scheduleInput);
    }

    if (state.stepId === "save") {
      const nameInput = createEl("input");
      nameInput.placeholder = "Program name";
      nameInput.value = state.draft.metadata?.name || "";
      nameInput.oninput = (event) => {
        state.draft.metadata.name = event.target.value;
        saveDraft(state.draft);
      };
      pane.appendChild(nameInput);
    }

    parent.appendChild(pane);
  }

  function renderRightPane(parent) {
    const pane = createEl("div", "program-v2-pane right");
    pane.appendChild(createEl("h4", "", "Summary"));
    const summary = computeProgramSummary(state.draft);
    [
      `Name: ${summary.name}`,
      `Split: ${summary.split}`,
      `Goal: ${summary.goal}`,
      `Days: ${summary.dayCount}`,
      `Exercises: ${summary.exerciseCount}`,
      `Scheduled Days: ${summary.scheduledDays}`
    ].forEach((line) => pane.appendChild(createEl("div", "program-v2-summary-row", line)));
    parent.appendChild(pane);
  }

  function renderBottomNav(parent) {
    const nav = createEl("div", "program-v2-bottom-nav");
    const back = createEl("button", "", "Back");
    back.onclick = () => setStep("back");
    const next = createEl("button", "", "Next");
    next.disabled = !validateStep(state.stepId, state.draft);
    next.onclick = () => setStep("next");
    const save = createEl("button", "", "Save Draft");
    save.onclick = () => saveDraft(state.draft);

    const clear = createEl("button", "", "Clear Draft");
    clear.onclick = () => {
      clearDraft();
      state.draft = createEmptyDraft();
      state.stepId = "split";
      state.selectedDayId = state.draft.days[0]?.id || null;
      render();
    };

    nav.append(back, next, save, clear);
    parent.appendChild(nav);
  }

  function render() {
    rootEl.innerHTML = "";
    const app = createEl("div", "program-tab-v2");
    renderStepper(app);

    const panes = createEl("div", "program-v2-panes");
    renderLeftPane(panes);
    renderMiddlePane(panes);
    renderRightPane(panes);
    app.appendChild(panes);

    renderBottomNav(app);
    rootEl.appendChild(app);
  }

  render();
}

window.initProgramTab = initProgramTabV2;
window.initProgramTabV2 = initProgramTabV2;

initProgramTabV2();
