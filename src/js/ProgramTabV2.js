/* =============================================================
   PROGRAM BUILDER V2 — UI layer (redesigned)
   Data layer: programBuilderV2Core.js (unchanged)
   ============================================================= */

(function () {
  'use strict';

  /* ── Constants ───────────────────────────────────────────────── */

  const STEPS = ['goal', 'split', 'exercises', 'schedule', 'save'];

  const STEP_META = {
    goal:      { icon: '🎯', label: 'Goal' },
    split:     { icon: '📅', label: 'Split' },
    exercises: { icon: '💪', label: 'Exercises' },
    schedule:  { icon: '🗓️', label: 'Schedule' },
    save:      { icon: '✅', label: 'Save' },
  };

  const GOALS = [
    { value: 'strength',    icon: '🏋️', label: 'Strength',       desc: 'Build your 1-rep max on the big lifts' },
    { value: 'hypertrophy', icon: '💪', label: 'Muscle Growth',   desc: 'Maximize size with higher-volume training' },
    { value: 'fat-loss',    icon: '🔥', label: 'Fat Loss',        desc: 'Preserve muscle while burning body fat' },
    { value: 'general',     icon: '⚡', label: 'General Fitness', desc: 'Balanced strength, health, and endurance' },
  ];

  const SPLITS = [
    {
      type: 'fullbody', days: 3, icon: '🔄',
      label: 'Full Body',
      badge: '3 days / week',
      desc: 'Train every muscle group each session. Maximum frequency, great for beginners.',
      rec: 'Best for: Beginners, 3 days/week',
    },
    {
      type: 'upperlower', days: 4, icon: '↕️',
      label: 'Upper / Lower',
      badge: '4 days / week',
      desc: 'Alternate upper-body and lower-body days. Popular intermediate structure.',
      rec: 'Best for: Intermediate, 4 days/week',
    },
    {
      type: 'ppl', days: 6, icon: '📐',
      label: 'Push / Pull / Legs',
      badge: '5–6 days / week',
      desc: 'Push muscles (chest/shoulders/triceps), Pull (back/biceps), Legs — each twice a week.',
      rec: 'Best for: Advanced, 5–6 days/week',
    },
    {
      type: 'custom', days: 4, icon: '✏️',
      label: 'Custom',
      badge: 'You choose',
      desc: 'Start from scratch and design your own split with any number of days.',
      rec: 'Best for: Any level',
    },
  ];

  const EXERCISE_LIB = {
    'Chest':     ['Bench Press', 'Incline Bench Press', 'Decline Bench Press', 'Dumbbell Fly', 'Cable Fly', 'Push-Up', 'Chest Dip'],
    'Back':      ['Deadlift', 'Pull-Up', 'Chin-Up', 'Barbell Row', 'Dumbbell Row', 'Lat Pulldown', 'Seated Cable Row', 'Face Pull', 'Shrug'],
    'Shoulders': ['Overhead Press', 'Dumbbell Shoulder Press', 'Lateral Raise', 'Front Raise', 'Arnold Press', 'Rear Delt Fly', 'Upright Row'],
    'Arms':      ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Preacher Curl', 'Cable Curl', 'Tricep Pushdown', 'Skull Crusher', 'Overhead Tricep Extension', 'Dip'],
    'Legs':      ['Squat', 'Front Squat', 'Hack Squat', 'Leg Press', 'Romanian Deadlift', 'Bulgarian Split Squat', 'Leg Curl', 'Leg Extension', 'Calf Raise', 'Hip Thrust', 'Glute Bridge'],
    'Core':      ['Plank', 'Ab Wheel', 'Hanging Leg Raise', 'Cable Crunch', 'Russian Twist', 'Sit-Up', 'Pallof Press'],
    'Cardio':    ['Treadmill', 'Rowing Machine', 'Stationary Bike', 'Jump Rope', 'Stair Climber', 'Battle Ropes'],
  };

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ── Helpers ─────────────────────────────────────────────────── */

  function getUserId() {
    return (
      (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('username') ||
      localStorage.getItem('Username') ||
      'anonymous'
    );
  }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── Toast ───────────────────────────────────────────────────── */

  function showToast(msg, isError = false) {
    let el = document.getElementById('pbv2Toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pbv2Toast';
      document.body.appendChild(el);
    }
    el.className = isError ? 'error' : '';
    el.textContent = msg;
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(12px)';
    }, 3200);
  }

  /* ── initProgramTabV2 ────────────────────────────────────────── */

  function initProgramTabV2(mountEl) {
    if (!mountEl || mountEl.__pbv2Mounted) return;
    mountEl.__pbv2Mounted = true;

    const core = window.programBuilderV2Core;
    if (!core) {
      mountEl.innerHTML = "<div style='padding:16px;color:#eb5757'>programBuilderV2Core not loaded.</div>";
      return;
    }

    /* ── Component state ─ */
    const userId = getUserId();
    let draft = core.normalizeDraft(core.loadDraft(userId));
    let step = 'goal';
    let selectedDayId = draft.days?.[0]?.dayId || null;
    let pickerQuery = '';
    let pickerCategory = 'All';
    const advancedForm = { clientName: '', clientId: '', assignmentNotes: '', archetype: draft.archetype || 'general' };

    /* ── Draft persistence ─ */
    function persistDraft() {
      draft.updatedAt = new Date().toISOString();
      draft.name = draft.title || draft.name || '';
      draft.coachId = draft.coachId || userId;
      draft = core.saveDraft(userId, draft);
    }

    /* ── Step validation ─ */
    function canProceed() {
      switch (step) {
        case 'goal':      return Boolean(draft.archetype);
        case 'split':     return Boolean(draft.split?.type);
        case 'exercises': return Array.isArray(draft.days) && draft.days.length > 0;
        case 'schedule':  return (draft.schedule?.weekdays || []).length > 0;
        case 'save':      return Boolean((draft.title || draft.name || '').trim());
        default:          return true;
      }
    }

    function stepIndex(s) { return STEPS.indexOf(s); }

    function goToStep(s) {
      step = s;
      render();
    }

    function nextStep() {
      if (!canProceed()) {
        const hints = {
          goal: 'Pick a training goal to continue.',
          split: 'Choose a split to continue.',
          exercises: 'Add at least one day to continue.',
          schedule: 'Select at least one training day.',
          save: 'Enter a program title to save.',
        };
        showToast(hints[step] || 'Complete this step first.', true);
        return;
      }
      const idx = stepIndex(step);
      if (idx < STEPS.length - 1) goToStep(STEPS[idx + 1]);
    }

    function prevStep() {
      const idx = stepIndex(step);
      if (idx > 0) goToStep(STEPS[idx - 1]);
    }

    /* ── Data mutations ─ */

    function setGoal(archetype) {
      draft.archetype = archetype;
      advancedForm.archetype = archetype;
      persistDraft();
      goToStep('split');
    }

    function setSplit(type, daysPerWeek) {
      draft.split = { ...(draft.split || {}), type, daysPerWeek, name: draft.split?.name || '' };
      if (!Array.isArray(draft.days) || draft.days.length === 0) {
        draft.days = Array.from({ length: daysPerWeek }, (_, i) => ({
          dayId: uuid(), name: `Day ${i + 1}`, notes: '', exercises: [],
        }));
        selectedDayId = draft.days[0]?.dayId || null;
      }
      persistDraft();
      goToStep('exercises');
    }

    function addDay() {
      draft.days = Array.isArray(draft.days) ? draft.days : [];
      const newDay = { dayId: uuid(), name: `Day ${draft.days.length + 1}`, notes: '', exercises: [] };
      draft.days.push(newDay);
      draft.split = draft.split || { type: 'custom', daysPerWeek: draft.days.length, name: '' };
      draft.split.daysPerWeek = draft.days.length;
      selectedDayId = newDay.dayId;
      persistDraft();
      render();
    }

    function renameDay(dayId) {
      const day = draft.days.find(d => d.dayId === dayId);
      if (!day) return;
      window.showPrompt('Rename day:', { defaultValue: day.name }).then(name => {
        if (!name || !name.trim()) return;
        day.name = name.trim();
        persistDraft();
        render();
      });
    }

    function deleteDay(dayId) {
      window.showConfirm('Delete this day and all its exercises?', { danger: true }).then(ok => {
        if (!ok) return;
        draft.days = (draft.days || []).filter(d => d.dayId !== dayId);
        if (selectedDayId === dayId) selectedDayId = draft.days[0]?.dayId || null;
        if (draft.split) draft.split.daysPerWeek = draft.days.length;
        persistDraft();
        render();
      });
    }

    function selectDay(dayId) {
      selectedDayId = dayId;
      render();
    }

    function addExercise(name) {
      if (!selectedDayId && draft.days?.length) selectedDayId = draft.days[0].dayId;
      const day = (draft.days || []).find(d => d.dayId === selectedDayId);
      if (!day) return;
      day.exercises = Array.isArray(day.exercises) ? day.exercises : [];
      day.exercises.push({
        exerciseId: uuid(),
        name: name.trim(),
        notes: '',
        rirNote: '', rpeNote: '', progressionNotes: '',
        archetypeTags: [draft.archetype || 'general'],
        sets: [{ setType: 'straight', reps: 8, weight: null, rpe: null, rir: null, restSec: 120 }],
      });
      persistDraft();
      renderExercisesPane(); // partial re-render — keep picker state
    }

    function removeExercise(dayId, exerciseId) {
      const day = (draft.days || []).find(d => d.dayId === dayId);
      if (!day) return;
      day.exercises = (day.exercises || []).filter(e => e.exerciseId !== exerciseId);
      persistDraft();
      renderExercisesPane();
    }

    function addSet(dayId, exerciseId) {
      const day = (draft.days || []).find(d => d.dayId === dayId);
      const ex = (day?.exercises || []).find(e => e.exerciseId === exerciseId);
      if (!ex) return;
      ex.sets = Array.isArray(ex.sets) ? ex.sets : [];
      ex.sets.push({ setType: 'straight', reps: 8, weight: null, rpe: null, rir: null, restSec: 120 });
      persistDraft();
      renderExercisesPane();
    }

    function removeSet(dayId, exerciseId, idx) {
      const day = (draft.days || []).find(d => d.dayId === dayId);
      const ex = (day?.exercises || []).find(e => e.exerciseId === exerciseId);
      if (!ex || ex.sets.length <= 1) return; // keep at least 1 set
      ex.sets.splice(idx, 1);
      persistDraft();
      renderExercisesPane();
    }

    function updateSetField(dayId, exerciseId, idx, field, raw) {
      const day = (draft.days || []).find(d => d.dayId === dayId);
      const ex = (day?.exercises || []).find(e => e.exerciseId === exerciseId);
      if (!ex || !ex.sets?.[idx]) return;
      ex.sets[idx][field] = raw === '' ? null : parseFloat(raw);
      persistDraft();
    }

    function saveFinal() {
      const title = (draft.title || '').trim();
      if (!title) { showToast('Enter a program title first.', true); return; }
      draft.name = title;
      draft.programId = draft.programId || `prog-${Date.now()}`;
      draft.coachId = draft.coachId || userId;
      core.upsertProgram(window, core.normalizeDraft(draft));
      persistDraft();
      showToast('✅ Program saved!');
    }

    function saveTemplate() {
      if (!(draft.title || '').trim()) { showToast('Add a title first.', true); return; }
      core.saveProgramTemplate(window, draft);
      showToast('📋 Template saved!');
    }

    function assignToClient() {
      if (!(draft.title || '').trim()) { showToast('Save the program first.', true); return; }
      const clientName = advancedForm.clientName.trim();
      if (!clientName) { showToast('Enter a client name.', true); return; }
      core.assignProgramToClient(window, {
        coachId: userId, clientId: advancedForm.clientId || null,
        clientName, archetype: draft.archetype || 'general',
        notes: advancedForm.assignmentNotes || '',
        program: draft,
      });
      showToast(`✅ Assigned to ${clientName}`);
    }

    function startFresh() {
      window.showConfirm('Clear the current draft and start a new program?').then(ok => {
        if (!ok) return;
        draft = core.normalizeDraft(core.createEmptyDraft(userId));
        selectedDayId = null;
        pickerQuery = '';
        pickerCategory = 'All';
        step = 'goal';
        persistDraft();
        render();
      });
    }

    /* ── Picker helpers ─ */

    function filteredExercises() {
      const q = pickerQuery.toLowerCase().trim();
      const cats = pickerCategory === 'All' ? Object.keys(EXERCISE_LIB) : [pickerCategory];
      const results = [];
      for (const cat of cats) {
        for (const name of (EXERCISE_LIB[cat] || [])) {
          if (!q || name.toLowerCase().includes(q)) results.push(name);
        }
      }
      // Also allow adding exactly what the user typed if no exact match
      if (q && !results.some(r => r.toLowerCase() === q)) {
        results.unshift(pickerQuery.trim()); // custom exercise at top
      }
      return results;
    }

    /* ══════════════════════════════════════════════════════════════
       RENDER FUNCTIONS
    ══════════════════════════════════════════════════════════════ */

    /* ── Main render — full repaint ─ */
    function render() {
      mountEl.innerHTML = '';
      mountEl.appendChild(buildRoot());
    }

    function buildRoot() {
      const root = document.createElement('div');
      root.className = 'pbv2-root';
      root.appendChild(buildStepper());
      const content = document.createElement('div');
      content.className = 'pbv2-content';
      if (step === 'goal')      content.appendChild(buildGoalStep());
      else if (step === 'split') content.appendChild(buildSplitStep());
      else if (step === 'exercises') {
        content.appendChild(buildExercisesStep());
      }
      else if (step === 'schedule') content.appendChild(buildScheduleStep());
      else if (step === 'save')   content.appendChild(buildSaveStep());
      root.appendChild(content);
      root.appendChild(buildNav());
      return root;
    }

    /* ── Step indicator ─ */
    function buildStepper() {
      const nav = document.createElement('div');
      nav.className = 'pbv2-stepper';
      const currentIdx = stepIndex(step);

      STEPS.forEach((s, i) => {
        const meta = STEP_META[s];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pbv2-step' +
          (s === step ? ' active' : '') +
          (i < currentIdx ? ' done' : '');
        btn.innerHTML = `
          <span class="pbv2-step-icon">${i < currentIdx ? '✓' : meta.icon}</span>
          <span class="pbv2-step-label">${meta.label}</span>
        `;
        // Allow clicking back to completed steps
        if (i <= currentIdx) {
          btn.addEventListener('click', () => goToStep(s));
        }
        nav.appendChild(btn);
      });
      return nav;
    }

    /* ── Nav (Back / Next) ─ */
    function buildNav() {
      const nav = document.createElement('div');
      nav.className = 'pbv2-nav';

      const backBtn = document.createElement('button');
      backBtn.className = 'pbv2-nav-back';
      backBtn.type = 'button';
      backBtn.textContent = stepIndex(step) === 0 ? 'New' : '← Back';
      backBtn.addEventListener('click', () => {
        if (stepIndex(step) === 0) startFresh();
        else prevStep();
      });

      const nextBtn = document.createElement('button');
      nextBtn.className = 'pbv2-nav-next';
      nextBtn.type = 'button';
      nextBtn.textContent = step === 'save' ? 'Save Program ✅' : 'Continue →';
      nextBtn.addEventListener('click', () => {
        if (step === 'save') saveFinal();
        else nextStep();
      });

      nav.appendChild(backBtn);
      nav.appendChild(nextBtn);
      return nav;
    }

    /* ── Goal step ─ */
    function buildGoalStep() {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="pbv2-step-heading">
          <h2>What's your training goal?</h2>
          <p>This shapes how your program is structured.</p>
        </div>
        <div class="pbv2-goal-grid"></div>
      `;
      const grid = wrap.querySelector('.pbv2-goal-grid');
      GOALS.forEach(g => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'pbv2-goal-card' + (draft.archetype === g.value ? ' selected' : '');
        card.innerHTML = `
          <span class="pbv2-goal-icon">${g.icon}</span>
          <div class="pbv2-goal-label">${esc(g.label)}</div>
          <div class="pbv2-goal-desc">${esc(g.desc)}</div>
        `;
        card.addEventListener('click', () => setGoal(g.value));
        grid.appendChild(card);
      });
      return wrap;
    }

    /* ── Split step ─ */
    function buildSplitStep() {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="pbv2-step-heading">
          <h2>Choose a training split</h2>
          <p>How many days per week do you want to train?</p>
        </div>
        <div class="pbv2-split-list"></div>
      `;
      const list = wrap.querySelector('.pbv2-split-list');
      SPLITS.forEach(sp => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'pbv2-split-card' + (draft.split?.type === sp.type ? ' selected' : '');
        card.innerHTML = `
          <span class="pbv2-split-icon">${sp.icon}</span>
          <div class="pbv2-split-info">
            <div class="pbv2-split-label">${esc(sp.label)}</div>
            <span class="pbv2-split-days-badge">${esc(sp.badge)}</span>
            <div class="pbv2-split-desc">${esc(sp.desc)}</div>
            <div class="pbv2-split-rec">${esc(sp.rec)}</div>
          </div>
        `;
        card.addEventListener('click', () => setSplit(sp.type, sp.days));
        list.appendChild(card);
      });
      return wrap;
    }

    /* ── Exercises step — layout shell ─ */
    function buildExercisesStep() {
      const wrap = document.createElement('div');
      wrap.id = 'pbv2ExWrap';
      wrap.innerHTML = `
        <div class="pbv2-step-heading" style="padding-bottom:0;">
          <h2>Add exercises to each day</h2>
          <p>Search the library or type any name to add a custom exercise.</p>
        </div>
        <div class="pbv2-ex-layout">
          <div class="pbv2-day-pane" id="pbv2DayPane"></div>
          <div class="pbv2-exercise-pane" id="pbv2ExPane"></div>
        </div>
      `;
      _renderDayPane(wrap.querySelector('#pbv2DayPane'));
      _renderExercisePane(wrap.querySelector('#pbv2ExPane'));
      return wrap;
    }

    /* ── Partial re-render for exercises (keeps picker query/category) ─ */
    function renderExercisesPane() {
      const dayPane = document.getElementById('pbv2DayPane');
      const exPane  = document.getElementById('pbv2ExPane');
      if (!dayPane || !exPane) { render(); return; }
      _renderDayPane(dayPane);
      _renderExercisePane(exPane);
    }

    function _renderDayPane(host) {
      host.innerHTML = '';
      (draft.days || []).forEach(day => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pbv2-day-btn' + (day.dayId === selectedDayId ? ' active' : '');
        const exCount = (day.exercises || []).length;
        btn.innerHTML = `
          ${esc(day.name)}
          <span class="pbv2-day-btn-meta">${exCount} exercise${exCount !== 1 ? 's' : ''}</span>
          <span class="pbv2-day-actions">
            <span class="pbv2-day-action-btn" data-act="rename" data-id="${day.dayId}" title="Rename">✏️</span>
            <span class="pbv2-day-action-btn" data-act="delete" data-id="${day.dayId}" title="Delete">🗑️</span>
          </span>
        `;
        btn.addEventListener('click', e => {
          const act = e.target.closest('[data-act]');
          if (act) {
            e.stopPropagation();
            if (act.dataset.act === 'rename') renameDay(act.dataset.id);
            else if (act.dataset.act === 'delete') deleteDay(act.dataset.id);
            return;
          }
          selectDay(day.dayId);
        });
        host.appendChild(btn);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'pbv2-add-day-btn';
      addBtn.textContent = '+ Add Day';
      addBtn.addEventListener('click', addDay);
      host.appendChild(addBtn);
    }

    /* ── Template helpers ─────────────────────────────────────── */

    /** Pull all workout templates the user has saved. */
    function _getAvailableTemplates() {
      // Prefer the in-memory cache populated when the Logbook Templates tab loads
      if (Array.isArray(window.resistanceTemplatesCache) && window.resistanceTemplatesCache.length) {
        return window.resistanceTemplatesCache;
      }
      // Fallback: read directly from localStorage
      const user = window.currentUser || localStorage.getItem('fitnessAppUser') || '';
      if (!user) return [];
      try {
        const raw = JSON.parse(localStorage.getItem(`managedTemplates_${user}`)) || [];
        return raw
          .map(t => ({
            id:   t.localId || t.id || String(Date.now()),
            name: t.name || 'Untitled',
            data: typeof t.data === 'string' ? JSON.parse(t.data) : t.data
          }))
          .filter(t => t.data && typeof t.data === 'object');
      } catch { return []; }
    }

    /** Load all exercises from a template into the currently selected day. */
    function _loadTemplateIntoDay(dayId, templateId) {
      if (!dayId) return;
      const tpl = _getAvailableTemplates().find(t => t.id === templateId);
      if (!tpl) return;

      const day = (draft.days || []).find(d => d.dayId === dayId);
      if (!day) return;

      const tplExercises = Array.isArray(tpl.data?.exercises) ? tpl.data.exercises : [];
      if (!tplExercises.length) {
        window.showToast('This template has no exercises.', 'warn');
        return;
      }

      // Map template exercise format → program-builder exercise format
      const mapped = tplExercises.map(ex => ({
        exerciseId: uuid(),
        name:       ex.name || 'Exercise',
        notes:      ex.notes || '',
        rirNote: '', rpeNote: '', progressionNotes: '',
        archetypeTags: [draft.archetype || 'general'],
        sets: (Array.isArray(ex.sets) && ex.sets.length
          ? ex.sets.map(s => ({
              setType: s.setType || 'straight',
              reps:    Number(s.targetReps)  || 8,
              weight:  Number(s.targetWeight) || null,
              rpe: null, rir: null, restSec: 120
            }))
          : [{ setType: 'straight', reps: 8, weight: null, rpe: null, rir: null, restSec: 120 }]
        )
      }));

      day.exercises = [...(day.exercises || []), ...mapped];
      persistDraft();
      renderExercisesPane();
      window.showToast(
        `✅ "${tpl.name}" loaded — ${mapped.length} exercise${mapped.length !== 1 ? 's' : ''} added`,
        'success', 4000
      );
    }

    function _renderExercisePane(host) {
      host.innerHTML = '';

      // Ensure a day is selected
      if (!selectedDayId && draft.days?.length) selectedDayId = draft.days[0].dayId;
      const day = (draft.days || []).find(d => d.dayId === selectedDayId);

      if (!day) {
        host.innerHTML = '<div class="pbv2-no-exercises">Add a day first →</div>';
        return;
      }

      /* ── Template loader strip ──────────────────────────────── */
      const availableTpls = _getAvailableTemplates();
      if (availableTpls.length) {
        const strip = document.createElement('div');
        strip.className = 'pbv2-template-strip';
        strip.title = 'Load a saved workout template into this day';

        const sel = document.createElement('select');
        sel.className = 'pbv2-template-select';
        sel.innerHTML =
          '<option value="">📋 Load from template…</option>' +
          availableTpls.map(t =>
            `<option value="${esc(t.id)}">${esc(t.name)}</option>`
          ).join('');

        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'pbv2-template-load-btn';
        loadBtn.textContent = 'Load';
        loadBtn.addEventListener('click', () => {
          const id = sel.value;
          if (!id) { window.showToast('Choose a template first.', 'warn'); return; }
          _loadTemplateIntoDay(selectedDayId, id);
          sel.value = '';
        });

        strip.appendChild(sel);
        strip.appendChild(loadBtn);
        host.appendChild(strip);
      }

      /* Exercise picker */
      const picker = document.createElement('div');
      picker.className = 'pbv2-picker';

      const pickerHeader = document.createElement('div');
      pickerHeader.className = 'pbv2-picker-header';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'pbv2-picker-search';
      searchInput.placeholder = '🔍 Search or type any exercise…';
      searchInput.value = pickerQuery;
      searchInput.addEventListener('input', e => {
        pickerQuery = e.target.value;
        _updatePickerList(pickerList);
      });
      pickerHeader.appendChild(searchInput);

      // Category pills
      const catsRow = document.createElement('div');
      catsRow.className = 'pbv2-picker-cats';
      ['All', ...Object.keys(EXERCISE_LIB)].forEach(cat => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'pbv2-cat-pill' + (pickerCategory === cat ? ' active' : '');
        pill.textContent = cat;
        pill.addEventListener('click', () => {
          pickerCategory = cat;
          _updatePickerList(pickerList);
          catsRow.querySelectorAll('.pbv2-cat-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
        });
        catsRow.appendChild(pill);
      });

      picker.appendChild(pickerHeader);
      picker.appendChild(catsRow);

      const pickerList = document.createElement('div');
      pickerList.className = 'pbv2-picker-list';
      _updatePickerList(pickerList);
      picker.appendChild(pickerList);
      host.appendChild(picker);

      /* Current exercises for this day */
      if ((day.exercises || []).length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pbv2-no-exercises';
        empty.textContent = 'Tap an exercise above to add it here.';
        host.appendChild(empty);
      } else {
        (day.exercises || []).forEach(ex => {
          host.appendChild(_buildExCard(day.dayId, ex));
        });
      }
    }

    function _updatePickerList(listEl) {
      listEl.innerHTML = '';
      const items = filteredExercises();
      if (!items.length) {
        listEl.innerHTML = '<div class="pbv2-picker-empty">No matches — type a name to add a custom exercise.</div>';
        return;
      }
      items.slice(0, 40).forEach(name => {
        const row = document.createElement('div');
        row.className = 'pbv2-picker-row';
        row.innerHTML = `<span class="pbv2-picker-row-name">${esc(name)}</span><span class="pbv2-picker-row-add">+</span>`;
        row.addEventListener('click', () => {
          addExercise(name);
          // Clear search after adding
          pickerQuery = '';
          const inp = row.closest('.pbv2-picker')?.querySelector('.pbv2-picker-search');
          if (inp) inp.value = '';
          _updatePickerList(listEl);
        });
        listEl.appendChild(row);
      });
    }

    function _buildExCard(dayId, ex) {
      const card = document.createElement('div');
      card.className = 'pbv2-ex-card';

      const header = document.createElement('div');
      header.className = 'pbv2-ex-card-header';
      header.innerHTML = `
        <span class="pbv2-ex-card-name">${esc(ex.name)}</span>
        <button type="button" class="pbv2-ex-card-remove" title="Remove exercise">✕</button>
      `;
      header.querySelector('button').addEventListener('click', () => removeExercise(dayId, ex.exerciseId));
      card.appendChild(header);

      /* Sets table */
      const table = document.createElement('table');
      table.className = 'pbv2-sets-table';
      table.innerHTML = `
        <thead><tr>
          <th>#</th><th>Reps</th><th>Weight</th><th>RPE</th><th></th>
        </tr></thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector('tbody');
      (ex.sets || []).forEach((s, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="color:var(--text-muted,#7a8f7d);font-size:0.78rem;">${idx + 1}</td>
          <td><input type="number" min="1" max="100" step="1" value="${s.reps ?? ''}" placeholder="—"></td>
          <td><input type="number" min="0" step="0.5" value="${s.weight ?? ''}" placeholder="—"></td>
          <td><input type="number" min="1" max="10" step="0.5" value="${s.rpe ?? ''}" placeholder="—"></td>
          <td><button type="button" class="pbv2-del-set-btn" title="Remove set">✕</button></td>
        `;
        const [, repsInp, weightInp, rpeInp] = tr.querySelectorAll('input');
        repsInp.addEventListener('change', e => updateSetField(dayId, ex.exerciseId, idx, 'reps', e.target.value));
        weightInp.addEventListener('change', e => updateSetField(dayId, ex.exerciseId, idx, 'weight', e.target.value));
        rpeInp.addEventListener('change', e => updateSetField(dayId, ex.exerciseId, idx, 'rpe', e.target.value));
        tr.querySelector('button').addEventListener('click', () => removeSet(dayId, ex.exerciseId, idx));
        tbody.appendChild(tr);
      });
      card.appendChild(table);

      const addSetBtn = document.createElement('button');
      addSetBtn.type = 'button';
      addSetBtn.className = 'pbv2-add-set-btn';
      addSetBtn.textContent = '+ Add Set';
      addSetBtn.addEventListener('click', () => addSet(dayId, ex.exerciseId));
      card.appendChild(addSetBtn);

      return card;
    }

    /* ── Schedule step ─ */
    function buildScheduleStep() {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="pbv2-step-heading">
          <h2>When do you train?</h2>
          <p>Pick your training days and an optional start date.</p>
        </div>
        <div class="pbv2-schedule-body">
          <p class="pbv2-schedule-label">Start date (optional)</p>
          <input type="date" id="pbv2StartDate" class="pbv2-date-input" value="${esc(draft.schedule?.startDate || '')}">

          <p class="pbv2-schedule-label">Training days</p>
          <div class="pbv2-weekday-row" id="pbv2WdRow"></div>
          <p class="pbv2-wd-hint" id="pbv2WdHint"></p>
        </div>
      `;

      wrap.querySelector('#pbv2StartDate').addEventListener('change', e => {
        draft.schedule = draft.schedule || { startDate: '', weekdays: [] };
        draft.schedule.startDate = e.target.value;
        persistDraft();
      });

      const wdRow = wrap.querySelector('#pbv2WdRow');
      const hint  = wrap.querySelector('#pbv2WdHint');

      function updateHint() {
        const count = (draft.schedule?.weekdays || []).length;
        hint.textContent = count ? `${count} day${count !== 1 ? 's' : ''} / week selected.` : 'Tap days to select.';
      }

      WEEKDAYS.forEach((label, i) => {
        const wd = i + 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pbv2-wd-btn' + ((draft.schedule?.weekdays || []).includes(wd) ? ' active' : '');
        btn.textContent = label;
        btn.addEventListener('click', () => {
          draft.schedule = draft.schedule || { startDate: '', weekdays: [] };
          const set = new Set(draft.schedule.weekdays || []);
          set.has(wd) ? set.delete(wd) : set.add(wd);
          draft.schedule.weekdays = Array.from(set).sort((a, b) => a - b);
          btn.classList.toggle('active', set.has(wd));
          persistDraft();
          updateHint();
        });
        wdRow.appendChild(btn);
      });

      updateHint();
      return wrap;
    }

    /* ── Save step ─ */
    function buildSaveStep() {
      const summary = core.computeProgramSummary(draft);
      const splitLabels = { fullbody: 'Full Body', upperlower: 'Upper/Lower', ppl: 'Push/Pull/Legs', custom: 'Custom' };
      const goalLabels  = { strength: 'Strength', hypertrophy: 'Muscle Growth', 'fat-loss': 'Fat Loss', general: 'General Fitness' };
      const wdNames = (draft.schedule?.weekdays || []).map(d => WEEKDAYS[d - 1]).join(', ');

      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="pbv2-step-heading">
          <h2>Save your program</h2>
          <p>Give it a name, then hit Save.</p>
        </div>
        <div class="pbv2-save-body">
          <input type="text" id="pbv2TitleInput" class="pbv2-title-input"
            placeholder="Program title (e.g., My 4-Day Bulk)" value="${esc(draft.title || draft.name || '')}">

          <div class="pbv2-summary-card">
            <div class="pbv2-summary-row">
              <span class="pbv2-summary-label">Goal</span>
              <span class="pbv2-summary-value">${esc(goalLabels[draft.archetype] || draft.archetype)}</span>
            </div>
            <div class="pbv2-summary-row">
              <span class="pbv2-summary-label">Split</span>
              <span class="pbv2-summary-value">${esc(splitLabels[draft.split?.type] || draft.split?.type || '—')}</span>
            </div>
            <div class="pbv2-summary-row">
              <span class="pbv2-summary-label">Days</span>
              <span class="pbv2-summary-value">${summary.dayCount}</span>
            </div>
            <div class="pbv2-summary-row">
              <span class="pbv2-summary-label">Exercises</span>
              <span class="pbv2-summary-value">${summary.exerciseCount}</span>
            </div>
            <div class="pbv2-summary-row">
              <span class="pbv2-summary-label">Schedule</span>
              <span class="pbv2-summary-value">${esc(wdNames || 'Not set')}</span>
            </div>
          </div>

          <button type="button" class="pbv2-save-btn" id="pbv2SaveFinalBtn">Save Program ✅</button>

          <details class="pbv2-save-advanced">
            <summary>Advanced — Templates &amp; Client Assignment</summary>
            <div class="pbv2-save-advanced-body">
              <label>Progression notes
                <textarea id="pbv2ProgNotes" rows="2" placeholder="e.g., Add 2.5 kg each week...">${esc(draft.progressionNotes || '')}</textarea>
              </label>
              <div class="pbv2-advanced-btn-row">
                <button type="button" class="pbv2-advanced-btn" id="pbv2SaveTplBtn">💾 Save as Template</button>
              </div>
              <label>Client name
                <input type="text" id="pbv2ClientName" placeholder="e.g., Alex Smith" value="${esc(advancedForm.clientName)}">
              </label>
              <label>Assignment notes (optional)
                <textarea id="pbv2AssignNotes" rows="2" placeholder="optional">${esc(advancedForm.assignmentNotes)}</textarea>
              </label>
              <div class="pbv2-advanced-btn-row">
                <button type="button" class="pbv2-advanced-btn" id="pbv2AssignBtn">👤 Assign to Client</button>
              </div>
            </div>
          </details>
        </div>
      `;

      wrap.querySelector('#pbv2TitleInput').addEventListener('input', e => {
        draft.title = e.target.value;
        draft.name  = e.target.value;
        persistDraft();
      });
      wrap.querySelector('#pbv2ProgNotes').addEventListener('input', e => {
        draft.progressionNotes = e.target.value;
        persistDraft();
      });
      wrap.querySelector('#pbv2ClientName').addEventListener('input', e => { advancedForm.clientName = e.target.value; });
      wrap.querySelector('#pbv2AssignNotes').addEventListener('input', e => { advancedForm.assignmentNotes = e.target.value; });

      wrap.querySelector('#pbv2SaveFinalBtn').addEventListener('click', saveFinal);
      wrap.querySelector('#pbv2SaveTplBtn').addEventListener('click', saveTemplate);
      wrap.querySelector('#pbv2AssignBtn').addEventListener('click', assignToClient);

      return wrap;
    }

    /* ── Initial render ─ */
    render();
  }

  /* ══════════════════════════════════════════════════════════════
     MY PROGRAMS — list view
  ══════════════════════════════════════════════════════════════ */

  function renderProgramList() {
    const container = document.getElementById('progListContainer');
    if (!container) return;

    const core = window.programBuilderV2Core;
    if (!core) { container.innerHTML = '<div style="padding:16px;color:#eb5757">Core not loaded.</div>'; return; }

    const programs = core.loadPrograms(window);

    const header = document.createElement('div');
    header.className = 'prog-list-header';
    header.innerHTML = `
      <h2>My Programs</h2>
      <button type="button" class="prog-list-new-btn" onclick="showProgramView('build')">+ New Program</button>
    `;

    container.innerHTML = '';
    container.appendChild(header);

    if (!programs.length) {
      const empty = document.createElement('div');
      empty.className = 'prog-list-empty';
      empty.innerHTML = `
        <span class="prog-list-empty-icon">🏋️</span>
        <p>No programs saved yet.</p>
        <button type="button" class="prog-list-empty-btn" onclick="showProgramView('build')">Build Your First Program</button>
      `;
      container.appendChild(empty);
      return;
    }

    const splitLabels = { fullbody: 'Full Body', upperlower: 'Upper/Lower', ppl: 'PPL', custom: 'Custom' };
    const goalLabels  = { strength: 'Strength', hypertrophy: 'Hypertrophy', 'fat-loss': 'Fat Loss', general: 'General' };

    programs.slice().reverse().forEach((prog, revIdx) => {
      const origIdx = programs.length - 1 - revIdx;
      const exCount = Array.isArray(prog.days)
        ? prog.days.reduce((n, d) => n + (d.exercises?.length || 0), 0)
        : 0;
      const dayCount = Array.isArray(prog.days) ? prog.days.length : 0;
      const splitLabel = splitLabels[prog.split?.type] || prog.split?.type || '—';
      const goalLabel  = goalLabels[prog.archetype] || prog.archetype || '—';

      const card = document.createElement('div');
      card.className = 'prog-card';
      card.innerHTML = `
        <div class="prog-card-title">${esc(prog.name || prog.title || 'Untitled Program')}</div>
        <div class="prog-card-meta">${dayCount} day${dayCount !== 1 ? 's' : ''} · ${exCount} exercise${exCount !== 1 ? 's' : ''}</div>
        <div class="prog-card-badges">
          <span class="prog-badge">${esc(splitLabel)}</span>
          <span class="prog-badge">${esc(goalLabel)}</span>
        </div>
        <div class="prog-card-actions">
          <button type="button" class="prog-card-load" data-idx="${origIdx}">Load into Builder</button>
          <button type="button" class="prog-card-del" data-idx="${origIdx}">Delete</button>
        </div>
      `;

      card.querySelector('.prog-card-load').addEventListener('click', () => {
        // Load this program into the draft and switch to builder
        const core = window.programBuilderV2Core;
        if (!core) return;
        const userId = (window.getActiveUsername && window.getActiveUsername()) ||
          localStorage.getItem('username') || localStorage.getItem('Username') || 'anonymous';
        const fresh = core.normalizeDraft(programs[origIdx]);
        core.saveDraft(userId, fresh);
        // Force re-init of builder
        const builderMount = document.getElementById('programBuilderV2Mount');
        if (builderMount) {
          builderMount.__pbv2Mounted = false;
          builderMount.innerHTML = '';
        }
        const builderContainer = document.getElementById('programBuilderContainer');
        if (builderContainer) builderContainer.__programBuilderMounted = false;
        showProgramView('build');
        if (typeof window.initProgramBuilder === 'function') window.initProgramBuilder();
      });

      card.querySelector('.prog-card-del').addEventListener('click', () => {
        const name = prog.name || prog.title || 'this program';
        window.showConfirm(`Delete "${name}"?`, { danger: true }).then(ok => {
          if (!ok) return;
          const core = window.programBuilderV2Core;
          if (!core) return;
          const all = core.loadPrograms(window);
          all.splice(origIdx, 1);
          core.savePrograms(window, all);
          renderProgramList();
        });
      });

      container.appendChild(card);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     GLOBAL: switch between Build / List views
  ══════════════════════════════════════════════════════════════ */

  window.showProgramView = function showProgramView(view) {
    const builderContainer = document.getElementById('programBuilderContainer');
    const listView         = document.getElementById('progListView');
    const btns             = document.querySelectorAll('#progTopNav .prog-top-btn');

    if (view === 'list') {
      if (builderContainer) builderContainer.style.display = 'none';
      if (listView) { listView.style.display = ''; renderProgramList(); }
      btns.forEach((b, i) => b.classList.toggle('active', i === 1));
    } else {
      if (builderContainer) builderContainer.style.display = '';
      if (listView) listView.style.display = 'none';
      btns.forEach((b, i) => b.classList.toggle('active', i === 0));
      // Init if not already mounted
      if (typeof window.initProgramBuilder === 'function') window.initProgramBuilder();
    }
  };

  window.initProgramTabV2 = initProgramTabV2;

})();
