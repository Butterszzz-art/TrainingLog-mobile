(function (global) {
  const core = global.programBuilderV2Core || {};
  const createEmptyDraft = core.createEmptyDraft || function () { return { split: "upper-lower", days: [], schedule: { trainingDays: [] }, metadata: { name: "", goal: "" } }; };
  const loadDraft = core.loadDraft || function () { return createEmptyDraft(); };
  const saveDraft = core.saveDraft || function () {};
  const clearDraft = core.clearDraft || function () {};
  const computeProgramSummary = core.computeProgramSummary || function () { return { name: "Untitled Program", split: "-", goal: "-", dayCount: 0, exerciseCount: 0, scheduledDays: 0 }; };
  const validateStep = core.validateStep || function () { return true; };

  const STEPS = ["split", "days", "review", "schedule", "save"];

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === "string") el.innerText = text;
    return el;
  }

  function initProgramTabV2(rootEl) {
    if (!rootEl) return;

    const state = {
      stepId: "split",
      selectedDayId: null,
      draft: loadDraft(),
    };

    if (!state.draft || typeof state.draft !== "object") state.draft = createEmptyDraft();
    if (!Array.isArray(state.draft.days) || !state.draft.days.length) state.draft = createEmptyDraft();
    if (!state.selectedDayId) state.selectedDayId = state.draft.days[0] && state.draft.days[0].id ? state.draft.days[0].id : null;

    function setStep(direction) {
      const index = STEPS.indexOf(state.stepId);
      const nextIndex = direction === "next" ? Math.min(STEPS.length - 1, index + 1) : Math.max(0, index - 1);
      state.stepId = STEPS[nextIndex];
      render();
    }

    function renderStepper(parent) {
      const stepper = createEl("div", "program-v2-stepper");
      STEPS.forEach(function (step) {
        const item = createEl("button", ("program-v2-step " + (state.stepId === step ? "active" : "")).trim(), step.toUpperCase());
        item.onclick = function () {
          state.stepId = step;
          render();
        };
        stepper.appendChild(item);
      });
      parent.appendChild(stepper);
    }

    function renderRightPane(parent) {
      const pane = createEl("div", "program-v2-pane right");
      pane.appendChild(createEl("h4", "", "Summary"));
      const summary = computeProgramSummary(state.draft);
      [
        "Name: " + summary.name,
        "Split: " + summary.split,
        "Goal: " + summary.goal,
        "Days: " + summary.dayCount,
        "Exercises: " + summary.exerciseCount,
        "Scheduled Days: " + summary.scheduledDays,
      ].forEach(function (line) {
        pane.appendChild(createEl("div", "program-v2-summary-row", line));
      });
      parent.appendChild(pane);
    }

    function renderBottomNav(parent) {
      const nav = createEl("div", "program-v2-bottom-nav");
      const back = createEl("button", "", "Back");
      back.onclick = function () { setStep("back"); };
      const next = createEl("button", "", "Next");
      next.disabled = !validateStep(state.stepId, state.draft);
      next.onclick = function () { setStep("next"); };
      const save = createEl("button", "", "Save Draft");
      save.onclick = function () { saveDraft(state.draft); };
      const clear = createEl("button", "", "Clear Draft");
      clear.onclick = function () {
        clearDraft();
        state.draft = createEmptyDraft();
        state.stepId = "split";
        render();
      };

      nav.append(back, next, save, clear);
      parent.appendChild(nav);
    }

    function render() {
      rootEl.innerHTML = "";
      const app = createEl("div", "program-tab-v2");
      renderStepper(app);
      renderRightPane(app);
      renderBottomNav(app);
      rootEl.appendChild(app);
    }

    render();
  }

  global.initProgramTab = initProgramTabV2;
  global.initProgramTabV2 = initProgramTabV2;
})(typeof window !== "undefined" ? window : globalThis);
