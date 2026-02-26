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
  typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this,
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
    const STORAGE_KEY = "programs";
    const ACTIVE_KEY = "activeProgram";
    const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const DEFAULT_DRAFT = {
      splitMode: "push-pull-legs",
      days: [
        { name: "Day 1", muscles: { chest: 6, shoulders: 4, triceps: 3 } },
        { name: "Day 2", muscles: { back: 7, biceps: 3, rearDelts: 2 } },
        { name: "Day 3", muscles: { quads: 5, hamstrings: 4, glutes: 4, calves: 3 } },
      ],
      startDate: "",
      weekdays: ["Mon", "Wed", "Fri"],
      name: "",
      notes: "",
    };
    const state = {
      step: 0,
      draft: JSON.parse(JSON.stringify(DEFAULT_DRAFT)),
    };

    function isBrowser() {
      return Boolean(global && global.document);
    }

    function getElement(id) {
      if (!isBrowser()) return null;
      return global.document.getElementById(id);
    }

    function showToast(message) {
      if (global && typeof global.showToast === "function") {
        global.showToast(message);
      } else if (isBrowser() && typeof global.alert === "function") {
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
    function loadStoredPrograms() {
      if (!global || !global.localStorage) return [];
      try {
        const raw = global.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (_error) {
        return [];
      }
    }

    function persistPrograms(programs) {
      if (!global || !global.localStorage) return;
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(programs));
    }

    function resolveCurrentUserId() {
      if (typeof global.getActiveUsername === "function") {
        const active = global.getActiveUsername();
        if (active) return active;
      }
      const direct = global.currentUser;
      if (typeof direct === "string" && direct.trim()) return direct;
      if (direct && typeof direct === "object") {
        if (direct.userId) return direct.userId;
        if (direct.id) return direct.id;
        if (direct.username) return direct.username;
      }
      if (global.localStorage) {
        const rawUser = global.localStorage.getItem("fitnessAppUser");
        if (rawUser) {
          try {
            const parsed = JSON.parse(rawUser);
            if (parsed?.userId || parsed?.id || parsed?.username) {
              return parsed.userId || parsed.id || parsed.username;
            }
          } catch (_err) {
            if (rawUser.trim()) return rawUser;
          }
        }
        return (
          global.localStorage.getItem("currentUser") ||
          global.localStorage.getItem("username") ||
          global.localStorage.getItem("Username") ||
          null
        );
      }
      return null;
    }

    function computeProgramSummary(draft) {
      const setsByMuscleGroup = {};
      const frequencyByMuscleGroup = {};
      (draft.days || []).forEach((day) => {
        Object.entries(day.muscles || {}).forEach(([muscle, sets]) => {
          const normalizedSets = Number(sets) || 0;
          setsByMuscleGroup[muscle] = (setsByMuscleGroup[muscle] || 0) + normalizedSets;
          if (normalizedSets > 0) {
            frequencyByMuscleGroup[muscle] = (frequencyByMuscleGroup[muscle] || 0) + 1;
          }
        });
      });

      const totalSets = Object.values(setsByMuscleGroup).reduce((sum, sets) => sum + sets, 0);
      const legsSets = (setsByMuscleGroup.quads || 0) + (setsByMuscleGroup.hamstrings || 0) + (setsByMuscleGroup.glutes || 0) + (setsByMuscleGroup.calves || 0);
      const backSets = setsByMuscleGroup.back || 0;
      const pushSets = (setsByMuscleGroup.chest || 0) + (setsByMuscleGroup.shoulders || 0) + (setsByMuscleGroup.triceps || 0);
      const pullSets = (setsByMuscleGroup.back || 0) + (setsByMuscleGroup.biceps || 0) + (setsByMuscleGroup.rearDelts || 0);
      const warnings = [];

      if (!legsSets || !backSets) warnings.push("Missing legs/back coverage");
      if (pushSets > pullSets * 1.5 && pushSets - pullSets >= 4) warnings.push("Push volume is much higher than pull");
      if (totalSets > 32) warnings.push("Total weekly sets appear unusually high");

      return {
        totalSets,
        setsByMuscleGroup,
        frequencyByMuscleGroup,
        warnings,
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
    function escapeHtml(value) {
      if (typeof value !== "string") return "";
      return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function renderBars(targetId, data) {
      const el = getElement(targetId);
      if (!el) return;
      const entries = Object.entries(data || {});
      if (!entries.length) {
        el.innerHTML = '<p class="helper">No data yet.</p>';
        return;
      }
      const max = Math.max(...entries.map(([, value]) => Number(value) || 0), 1);
      el.innerHTML = entries
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => {
          const width = Math.max(5, Math.round(((Number(value) || 0) / max) * 100));
          return `<div class="bar-row"><span>${escapeHtml(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><strong>${Number(value) || 0}</strong></div>`;
        })
        .join("");
    }

    function renderWarnings(list) {
      const el = getElement("warningCards");
      if (!el) return;
      if (!list.length) {
        el.innerHTML = '<div class="ok-card">No major warnings detected.</div>';
        return;
      }
      el.innerHTML = list.map((warning) => `<div class="warning-card">${escapeHtml(warning)}</div>`).join("");
    }

    function renderSchedulePreview() {
      const body = getElement("schedulePreviewBody");
      if (!body) return;
      const selected = state.draft.weekdays;
      body.innerHTML = selected
        .map((day, index) => `<tr><td>${escapeHtml(day)}</td><td>${escapeHtml(state.draft.days[index % state.draft.days.length].name)}</td></tr>`)
        .join("");
    }

    function renderReview() {
      const summary = computeProgramSummary(state.draft);
      const total = getElement("totalSetsValue");
      if (total) total.textContent = String(summary.totalSets);
      renderBars("setsBars", summary.setsByMuscleGroup);
      renderBars("frequencyBars", summary.frequencyByMuscleGroup);
      renderWarnings(summary.warnings);
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
    function renderStep() {
      const steps = ["stepReview", "stepSchedule", "stepSave"];
      const titles = ["Step 3 · Review", "Step 4 · Schedule", "Step 5 · Save"];
      steps.forEach((id, idx) => {
        const el = getElement(id);
        if (el) el.classList.toggle("active", idx === state.step);
      });
      const title = getElement("wizardTitle");
      if (title) title.textContent = titles[state.step];
      const back = getElement("backStepButton");
      const next = getElement("nextStepButton");
      if (back) back.style.visibility = state.step === 0 ? "hidden" : "visible";
      if (next) next.style.display = state.step === 2 ? "none" : "inline-block";
      if (state.step === 0) renderReview();
      if (state.step === 1) renderSchedulePreview();
    }

    function renderProgramList() {
      const programs = loadStoredPrograms();
      const container = getElement("programList");
      if (!container) return programs;
      if (!programs.length) {
        container.innerHTML = '<li class="program-item">No programs saved yet.</li>';
        return programs;
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
        .map((program) => {
          const weekdays = Array.isArray(program.weekdays) ? program.weekdays.join(", ") : "-";
          return `<li class="program-item"><h3>${escapeHtml(program.name || "Unnamed program")}</h3><div class="program-meta"><span><strong>Start:</strong> ${escapeHtml(program.startDate || "-")}</span><span><strong>Weekdays:</strong> ${escapeHtml(weekdays)}</span><span><strong>Total sets/week:</strong> ${computeProgramSummary(program).totalSets}</span></div></li>`;
        })
        .join("");
      return programs;
    }

    async function postProgramToBackend(payload) {
      if (typeof fetch === "undefined" || !global.SERVER_URL) return;
      const headers = { "Content-Type": "application/json" };
      if (typeof global.getAuthHeaders === "function") {
        Object.assign(headers, global.getAuthHeaders());
      }

      const endpoint = `${global.SERVER_URL}/saveProgram`;
      const first = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ draft: payload }),
      });
      if (first.ok) return;
      await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ program: payload }),
      });
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
    async function finalizeSave(saveAsCopy) {
      const name = (getElement("programName")?.value || "").trim();
      if (!name) {
        showToast("Program name is required");
        return null;
      }
      state.draft.name = name;
      state.draft.notes = (getElement("programNotes")?.value || "").trim();
      state.draft.startDate = getElement("programStartDate")?.value || "";
      if (!state.draft.weekdays.length) {
        showToast("Choose at least one weekday");
        return null;
      }

      const userId = resolveCurrentUserId();
      if (!userId) {
        showToast("Unable to resolve userId from current auth session.");
        return null;
      }

      const summary = computeProgramSummary(state.draft);
      const program = {
        ...JSON.parse(JSON.stringify(state.draft)),
        id: saveAsCopy ? `${Date.now()}_copy` : `${Date.now()}`,
        userId,
        summary,
      };

      const programs = loadStoredPrograms();
      programs.push(program);
      persistPrograms(programs);
      global.localStorage?.setItem(ACTIVE_KEY, JSON.stringify(program));

      try {
        await postProgramToBackend(program);
      } catch (_error) {
        showToast("Saved locally and set active. Backend sync will retry later.");
      }

      renderProgramList();
      showToast("Program saved and set active");
      const post = getElement("postSaveActions");
      if (post) post.style.display = "block";
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
    function openProgramModal() {
      const modal = getElement("programModal");
      if (!modal) return;
      state.step = 0;
      renderStep();
      if (typeof modal.showModal === "function") modal.showModal();
      else modal.removeAttribute("hidden");
    }

    function closeProgramModal() {
      const modal = getElement("programModal");
      if (!modal) return;
      if (typeof modal.close === "function") modal.close();
      else modal.setAttribute("hidden", "hidden");
    }

    function initialiseWeekdayGrid() {
      const grid = getElement("weekdayGrid");
      if (!grid) return;
      grid.innerHTML = WEEKDAYS.map((day) => `<label><input type="checkbox" data-day="${day}" ${state.draft.weekdays.includes(day) ? "checked" : ""}> ${day}</label>`).join("");
      Array.from(grid.querySelectorAll("input[type=checkbox]")).forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          const selected = Array.from(grid.querySelectorAll("input[type=checkbox]:checked")).map((el) => el.getAttribute("data-day"));
          state.draft.weekdays = WEEKDAYS.filter((day) => selected.includes(day));
          renderSchedulePreview();
        });
      });
    }

    function initialiseUI() {
      if (!isBrowser()) return;
      getElement("openProgramButton")?.addEventListener("click", openProgramModal);
      getElement("cancelProgramButton")?.addEventListener("click", closeProgramModal);
      getElement("backStepButton")?.addEventListener("click", () => {
        state.step = Math.max(0, state.step - 1);
        renderStep();
      });
      getElement("nextStepButton")?.addEventListener("click", () => {
        state.step = Math.min(2, state.step + 1);
        renderStep();
      });
      getElement("saveProgramButton")?.addEventListener("click", () => {
        finalizeSave(false);
      });
      getElement("saveCopyButton")?.addEventListener("click", () => {
        finalizeSave(true);
      });
      getElement("goToTodayButton")?.addEventListener("click", () => {
        if (global.location) global.location.href = "./today.html";
      });
      getElement("programStartDate")?.addEventListener("change", (event) => {
        state.draft.startDate = event.target.value;
      });

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

      initialiseWeekdayGrid();
      renderStep();
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
      computeProgramSummary,
      renderProgramList,
      openProgramModal,
      closeProgramModal,
      saveProgram: finalizeSave,
    };
  }
);
