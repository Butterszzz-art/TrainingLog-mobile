/* Coach dashboard: library pages (Workouts, Meals, Vault).
 *
 * Workouts are single sessions kept to reuse in programs
 * (/api/coach/workouts). The editor is the program builder in single-day
 * mode; inside the program builder a day can be saved as a workout and a
 * workout's rows can be inserted into a day (coach.js passes the hooks).
 *
 * Meals is the meal library the meal planner already saves to
 * (/api/coach/meals), with its own editor so a meal can be built without
 * opening a client.
 *
 * The vault holds links to guides and other resources (/api/coach/vault),
 * in optional folders, for all clients or chosen ones.
 *
 * Uses coach.js globals: coachJson, escapeHtml, activeClients, railNavGo. */

const libError = err => (err && err.message === 'Failed to fetch' ? 'Connection error. Try again.' : (err && err.message) || 'Something went wrong. Try again.');
const libId = (prefix, name) => prefix + '_' + (String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item') + '-' + Math.random().toString(36).slice(2, 6);

function libCounts() {
  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  set('railCountWorkouts', (_workouts || []).length);
  set('railCountMeals', (_mealLibrary || []).length);
  set('railCountVault', (_vault || []).length);
}

// ── Workouts ─────────────────────────────────────────────────────────────
let _workouts = null;

async function loadWorkouts(force) {
  if (!_workouts || force) {
    try { _workouts = (await coachJson('/api/coach/workouts')).workouts || []; } catch (err) { if (!_workouts) throw err; }
  }
  libCounts();
  return _workouts;
}

async function renderWorkoutsPage(message) {
  const el = document.getElementById('wsWorkoutsList');
  if (!el) return;
  try { await loadWorkouts(); } catch (err) { el.innerHTML = '<p class="ws-empty-note">' + escapeHtml(libError(err)) + '</p>'; return; }
  el.innerHTML = (message ? '<p class="ws-empty-note">' + escapeHtml(message) + '</p>' : '')
    + (_workouts.length ? _workouts.map(w =>
      '<div class="ws-list-row"><span class="ws-list-name">' + escapeHtml(w.name) + (w.focus ? ' <small>' + escapeHtml(w.focus) + '</small>' : '')
      + '<span class="lib-sub">' + escapeHtml(w.exercises.map(e => e.name).join(' · ')) + '</span></span>'
      + '<span class="ws-side-note">' + w.exercises.length + ' exercise' + (w.exercises.length === 1 ? '' : 's') + '</span>'
      + '<button class="bulk-action-btn bulk-action-btn--ghost" onclick="editWorkout(\'' + escapeHtml(w.id) + '\')">Edit</button>'
      + '<button class="bulk-action-btn bulk-action-btn--ghost" onclick="deleteWorkout(\'' + escapeHtml(w.id) + '\')">Delete</button></div>').join('')
      : '<p class="ws-empty-note">No workouts yet. Build one here, or use "Save as workout" on a day in the program builder.</p>');
}

// The program builder in single-day mode. `id` = an existing workout, or none for a new one.
function editWorkout(id) {
  const area = document.getElementById('workoutBuilderArea');
  if (!area || !window.ProgramBuilder) return;
  const w = (_workouts || []).find(x => x.id === id);
  const program = {
    schema: 'pocketcoach.program/2', name: w ? w.name : 'New workout',
    weeks: [{ days: [{ dayId: 'd1', weekday: null, label: w ? w.name : 'Workout', focus: w ? w.focus : '', notes: w ? w.notes : '', exercises: w ? JSON.parse(JSON.stringify(w.exercises)) : [] }] }],
  };
  window.ProgramBuilder.mount(area, program, {
    single: true,
    onSave: async p => {
      const day = p.weeks[0].days[0];
      await saveWorkout(id || libId('wk', p.name), { name: p.name, focus: day.focus, notes: day.notes, exercises: day.exercises });
      area.innerHTML = '';
      renderWorkoutsPage('Saved.');
    },
    onCancel: () => { area.innerHTML = ''; },
  });
  area.querySelector('[data-pf="name"]')?.focus();
}

// Throws with a readable message on failure (the builder shows it).
async function saveWorkout(id, workout) {
  let saved;
  try { saved = (await coachJson('/api/coach/workouts/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(workout) })).workout; } catch (err) { throw new Error(libError(err)); }
  _workouts = (_workouts || []).filter(x => x.id !== saved.id).concat(saved).sort((a, b) => a.name.localeCompare(b.name));
  libCounts();
  return saved;
}

async function deleteWorkout(id) {
  const w = (_workouts || []).find(x => x.id === id);
  if (!w || !confirm('Delete the workout "' + w.name + '"? Programs that already use its exercises keep them.')) return;
  try {
    await coachJson('/api/coach/workouts/' + encodeURIComponent(id), { method: 'DELETE' });
    _workouts = _workouts.filter(x => x.id !== id);
    libCounts();
    renderWorkoutsPage('Deleted.');
  } catch (err) { renderWorkoutsPage(libError(err)); }
}

// "Save as workout" on a day in the program builder.
async function saveDayAsWorkout(day) {
  const name = (prompt('Name this workout:', day.label || '') || '').trim();
  if (!name) return '';
  await saveWorkout(libId('wk', name), { name, focus: day.focus, notes: day.notes, exercises: day.exercises });
  return 'Saved "' + name + '" to your workouts.';
}

// ── Meals ────────────────────────────────────────────────────────────────
let _mealLibrary = null;
let _mealEdit = null; // { meal, results, query, busy, message }

const mealMacros = m => { const t = window.MealPlanner.mealTotals(m); return t.kcal + ' kcal · P ' + t.protein + ' · C ' + t.carbs + ' · F ' + t.fat; };

async function renderMealsPage(message) {
  const el = document.getElementById('wsMealsList');
  if (!el) return;
  if (!_mealLibrary) {
    try { _mealLibrary = (await coachJson('/api/coach/meals')).meals || []; } catch (err) { el.innerHTML = '<p class="ws-empty-note">' + escapeHtml(libError(err)) + '</p>'; return; }
  }
  libCounts();
  if (_mealEdit) { renderMealEditor(); return; }
  el.innerHTML = (message ? '<p class="ws-empty-note">' + escapeHtml(message) + '</p>' : '')
    + (_mealLibrary.length ? _mealLibrary.map(m =>
      '<div class="ws-list-row"><span class="ws-list-name">' + escapeHtml(m.name)
      + '<span class="lib-sub">' + escapeHtml(m.items.map(it => it.food.name + ' ' + Math.round(it.grams) + ' g').join(' · ')) + '</span></span>'
      + '<span class="ws-side-note">' + mealMacros(m) + '</span>'
      + '<button class="bulk-action-btn bulk-action-btn--ghost" onclick="editMeal(\'' + escapeHtml(m.id) + '\')">Edit</button>'
      + '<button class="bulk-action-btn bulk-action-btn--ghost" onclick="deleteMeal(\'' + escapeHtml(m.id) + '\')">Delete</button></div>').join('')
      : '<p class="ws-empty-note">No meals yet. Build one here; it shows up in the meal planner in every client\'s Nutrition tab.</p>');
}

function editMeal(id) {
  const m = (_mealLibrary || []).find(x => x.id === id);
  _mealEdit = { meal: m ? JSON.parse(JSON.stringify(m)) : { id: null, name: '', note: '', items: [] }, results: [], query: '', busy: false, message: '' };
  renderMealEditor();
}

function renderMealEditor() {
  const el = document.getElementById('wsMealsList');
  const e = _mealEdit;
  const rows = e.meal.items.map((it, i) =>
    '<tr><td>' + escapeHtml(it.food.name) + (it.food.brand ? '<small> · ' + escapeHtml(it.food.brand) + '</small>' : '') + '</td>'
    + '<td><input class="pb-in pb-in--num" type="number" min="1" max="5000" data-ml-grams="' + i + '" value="' + escapeHtml(it.grams) + '" aria-label="Grams of ' + escapeHtml(it.food.name) + '"> g</td>'
    + '<td class="mp2-macros">' + mealMacros({ items: [it] }) + '</td>'
    + '<td><button type="button" class="pb-icon" data-ml="drop" data-i="' + i + '" aria-label="Remove ' + escapeHtml(it.food.name) + '">✕</button></td></tr>').join('');
  const results = e.results.map((f, i) => '<li><button type="button" class="mp2-result" data-ml="pick" data-i="' + i + '"><b>' + escapeHtml(f.name) + '</b>'
    + (f.brand ? ' <small>' + escapeHtml(f.brand) + '</small>' : '') + (f.source === 'coach' ? ' <span class="mp2-tag">Your food</span>' : '')
    + ' <small>' + Math.round(f.per100.kcal || 0) + ' kcal · P ' + (f.per100.protein ?? '–') + ' · C ' + (f.per100.carbs ?? '–') + ' · F ' + (f.per100.fat ?? '–') + ' per 100 ' + (f.basis === 'ml' ? 'ml' : 'g') + '</small></button></li>').join('');
  el.innerHTML = '<div class="mp2-editor">'
    + '<div class="mp2-editor-top"><label class="mp-field"><span class="mp-field-label">Meal name</span><input class="mp-input mp-input--text" data-ml-name value="' + escapeHtml(e.meal.name) + '" maxlength="80" placeholder="e.g. Oats &amp; whey"></label>'
    + '<span class="mp2-macros">' + mealMacros(e.meal) + '</span></div>'
    + '<table class="mp2-items"><tbody>' + (rows || '<tr><td colspan="4" class="ws-empty-note">Add foods below.</td></tr>') + '</tbody></table>'
    + '<div class="mp2-search"><input class="pb-in" data-ml-search value="' + escapeHtml(e.query) + '" placeholder="Add a food: search your foods and the food database" aria-label="Search foods">'
    + '<button type="button" class="pb-link" data-ml="search">Search</button></div>'
    + (results ? '<ul class="mp2-results">' + results + '</ul>' : '')
    + '<label class="mp-field mp-field--wide"><span class="mp-field-label">Note for clients (optional)</span><input class="mp-input mp-input--text" data-ml-note value="' + escapeHtml(e.meal.note || '') + '" maxlength="300"></label>'
    + '<div class="mp-adjust-actions"><button type="button" class="mp-btn" data-ml="save"' + (e.busy ? ' disabled' : '') + '>Save meal</button>'
    + '<button type="button" class="pb-link" data-ml="cancel">Cancel</button><span class="pb-msg" role="status">' + escapeHtml(e.message) + '</span></div></div>';
}

async function mealFoodSearch() {
  const e = _mealEdit;
  const q = e.query.trim().toLowerCase();
  if (!q) return;
  let mine = [];
  try { mine = ((await coachJson('/api/coach/foods')).foods || []).filter(f => String(f.name).toLowerCase().includes(q)).map(f => ({ ...f, source: 'coach' })).slice(0, 8); } catch { /* search still runs */ }
  let found = [];
  try { found = ((await coachJson('/api/food/search?q=' + encodeURIComponent(q) + '&limit=20')).foods || []).filter(f => f && f.per100 && f.per100.protein != null).slice(0, 15); } catch { /* your own foods still show */ }
  if (_mealEdit !== e) return;
  e.results = mine.concat(found);
  e.message = e.results.length ? '' : 'No foods found for "' + q + '".';
  renderMealEditor();
}

async function deleteMeal(id) {
  const m = (_mealLibrary || []).find(x => x.id === id);
  if (!m || !confirm('Delete the meal "' + m.name + '"? Meal plans already sent keep their copy.')) return;
  try {
    await coachJson('/api/coach/meals/' + encodeURIComponent(id), { method: 'DELETE' });
    _mealLibrary = _mealLibrary.filter(x => x.id !== id);
    renderMealsPage('Deleted.');
  } catch (err) { renderMealsPage(libError(err)); }
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('wsMealsList');
  if (!el) return;
  el.addEventListener('input', ev => {
    const t = ev.target;
    if (!_mealEdit) return;
    if (t.matches('[data-ml-name]')) _mealEdit.meal.name = t.value;
    else if (t.matches('[data-ml-note]')) _mealEdit.meal.note = t.value;
    else if (t.matches('[data-ml-search]')) _mealEdit.query = t.value;
  });
  el.addEventListener('change', ev => {
    const t = ev.target;
    if (!_mealEdit || !t.matches('[data-ml-grams]')) return;
    const it = _mealEdit.meal.items[Number(t.dataset.mlGrams)];
    const g = Math.max(1, Math.min(5000, Number(t.value) || 0));
    it.amount = it.unit && it.unit !== it.food.basis && it.grams ? Math.round((it.amount * g / it.grams) * 100) / 100 : g;
    it.grams = g;
    renderMealEditor();
  });
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.matches('[data-ml-search]')) { ev.preventDefault(); mealFoodSearch(); }
  });
  el.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-ml]');
    const e = _mealEdit;
    if (!b || !e || b.disabled) return;
    const act = b.dataset.ml;
    const i = Number(b.dataset.i);
    if (act === 'search') { mealFoodSearch(); return; }
    if (act === 'cancel') { _mealEdit = null; renderMealsPage(); return; }
    if (act === 'pick') {
      const f = e.results[i];
      const basis = f.basis === 'ml' ? 'ml' : 'g';
      e.meal.items.push({ food: { id: f.id || null, source: f.source || 'coach', name: f.name, brand: f.brand || '', basis, per100: f.per100, servings: f.servings || [] }, grams: 100, amount: 100, unit: basis });
      e.results = []; e.query = '';
    } else if (act === 'drop') e.meal.items.splice(i, 1);
    else if (act === 'save') {
      if (!e.meal.name.trim()) { e.message = 'Give the meal a name.'; renderMealEditor(); return; }
      if (!e.meal.items.length) { e.message = 'Add at least one food.'; renderMealEditor(); return; }
      e.busy = true; e.message = ''; renderMealEditor();
      try {
        const meal = { ...e.meal, id: e.meal.id || libId('meal', e.meal.name) };
        const saved = (await coachJson('/api/coach/meals/' + encodeURIComponent(meal.id), { method: 'PUT', body: JSON.stringify(meal) })).meal || meal;
        _mealLibrary = _mealLibrary.filter(x => x.id !== saved.id).concat(saved).sort((a, b) => a.name.localeCompare(b.name));
        _mealEdit = null;
        renderMealsPage('Saved. It is in the meal planner for every client.');
        return;
      } catch (err) { e.busy = false; e.message = libError(err); }
    }
    renderMealEditor();
  });
});

// ── Vault ────────────────────────────────────────────────────────────────
let _vault = null;

async function renderVaultPage(message) {
  const el = document.getElementById('wsVaultList');
  if (!el) return;
  if (!_vault) {
    try { _vault = (await coachJson('/api/coach/vault')).items || []; } catch (err) { el.innerHTML = '<p class="ws-empty-note">' + escapeHtml(libError(err)) + '</p>'; return; }
  }
  libCounts();
  const clients = activeClients();
  const folders = [...new Set(_vault.map(x => x.folder || ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  const audience = x => (x.audience === 'selected' ? (x.clientUids || []).length + ' client' + ((x.clientUids || []).length === 1 ? '' : 's') : 'All clients');
  const safe = url => (/^https?:\/\//i.test(url || '') ? url : '#');
  el.innerHTML = (message ? '<p class="ws-empty-note">' + escapeHtml(message) + '</p>' : '')
    + (_vault.length ? folders.map(folder =>
      '<div class="lib-folder">' + escapeHtml(folder || 'No folder') + '</div>'
      + _vault.filter(x => (x.folder || '') === folder).map(x =>
        '<div class="ws-list-row"><span class="ws-list-name">' + escapeHtml(x.title)
        + (x.description ? '<span class="lib-sub">' + escapeHtml(x.description) + '</span>' : '') + '</span>'
        + '<span class="ws-side-note">' + audience(x) + '</span>'
        + '<a class="bulk-action-btn bulk-action-btn--ghost" href="' + escapeHtml(safe(x.url)) + '" target="_blank" rel="noopener noreferrer">Open</a>'
        + '<button class="bulk-action-btn bulk-action-btn--ghost" data-vault-remove="' + escapeHtml(x.id) + '">Remove</button></div>').join('')).join('')
      : '<p class="ws-empty-note">Nothing in your vault yet. Add a link to a guide, PDF or page and your clients find it in the app under Your Coach.</p>')
    + '<details class="fl-add"' + (_vault.length ? '' : ' open') + '><summary>Add a resource</summary>'
    + '<div class="fl-add-grid fl-add-grid--2">'
    + '<input id="vaTitle" class="coach-input" placeholder="Title, e.g. Meal prep guide" maxlength="120">'
    + '<input id="vaFolder" class="coach-input" placeholder="Folder (optional)" maxlength="40" list="vaFolders"></div>'
    + '<datalist id="vaFolders">' + folders.filter(Boolean).map(f => '<option value="' + escapeHtml(f) + '">').join('') + '</datalist>'
    + '<input id="vaUrl" class="coach-input" placeholder="Link (https://…), e.g. a shared Google Drive PDF" maxlength="2000">'
    + '<textarea id="vaDescription" class="coach-input" rows="2" maxlength="500" style="margin-top:8px;" placeholder="What is it and when should they read it? (optional)"></textarea>'
    + '<label class="fl-add-all"><input type="checkbox" id="vaAll" checked> Share with all clients</label>'
    + '<div id="vaClients" class="ws-check-grid" hidden>' + (clients.length ? clients.map(c =>
      '<label><input type="checkbox" value="' + escapeHtml(c.id) + '"> ' + escapeHtml(c.clientName || 'Unknown') + '</label>').join('')
      : '<span class="ws-empty-note">No active clients yet.</span>') + '</div>'
    + '<button class="bulk-action-btn" id="vaSave">Save</button> <span class="ws-empty-note" id="vaStatus"></span></details>';

  document.getElementById('vaAll').addEventListener('change', e => { document.getElementById('vaClients').hidden = e.target.checked; });
  el.querySelectorAll('[data-vault-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remove this from your vault? Clients stop seeing it.')) return;
    try {
      await coachJson('/api/coach/vault/' + encodeURIComponent(b.dataset.vaultRemove), { method: 'DELETE' });
      _vault = _vault.filter(x => x.id !== b.dataset.vaultRemove);
      renderVaultPage('Removed.');
    } catch (err) { renderVaultPage(libError(err)); }
  }));
  document.getElementById('vaSave').addEventListener('click', async () => {
    const v = id => document.getElementById(id).value.trim();
    const say = msg => { document.getElementById('vaStatus').textContent = msg; };
    const forAll = document.getElementById('vaAll').checked;
    const clientUids = forAll ? [] : Array.from(document.querySelectorAll('#vaClients input:checked')).map(i => i.value);
    if (!v('vaTitle')) { say('Give it a title.'); return; }
    if (!/^https?:\/\//i.test(v('vaUrl'))) { say('Paste the full link (starting with https://).'); return; }
    if (!forAll && !clientUids.length) { say('Pick at least one client.'); return; }
    try {
      const data = await coachJson('/api/coach/vault', { method: 'POST', body: JSON.stringify({ title: v('vaTitle'), url: v('vaUrl'), folder: v('vaFolder'), description: v('vaDescription'), audience: forAll ? 'all' : 'selected', clientUids }) });
      _vault = [data.item].concat(_vault);
      renderVaultPage('Saved. Your clients can open it in the app.');
    } catch (err) { say(libError(err)); }
  });
}
