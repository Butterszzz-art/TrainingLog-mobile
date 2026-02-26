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
      computeProgramSummary,
      renderProgramList,
      openProgramModal,
      closeProgramModal,
      saveProgram: finalizeSave,
    };
  }
);
