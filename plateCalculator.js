(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(global || globalThis);
  } else {
    const api = factory(global || globalThis);
    if (global) {
      global.PlateCalculator = api;
      global.calculatePlateCombination = api.calculatePlateCombination;
      global.openPlateCalculator = api.openPlateCalculator;
    }
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
  const PREFS_KEY = 'plateCalculatorPrefs_v1';
  const DEFAULT_BAR_WEIGHT = 20;
  const DEFAULT_PLATES = [
    { size: 25, count: 2 },
    { size: 20, count: 2 },
    { size: 15, count: 2 },
    { size: 10, count: 2 },
    { size: 5, count: 2 },
    { size: 2.5, count: 2 },
    { size: 1.25, count: 2 }
  ];

  let activeSetIndex = null;
  let lastResult = null;

  function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function loadPrefs() {
    try {
      const raw = global.localStorage?.getItem(PREFS_KEY);
      if (!raw) {
        return { barWeight: DEFAULT_BAR_WEIGHT, plates: DEFAULT_PLATES.map((p) => ({ ...p })) };
      }
      const parsed = JSON.parse(raw);
      const plateMap = new Map();
      DEFAULT_PLATES.forEach((p) => plateMap.set(p.size, { ...p }));
      if (Array.isArray(parsed?.plates)) {
        parsed.plates.forEach((p) => {
          const size = parseNumber(p?.size, NaN);
          if (!Number.isFinite(size) || size <= 0) return;
          plateMap.set(size, {
            size,
            count: Math.max(0, Math.floor(parseNumber(p?.count, 0)))
          });
        });
      }
      return {
        barWeight: parseNumber(parsed?.barWeight, DEFAULT_BAR_WEIGHT),
        plates: Array.from(plateMap.values()).sort((a, b) => b.size - a.size)
      };
    } catch (error) {
      console.warn('Unable to load plate calculator preferences', error);
      return { barWeight: DEFAULT_BAR_WEIGHT, plates: DEFAULT_PLATES.map((p) => ({ ...p })) };
    }
  }

  function savePrefs(prefs) {
    try {
      global.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (error) {
      console.warn('Unable to save plate calculator preferences', error);
    }
  }

  function calculatePlateCombination(targetWeight, barWeight, plates) {
    const target = parseNumber(targetWeight, NaN);
    const bar = parseNumber(barWeight, NaN);
    const normalizedPlates = Array.isArray(plates)
      ? plates
          .map((p) => ({
            size: parseNumber(p?.size, 0),
            count: Math.max(0, Math.floor(parseNumber(p?.count, 0)))
          }))
          .filter((p) => p.size > 0 && p.count > 0)
          .sort((a, b) => b.size - a.size)
      : [];

    if (!Number.isFinite(target) || !Number.isFinite(bar) || target <= 0 || bar < 0) {
      return {
        success: false,
        message: 'Please provide valid target and barbell weights.',
        combination: [],
        achievedWeight: bar
      };
    }

    const perSide = (target - bar) / 2;
    if (perSide < 0) {
      return {
        success: false,
        message: 'Target weight must be at least the barbell weight.',
        combination: [],
        achievedWeight: bar
      };
    }

    const scale = 100;
    const targetUnits = Math.round(perSide * scale);
    let states = new Map([[0, new Array(normalizedPlates.length).fill(0)]]);

    normalizedPlates.forEach((plate, idx) => {
      const pairsAvailable = Math.floor(plate.count / 2);
      if (pairsAvailable <= 0) return;
      const plateUnits = Math.round(plate.size * scale);
      const nextStates = new Map(states);

      states.forEach((combo, sum) => {
        for (let pairCount = 1; pairCount <= pairsAvailable; pairCount += 1) {
          const nextSum = sum + pairCount * plateUnits;
          if (nextSum > targetUnits) break;
          if (!nextStates.has(nextSum)) {
            const nextCombo = combo.slice();
            nextCombo[idx] += pairCount;
            nextStates.set(nextSum, nextCombo);
          }
        }
      });

      states = nextStates;
    });

    const possibleSums = Array.from(states.keys()).sort((a, b) => b - a);
    const bestSum = possibleSums.find((sum) => sum <= targetUnits) ?? 0;
    const bestCombo = states.get(bestSum) || new Array(normalizedPlates.length).fill(0);
    const combination = normalizedPlates
      .map((plate, idx) => ({ size: plate.size, pairs: bestCombo[idx] || 0 }))
      .filter((item) => item.pairs > 0);

    const achievedPerSide = bestSum / scale;
    const achievedWeight = bar + achievedPerSide * 2;
    const diff = Math.abs(target - achievedWeight);

    return {
      success: diff < 0.001,
      message:
        diff < 0.001
          ? 'Exact match found.'
          : `Exact match unavailable. Closest achievable weight is ${achievedWeight.toFixed(2)}.`,
      combination,
      achievedWeight,
      remainingWeight: Math.max(0, target - achievedWeight)
    };
  }

  function ensureModal() {
    if (!global.document) return null;
    let modal = global.document.getElementById('plateCalcModal');
    if (modal) return modal;

    modal = global.document.createElement('dialog');
    modal.id = 'plateCalcModal';
    modal.innerHTML = `
      <form method="dialog" id="plateCalcForm" style="min-width:320px;max-width:460px;">
        <h3 style="margin-top:0;">Plate Calculator</h3>
        <label style="display:block;margin-bottom:8px;">Target weight
          <input type="number" step="0.25" id="plateCalcTarget" style="width:100%;" />
        </label>
        <label style="display:block;margin-bottom:12px;">Barbell weight
          <input type="number" step="0.25" id="plateCalcBarWeight" style="width:100%;" />
        </label>
        <div id="plateCalcPlates" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin-bottom:12px;"></div>
        <div id="plateCalcResult" style="font-size:14px;margin-bottom:12px;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" id="plateCalcRun">Calculate</button>
          <button type="button" id="plateCalcApply">Apply</button>
          <button type="button" id="plateCalcClose">Close</button>
        </div>
      </form>
    `;

    global.document.body.appendChild(modal);

    const closeButton = modal.querySelector('#plateCalcClose');
    closeButton?.addEventListener('click', () => modal.close());

    modal.querySelector('#plateCalcRun')?.addEventListener('click', () => runCalculation());
    modal.querySelector('#plateCalcApply')?.addEventListener('click', () => applyCalculationToSet());

    modal.querySelector('#plateCalcBarWeight')?.addEventListener('input', persistFormPreferences);
    modal.addEventListener('input', (event) => {
      if (event.target && event.target.matches('[data-plate-size]')) {
        persistFormPreferences();
      }
    });

    return modal;
  }

  function renderPlates(plates) {
    const container = global.document?.getElementById('plateCalcPlates');
    if (!container) return;
    container.innerHTML = '';

    plates.forEach((plate) => {
      const label = global.document.createElement('label');
      label.textContent = `${plate.size} kg plates`;
      const input = global.document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = String(plate.count);
      input.setAttribute('data-plate-size', String(plate.size));
      input.style.width = '80px';
      container.appendChild(label);
      container.appendChild(input);
    });
  }

  function readPlatesFromForm() {
    const inputs = Array.from(global.document?.querySelectorAll('#plateCalcPlates input[data-plate-size]') || []);
    return inputs
      .map((input) => ({
        size: parseNumber(input.getAttribute('data-plate-size'), 0),
        count: Math.max(0, Math.floor(parseNumber(input.value, 0)))
      }))
      .filter((p) => p.size > 0)
      .sort((a, b) => b.size - a.size);
  }

  function persistFormPreferences() {
    const barWeight = parseNumber(global.document?.getElementById('plateCalcBarWeight')?.value, DEFAULT_BAR_WEIGHT);
    const plates = readPlatesFromForm();
    savePrefs({ barWeight, plates });
  }

  function runCalculation() {
    const target = parseNumber(global.document?.getElementById('plateCalcTarget')?.value, NaN);
    const barWeight = parseNumber(global.document?.getElementById('plateCalcBarWeight')?.value, DEFAULT_BAR_WEIGHT);
    const plates = readPlatesFromForm();
    const result = calculatePlateCombination(target, barWeight, plates);
    lastResult = result;

    persistFormPreferences();

    const resultEl = global.document?.getElementById('plateCalcResult');
    if (!resultEl) return result;

    if (!result.combination.length) {
      resultEl.textContent = result.message;
      return result;
    }

    const lines = result.combination.map((entry) => `${entry.size} kg × ${entry.pairs} pair${entry.pairs > 1 ? 's' : ''}`);
    resultEl.innerHTML = `
      <div>${result.message}</div>
      <div style="margin-top:6px;"><strong>Per side:</strong> ${lines.join(', ')}</div>
      <div style="margin-top:6px;"><strong>Total loaded:</strong> ${result.achievedWeight.toFixed(2)} kg</div>
    `;
    return result;
  }

  function applyCalculationToSet() {
    if (activeSetIndex == null || !lastResult) return;
    const targetInput = global.document?.getElementById(`weight_${activeSetIndex}`);
    if (!targetInput) return;
    targetInput.value = String(Number(lastResult.achievedWeight.toFixed(2)));
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    global.document.getElementById('plateCalcModal')?.close();
  }

  function openPlateCalculator(setIndex) {
    activeSetIndex = setIndex;
    const modal = ensureModal();
    if (!modal) return;

    const prefs = loadPrefs();
    renderPlates(prefs.plates);

    const weightInput = global.document.getElementById(`weight_${setIndex}`);
    const targetInput = global.document.getElementById('plateCalcTarget');
    const barInput = global.document.getElementById('plateCalcBarWeight');
    const resultEl = global.document.getElementById('plateCalcResult');
    if (targetInput) targetInput.value = weightInput?.value || '';
    if (barInput) barInput.value = String(prefs.barWeight);
    if (resultEl) resultEl.textContent = 'Enter values and click Calculate.';
    lastResult = null;

    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      modal.setAttribute('open', 'open');
    }
  }

  if (global && global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', ensureModal);
    } else {
      ensureModal();
    }
  }

  return {
    calculatePlateCombination,
    openPlateCalculator,
    loadPrefs,
    savePrefs
  };
});
