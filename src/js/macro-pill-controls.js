// =============================================================
// MACRO PILL CONTROLS
// Progressive-enhancement layer for the Macros tab redesign: turns
// a handful of native <select>/checkbox-driven bits of UI (Carb
// Day, Macro Preset, Sex, Activity Level, and per-macro quick-add)
// into tappable segmented pills / chips, while the real <select> or
// <input> stays in the DOM (visually hidden via .macro-seg-hidden)
// so every existing read/save/validation code path — presetMap,
// getMacroCyclingSettings(), readPersonalDetailsFromDOM(), the
// carbCycleSelect/refeedDayToggle/trainingDayToggle "change" listener
// that persists+refreshes the day context — keeps working unchanged.
// =============================================================

(function () {
  // ── Quick-add chips (Targets tab) ───────────────────────────
  // Reuses the exact same addMacro()/subtractMacro() the manual
  // qty input + ± buttons already call, just pre-filling the qty.
  window.quickAddMacro = function quickAddMacro(type, amount) {
    const inputMap = { cal: 'qaCals', protein: 'qaProtein', carbs: 'qaCarbs', fat: 'qaFat' };
    const input = document.getElementById(inputMap[type]);
    if (input) input.value = Math.abs(amount);
    if (amount < 0) {
      window.subtractMacro?.(type);
    } else {
      window.addMacro?.(type);
    }
  };

  // ── Generic segmented-pill <-> <select> sync ────────────────
  // Sets the real select's value, fires a real "change" event (so
  // any existing listener — e.g. the one that persists Carb Day and
  // re-runs updateMacroUI() — still fires exactly as if the user had
  // picked the option natively), then reflects the active pill.
  window.setSegValue = function setSegValue(selectId, btn) {
    const select = document.getElementById(selectId);
    if (!select || !btn) return;
    select.value = btn.dataset.val;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncSegRow(selectId);
  };

  function syncSegRow(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    document.querySelectorAll(`.macro-seg-row[data-macro-seg-for="${selectId}"] .macro-seg-btn`).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.val === select.value);
    });
  }

  // ── Macro Preset: two-step Goal x Rate picker ───────────────
  // presetMap (defined in index.html) maps e.g. "cut-slow" -> {goal,
  // rate}; this does the reverse — picked goal+rate -> preset key —
  // then drives #macroPreset exactly like picking it from the old
  // dropdown would, including the existing "missing personal details"
  // modal/alert fallback in that select's change listener.
  function currentPresetKeyFromForm() {
    const goalBtn = document.querySelector('#macroGoalSegRow .macro-seg-btn.active');
    const rateBtn = document.querySelector('#macroRateSegRow .macro-seg-btn.active');
    const goal = goalBtn?.dataset.val;
    if (!goal) return null;
    if (goal === 'maintain') return 'maintain';
    const rate = rateBtn?.dataset.val || 'moderate';
    return `${goal}-${rate}`;
  }

  function applyMacroPresetFromForm() {
    const key = currentPresetKeyFromForm();
    const select = document.getElementById('macroPreset');
    if (!key || !select) return;
    select.value = key;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  window.selectMacroGoal = function selectMacroGoal(btn) {
    document.querySelectorAll('#macroGoalSegRow .macro-seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    const rateRow = document.getElementById('macroRateSegRow');
    const rateLabel = document.getElementById('macroRateLabel');
    const isMaintain = btn.dataset.val === 'maintain';
    rateRow?.classList.toggle('is-hidden', isMaintain);
    rateLabel?.classList.toggle('is-hidden', isMaintain);
    if (!isMaintain && !document.querySelector('#macroRateSegRow .macro-seg-btn.active')) {
      document.querySelector('#macroRateSegRow .macro-seg-btn[data-val="moderate"]')?.classList.add('active');
    }
    applyMacroPresetFromForm();
  };

  window.selectMacroRate = function selectMacroRate(btn) {
    document.querySelectorAll('#macroRateSegRow .macro-seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    applyMacroPresetFromForm();
  };

  function syncPresetSegFromSelect() {
    const select = document.getElementById('macroPreset');
    const preset = select && window.presetMap ? window.presetMap[select.value] : null;
    if (!preset) return;
    document.querySelectorAll('#macroGoalSegRow .macro-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === preset.goal));
    document.querySelectorAll('#macroRateSegRow .macro-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === preset.rate));
    const isMaintain = preset.goal === 'maintain';
    document.getElementById('macroRateSegRow')?.classList.toggle('is-hidden', isMaintain);
    document.getElementById('macroRateLabel')?.classList.toggle('is-hidden', isMaintain);
  }

  // ── Keep pills matched to whatever the underlying control holds ──
  // Several code paths set carbCycleSelect/sex/activity/#macroPreset
  // .value directly (loadMacroDayContext, loadPersonalDetailsToDOM,
  // applyPersonalDetailsToMacroForm, ...) without going through a
  // pill click, and plain .value assignment doesn't fire "change".
  // Poll instead of hooking every call site — same idiom this file's
  // neighbour (archetype-features.js's macro-ring sync) already uses.
  function syncAllMacroSegRows() {
    ['carbCycleSelect', 'sex', 'activity'].forEach(syncSegRow);
    syncPresetSegFromSelect();
  }

  document.addEventListener('DOMContentLoaded', () => {
    let pollId = setInterval(syncAllMacroSegRows, 400);
    syncAllMacroSegRows();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearInterval(pollId);
        pollId = 0;
      } else if (!pollId) {
        pollId = setInterval(syncAllMacroSegRows, 400);
        syncAllMacroSegRows();
      }
    });
  });
})();
