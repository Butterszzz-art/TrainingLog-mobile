(function (global, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory(global || globalThis);
  } else {
    const api = factory(global || globalThis);
    if (global) {
      global.ProgramModule = api;
    }
  }
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
    ? globalThis
    : this,
  function (global) {
    const HISTORY_KEYS = ["workoutHistory", "resistanceLogs", "tl_workout_history_v1"];
    const FREQUENCY_DAYS = ["Mon", "Wed", "Fri"];
    const DEFAULT_VARIETY_SETTINGS = {
      autoInsertSuggestions: false,
    };
    const existingToast =
      global && typeof global.showToast === "function" ? global.showToast : null;
    const varietyEngine =
      (global && global.exerciseVarietyEngine) ||
      (typeof require === "function" ? require("../../exerciseVarietyEngine") : null);
    const programBuilderV2Core =
      (global && global.programBuilderV2Core) ||
      (typeof require === "function" ? require("./programBuilderV2Core") : null);

    function isBrowser() {
      return Boolean(global && global.document);
    }

    function getElement(id) {
      if (!isBrowser()) return null;
      return global.document.getElementById(id);
    }

    function getInputValue(id) {
      const el = getElement(id);
      if (!el || typeof el.value !== "string") return "";
      return el.value.trim();
    }

    function setInputValue(id, value) {
      const el = getElement(id);
      if (!el) return;
      el.value = value;
    }

    function getSelectValue(id) {
      const el = getElement(id);
      if (!el || typeof el.value !== "string") return "";
      return el.value;
    }

    function getCheckboxState(id) {
      const el = getElement(id);
      if (!el) return false;
      return Boolean(el.checked);
    }

    function setCheckboxState(id, state) {
      const el = getElement(id);
      if (!el) return;
      el.checked = Boolean(state);
    }

    function showToast(message) {
      if (existingToast && existingToast !== showToast) {
        existingToast(message);
        return;
      }

      if (isBrowser() && typeof global.alert === "function") {
        global.alert(message);
      } else {
        console.log(message);
      }
    }

    function normalizeProgram(program) {
      if (programBuilderV2Core && typeof programBuilderV2Core.normalizeProgram === "function") {
        return programBuilderV2Core.normalizeProgram(program);
      }
      return {
        name: "",
        startDate: "",
        frequency: [],
        progressionType: "linear",
        splitMode: "full-body",
        varietySettings: { ...DEFAULT_VARIETY_SETTINGS },
      };
    }

    function parseJsonArray(value) {
      if (!value) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    function loadWorkoutHistory() {
      if (!global || !global.localStorage) return [];
      const combined = [];

      HISTORY_KEYS.forEach((key) => {
        parseJsonArray(global.localStorage.getItem(key)).forEach((entry) => {
          combined.push(entry);
        });
      });

      return combined;
    }

    function createAutoInsertedExercisePlan(suggestedVarietyExercises, frequency) {
      const suggestions = Object.entries(suggestedVarietyExercises || {}).flatMap(
        ([muscle, exercises]) =>
          (Array.isArray(exercises) ? exercises : []).map((exercise) => ({
            muscle,
            name: exercise,
          }))
      );

      if (!suggestions.length || !Array.isArray(frequency) || !frequency.length) {
        return [];
      }

      return suggestions.map((suggestion, index) => ({
        day: frequency[index % frequency.length],
        muscle: suggestion.muscle,
        exercise: suggestion.name,
      }));
    }

    function buildVarietyRecommendations(program) {
      if (!varietyEngine || typeof varietyEngine.buildProgramVarietyRecommendations !== "function") {
        return null;
      }

      const recommendations = varietyEngine.buildProgramVarietyRecommendations(loadWorkoutHistory());
      const autoInsertSuggestions = Boolean(program?.varietySettings?.autoInsertSuggestions);

      return {
        ...recommendations,
        autoInsertedExercises: autoInsertSuggestions
          ? createAutoInsertedExercisePlan(recommendations.suggestedVarietyExercises, program.frequency)
          : [],
      };
    }

    function renderVarietyPreview() {
      const target = getElement("programVarietyPreview");
      if (!target || !varietyEngine || typeof varietyEngine.buildProgramVarietyRecommendations !== "function") {
        return;
      }

      const recommendations = varietyEngine.buildProgramVarietyRecommendations(loadWorkoutHistory());
      const totalVariety = Object.values(recommendations.suggestedVarietyExercises || {}).reduce(
        (count, list) => count + (Array.isArray(list) ? list.length : 0),
        0
      );
      const lowProgressCount = Array.isArray(recommendations.lowProgressExercises)
        ? recommendations.lowProgressExercises.length
        : 0;
      const deloadWeeks = recommendations?.deloadPlan?.recommendedDeloadWeeks || [];

      target.innerHTML = `
        <strong>History-informed recommendations ready:</strong>
        ${totalVariety} variety suggestions,
        ${lowProgressCount} low-progress exercises flagged,
        deload weeks ${deloadWeeks.length ? deloadWeeks.join(", ") : "none"}.
      `;
    }

    let programs =
      programBuilderV2Core && typeof programBuilderV2Core.loadPrograms === "function"
        ? programBuilderV2Core.loadPrograms(global)
        : [];
    let editingProgramIndex = null;

    function getPrograms() {
      return programs.map(normalizeProgram);
    }

    function setPrograms(list) {
      programs = Array.isArray(list) ? list.map(normalizeProgram) : [];
      if (programBuilderV2Core && typeof programBuilderV2Core.savePrograms === "function") {
        programBuilderV2Core.savePrograms(global, programs);
      }
      renderProgramList();
      return getPrograms();
    }

    function collectProgramFromForm() {
      const name = getInputValue("programName");
      const startDate = getInputValue("programStartDate");
      const progressionType = getSelectValue("programProgression") || "";
      const splitMode = getSelectValue("programSplit") || "";
      const frequency = FREQUENCY_DAYS.filter((day) => getCheckboxState(`freq${day}`));
      const autoInsertSuggestions = getCheckboxState("programAutoInsertVariety");

      if (!name || !startDate || frequency.length === 0) {
        return {
          error: "Please fill in all required fields",
        };
      }

      return {
        program: {
          name,
          startDate,
          frequency,
          progressionType,
          splitMode,
          varietySettings: {
            autoInsertSuggestions,
          },
        },
      };
    }

    function applyDraftToForm(draft) {
      setInputValue("programName", draft.name || "");
      setInputValue("programStartDate", draft.startDate || "");
      FREQUENCY_DAYS.forEach((day) => {
        setCheckboxState(`freq${day}`, Array.isArray(draft.frequency) && draft.frequency.includes(day));
      });
      setInputValue("programProgression", draft.progressionType || "linear");
      setInputValue("programSplit", draft.splitMode || "full-body");
      setCheckboxState(
        "programAutoInsertVariety",
        Boolean(draft?.varietySettings?.autoInsertSuggestions)
      );
    }

    function resetProgramForm() {
      editingProgramIndex = null;
      const draft =
        programBuilderV2Core && typeof programBuilderV2Core.defaultProgramDraft === "function"
          ? programBuilderV2Core.defaultProgramDraft()
          : normalizeProgram(null);
      applyDraftToForm(draft);
      if (programBuilderV2Core && typeof programBuilderV2Core.clearDraft === "function") {
        programBuilderV2Core.clearDraft(global);
      }
    }

    function openProgramModal() {
      const modal = getElement("programModal");
      if (!modal) return;
      if (typeof modal.showModal === "function") {
        modal.showModal();
      } else {
        modal.removeAttribute("hidden");
      }
    }

    function closeProgramModal() {
      const modal = getElement("programModal");
      if (!modal) return;
      if (typeof modal.close === "function") {
        modal.close();
      } else {
        modal.setAttribute("hidden", "hidden");
      }
    }

    function openEditorForProgram(index) {
      if (!Number.isInteger(index) || index < 0 || index >= programs.length) return;
      editingProgramIndex = index;
      const draft = normalizeProgram(programs[index]);
      if (programBuilderV2Core && typeof programBuilderV2Core.saveDraft === "function") {
        programBuilderV2Core.saveDraft(global, draft);
      }
      applyDraftToForm(draft);
      renderVarietyPreview();
      openProgramModal();
    }

    function escapeHtml(value) {
      if (typeof value !== "string") return "";
      return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function renderProgramList() {
      const container = getElement("programList");
      if (!container) return getPrograms();

      if (!programs.length) {
        container.innerHTML = '<li class="empty-state">No programs saved yet.</li>';
        return getPrograms();
      }

      container.innerHTML = programs
        .map((program, index) => {
          const summary =
            programBuilderV2Core && typeof programBuilderV2Core.summarizeProgram === "function"
              ? programBuilderV2Core.summarizeProgram(program)
              : {
                  name: program.name,
                  startDate: program.startDate,
                  frequency: Array.isArray(program.frequency) ? program.frequency.join(", ") : "-",
                  progressionType: program.progressionType || "",
                  splitMode: program.splitMode || "",
                  deloadWeeks: "None",
                  autoInserted: 0,
                };
          return `
            <li class="program-item" data-program-index="${index}">
              <h3>${escapeHtml(summary.name)}</h3>
              <div class="program-meta">
                <span><strong>Start:</strong> ${escapeHtml(summary.startDate)}</span>
                <span><strong>Frequency:</strong> ${escapeHtml(summary.frequency)}</span>
                <span><strong>Progression:</strong> ${escapeHtml(summary.progressionType)}</span>
                <span><strong>Split:</strong> ${escapeHtml(summary.splitMode)}</span>
                <span><strong>Deload weeks:</strong> ${escapeHtml(summary.deloadWeeks)}</span>
                <span><strong>Auto-inserted variety:</strong> ${escapeHtml(String(summary.autoInserted))}</span>
              </div>
              <div class="actions">
                <button type="button" class="edit-program-button" data-edit-program-index="${index}">Edit</button>
              </div>
            </li>
          `;
        })
        .join("");

      return getPrograms();
    }

    function saveProgramLegacy() {
      const result = collectProgramFromForm();
      if (result.error) {
        showToast(result.error);
        return null;
      }

      const program = normalizeProgram(result.program);
      program.recommendations = buildVarietyRecommendations(program);
      programs.push(program);
      if (programBuilderV2Core && typeof programBuilderV2Core.savePrograms === "function") {
        programBuilderV2Core.savePrograms(global, programs);
      }
      renderProgramList();
      closeProgramModal();
      showToast("Program saved");
      resetProgramForm();
      return program;
    }

    function saveProgram() {
      const result = collectProgramFromForm();
      if (result.error) {
        showToast(result.error);
        return null;
      }

      const program = normalizeProgram(result.program);
      program.recommendations = buildVarietyRecommendations(program);

      if (programBuilderV2Core && typeof programBuilderV2Core.upsertProgram === "function") {
        const persisted = programBuilderV2Core.upsertProgram(global, program, editingProgramIndex);
        programs = persisted.programs;
      } else {
        return saveProgramLegacy();
      }

      renderProgramList();
      closeProgramModal();
      showToast(editingProgramIndex === null ? "Program saved" : "Program updated");
      resetProgramForm();
      return program;
    }

    function initialiseUI() {
      if (!isBrowser()) return;
      const openButton = getElement("openProgramButton");
      const cancelButton = getElement("cancelProgramButton");
      const form = getElement("programForm");
      const libraryTitle = getElement("programLibraryTitle");
      const savedDraft =
        programBuilderV2Core && typeof programBuilderV2Core.loadDraft === "function"
          ? programBuilderV2Core.loadDraft(global)
          : null;

      if (libraryTitle) {
        libraryTitle.textContent = "Program Library";
      }

      if (savedDraft && savedDraft.name) {
        applyDraftToForm(savedDraft);
      }

      if (openButton) {
        openButton.addEventListener("click", () => {
          const draft =
            programBuilderV2Core && typeof programBuilderV2Core.loadDraft === "function"
              ? programBuilderV2Core.loadDraft(global)
              : null;
          editingProgramIndex = null;
          if (draft && draft.name) {
            applyDraftToForm(draft);
          } else {
            resetProgramForm();
          }
          renderVarietyPreview();
          openProgramModal();
        });
      }

      if (cancelButton) {
        cancelButton.addEventListener("click", () => {
          closeProgramModal();
        });
      }

      if (form) {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          saveProgram();
        });
      }

      const list = getElement("programList");
      if (list) {
        list.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof global.HTMLElement)) return;
          const editIndex = Number(target.getAttribute("data-edit-program-index"));
          if (Number.isInteger(editIndex)) {
            openEditorForProgram(editIndex);
          }
        });
      }

      renderProgramList();
    }

    if (isBrowser()) {
      if (global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", initialiseUI);
      } else {
        initialiseUI();
      }
    }

    return {
      saveProgram,
      saveProgramLegacy,
      renderProgramList,
      openProgramModal,
      closeProgramModal,
      resetProgramForm,
      getPrograms,
      setPrograms,
      collectProgramFromForm,
      openEditorForProgram,
    };
  }
);
