(function () {
  const STEPS = ["split", "days", "review", "schedule", "save"];

  function getUserId() {
    return (
      (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem("username") ||
      localStorage.getItem("Username") ||
      "anonymous"
    );
  }

  function $(id) {
    return document.getElementById(id);
  }

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function initProgramTabV2(mountEl) {
    // mountEl might be programBuilderV2Mount; UI uses fixed containers by ID
    if (!mountEl) return;
    if (mountEl.__pbv2Mounted) return;
    mountEl.__pbv2Mounted = true;

    const core = window.programBuilderV2Core;
    if (!core) {
      mountEl.innerHTML = "<div style='padding:12px'>programBuilderV2Core missing.</div>";
      return;
    }

    const userId = getUserId();
    let draft = core.loadDraft(userId);
    let step = "split";
    let selectedDayId = draft.days?.[0]?.dayId || null;

    // ---------- state helpers ----------
    function persistDraft() {
      draft.updatedAt = new Date().toISOString();
      draft = core.saveDraft(userId, draft);
    }

    function ensureContainers() {
      const required = [
        "programStepperContainer",
        "programDaysContainer",
        "programStepContainer",
        "programSummaryContainer",
        "programNavContainer",
      ];
      const missing = required.filter((id) => !$(id));
      if (missing.length) {
        mountEl.innerHTML =
          "<div style='padding:12px;color:#b00'>Missing containers: " +
          missing.join(", ") +
          "</div>";
        return false;
      }
      return true;
    }

    function ensureSelectedDay() {
      if (!selectedDayId && Array.isArray(draft.days) && draft.days.length) {
        selectedDayId = draft.days[0].dayId;
      }
    }

    function goToStep(next) {
      step = next;
      render();
    }

    function canProceedFrom(currentStep) {
      // core.validateStep signature in your file is validateStep(stepId, draft)
      // (it’s currently: validateStep(stepId, draft) in the deployed core)
      try {
        return Boolean(core.validateStep(currentStep, draft));
      } catch (e) {
        console.warn("[ProgramV2] validateStep error", e);
        return true;
      }
    }

    function nextStep() {
      if (!canProceedFrom(step)) {
        alert("Complete this step before continuing.");
        return;
      }
      const idx = STEPS.indexOf(step);
      goToStep(STEPS[Math.min(idx + 1, STEPS.length - 1)]);
    }

    function prevStep() {
      const idx = STEPS.indexOf(step);
      goToStep(STEPS[Math.max(idx - 1, 0)]);
    }

    // ---------- actions ----------
    function setSplit(type, daysPerWeek) {
      draft.split = { type, daysPerWeek };

      // Generate days only if none exist
      if (!Array.isArray(draft.days) || draft.days.length === 0) {
        draft.days = Array.from({ length: daysPerWeek }, (_, i) => ({
          dayId: uuid(),
          name: `Day ${i + 1}`,
          notes: "",
          exercises: [],
        }));
        selectedDayId = draft.days[0]?.dayId || null;
      } else {
        // Keep existing days but update count
        draft.split.daysPerWeek = draft.days.length;
      }

      persistDraft();
      goToStep("days");
    }

    function addDay() {
      draft.days = Array.isArray(draft.days) ? draft.days : [];
      const newDay = {
        dayId: uuid(),
        name: `Day ${draft.days.length + 1}`,
        notes: "",
        exercises: [],
      };
      draft.days.push(newDay);
      selectedDayId = newDay.dayId;
      draft.split = draft.split || { type: "custom", daysPerWeek: draft.days.length };
      draft.split.daysPerWeek = draft.days.length;
      persistDraft();
      render();
    }

    function renameDay(dayId) {
      const day = draft.days.find((d) => d.dayId === dayId);
      if (!day) return;
      const name = prompt("Rename day:", day.name);
      if (!name) return;
      day.name = name.trim();
      persistDraft();
      render();
    }

    function deleteDay(dayId) {
      if (!confirm("Delete this day?")) return;
      draft.days = (draft.days || []).filter((d) => d.dayId !== dayId);
      if (selectedDayId === dayId) selectedDayId = draft.days[0]?.dayId || null;
      if (draft.split) draft.split.daysPerWeek = draft.days.length;
      persistDraft();
      render();
    }

    function addExerciseToSelectedDay() {
      ensureSelectedDay();
      const day = (draft.days || []).find((d) => d.dayId === selectedDayId);
      if (!day) return;

      const name = prompt("Exercise name (e.g., Bench Press):");
      if (!name) return;

      day.exercises = Array.isArray(day.exercises) ? day.exercises : [];
      day.exercises.push({
        exerciseId: uuid(),
        name: name.trim(),
        muscleGroup: "", // can add later (dropdown)
        sets: [{ setType: "straight", reps: 8, weight: null, rpe: null, restSec: 120 }],
        notes: "",
      });

      persistDraft();
      render();
    }

    function updateSetField(dayId, exerciseId, setIndex, field, value) {
      const day = (draft.days || []).find((d) => d.dayId === dayId);
      const ex = (day?.exercises || []).find((e) => e.exerciseId === exerciseId);
      if (!ex || !ex.sets?.[setIndex]) return;
      ex.sets[setIndex][field] = value;
      persistDraft();
    }

    function addSet(dayId, exerciseId) {
      const day = (draft.days || []).find((d) => d.dayId === dayId);
      const ex = (day?.exercises || []).find((e) => e.exerciseId === exerciseId);
      if (!ex) return;
      ex.sets = Array.isArray(ex.sets) ? ex.sets : [];
      ex.sets.push({ setType: "straight", reps: 8, weight: null, rpe: null, restSec: 120 });
      persistDraft();
      render();
    }

    function removeExercise(dayId, exerciseId) {
      const day = (draft.days || []).find((d) => d.dayId === dayId);
      if (!day) return;
      day.exercises = (day.exercises || []).filter((e) => e.exerciseId !== exerciseId);
      persistDraft();
      render();
    }

    function saveProgramFinal() {
      const name = (draft.name || "").trim();
      if (!name) {
        alert("Program name is required.");
        return;
      }
      // Local save via core upsertProgram (uses PROGRAM_STORAGE_KEY="programs")
      core.upsertProgram(window, draft);
      alert("Program saved ✅");
    }

    // ---------- render ----------
    function renderStepper() {
      const host = $("programStepperContainer");
      host.innerHTML = "";
      const row = document.createElement("div");
      row.className = "pbv2-stepper";

      STEPS.forEach((s) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pbv2-step" + (s === step ? " active" : "");
        btn.textContent = s.toUpperCase();
        btn.onclick = () => goToStep(s);
        row.appendChild(btn);
      });

      host.appendChild(row);
    }

    function renderDaysPane() {
      const host = $("programDaysContainer");
      host.innerHTML = `<div class="pbv2-paneTitle">Days</div>`;

      (draft.days || []).forEach((day) => {
        const row = document.createElement("div");
        row.className = "pbv2-dayRow" + (day.dayId === selectedDayId ? " active" : "");
        row.innerHTML = `
          <div class="pbv2-dayTitle">${day.name}</div>
          <div class="pbv2-dayMeta">${(day.exercises || []).length} exercises</div>
          <div class="pbv2-dayActions">
            <button data-act="rename" data-id="${day.dayId}" title="Rename">✏️</button>
            <button data-act="delete" data-id="${day.dayId}" title="Delete">🗑️</button>
          </div>
        `;

        row.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          selectedDayId = day.dayId;
          render();
        });

        host.appendChild(row);
      });

      const add = document.createElement("button");
      add.className = "pbv2-addDay";
      add.textContent = "+ Add Day";
      add.onclick = addDay;
      host.appendChild(add);

      host.querySelectorAll("button[data-act='rename']").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          renameDay(b.dataset.id);
        })
      );
      host.querySelectorAll("button[data-act='delete']").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteDay(b.dataset.id);
        })
      );
    }

    function renderSplitStep() {
      const host = $("programStepContainer");
      host.innerHTML = `
        <h2>Choose a split</h2>
        <div class="pbv2-grid">
          <button data-split="fullbody" data-days="3">Full Body (3)</button>
          <button data-split="upperlower" data-days="4">Upper/Lower (4)</button>
          <button data-split="ppl" data-days="6">PPL (6)</button>
          <button data-split="custom" data-days="4">Custom (4)</button>
        </div>
      `;
      host.querySelectorAll("button[data-split]").forEach((btn) => {
        btn.addEventListener("click", () => {
          setSplit(btn.dataset.split, parseInt(btn.dataset.days, 10));
        });
      });
    }

    function renderDayEditorStep() {
      ensureSelectedDay();
      const day = (draft.days || []).find((d) => d.dayId === selectedDayId);
      const host = $("programStepContainer");

      if (!day) {
        host.innerHTML = `<p>No day selected. Add a day.</p>`;
        return;
      }

      host.innerHTML = `
        <h2>${day.name}</h2>
        <button id="pbv2AddExercise">+ Add Exercise</button>
        <div id="pbv2Exercises"></div>
      `;

      host.querySelector("#pbv2AddExercise").onclick = addExerciseToSelectedDay;

      const list = host.querySelector("#pbv2Exercises");
      (day.exercises || []).forEach((ex) => {
        const card = document.createElement("div");
        card.className = "pbv2-exCard";
        card.innerHTML = `
          <div class="pbv2-exHeader">
            <strong>${ex.name}</strong>
            <button data-remove="${ex.exerciseId}" title="Remove">✖</button>
          </div>
          <div class="pbv2-sets">
            ${(ex.sets || [])
              .map(
                (s, idx) => `
              <div class="pbv2-setRow">
                <span>Set ${idx + 1}</span>
                <label>Reps <input data-field="reps" data-idx="${idx}" value="${s.reps ?? ""}" /></label>
                <label>Weight <input data-field="weight" data-idx="${idx}" value="${s.weight ?? ""}" /></label>
              </div>
            `
              )
              .join("")}
          </div>
          <button data-addset="${ex.exerciseId}">+ Add Set</button>
        `;

        // remove exercise
        card.querySelector("button[data-remove]")?.addEventListener("click", () => {
          removeExercise(day.dayId, ex.exerciseId);
        });

        // add set
        card.querySelector("button[data-addset]")?.addEventListener("click", () => {
          addSet(day.dayId, ex.exerciseId);
        });

        // set input changes
        card.querySelectorAll("input[data-field]").forEach((inp) => {
          inp.addEventListener("change", () => {
            const field = inp.dataset.field;
            const idx = parseInt(inp.dataset.idx, 10);
            const raw = inp.value.trim();
            const val =
              raw === ""
                ? null
                : field === "reps"
                ? parseInt(raw, 10)
                : parseFloat(raw);
            updateSetField(day.dayId, ex.exerciseId, idx, field, val);
          });
        });

        list.appendChild(card);
      });
    }

    function renderReviewStep() {
      const host = $("programStepContainer");
      const summary = core.computeProgramSummary(draft);
      host.innerHTML = `
        <h2>Review</h2>
        <p><strong>${summary.name}</strong></p>
        <p>Split: ${summary.split}</p>
        <p>Goal: ${summary.goal}</p>
        <p>Days: ${summary.dayCount}</p>
        <p>Exercises: ${summary.exerciseCount}</p>
        <p>Scheduled weekdays: ${summary.scheduledDays}</p>
      `;
    }

    function renderScheduleStep() {
      const host = $("programStepContainer");
      host.innerHTML = `
        <h2>Schedule</h2>
        <label>Start date <input id="pbv2StartDate" type="date" value="${draft.schedule?.startDate || ""}"></label>
        <div style="margin-top:10px">
          <strong>Weekdays</strong><br/>
          ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
            .map((d, i) => {
              const wd = i + 1;
              const checked = (draft.schedule?.weekdays || []).includes(wd) ? "checked" : "";
              return `<label style="margin-right:8px"><input type="checkbox" data-wd="${wd}" ${checked}/> ${d}</label>`;
            })
            .join("")}
        </div>
      `;

      host.querySelector("#pbv2StartDate").addEventListener("change", (e) => {
        draft.schedule = draft.schedule || { startDate: "", weekdays: [] };
        draft.schedule.startDate = e.target.value;
        persistDraft();
      });

      host.querySelectorAll("input[type=checkbox][data-wd]").forEach((cb) => {
        cb.addEventListener("change", () => {
          draft.schedule = draft.schedule || { startDate: "", weekdays: [] };
          const wd = parseInt(cb.dataset.wd, 10);
          const set = new Set(draft.schedule.weekdays || []);
          cb.checked ? set.add(wd) : set.delete(wd);
          draft.schedule.weekdays = Array.from(set).sort((a, b) => a - b);
          persistDraft();
        });
      });
    }

    function renderSaveStep() {
      const host = $("programStepContainer");
      host.innerHTML = `
        <h2>Save</h2>
        <label>Program name <input id="pbv2Name" value="${draft.name || ""}"></label>
        <div style="margin-top:12px">
          <button id="pbv2SaveProgram">Save program</button>
        </div>
      `;
      host.querySelector("#pbv2Name").addEventListener("input", (e) => {
        draft.name = e.target.value;
        persistDraft();
      });
      host.querySelector("#pbv2SaveProgram").onclick = saveProgramFinal;
    }

    function renderSummaryPane() {
      const host = $("programSummaryContainer");
      const summary = core.computeProgramSummary(draft);
      host.innerHTML = `
        <div class="pbv2-paneTitle">Summary</div>
        <p><strong>${summary.name}</strong></p>
        <p>Split: ${summary.split}</p>
        <p>Goal: ${summary.goal}</p>
        <p>Days: ${summary.dayCount}</p>
        <p>Exercises: ${summary.exerciseCount}</p>
        <p>Scheduled: ${summary.scheduledDays}</p>
      `;
    }

    function renderNav() {
      const host = $("programNavContainer");
      host.innerHTML = `
        <button id="pbv2Back">Back</button>
        <button id="pbv2Next">Next</button>
        <button id="pbv2SaveDraft">Save draft</button>
      `;
      host.querySelector("#pbv2Back").onclick = prevStep;
      host.querySelector("#pbv2Next").onclick = nextStep;
      host.querySelector("#pbv2SaveDraft").onclick = () => {
        persistDraft();
        alert("Draft saved.");
      };
    }

    function render() {
      if (!ensureContainers()) return;

      renderStepper();
      renderDaysPane();
      renderSummaryPane();
      renderNav();

      if (step === "split") renderSplitStep();
      else if (step === "days") renderDayEditorStep();
      else if (step === "review") renderReviewStep();
      else if (step === "schedule") renderScheduleStep();
      else if (step === "save") renderSaveStep();
    }

    render();
  }

  // expose global for core to call
  window.initProgramTabV2 = initProgramTabV2;
})();
