(function () {
  const STEPS = ["split", "days", "review", "schedule", "save"];
  const ARCHETYPES = [
    { value: "general", label: "General" },
    { value: "beginner", label: "Beginner" },
    { value: "strength", label: "Strength" },
    { value: "hypertrophy", label: "Hypertrophy" },
    { value: "fat-loss", label: "Fat Loss" },
  ];

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

  function esc(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initProgramTabV2(mountEl) {
    if (!mountEl || mountEl.__pbv2Mounted) return;
    mountEl.__pbv2Mounted = true;

    const core = window.programBuilderV2Core;
    if (!core) {
      mountEl.innerHTML = "<div style='padding:12px'>programBuilderV2Core missing.</div>";
      return;
    }

    const userId = getUserId();
    let draft = core.normalizeDraft(core.loadDraft(userId));
    let step = "split";
    let selectedDayId = draft.days?.[0]?.dayId || null;
    let selectedTemplateId = "";
    const assignmentForm = {
      clientName: "",
      clientId: "",
      assignmentNotes: "",
    };

    function persistDraft() {
      draft.updatedAt = new Date().toISOString();
      draft.name = draft.title || draft.name || "";
      draft.coachId = draft.coachId || userId;
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
          "<div style='padding:12px;color:#b00'>Missing containers: " + missing.join(", ") + "</div>";
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
      try {
        return Boolean(core.validateStep(currentStep, draft));
      } catch (_e) {
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

    function setSplit(type, daysPerWeek) {
      draft.split = {
        ...(draft.split || {}),
        type,
        daysPerWeek,
        name: draft.split?.name || "",
      };
      if (!Array.isArray(draft.days) || draft.days.length === 0) {
        draft.days = Array.from({ length: daysPerWeek }, (_, i) => ({
          dayId: uuid(),
          name: `Day ${i + 1}`,
          notes: "",
          exercises: [],
        }));
        selectedDayId = draft.days[0]?.dayId || null;
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
      draft.split = draft.split || { type: "custom", daysPerWeek: draft.days.length, name: "" };
      draft.split.daysPerWeek = draft.days.length;
      selectedDayId = newDay.dayId;
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
      const baseExercise =
        typeof core.createDefaultExercise === "function"
          ? core.createDefaultExercise({ name: name.trim() })
          : { name: name.trim(), sets: [{ setType: "straight", reps: 8, weight: null, rpe: null, rir: null, restSec: 120 }] };
      day.exercises.push({
        ...baseExercise,
        exerciseId: uuid(),
        name: name.trim(),
        archetypeTags: [draft.archetype || "general"],
      });

      persistDraft();
      render();
    }

    function updateExerciseField(dayId, exerciseId, field, value) {
      const day = (draft.days || []).find((d) => d.dayId === dayId);
      const ex = (day?.exercises || []).find((e) => e.exerciseId === exerciseId);
      if (!ex) return;
      ex[field] = value;
      persistDraft();
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
      ex.sets.push({ setType: "straight", reps: 8, weight: null, rpe: null, rir: null, restSec: 120 });
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
      const title = (draft.title || "").trim();
      if (!title) {
        alert("Program title is required.");
        return;
      }
      draft.name = title;
      draft.programId = draft.programId || `prog-${Date.now()}`;
      draft.coachId = draft.coachId || userId;
      const persisted = core.upsertProgram(window, core.normalizeDraft(draft));
      draft = core.normalizeDraft(persisted.program || draft);
      persistDraft();
      alert("Program saved ✅");
    }

    function saveTemplate() {
      if (!draft.title?.trim()) {
        alert("Add a program title before saving template.");
        return;
      }
      const template = core.saveProgramTemplate(window, draft);
      if (!template) {
        alert("Template save failed.");
        return;
      }
      alert(`Template saved: ${template.title || template.name}`);
    }

    function duplicateTemplate() {
      const templates = core.loadCoachTemplates(window);
      if (!templates.length) {
        alert("No templates available to duplicate yet.");
        return;
      }
      const targetTemplateId = selectedTemplateId || templates[templates.length - 1].templateId;
      const duplicated = core.duplicateProgramTemplate(window, targetTemplateId);
      if (!duplicated) {
        alert("Template duplication failed.");
        return;
      }
      selectedTemplateId = duplicated.templateId || selectedTemplateId;
      alert(`Template duplicated: ${duplicated.title || duplicated.name}`);
      render();
    }

    function assignToClient() {
      if (!draft.title?.trim()) {
        alert("Save or title the program before assigning.");
        return;
      }
      const clientName = (assignmentForm.clientName || "").trim();
      if (!clientName) {
        alert("Client name is required.");
        return;
      }
      const clientId = (assignmentForm.clientId || "").trim();
      const assignment = core.assignProgramToClient(window, {
        coachId: userId,
        clientId: clientId || null,
        clientName,
        archetype: draft.archetype || "general",
        notes: (assignmentForm.assignmentNotes || "").trim() || draft.progressionNotes || "",
        program: draft,
      });
      if (!assignment) {
        alert("Assignment failed.");
        return;
      }
      alert(`Assigned to ${assignment.clientName} ✅`);
    }

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
          <div class="pbv2-dayTitle">${esc(day.name)}</div>
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
        <label>Split name <input id="pbv2SplitName" value="${esc(draft.split?.name || "")}" placeholder="e.g., 4-Day Upper/Lower" /></label>
        <div class="pbv2-grid">
          <button data-split="fullbody" data-days="3">Full Body (3)</button>
          <button data-split="upperlower" data-days="4">Upper/Lower (4)</button>
          <button data-split="ppl" data-days="6">PPL (6)</button>
          <button data-split="custom" data-days="4">Custom (4)</button>
        </div>
      `;
      host.querySelector("#pbv2SplitName").addEventListener("input", (e) => {
        draft.split = draft.split || { type: "custom", daysPerWeek: 3, name: "" };
        draft.split.name = e.target.value;
        persistDraft();
      });
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
        <h2>${esc(day.name)}</h2>
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
            <strong>${esc(ex.name)}</strong>
            <button data-remove="${ex.exerciseId}" title="Remove">✖</button>
          </div>
          <div class="pbv2-sets">
            ${(ex.sets || [])
              .map(
                (s, idx) => `
              <div class="pbv2-setRow">
                <span>Set ${idx + 1}</span>
                <label>Reps <input data-field="reps" data-idx="${idx}" value="${s.reps ?? ""}" /></label>
                <label>RPE <input data-field="rpe" data-idx="${idx}" value="${s.rpe ?? ""}" /></label>
                <label>RIR <input data-field="rir" data-idx="${idx}" value="${s.rir ?? ""}" /></label>
              </div>
            `
              )
              .join("")}
          </div>
          <div class="pbv2-exNotes">
            <label>RIR/RPE Notes <input data-exfield="rpeNote" value="${esc(ex.rpeNote || ex.rirNote || "")}" /></label>
            <label>Progression Notes <input data-exfield="progressionNotes" value="${esc(ex.progressionNotes || "")}" /></label>
          </div>
          <button data-addset="${ex.exerciseId}">+ Add Set</button>
        `;

        card.querySelector("button[data-remove]")?.addEventListener("click", () => {
          removeExercise(day.dayId, ex.exerciseId);
        });

        card.querySelector("button[data-addset]")?.addEventListener("click", () => {
          addSet(day.dayId, ex.exerciseId);
        });

        card.querySelectorAll("input[data-field]").forEach((inp) => {
          inp.addEventListener("change", () => {
            const field = inp.dataset.field;
            const idx = parseInt(inp.dataset.idx, 10);
            const raw = inp.value.trim();
            const val = raw === "" ? null : parseFloat(raw);
            updateSetField(day.dayId, ex.exerciseId, idx, field, val);
          });
        });

        card.querySelectorAll("input[data-exfield]").forEach((inp) => {
          inp.addEventListener("change", () => {
            updateExerciseField(day.dayId, ex.exerciseId, inp.dataset.exfield, inp.value.trim());
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
        <p><strong>${esc(summary.name)}</strong></p>
        <p>Split: ${esc(summary.split)} (${esc(summary.splitName || "-")})</p>
        <p>Archetype: ${esc(summary.archetype)}</p>
        <p>Days: ${summary.dayCount}</p>
        <p>Exercises: ${summary.exerciseCount}</p>
        <p>Progression notes: ${esc(summary.progressionNotes || "-")}</p>
      `;
    }

    function renderScheduleStep() {
      const host = $("programStepContainer");
      host.innerHTML = `
        <h2>Schedule</h2>
        <label>Start date <input id="pbv2StartDate" type="date" value="${draft.schedule?.startDate || ""}"></label>
        <div style="margin-top:10px">
          <strong>Weekdays</strong><br/>
          ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
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
      const templates = core.loadCoachTemplates(window);
      if (!selectedTemplateId && templates.length) {
        selectedTemplateId = templates[templates.length - 1].templateId;
      }
      host.innerHTML = `
        <h2>Save & Assign</h2>
        <label>Program title <input id="pbv2Title" value="${esc(draft.title || draft.name || "")}"></label>
        <label>Archetype
          <select id="pbv2Archetype">
            ${ARCHETYPES.map((a) => `<option value="${a.value}" ${draft.archetype === a.value ? "selected" : ""}>${a.label}</option>`).join("")}
          </select>
        </label>
        <label>Program progression notes <textarea id="pbv2ProgressionNotes" rows="3">${esc(draft.progressionNotes || "")}</textarea></label>
        <label>Saved templates
          <select id="pbv2TemplateSelect">
            <option value="">Latest template</option>
            ${templates
              .map(
                (template) =>
                  `<option value="${esc(template.templateId || "")}" ${
                    selectedTemplateId === template.templateId ? "selected" : ""
                  }>${esc(template.title || template.name || "Untitled Template")}</option>`
              )
              .join("")}
          </select>
        </label>
        <fieldset style="border:1px solid #ddd;padding:10px;border-radius:8px;">
          <legend>Assign to client</legend>
          <label>Client name <input id="pbv2ClientName" value="${esc(assignmentForm.clientName)}" placeholder="e.g., Avery Smith"></label>
          <label>Client ID <input id="pbv2ClientId" value="${esc(assignmentForm.clientId)}" placeholder="optional"></label>
          <label>Assignment notes <textarea id="pbv2AssignmentNotes" rows="2" placeholder="optional">${esc(assignmentForm.assignmentNotes)}</textarea></label>
        </fieldset>
        <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
          <button id="pbv2SaveProgram">Save program</button>
          <button id="pbv2SaveTemplate" type="button">Save template</button>
          <button id="pbv2DuplicateTemplate" type="button">Duplicate template</button>
          <button id="pbv2AssignClient" type="button">Assign to client</button>
        </div>
      `;
      host.querySelector("#pbv2Title").addEventListener("input", (e) => {
        draft.title = e.target.value;
        draft.name = e.target.value;
        persistDraft();
      });
      host.querySelector("#pbv2Archetype").addEventListener("change", (e) => {
        draft.archetype = e.target.value;
        persistDraft();
      });
      host.querySelector("#pbv2ProgressionNotes").addEventListener("input", (e) => {
        draft.progressionNotes = e.target.value;
        persistDraft();
      });
      host.querySelector("#pbv2TemplateSelect").addEventListener("change", (e) => {
        selectedTemplateId = e.target.value;
      });
      host.querySelector("#pbv2ClientName").addEventListener("input", (e) => {
        assignmentForm.clientName = e.target.value;
      });
      host.querySelector("#pbv2ClientId").addEventListener("input", (e) => {
        assignmentForm.clientId = e.target.value;
      });
      host.querySelector("#pbv2AssignmentNotes").addEventListener("input", (e) => {
        assignmentForm.assignmentNotes = e.target.value;
      });
      host.querySelector("#pbv2SaveProgram").onclick = saveProgramFinal;
      host.querySelector("#pbv2SaveTemplate").onclick = saveTemplate;
      host.querySelector("#pbv2DuplicateTemplate").onclick = duplicateTemplate;
      host.querySelector("#pbv2AssignClient").onclick = assignToClient;
    }

    function renderSummaryPane() {
      const host = $("programSummaryContainer");
      const summary = core.computeProgramSummary(draft);
      host.innerHTML = `
        <div class="pbv2-paneTitle">Summary</div>
        <p><strong>${esc(summary.name)}</strong></p>
        <p>Split: ${esc(summary.split)} (${esc(summary.splitName || "-")})</p>
        <p>Archetype: ${esc(summary.archetype)}</p>
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

  window.initProgramTabV2 = initProgramTabV2;
})();
