/* =============================================================
   Import a coach's program from a file (Program tab).

   The coach picks an Excel / Word / PDF / CSV file or a photo; it
   goes to POST /api/ai/coach/import-program on the backend, which
   has Claude convert it into a Library-shaped program document.
   The coach checks the preview (every week, day and set, plus the
   AI's warnings) and saves it with programBuilderV2Core's
   importLibraryProgram(), optionally starting it right away.
   Saved programs can be edited like any other in My Programs.
   ============================================================= */

(function (global) {
  'use strict';

  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const TIMEOUT_MS = 500000; // the server gives up at 480 s
  const ACCEPT = '.xlsx,.docx,.pdf,.csv,.tsv,.txt,image/jpeg,image/png,image/webp';
  const TAG_LABELS = { RP: 'Rest-pause', P: 'Partials', S: 'Intra-set stretch', TUT: 'Time under tension' };

  const state = { fileName: '', result: null, week: 1, controller: null };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function icon(name) {
    return '<span class="ui-icon" data-icon="' + esc(name) + '"></span>';
  }
  // The shared icon set is a global const in index.html (not on window).
  function hydrateIcons(el) {
    if (typeof ICONS === 'undefined') return;
    el.querySelectorAll('[data-icon]').forEach(function (node) {
      const svg = ICONS[node.dataset.icon];
      if (svg && !node.innerHTML) node.innerHTML = svg;
    });
  }
  function toast(message, type) {
    if (typeof global.showToast === 'function') global.showToast(message, type || 'success', 3000);
  }
  function core() { return global.programBuilderV2Core || null; }
  function currentUser() {
    return global.currentUser || localStorage.getItem('fitnessAppUser') || localStorage.getItem('username') || '';
  }
  function serverUrl() {
    return String(global.SERVER_URL || 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api').replace(/\/$/, '');
  }
  function body() { return document.getElementById('progImportBody'); }
  function setStatus(text) {
    const el = document.getElementById('progImportStatus');
    if (el) el.textContent = text;
  }
  function render(html) {
    const el = body();
    if (el) { el.innerHTML = html; el.scrollTop = 0; hydrateIcons(el); }
  }

  // ── sheet open / close ─────────────────────────────────────────────────────

  function open() {
    if (typeof global.isProUser === 'function' && !global.isProUser()) {
      if (typeof global.openUpgradeModal === 'function') global.openUpgradeModal('pro');
      return;
    }
    const backdrop = document.getElementById('progImportBackdrop');
    const panel = document.getElementById('progImportPanel');
    if (!backdrop || !panel) return;
    backdrop.style.display = 'block';
    panel.style.display = 'flex';
    requestAnimationFrame(function () { panel.style.transform = 'translateY(0)'; });
    if (state.result) renderPreview(); else renderPick();
  }

  function close() {
    if (state.controller) state.controller.abort();
    const panel = document.getElementById('progImportPanel');
    const backdrop = document.getElementById('progImportBackdrop');
    if (!panel) return;
    panel.style.transform = 'translateY(100%)';
    setTimeout(function () {
      panel.style.display = 'none';
      if (backdrop) backdrop.style.display = 'none';
    }, 340);
  }

  // ── step 1: pick a file ────────────────────────────────────────────────────

  function renderPick(error) {
    setStatus('Excel, Word, PDF or photo');
    render(
      (error ? '<div class="ai-error">' + icon('alertTriangle') + '<span>' + esc(error) + '</span></div>' : '') +
      '<p class="pimp-lead">Made a program in Excel, Google Sheets, Word or another app? Import it and the AI turns it into a Pocket Coach program: every week, day, exercise and set.</p>' +
      '<ul class="pimp-tips">' +
        '<li>Works with .xlsx, .docx, PDF, CSV, or a clear photo of the program.</li>' +
        '<li>Google Sheets / Numbers: download as .xlsx or PDF first.</li>' +
        '<li>One block at a time works best, e.g. a month.</li>' +
        '<li>You can check everything before it is saved.</li>' +
      '</ul>' +
      '<input type="file" id="progImportFile" accept="' + ACCEPT + '" hidden>' +
      '<button type="button" class="mx-cta" data-act="choose"><span>Choose file</span><span class="mx-cta-icon">' + icon('fileText') + '</span></button>'
    );
  }

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).replace(/^data:[^,]*,/, '')); };
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.readAsDataURL(file);
    });
  }

  async function upload(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { renderPick('That file is over 8 MB. Import one month at a time.'); return; }
    state.fileName = file.name;
    setStatus('Reading your program…');
    render(
      '<div class="ai-loading"><span class="ai-spinner"></span><span>Reading <strong>' + esc(file.name) +
      '</strong> and converting it. This can take a few minutes for a long program.</span></div>'
    );

    const controller = new AbortController();
    state.controller = controller;
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    try {
      const data = await readAsBase64(file);
      const headers = typeof global.getAuthHeaders === 'function' ? global.getAuthHeaders() : {};
      const res = await fetch(serverUrl() + '/api/ai/coach/import-program', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: JSON.stringify({ fileName: file.name, data: data }),
        signal: controller.signal,
      });
      const json = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (res.status === 401) throw new Error('Please log in again to import a program.');
        if (res.status === 402 || res.status === 403) throw new Error('Importing programs is a Pro feature.');
        if (res.status === 404 && json.error === 'AI_NOT_CONFIGURED') throw new Error('The AI is not switched on for this server yet.');
        throw new Error(json.message || (json.error && json.error.message) || "Couldn't import the program. Try again.");
      }
      if (!json.program) throw new Error("Couldn't import the program. Try again.");
      state.result = json;
      state.week = 1;
      renderPreview();
    } catch (err) {
      if (state.controller !== controller) return; // sheet closed or another upload started
      const message = err.name === 'AbortError'
        ? 'That took too long. Try again, or import a shorter part of the program.'
        : (!navigator.onLine ? 'You are offline.' : err.message);
      renderPick(message);
    } finally {
      clearTimeout(timer);
      if (state.controller === controller) state.controller = null;
    }
  }

  // ── step 2: check and save ─────────────────────────────────────────────────

  function setsSummary(sets) {
    const groups = [];
    (sets || []).forEach(function (set) {
      const c = core();
      let reps = c && c.formatReps ? c.formatReps(set) : String(set.reps == null ? '?' : set.reps);
      if (set.weight != null) reps += ' @ ' + set.weight + ' kg';
      if (set.rpe != null) reps += ' RPE ' + set.rpe;
      else if (set.rir != null) reps += ' RIR ' + set.rir;
      if (set.setType && set.setType !== 'straight') reps += ' ' + set.setType;
      const last = groups[groups.length - 1];
      if (last && last.label === reps) last.n += 1; else groups.push({ n: 1, label: reps });
    });
    return groups.map(function (g) { return g.n + ' × ' + g.label; }).join(', ');
  }

  function weekDays(program, number) {
    const c = core();
    if (c && c.getWeekDays) return c.getWeekDays(program, number);
    const week = (program.weeks || [])[number - 1];
    return (week && week.days) || [];
  }

  function exerciseHtml(ex) {
    const tags = (ex.techniques || []).map(function (t) {
      return '<span class="mx-tag" title="' + esc(TAG_LABELS[t] || t) + '">' + esc(TAG_LABELS[t] || t) + '</span>';
    }).join('') + (ex.supersetGroup ? '<span class="mx-tag">Superset ' + esc(ex.supersetGroup) + '</span>' : '');
    return '<li class="pimp-ex">' +
      '<div class="pimp-ex-row"><span class="pimp-ex-name">' + esc(ex.name) + '</span>' +
      '<span class="pimp-ex-sets">' + esc(setsSummary(ex.sets)) + '</span></div>' +
      (tags ? '<div class="mx-tags">' + tags + '</div>' : '') +
      (ex.notes ? '<div class="pimp-ex-note">' + esc(ex.notes) + '</div>' : '') +
    '</li>';
  }

  function renderPreview() {
    const result = state.result;
    if (!result) { renderPick(); return; }
    const program = result.program;
    const weeks = program.weeks || [];
    const week = weeks[state.week - 1] || weeks[0];
    const days = weekDays(program, state.week);
    const exCount = days.reduce(function (n, d) { return n + (d.exercises || []).length; }, 0);
    setStatus('Check before saving');

    let html = '<section class="pod pod--hero mx-pod">' +
      '<div class="mx-kicker">Imported from ' + esc(state.fileName || 'file') + '</div>' +
      '<h4 class="pod-title mx-h3">' + esc(program.title) + '</h4>' +
      '<div class="mx-tags"><span class="mx-tag">' + weeks.length + ' week' + (weeks.length === 1 ? '' : 's') + '</span>' +
      '<span class="mx-tag">' + days.length + ' day' + (days.length === 1 ? '' : 's') + ' / week</span>' +
      '<span class="mx-tag">' + esc(program.goal) + '</span></div>' +
      (program.progressionNotes ? '<p class="mx-note"><strong>Coach notes:</strong> ' + esc(program.progressionNotes) + '</p>' : '') +
    '</section>';

    if ((result.warnings || []).length) {
      html += '<div class="pimp-warn"><div class="mx-kicker">' + icon('alertTriangle') + ' Please check</div><ul>' +
        result.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    }

    if (weeks.length > 1) {
      html += '<div class="pimp-weekpick" role="tablist" aria-label="Program week">' + weeks.map(function (w) {
        const active = w.week === state.week;
        return '<button type="button" role="tab" class="pimp-weekbtn' + (active ? ' active' : '') + '" aria-selected="' + active +
          '" data-week="' + w.week + '">W' + w.week + '</button>';
      }).join('') + '</div>' +
      '<div class="pimp-weekhead"><strong>' + esc(week.label) + '</strong>' +
        (week.phase ? ' · ' + esc(week.phase) : '') +
        (week.sameAs ? ' <span>· same as Week ' + week.sameAs + '</span>' : '') +
        ' <span>· ' + exCount + ' exercises</span></div>';
    }

    html += days.map(function (day) {
      return '<div class="pimp-day"><h5 class="pimp-day-name">' + esc(day.name) + '</h5>' +
        (day.notes ? '<div class="pimp-ex-note">' + esc(day.notes) + '</div>' : '') +
        '<ul class="pimp-ex-list">' + (day.exercises || []).map(exerciseHtml).join('') + '</ul></div>';
    }).join('');

    html += '<button type="button" class="mx-cta" data-act="start"><span>Save &amp; start this program</span><span class="mx-cta-icon">' + icon('check') + '</span></button>' +
      '<button type="button" class="mx-outline mx-outline--block" data-act="save">Save to My Programs</button>' +
      '<button type="button" class="mx-outline mx-outline--block" data-act="again">Import a different file</button>' +
      '<p class="pimp-foot">Something off? Save it, then edit it in My Programs.</p>';
    render(html);
  }

  function confirmAsync(message) {
    if (typeof global.showConfirm === 'function') return global.showConfirm(message);
    return Promise.resolve(global.confirm(message));
  }

  function save(start) {
    const c = core();
    const result = state.result;
    if (!c || !result) return;
    const run = function () {
      const user = currentUser();
      const program = c.importLibraryProgram(global, result.program, {
        userId: user,
        source: { type: 'file-import', fileName: state.fileName || '', importedFrom: result.program.id },
      });
      if (!program) { toast('Could not save this program.', 'warn'); return; }
      if (start) {
        c.startProgram(global, program.id, { userId: user });
        if (typeof global.renderTodayProgramCard === 'function') global.renderTodayProgramCard();
      }
      state.result = null;
      close();
      if (typeof global.showProgramView === 'function') global.showProgramView('list');
      toast(start ? 'Imported and started. Week 1 begins today.' : 'Imported to My Programs.');
    };
    if (!start) { run(); return; }
    let active = null;
    try { active = JSON.parse(localStorage.getItem('activeProgram') || 'null'); } catch (_e) { active = null; }
    if (active && active.programId) {
      confirmAsync('Make this your active program? "' + (active.programName || 'Your current program') + '" stays in My Programs.')
        .then(function (ok) { if (ok) run(); });
    } else {
      run();
    }
  }

  // ── events ─────────────────────────────────────────────────────────────────

  document.addEventListener('click', function (event) {
    const el = body();
    if (!el || !el.contains(event.target)) return;
    const weekBtn = event.target.closest('[data-week]');
    if (weekBtn) { state.week = Number(weekBtn.getAttribute('data-week')) || 1; renderPreview(); return; }
    const act = event.target.closest('[data-act]');
    if (!act) return;
    const what = act.getAttribute('data-act');
    if (what === 'choose') { const input = document.getElementById('progImportFile'); if (input) input.click(); }
    else if (what === 'start') save(true);
    else if (what === 'save') save(false);
    else if (what === 'again') { state.result = null; renderPick(); }
  });

  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'progImportFile') {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      upload(file);
    }
  });

  global.openProgImport = open;
  global.closeProgImport = close;
})(typeof window !== 'undefined' ? window : globalThis);
