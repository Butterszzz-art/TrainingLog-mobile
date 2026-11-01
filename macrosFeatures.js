// The Meals card's camera button. Scanning, product lookup and the
// "not found → add it yourself" fallback live in src/js/food-barcode.js.
export async function scanBarcode() {
  if (typeof window.scanFoodBarcode === 'function') return window.scanFoodBarcode();
  alert('Barcode scanning is still loading — try again in a moment.');
}

// Recipe import from a link: reads the page's schema.org Recipe data
// (src/js/food-log-tools.js). Returns { protein, carbs, fat } per serving,
// or null. Never sends the user's cookies to the recipe site.
export async function importRecipe(url) {
  if (typeof window.importRecipeFromUrl !== 'function') return null;
  const { recipe } = await window.importRecipeFromUrl(url);
  const p = recipe && recipe.perServing;
  return p && (p.protein !== null || p.carbs !== null || p.fat !== null)
    ? { protein: p.protein || 0, carbs: p.carbs || 0, fat: p.fat || 0 }
    : null;
}

export function quickAdd(type, amountInputId) {
  if (window.guardMacroDayLocked?.()) return;
  const id = amountInputId || `qa${type.charAt(0).toUpperCase()+type.slice(1)}`;
  const amt = Number(document.getElementById(id)?.value || 0);
  if (!amt) return;
  const prog = JSON.parse(localStorage.getItem('dailyMacroProgress') || '{"protein":0,"carbs":0,"fats":0,"cals":0}');
  if (type === 'protein') prog.protein += amt;
  else if (type === 'carbs') prog.carbs += amt;
  else if (type === 'fat') prog.fats += amt;
  else if (type === 'cals') prog.cals = (prog.cals || 0) + amt;
  localStorage.setItem('dailyMacroProgress', JSON.stringify(prog));
  if (window.renderDailyMacroProgress) window.renderDailyMacroProgress();
}

// The Meals card's "Import recipe URL" field: opens the import, which lets
// the user check the numbers and save the recipe as one of their foods
// before logging it (it used to add the macros straight to today).
export async function fetchRecipe() {
  if (window.guardMacroDayLocked?.()) return;
  const url = document.getElementById('recipeUrl')?.value || '';
  if (typeof window.openRecipeImport === 'function') window.openRecipeImport(url);
}

export function logFavorite(meal) {
  if (!meal) return;
  const list = JSON.parse(localStorage.getItem('favMeals') || '[]');
  const found = list.find(f => f.name===meal);
  if (found) {
    quickAdd('protein');
  }
}

export function updateOfflineBadge() {
  const badge = document.getElementById('offlineBadge');
  if (badge) badge.style.display = navigator.onLine ? 'none' : 'inline-block';
}

export function renderSparklines() {
  if (!window.Chart) return;
  const key = `macroHistory_${window.currentUser || ''}`;
  const macroHistory = JSON.parse(localStorage.getItem(key) || '[]').slice(-7);
  const labels = macroHistory.map(h => h.date);
  const cals = macroHistory.map(h => (h.totals.protein*4)+(h.totals.carbs*4)+(h.totals.fats*9));
  const proteins = macroHistory.map(h => h.totals.protein);
  const calCanvas = document.getElementById('calSpark');
  const proteinCanvas = document.getElementById('proteinSpark');
  // The weekly trend charts moved to Insights; nothing to draw here.
  if (!calCanvas || !proteinCanvas) return;
  const ctx1 = calCanvas.getContext('2d');
  const ctx2 = proteinCanvas.getContext('2d');
  if (window.calChart) window.calChart.destroy();
  if (window.proChart) window.proChart.destroy();
  window.calChart = new Chart(ctx1,{type:'line',data:{labels,datasets:[{data:cals,borderColor:'#2F80ED',fill:false}]},options:{plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}}}});
  window.proChart = new Chart(ctx2,{type:'line',data:{labels,datasets:[{data:proteins,borderColor:'#F2994A',fill:false}]},options:{plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}}}});
}

const getWeeklyHistoryKey = () => `weeklyHistory_${window.currentUser || ''}`;

const getTodayString = () => {
  if (typeof window.getTodayDateString === 'function') {
    return window.getTodayDateString();
  }
  return new Date().toISOString().split('T')[0];
};

export function updateWeeklyTrend(progressOverride) {
  if (!window.Chart) return;
  const canvas = document.getElementById('weeklyTrend');
  if (!canvas) return;
  const stored = progressOverride || JSON.parse(localStorage.getItem('dailyMacroProgress') || '{"protein":0,"carbs":0,"fats":0}');
  const totalCals = (stored.protein || 0) * 4 + (stored.carbs || 0) * 4 + (stored.fats || 0) * 9;
  const entry = {
    date: getTodayString(),
    cal: totalCals,
    protein: stored.protein || 0,
    carbs: stored.carbs || 0,
    fat: stored.fats || 0,
  };

  const key = getWeeklyHistoryKey();
  const weeklyHistory = JSON.parse(localStorage.getItem(key) || '[]');
  const filtered = weeklyHistory.filter(item => item.date !== entry.date).filter(item => {
    const diff = (new Date(entry.date) - new Date(item.date)) / (1000 * 60 * 60 * 24);
    return diff <= 6;
  });
  filtered.push(entry);
  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
  localStorage.setItem(key, JSON.stringify(filtered));

  const labels = filtered.map(item => item.date);
  const dataCal = filtered.map(item => item.cal);
  const ctx = canvas.getContext('2d');
  if (window.weeklyChart) window.weeklyChart.destroy();
  window.weeklyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Calories', data: dataCal, borderColor: '#03a9f4', fill: false },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

// The "Training day" chip only changes today's split (see
// buildBodybuildingDayTargets). It used to re-run the macro calculator from a
// day preset on every load and toggle, which saved over the targets set with
// the Adjust Macros sliders (locally and on the server). Off by default = the
// saved targets as they are. The old value "training" was set for everyone
// automatically, so only the new "training-day" value turns the chip on.
const DAY_TYPE_KEY = 'macroDayType'; // per user + synced (cloud-sync.js)
const initTrainingToggle = () => {
  const toggle = document.getElementById('trainingDayToggle');
  if (!toggle) return;
  let saved = null;
  try { saved = localStorage.getItem(DAY_TYPE_KEY); } catch { /* storage blocked */ }
  toggle.checked = saved === 'training-day';
  toggle.addEventListener('change', (e) => {
    try { localStorage.setItem(DAY_TYPE_KEY, e.target.checked ? 'training-day' : 'normal'); } catch { /* storage blocked */ }
  });
  // A coach's weekly pattern decides today's day type over the saved chip
  // (index.html applyCoachMacroScheduleForToday); this runs after it did.
  if (window.applyCoachMacroScheduleForToday?.()) window.updateMacroUI?.();
};

export function renderHeatmap() {
  const container = document.getElementById('heatmap');
  if (!container) return;
  container.innerHTML = '';
  const key = `macroHistory_${window.currentUser || ''}`;
  const macroHistory = JSON.parse(localStorage.getItem(key) || '[]');
  const map = {};
  macroHistory.forEach(h => {
    const total = (h.totals.protein*4)+(h.totals.carbs*4)+(h.totals.fats*9);
    const target = (JSON.parse(localStorage.getItem(`macroTargets_${window.currentUser}`))||{}).calories||1;
    map[h.date] = Math.min(1,total/target);
  });
  for(let i=29;i>=0;i--){
    const d = new Date();
    d.setDate(d.getDate()-i);
    const keyDate = d.toISOString().slice(0,10);
    const pct = map[keyDate] || 0;
    const cell = document.createElement('div');
    const g = Math.floor(255*(1-pct));
    const r = Math.floor(255*pct);
    cell.style.background=`rgb(${r},${g},100)`;
    cell.title=keyDate;
    cell.addEventListener('click',()=>{
      if(window.loadDay) window.loadDay(keyDate);
    });
    container.appendChild(cell);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', updateOfflineBadge);
  window.addEventListener('offline', updateOfflineBadge);
}

export function planWeek(meals) {
  const groceries = {};
  meals.forEach(day => {
    day.forEach(item => {
      Object.entries(item).forEach(([k,v]) => {
        groceries[k] = (groceries[k] || 0) + v;
      });
    });
  });
  return groceries;
}

export function toggleTargetForm() {
  const main = document.getElementById('macrosMainContent');
  const settings = document.getElementById('macrosSettingsContent');
  const adjustToggle = document.getElementById('adjustMacrosToggle');
  if (!main) {
    console.warn('toggleTargetForm: missing element: macrosMainContent');
    return;
  }
  if (!settings) {
    console.warn('toggleTargetForm: missing element: macrosSettingsContent');
    main.style.display = '';
    return;
  }
  if (!adjustToggle) {
    console.warn('toggleTargetForm: missing element: adjustMacrosToggle');
  }
  main.style.display = main.style.display === 'none' ? 'block' : 'none';
  settings.style.display = settings.style.display === 'none' ? 'block' : 'none';
  if (adjustToggle) {
    adjustToggle.textContent =
      settings.style.display === 'block' ? '⬅️ Back to Targets' : '⚙️ Adjust Macros';
  }
}

if (typeof window !== 'undefined') {
  window.scanBarcode = scanBarcode;
  window.importRecipe = importRecipe;
  window.planWeek = planWeek;
  window.toggleTargetForm = toggleTargetForm;
  window.quickAdd = quickAdd;
  window.fetchRecipe = fetchRecipe;
  window.logFavorite = logFavorite;
  window.updateOfflineBadge = updateOfflineBadge;
  window.renderSparklines = renderSparklines;
  window.renderHeatmap = renderHeatmap;
  window.updateWeeklyTrend = updateWeeklyTrend;
}

if (typeof window !== 'undefined') {
  const init = () => {
    updateWeeklyTrend();
    initTrainingToggle();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
