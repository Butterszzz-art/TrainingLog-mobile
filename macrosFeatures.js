export async function scanBarcode() {
  if (!navigator.mediaDevices) {
    alert('Camera not available');
    return;
  }
  // simplified placeholder using barcode detector if available
  if ('BarcodeDetector' in window) {
    const detector = new BarcodeDetector({ formats: ['ean_13'] });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const barcodes = await detector.detect(canvas);
    stream.getTracks().forEach(t => t.stop());
    if (barcodes[0]) return barcodes[0].rawValue;
  }
  alert('Barcode scanning not supported');
}

export async function importRecipe(url) {
  try {
    const res = await fetch(url, { credentials: "include" });
    const text = await res.text();
    const m = text.match(/(protein|fat|carb)s?\s*:?\s*(\d+)/gi);
    if (!m) return null;
    const result = { protein:0, carbs:0, fat:0 };
    m.forEach(pair => {
      const [_, key, val] = pair.match(/(protein|fat|carb)s?\s*:?\s*(\d+)/i);
      result[key.toLowerCase()] = Number(val);
    });
    return result;
  } catch(e) {
    console.warn('Recipe import failed', e);
    return null;
  }
}

export function quickAdd(type, amountInputId) {
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

export async function fetchRecipe() {
  const url = document.getElementById('recipeUrl').value;
  if (!url) return;
  const data = await importRecipe(url);
  if (data) {
    quickAdd('protein', null); // triggers update later with manual amounts
    const prog = JSON.parse(localStorage.getItem('dailyMacroProgress') || '{"protein":0,"carbs":0,"fats":0}');
    prog.protein += data.protein || 0;
    prog.carbs += data.carbs || 0;
    prog.fats += data.fat || 0;
    localStorage.setItem('dailyMacroProgress', JSON.stringify(prog));
    if (window.renderDailyMacroProgress) window.renderDailyMacroProgress();
  } else {
    alert('Could not parse recipe');
  }
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
  const history = JSON.parse(localStorage.getItem(key) || '[]').slice(-7);
  const labels = history.map(h => h.date);
  const cals = history.map(h => (h.totals.protein*4)+(h.totals.carbs*4)+(h.totals.fats*9));
  const proteins = history.map(h => h.totals.protein);
  const ctx1 = document.getElementById('calSpark').getContext('2d');
  const ctx2 = document.getElementById('proteinSpark').getContext('2d');
  if (window.calChart) window.calChart.destroy();
  if (window.proChart) window.proChart.destroy();
  window.calChart = new Chart(ctx1,{type:'line',data:{labels,datasets:[{data:cals,borderColor:'#2F80ED',fill:false}]},options:{plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}}}});
  window.proChart = new Chart(ctx2,{type:'line',data:{labels,datasets:[{data:proteins,borderColor:'#F2994A',fill:false}]},options:{plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}}}});
}

export function renderHeatmap() {
  const container = document.getElementById('heatmap');
  if (!container) return;
  container.innerHTML = '';
  const key = `macroHistory_${window.currentUser || ''}`;
  const history = JSON.parse(localStorage.getItem(key) || '[]');
  const map = {};
  history.forEach(h => {
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
  main.style.display = main.style.display === 'none' ? 'block' : 'none';
  settings.style.display = settings.style.display === 'none' ? 'block' : 'none';
  document.getElementById('adjustMacrosToggle').textContent =
    settings.style.display === 'block' ? '⬅️ Back to Targets' : '⚙️ Adjust Macros';
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
}
