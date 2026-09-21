/**
 * premium-library.js
 * The Library view in the Program tab: ready-made programs and the training /
 * nutrition guides. Everything comes from GET /api/premium/*, which only sends
 * the full content to Pro/Coach accounts; free accounts get titles, a short
 * preview and an upgrade prompt. Paid content is cached in localStorage so it
 * reads offline, and that cache is wiped on logout or when the plan is no
 * longer paid.
 */
(function (global) {
  'use strict';

  const INDEX_KEY = 'premium_index_v1';
  const DOC_PREFIX = 'premium_doc_v1:';
  const LAST_PREFIX = 'premium_last_v1:';
  const TAG_LABELS = { RP: 'Rest-pause', P: 'Long-length partials', S: 'Intra-set stretch', TUT: 'Time under tension' };

  const state = {
    index: null,
    access: 'preview',
    offline: false,
    loading: false,
    error: '',
    tab: 'programs',      // programs | guides
    view: 'home',         // home | program | ebook
    openId: null,         // id of the open program / guide
    detail: null,         // { locked, doc } for the open item
    detailLoading: false,
    detailError: '',
    week: 1,              // week being previewed in a program
    chapterId: null,      // chapter open in a guide
    query: '',
  };

  // ── small helpers ──────────────────────────────────────────────────────────

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function root() { return document.getElementById('progLibraryView'); }
  function core() { return global.programBuilderV2Core || null; }

  function currentUser() {
    return global.currentUser || localStorage.getItem('fitnessAppUser') || localStorage.getItem('username') || '';
  }

  function toast(message) {
    if (typeof global.showToast === 'function') global.showToast(message);
  }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_e) { return null; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_e) { /* storage full or blocked: reading still works online */ }
  }

  function icon(name) {
    return '<span class="ui-icon" data-icon="' + esc(name) + '"></span>';
  }

  // The shared icon set lives in a global const in index.html; fill any
  // data-icon spans we just rendered.
  function hydrateIcons(el) {
    if (typeof ICONS === 'undefined') return;
    el.querySelectorAll('[data-icon]').forEach(function (node) {
      const svg = ICONS[node.dataset.icon];
      if (svg) node.innerHTML = svg;
    });
  }

  function isPaid() {
    return state.access === 'full';
  }

  // ── cache ──────────────────────────────────────────────────────────────────

  function clearCache() {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key === INDEX_KEY || key.indexOf(DOC_PREFIX) === 0 || key.indexOf(LAST_PREFIX) === 0)) doomed.push(key);
    }
    doomed.forEach(function (key) { localStorage.removeItem(key); });
    state.index = null;
    state.detail = null;
  }

  // Downloaded content for a plan that is no longer paid.
  function purgeDocs() {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.indexOf(DOC_PREFIX) === 0) doomed.push(key);
    }
    doomed.forEach(function (key) { localStorage.removeItem(key); });
  }

  // ── network ────────────────────────────────────────────────────────────────

  async function api(path) {
    const base = String(global.SERVER_URL || '').replace(/\/$/, '');
    const headers = typeof global.getAuthHeaders === 'function' ? global.getAuthHeaders() : {};
    if (!headers.Authorization) {
      const err = new Error('Sign in to browse the library.');
      err.code = 'signin';
      throw err;
    }
    const res = await fetch(base + '/api/premium' + path, { headers: headers });
    const data = await res.json().catch(function () { return {}; });
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Sign in to browse the library.');
      err.code = 'signin';
      throw err;
    }
    if (!res.ok || data.success === false) {
      throw new Error((data.error && data.error.message) || 'Request failed');
    }
    return data;
  }

  async function loadIndex() {
    state.loading = true;
    state.error = '';
    render();
    try {
      const data = await api('/library');
      state.index = data;
      state.access = data.access;
      state.offline = false;
      writeJSON(INDEX_KEY, { user: currentUser(), data: data });
      if (data.access !== 'full') purgeDocs();
    } catch (err) {
      const cached = readJSON(INDEX_KEY);
      if (err.code !== 'signin' && cached && cached.user === currentUser() && cached.data) {
        state.index = cached.data;
        state.access = cached.data.access;
        state.offline = true;
      } else {
        state.index = null;
        state.error = err.code === 'signin' ? err.message : 'Could not load the library. Check your connection and try again.';
      }
    }
    state.loading = false;
    render();
  }

  async function fetchDoc(kind, meta) {
    const key = DOC_PREFIX + kind + ':' + meta.id;
    const cached = readJSON(key);
    const usable = isPaid() && cached && cached.user === currentUser();
    if (usable && cached.rev === meta.rev) return { locked: false, doc: cached.doc };
    try {
      const data = await api('/' + (kind === 'ebook' ? 'ebooks' : 'programs') + '/' + encodeURIComponent(meta.id));
      const doc = data.ebook || data.program;
      if (data.locked) return { locked: true, doc: doc };
      writeJSON(key, { rev: doc.rev, user: currentUser(), doc: doc });
      return { locked: false, doc: doc };
    } catch (err) {
      if (usable) return { locked: false, doc: cached.doc }; // offline: an older copy beats nothing
      throw err;
    }
  }

  // ── navigation ─────────────────────────────────────────────────────────────

  function metaFor(kind, id) {
    if (!state.index) return null;
    const list = kind === 'ebook' ? state.index.ebooks : state.index.programs;
    return list.find(function (item) { return item.id === id; }) || null;
  }

  async function openItem(kind, id) {
    const meta = metaFor(kind, id);
    if (!meta) return;
    state.view = kind;
    state.openId = id;
    state.detail = null;
    state.detailError = '';
    state.detailLoading = true;
    state.week = 1;
    state.query = '';
    state.chapterId = kind === 'ebook' ? ((readJSON(LAST_PREFIX + id) || {}).chapterId || (meta.chapters[0] && meta.chapters[0].id)) : null;
    render();
    try {
      state.detail = await fetchDoc(kind, meta);
    } catch (err) {
      state.detailError = err.code === 'signin' ? err.message : 'Could not load this. Check your connection and try again.';
    }
    state.detailLoading = false;
    render();
    const el = root();
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }

  function goHome() {
    state.view = 'home';
    state.detail = null;
    render();
  }

  // ── programs: import + start ───────────────────────────────────────────────

  function confirmAsync(message) {
    if (typeof global.showConfirm === 'function') return global.showConfirm(message);
    return Promise.resolve(global.confirm(message));
  }

  function addProgram(start) {
    const c = core();
    if (!c || !state.detail || state.detail.locked) return;
    const doc = state.detail.doc;
    const run = function () {
      const user = currentUser();
      const program = c.importLibraryProgram(global, doc, { userId: user });
      if (!program) { toast('Could not add this program.'); return; }
      if (start) {
        c.startProgram(global, program.id, { userId: user });
        if (typeof global.renderTodayProgramCard === 'function') global.renderTodayProgramCard();
        toast('Started. Week 1 begins today.');
      } else {
        toast('Added to My Programs.');
      }
    };
    if (!start) return run();
    const active = readJSON('activeProgram');
    if (active && active.programId) {
      confirmAsync('Make this your active program? "' + (active.programName || 'Your current program') + '" stays in My Programs.')
        .then(function (ok) { if (ok) run(); });
    } else {
      run();
    }
  }

  // ── rendering: shared bits ─────────────────────────────────────────────────

  function lockedCard(name) {
    if (typeof global.renderLockedCard === 'function') return global.renderLockedCard(name, 'pro');
    return '<div class="plib-note">' + esc(name) + ' is available on Pro. ' +
      '<button type="button" class="plib-link" onclick="openUpgradeModal(\'pro\')">Upgrade</button></div>';
  }

  function tagsHtml(items) {
    const list = items.filter(Boolean);
    return list.length ? '<div class="mx-tags">' + list.map(function (t) { return '<span class="mx-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '';
  }

  function programTags(p) {
    const audience = { women: 'Women', men: 'Men' }[p.audience];
    const goal = p.goal ? p.goal.charAt(0).toUpperCase() + p.goal.slice(1) : '';
    // list metadata has daysPerWeek; the full program only has split.daysPerWeek
    const weeks = p.durationWeeks || (p.weeks ? p.weeks.length : 1);
    const days = p.daysPerWeek || (p.split && p.split.daysPerWeek) || (p.days ? p.days.length : 0);
    // some splits don't fit a calendar week (e.g. 7 sessions per week), so they carry their own label
    const cadence = p.split && p.split.label ? p.split.label : (days ? days + ' days/wk' : '');
    return [weeks + ' week' + (weeks === 1 ? '' : 's'), cadence, audience, goal];
  }

  function backButton(label) {
    return '<button type="button" class="plib-back" data-act="back">' + icon('arrowLeft') + '<span>' + esc(label) + '</span></button>';
  }

  function stateBlock(text, withRetry) {
    return '<div class="plib-state">' + esc(text) +
      (withRetry ? '<button type="button" class="cta-capsule-outline plib-retry" data-act="retry">Try again</button>' : '') + '</div>';
  }

  // ── rendering: home ────────────────────────────────────────────────────────

  function cardHtml(kind, item) {
    const locked = !isPaid();
    const sub = kind === 'program' ? tagsHtml(programTags(item)) : tagsHtml([item.chapterCount + ' chapters', item.topic ? item.topic.charAt(0).toUpperCase() + item.topic.slice(1) : '']);
    return '<button type="button" class="plib-card" data-act="open" data-kind="' + kind + '" data-id="' + esc(item.id) + '">' +
      '<span class="plib-card-ico">' + icon(kind === 'program' ? 'clipboard' : 'bookOpen') + '</span>' +
      '<span class="plib-card-main">' +
        '<span class="plib-card-title">' + esc(item.title) + '</span>' +
        '<span class="plib-card-sub">' + esc(item.subtitle || item.summary) + '</span>' +
        sub +
      '</span>' +
      '<span class="plib-card-end">' + icon(locked ? 'lock' : 'chevronRight') + '</span>' +
    '</button>';
  }

  function homeHtml() {
    if (state.loading && !state.index) return '<div class="plib-state">Loading the library…</div>';
    if (state.error && !state.index) return stateBlock(state.error, true);
    if (!state.index) return '';

    const programs = state.index.programs;
    const ebooks = state.index.ebooks;
    const items = state.tab === 'programs' ? programs : ebooks;
    const kind = state.tab === 'programs' ? 'program' : 'ebook';

    let out = '<div class="plib-head"><span class="mx-kicker">Library</span>' +
      '<p class="plib-lede">Ready-made programs and the training and nutrition guides behind them.</p></div>';

    if (!isPaid()) {
      out += '<div class="plib-upsell">' + icon('lock') +
        '<div><strong>Pro unlocks the full library</strong><span>Every program, week by week, and every guide chapter.</span></div>' +
        '<button type="button" class="plib-upsell-btn" onclick="openUpgradeModal(\'pro\')">Upgrade</button></div>';
    }
    if (state.offline) out += '<div class="plib-note">You are offline. Showing what was saved on this device.</div>';

    out += '<div class="pill-nav plib-tabs" role="tablist">' +
      '<button type="button" role="tab" class="pill' + (state.tab === 'programs' ? ' active' : '') + '" data-act="tab" data-tab="programs">Programs (' + programs.length + ')</button>' +
      '<button type="button" role="tab" class="pill' + (state.tab === 'guides' ? ' active' : '') + '" data-act="tab" data-tab="guides">Guides (' + ebooks.length + ')</button></div>';

    out += items.length
      ? '<div class="plib-list">' + items.map(function (item) { return cardHtml(kind, item); }).join('') + '</div>'
      : '<div class="plib-state">Nothing here yet.</div>';
    return out;
  }

  // ── rendering: program ─────────────────────────────────────────────────────

  function setsSummary(sets) {
    const c = core();
    if (!sets || !sets.length) return '';
    const groups = [];
    sets.forEach(function (set) {
      const reps = c ? c.formatReps(set) : String(set.reps);
      const last = groups[groups.length - 1];
      if (last && last.reps === reps) last.n += 1; else groups.push({ n: 1, reps: reps });
    });
    return groups.map(function (g) { return g.n + ' × ' + g.reps; }).join(', ');
  }

  function exerciseHtml(ex) {
    const tech = (ex.techniques || []).map(function (t) {
      return '<span class="mx-tag mx-tag--hi" title="' + esc(TAG_LABELS[t] || t) + '">' + esc(t) + '</span>';
    }).join('');
    const sup = ex.supersetGroup ? '<span class="mx-tag mx-tag--brass">Superset</span>' : '';
    return '<li class="plib-ex">' +
      '<div class="plib-ex-row"><span class="plib-ex-name">' + esc(ex.name) + '</span><span class="plib-ex-sets">' + esc(setsSummary(ex.sets)) + '</span></div>' +
      (tech || sup ? '<div class="mx-tags">' + tech + sup + '</div>' : '') +
      (ex.notes ? '<div class="plib-ex-note">' + esc(ex.notes) + '</div>' : '') +
    '</li>';
  }

  function weekGroups(program) {
    const groups = [];
    (program.weeks || []).forEach(function (w) {
      const last = groups[groups.length - 1];
      if (last && last.phase === (w.phase || '')) last.to = w.week; else groups.push({ from: w.week, to: w.week, phase: w.phase || '' });
    });
    return groups;
  }

  function programHtml() {
    let out = backButton('Library');
    if (state.detailLoading) return out + '<div class="plib-state">Loading…</div>';
    if (state.detailError || !state.detail) return out + stateBlock(state.detailError || 'Could not load this program.', true);

    const doc = state.detail.doc;
    const locked = state.detail.locked;
    out += '<div class="plib-detail-head"><span class="mx-kicker">Program</span>' +
      '<h2 class="plib-title">' + esc(doc.title) + '</h2>' +
      '<p class="plib-sub">' + esc(doc.subtitle || '') + '</p>' + tagsHtml(programTags(doc)) +
      (doc.summary ? '<p class="plib-para">' + esc(doc.summary) + '</p>' : '') + '</div>';

    if (locked) {
      out += lockedCard('Full program');
      const names = doc.dayNames || [];
      if (names.length) {
        out += '<div class="plib-section"><span class="mx-kicker">Training days</span><ul class="plib-days-list">' +
          names.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
      }
      return out;
    }

    out += '<div class="plib-actions">' +
      '<button type="button" class="cta-capsule" data-act="start"><span>Start this program</span><span class="cta-capsule-icon">' + icon('chevronRight') + '</span></button>' +
      '<button type="button" class="cta-capsule-outline plib-add" data-act="add">Add to My Programs</button></div>';

    if ((doc.guide || []).length) {
      out += '<div class="plib-section"><span class="mx-kicker">How to use it</span>' +
        doc.guide.map(function (g, i) {
          return '<details class="plib-guide"' + (i === 0 ? ' open' : '') + '><summary>' + esc(g.heading) + '</summary>' +
            g.body.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</details>';
        }).join('') + '</div>';
    }

    const weeks = doc.weeks || [];
    if (weeks.length > 1) {
      out += '<div class="plib-section"><span class="mx-kicker">Weeks</span>' +
        '<div class="plib-phases">' + weekGroups(doc).map(function (g) {
          const label = g.from === g.to ? 'Week ' + g.from : 'Weeks ' + g.from + '-' + g.to;
          return '<div class="plib-phase"><strong>' + label + '</strong><span>' + esc(g.phase) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="plib-weekpick" role="tablist" aria-label="Preview a week">' +
        weeks.map(function (w) {
          return '<button type="button" role="tab" class="plib-weekbtn' + (w.week === state.week ? ' active' : '') + '" data-act="week" data-week="' + w.week + '" aria-selected="' + (w.week === state.week) + '">' + w.week + '</button>';
        }).join('') + '</div></div>';
    }

    const c = core();
    const days = c ? c.getWeekDays(doc, state.week) : doc.days;
    const weekInfo = weeks.find(function (w) { return w.week === state.week; });
    out += '<div class="plib-section"><span class="mx-kicker">' + (weeks.length > 1 ? 'Week ' + state.week + (weekInfo && weekInfo.phase ? ' · ' + esc(weekInfo.phase) : '') : 'Sessions') + '</span>' +
      (days || []).map(function (day) {
        return '<div class="plib-day"><h3 class="plib-day-name">' + esc(day.name) + '</h3>' +
          (day.notes ? '<p class="plib-ex-note">' + esc(day.notes) + '</p>' : '') +
          (day.exercises.length ? '<ul class="plib-ex-list">' + day.exercises.map(exerciseHtml).join('') + '</ul>' : '') + '</div>';
      }).join('') + '</div>';
    return out;
  }

  // ── rendering: ebook ───────────────────────────────────────────────────────

  function sectionHtml(section) {
    return '<article class="plib-sec"><h3>' + esc(section.heading) + '</h3>' +
      section.body.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
      (section.tables || []).map(function (t) {
        return '<table class="plib-table">' + (t.title ? '<caption>' + esc(t.title) + '</caption>' : '') +
          '<thead><tr>' + t.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead>' +
          '<tbody>' + t.rows.map(function (r) { return '<tr>' + r.map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
      }).join('') + '</article>';
  }

  // The scrolling part of the reader; re-rendered on its own while searching so
  // the search box keeps focus.
  function ebookBodyHtml(doc) {
    const q = state.query.trim().toLowerCase();
    if (q) {
      const hits = [];
      doc.chapters.forEach(function (ch) {
        ch.sections.forEach(function (s) {
          const hay = (s.heading + ' ' + s.body.join(' ')).toLowerCase();
          if (hay.indexOf(q) !== -1) hits.push({ chapter: ch, section: s });
        });
      });
      if (!hits.length) return '<div class="plib-state">No matches for "' + esc(state.query.trim()) + '".</div>';
      return hits.map(function (h) { return '<div class="plib-hit-chapter">' + esc(h.chapter.title) + '</div>' + sectionHtml(h.section); }).join('');
    }
    const idx = Math.max(0, doc.chapters.findIndex(function (ch) { return ch.id === state.chapterId; }));
    const chapter = doc.chapters[idx];
    return '<h3 class="plib-chapter-title">' + esc(chapter.title) + '</h3>' +
      chapter.sections.map(sectionHtml).join('') +
      '<div class="plib-pager">' +
        (idx > 0 ? '<button type="button" class="cta-capsule-outline" data-act="chapter" data-chapter="' + esc(doc.chapters[idx - 1].id) + '">Previous: ' + esc(doc.chapters[idx - 1].title) + '</button>' : '') +
        (idx < doc.chapters.length - 1 ? '<button type="button" class="cta-capsule-outline" data-act="chapter" data-chapter="' + esc(doc.chapters[idx + 1].id) + '">Next: ' + esc(doc.chapters[idx + 1].title) + '</button>' : '') +
      '</div>';
  }

  function ebookHtml() {
    let out = backButton('Library');
    if (state.detailLoading) return out + '<div class="plib-state">Loading…</div>';
    if (state.detailError || !state.detail) return out + stateBlock(state.detailError || 'Could not load this guide.', true);

    const doc = state.detail.doc;
    out += '<div class="plib-detail-head"><span class="mx-kicker">Guide</span>' +
      '<h2 class="plib-title">' + esc(doc.title) + '</h2>' +
      '<p class="plib-sub">' + esc(doc.subtitle || '') + '</p>' +
      (doc.summary ? '<p class="plib-para">' + esc(doc.summary) + '</p>' : '') + '</div>';

    if (state.detail.locked) {
      const pv = doc.preview;
      if (pv) {
        out += '<div class="plib-section"><span class="mx-kicker">Free preview · ' + esc(pv.chapterTitle) + '</span>' +
          '<article class="plib-sec plib-sec--fade"><h3>' + esc(pv.heading) + '</h3>' + pv.body.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</article></div>';
      }
      out += lockedCard('Full guide');
      out += '<div class="plib-section"><span class="mx-kicker">Chapters</span><ul class="plib-days-list">' +
        doc.chapters.map(function (ch) { return '<li>' + icon('lock') + esc(ch.title) + '</li>'; }).join('') + '</ul></div>';
      return out;
    }

    out += '<label class="plib-search"><span class="plib-sr">Search this guide</span>' + icon('search') +
      '<input type="search" id="plibSearch" placeholder="Search this guide" value="' + esc(state.query) + '" autocomplete="off"></label>';
    out += '<div class="plib-chapters" role="tablist" aria-label="Chapters">' + doc.chapters.map(function (ch) {
      const on = !state.query.trim() && ch.id === state.chapterId;
      return '<button type="button" role="tab" class="plib-chapter' + (on ? ' active' : '') + '" data-act="chapter" data-chapter="' + esc(ch.id) + '" aria-selected="' + on + '">' + esc(ch.title) + '</button>';
    }).join('') + '</div>';
    out += '<div id="plibEbookBody" class="plib-reader">' + ebookBodyHtml(doc) + '</div>';
    return out;
  }

  // ── render + events ────────────────────────────────────────────────────────

  function render() {
    const el = root();
    if (!el) return;
    const body = state.view === 'program' ? programHtml() : state.view === 'ebook' ? ebookHtml() : homeHtml();
    el.innerHTML = '<div class="plib">' + body + '</div>';
    hydrateIcons(el);
  }

  function onClick(event) {
    const target = event.target.closest('[data-act]');
    if (!target || !root() || !root().contains(target)) return;
    const act = target.dataset.act;
    if (act === 'open') openItem(target.dataset.kind, target.dataset.id);
    else if (act === 'back') goHome();
    else if (act === 'tab') { state.tab = target.dataset.tab; render(); }
    else if (act === 'retry') { if (state.view === 'home') loadIndex(); else openItem(state.view, state.openId); }
    else if (act === 'start') addProgram(true);
    else if (act === 'add') addProgram(false);
    else if (act === 'week') { state.week = Number(target.dataset.week) || 1; render(); }
    else if (act === 'chapter') {
      state.chapterId = target.dataset.chapter;
      state.query = '';
      const doc = state.detail && state.detail.doc;
      if (doc) writeJSON(LAST_PREFIX + doc.id, { chapterId: state.chapterId });
      render();
      const reader = document.getElementById('plibEbookBody');
      if (reader && reader.scrollIntoView) reader.scrollIntoView({ block: 'start' });
    }
  }

  function onInput(event) {
    if (event.target.id !== 'plibSearch') return;
    state.query = event.target.value;
    const doc = state.detail && state.detail.doc;
    const body = document.getElementById('plibEbookBody');
    if (doc && body) body.innerHTML = ebookBodyHtml(doc);
    // the chapter pills show which chapter is open, which is nothing while searching
    root().querySelectorAll('.plib-chapter').forEach(function (btn) {
      btn.classList.toggle('active', !state.query.trim() && btn.dataset.chapter === state.chapterId);
    });
  }

  // Called by showProgramView('library').
  function show() {
    const el = root();
    if (!el) return;
    if (!el.__plibBound) {
      el.__plibBound = true;
      el.addEventListener('click', onClick);
      el.addEventListener('input', onInput);
    }
    const wantPaid = typeof global.isPro === 'function' ? global.isPro() : false;
    const stale = state.index && isPaid() !== wantPaid;
    if (!state.index || state.error || stale) loadIndex();
    else render();
  }

  global.PremiumLibrary = { show: show, clearCache: clearCache };
})(window);
