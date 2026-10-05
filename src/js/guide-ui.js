/* =============================================================
   GUIDE UI — renders the guidance features on top of the app.
   Rules and data live in src/js/guide-core.js; themed tours in
   src/js/guide-tours.js; styles in css/guide.css (.gd-*).

   - Home #guidePathCard: pick a goal, then a "next step" card for it
   - Home #guideDiscoverCard: milestone suggestions + a weekly tip
   - All #guideAllSection: task search, goal path, tours, connections
   - All tiles: a "new" dot on features ready for you but never opened
   - Sheets: goal path checklist and "How it all connects"

   Purely additive. Tab visits are tracked by watching the .active
   class on .tab-content, so showTab() and the nav stay untouched.
   ============================================================= */
(function (global) {
  'use strict';

  const G = global.GuideCore;
  if (!G) return;

  // ── Storage + context ────────────────────────────────────────

  function userId() {
    try { if (typeof currentUser !== 'undefined' && currentUser) return currentUser; } catch (_) { /* not defined yet */ }
    return localStorage.getItem('fitnessAppUser') || localStorage.getItem('username') || null;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function addDays(day, n) {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function readJSON(key, fallback) {
    try { const val = JSON.parse(localStorage.getItem(key)); return val == null ? fallback : val; } catch (_) { return fallback; }
  }

  const stateKey = u => `guide_${u}`;
  function loadState(u) {
    const s = readJSON(stateKey(u), {});
    return Object.assign({ goal: null, pathHidden: false, completeAck: null, visited: {}, discover: {}, startedAt: null, seeded: false }, s);
  }
  function saveState(u, s) { try { localStorage.setItem(stateKey(u), JSON.stringify(s)); } catch (_) { /* quota / blocked */ } }
  function update(fn) {
    const u = userId();
    if (!u) return null;
    const s = loadState(u);
    fn(s);
    saveState(u, s);
    return s;
  }

  function arr(key) { const a = readJSON(key, []); return Array.isArray(a) ? a : []; }

  function buildContext(u, s) {
    const workouts = arr(`workouts_${u}`);
    const days = new Set();
    let first = null;
    workouts.forEach(w => {
      if (!w || !Array.isArray(w.log) || !w.log.length || !w.date) return;
      days.add(w.date);
      if (!first || w.date < first) first = w.date;
    });
    const weights = arr(`bodyweightLog_${u}`);
    weights.forEach(w => { if (w && w.date && (!first || w.date < first)) first = w.date; });
    let checkIns = 0;
    try { checkIns = (global.checkinEngine?.loadCheckIns?.(u) || []).length; } catch (_) { /* engine not ready */ }
    const start = [first, s.startedAt].filter(Boolean).sort()[0] || todayStr();
    const daysActive = Math.max(0, Math.round((new Date(`${todayStr()}T12:00:00`) - new Date(`${start}T12:00:00`)) / 864e5));
    return {
      workoutDays: days.size,
      hasProgram: !!localStorage.getItem(`activeProgram_${u}`),
      hasMacroTargets: !!readJSON(`macroTargets_${u}`, null),
      weighIns: weights.length,
      checkIns,
      sleepNights: arr(`sleepLog_${u}`).length,
      cardioSessions: arr(`cardioLog_${u}`).length,
      daysActive,
      visited: s.visited || {},
    };
  }

  // Existing users have opened tabs long before this shipped: count a
  // tab as visited if it already holds their data, so "new" dots only
  // land on things they really haven't tried.
  function seedVisited(u, s) {
    if (s.seeded) return;
    const c = buildContext(u, s);
    const seed = {
      logTab: c.workoutDays > 0, homeTab: true, programTab: c.hasProgram, macroTab: c.hasMacroTargets,
      weightTab: c.weighIns > 0, checkInTab: c.checkIns > 0, sleepTab: c.sleepNights > 0, cardioTab: c.cardioSessions > 0,
    };
    Object.keys(seed).forEach(t => { if (seed[t]) s.visited[t] = true; });
    s.seeded = true;
    s.startedAt = s.startedAt || todayStr();
  }

  function ctxNow() {
    const u = userId();
    if (!u) return null;
    const s = loadState(u);
    if (!s.seeded) { seedVisited(u, s); saveState(u, s); }
    return { u, s, c: buildContext(u, s) };
  }

  // ── Small DOM helpers ────────────────────────────────────────

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const ARROW = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function go(tab) {
    closeSheet();
    if (tab && typeof global.showTab === 'function') {
      global.showTab(tab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function askCoach(q) {
    closeSheet();
    if (typeof global.openAiCoach === 'function') global.openAiCoach(q);
  }

  // ── Sheets ───────────────────────────────────────────────────

  function closeSheet() {
    document.querySelectorAll('.gd-sheet-backdrop').forEach(n => n.remove());
    document.removeEventListener('keydown', onSheetKey);
  }
  function onSheetKey(e) { if (e.key === 'Escape') closeSheet(); }

  function openSheet(title, bodyHtml, bind) {
    closeSheet();
    const overlay = document.createElement('div');
    overlay.className = 'mx-sheet-backdrop gd-sheet-backdrop';
    overlay.innerHTML = `
      <div class="mx-sheet gd-sheet" role="dialog" aria-modal="true" aria-labelledby="gdSheetTitle">
        <div class="mx-sheet-head">
          <h3 class="pod-title mx-h3" id="gdSheetTitle">${esc(title)}</h3>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-gd-close aria-label="Close">${CLOSE}</button>
        </div>
        <div class="gd-sheet-body">${bodyHtml}</div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-gd-close]')) closeSheet(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onSheetKey);
    if (bind) bind(overlay);
    return overlay;
  }

  function suggestedGoal(u) {
    const settings = readJSON(`settings_${u}`, {}) || {};
    return G.suggestGoal(settings.profile);
  }

  // Suggested goal first, so the onboarding answer is one tap away.
  function orderedGoals(suggested) {
    return suggested ? [G.goalById(suggested)].concat(G.GOALS.filter(g => g.id !== suggested)) : G.GOALS;
  }

  function goalListHtml(current, suggested) {
    return `<div class="gd-goals">${orderedGoals(suggested).map(g => `
      <button type="button" class="gd-goal${g.id === current ? ' is-current' : ''}${g.id === suggested ? ' is-suggested' : ''}" data-gd-goal="${g.id}">
        <span class="gd-goal-name">${esc(g.label)}${g.id === suggested && g.id !== current ? '<span class="gd-suggested">Suggested</span>' : ''}</span>
        <span class="gd-goal-blurb">${esc(g.blurb)}</span>
      </button>`).join('')}</div>`;
  }

  function openGoalPicker() {
    const ctx = ctxNow();
    if (!ctx) return;
    openSheet('What are you training for?',
      `<p class="mx-sub gd-lead">Pick one and we’ll show you the few parts of the app that matter for it, in order.</p>${goalListHtml(ctx.s.goal, suggestedGoal(ctx.u))}`,
      overlay => overlay.querySelectorAll('[data-gd-goal]').forEach(b => b.addEventListener('click', () => chooseGoal(b.dataset.gdGoal, true))));
  }

  function chooseGoal(id, openPath) {
    update(s => { s.goal = id; s.pathHidden = false; s.completeAck = null; });
    renderAllViews();
    if (openPath) openPathSheet();
    else closeSheet();
  }

  function openPathSheet() {
    const ctx = ctxNow();
    if (!ctx) return;
    if (!ctx.s.goal) { openGoalPicker(); return; }
    const p = G.goalProgress(ctx.s.goal, ctx.c);
    const rows = p.steps.map((st, i) => `
      <div class="gd-step${st.isDone ? ' is-done' : ''}${p.next && p.next.id === st.id ? ' is-next' : ''}">
        <span class="gd-step-mark">${st.isDone ? CHECK : i + 1}</span>
        <span class="gd-step-main">
          <span class="gd-step-label">${esc(st.label)}</span>
          <span class="gd-step-why">${esc(st.why)}</span>
          ${st.tour && global.GuideTours?.[st.tour] && !st.isDone ? `<button type="button" class="gd-textbtn" data-gd-tour="${st.tour}">Show me how</button>` : ''}
        </span>
        <button type="button" class="gd-go" data-gd-go="${st.tab}" aria-label="Open ${esc(st.label)}">${st.isDone ? 'Open' : 'Go'}</button>
      </div>`).join('');
    openSheet(`Your path: ${p.goal.label}`, `
      <div class="gd-progress">
        <span class="mx-meta">${p.doneCount} of ${p.total} done</span>
        <div class="mx-meter mx-meter--thin"><i style="width:${Math.round(p.doneCount / p.total * 100)}%"></i></div>
      </div>
      <div class="gd-steps">${rows}</div>
      <div class="gd-sheet-foot">
        <button type="button" class="gd-textbtn" data-gd-connect>How it all connects</button>
        <button type="button" class="gd-textbtn" data-gd-change>Change goal</button>
      </div>`, overlay => {
      overlay.querySelectorAll('[data-gd-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.gdGo)));
      overlay.querySelectorAll('[data-gd-tour]').forEach(b => b.addEventListener('click', () => global.startGuideTour?.(b.dataset.gdTour)));
      overlay.querySelector('[data-gd-connect]').addEventListener('click', openConnections);
      overlay.querySelector('[data-gd-change]').addEventListener('click', openGoalPicker);
    });
  }

  function openConnections() {
    const coachOk = !!document.getElementById('aiCoachFab') && typeof global.openAiCoach === 'function';
    const rows = G.CONNECTIONS.filter(cn => !cn.coach || coachOk).map(cn => `
      <div class="gd-conn">
        <div class="gd-conn-flow">
          ${cn.fromTab ? `<button type="button" class="gd-node" data-gd-go="${cn.fromTab}">${esc(cn.from)}</button>` : `<span class="gd-node gd-node--static">${esc(cn.from)}</span>`}
          <span class="gd-conn-arrow">${ARROW}</span>
          ${cn.coach ? `<button type="button" class="gd-node gd-node--to" data-gd-coach>${esc(cn.to)}</button>`
            : `<button type="button" class="gd-node gd-node--to" data-gd-go="${cn.toTab}">${esc(cn.to)}</button>`}
        </div>
        <p class="gd-conn-text">${esc(cn.text)}</p>
      </div>`).join('');
    openSheet('How it all connects', `
      <div class="gd-loop" aria-hidden="true">
        <span class="gd-loop-stage">You log</span><span class="gd-conn-arrow">${ARROW}</span>
        <span class="gd-loop-stage">The app learns</span><span class="gd-conn-arrow">${ARROW}</span>
        <span class="gd-loop-stage">You get guidance</span>
      </div>
      <p class="mx-sub gd-lead">Nothing in the app stands alone. What you log in one place powers another. Tap any box to go there.</p>
      <div class="gd-conns">${rows}</div>`, overlay => {
      overlay.querySelectorAll('[data-gd-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.gdGo)));
      overlay.querySelector('[data-gd-coach]')?.addEventListener('click', () => askCoach('What should I focus on this week, based on all my data?'));
    });
  }

  // ── Home: path card ──────────────────────────────────────────

  function renderPathCard(ctx) {
    const host = document.getElementById('guidePathCard');
    if (!host) return;
    const { s, c } = ctx;
    if (!s.goal) {
      const suggested = suggestedGoal(ctx.u);
      if (s.pathHidden) { host.innerHTML = ''; return; }
      host.innerHTML = `
        <section class="pod mx-pod gd-card" aria-label="Choose your goal">
          <div class="gd-card-head">
            <span class="mx-kicker">Get started</span>
            <button type="button" class="gd-textbtn gd-dim" data-gd-hide>Not now</button>
          </div>
          <h3 class="pod-title mx-h3">What are you training for?</h3>
          <p class="mx-sub">We’ll show you the few parts of the app that matter for your goal.</p>
          <div class="gd-goal-chips">${orderedGoals(suggested).map(g => `<button type="button" class="mx-chip gd-goal-chip${g.id === suggested ? ' is-suggested' : ''}" data-gd-goal="${g.id}">${esc(g.label)}</button>`).join('')}</div>
          ${suggested ? `<p class="mx-sub gd-suggest-note">Suggested from your sign-up answers: <b>${esc(G.goalById(suggested).label)}</b>.</p>` : ''}
        </section>`;
      host.querySelectorAll('[data-gd-goal]').forEach(b => b.addEventListener('click', () => chooseGoal(b.dataset.gdGoal, false)));
      host.querySelector('[data-gd-hide]').addEventListener('click', () => { update(st => { st.pathHidden = true; }); renderAllViews(); });
      return;
    }
    const p = G.goalProgress(s.goal, c);
    if (p.complete) {
      if (s.completeAck === s.goal) { host.innerHTML = ''; return; }
      host.innerHTML = `
        <section class="pod mx-pod gd-card gd-card--done" aria-label="Path complete">
          <span class="mx-kicker">Path complete</span>
          <h3 class="pod-title mx-h3">You’re set up for ${esc(p.goal.label.toLowerCase())}</h3>
          <p class="mx-sub">All ${p.total} steps done. Keep logging and the app keeps learning.</p>
          <div class="gd-card-actions">
            <button type="button" class="gd-go" data-gd-ack>Nice</button>
            <button type="button" class="gd-textbtn" data-gd-pick>Pick another goal</button>
          </div>
        </section>`;
      host.querySelector('[data-gd-ack]').addEventListener('click', () => { update(st => { st.completeAck = st.goal; }); renderAllViews(); });
      host.querySelector('[data-gd-pick]').addEventListener('click', openGoalPicker);
      return;
    }
    const n = p.next;
    host.innerHTML = `
      <section class="pod mx-pod gd-card" aria-label="Your path">
        <div class="gd-card-head">
          <span class="mx-kicker">Your path · ${esc(p.goal.label)}</span>
          <span class="mx-meta">${p.doneCount}/${p.total}</span>
        </div>
        <div class="mx-meter mx-meter--thin"><i style="width:${Math.round(p.doneCount / p.total * 100)}%"></i></div>
        <div class="gd-next">
          <span class="gd-next-main">
            <span class="gd-next-label">Next: ${esc(n.label)}</span>
            <span class="gd-step-why">${esc(n.why)}</span>
          </span>
          <button type="button" class="gd-go" data-gd-go="${n.tab}">Go</button>
        </div>
        <div class="gd-card-actions">
          <button type="button" class="gd-textbtn" data-gd-all>See all steps</button>
          ${n.tour && global.GuideTours?.[n.tour] ? `<button type="button" class="gd-textbtn" data-gd-tour="${n.tour}">Show me how</button>` : ''}
        </div>
      </section>`;
    host.querySelector('[data-gd-go]').addEventListener('click', () => go(n.tab));
    host.querySelector('[data-gd-all]').addEventListener('click', openPathSheet);
    host.querySelector('[data-gd-tour]')?.addEventListener('click', e => global.startGuideTour?.(e.currentTarget.dataset.gdTour));
  }

  // ── Home: discover card ──────────────────────────────────────

  function renderDiscoverCard(ctx) {
    const host = document.getElementById('guideDiscoverCard');
    if (!host) return;
    const today = todayStr();
    const pick = G.pickDiscover(ctx.c, ctx.s.discover, today);
    if (!pick) { host.innerHTML = ''; return; }
    if (pick.week) update(s => { s.discover = Object.assign({}, s.discover, { weekly: { week: pick.week, tab: pick.tab } }); });
    const unlock = pick.kind === 'unlock';
    host.innerHTML = `
      <section class="pod mx-pod gd-card gd-card--discover" aria-label="${unlock ? 'Ready for you' : 'Did you know'}">
        <div class="gd-card-head">
          <span class="mx-kicker">${unlock ? 'Ready for you' : 'Did you know?'}</span>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost gd-x" data-gd-skip aria-label="Not now">${CLOSE}</button>
        </div>
        <div class="gd-next">
          <span class="gd-next-main">
            <span class="gd-next-label">${esc(pick.name)}</span>
            <span class="gd-step-why">${esc(pick.text)}</span>
          </span>
          <button type="button" class="gd-go" data-gd-open>Open</button>
        </div>
      </section>`;
    const settle = () => update(s => {
      const d = Object.assign({ seen: {} }, s.discover);
      d.seen = Object.assign({}, d.seen, { [pick.tab]: true });
      if (!unlock && d.weekly) d.weekly = Object.assign({}, d.weekly, { done: true });
      s.discover = d;
    });
    host.querySelector('[data-gd-open]').addEventListener('click', () => { settle(); go(pick.tab); });
    // Dismissing rests the card until tomorrow rather than lining up the next one.
    host.querySelector('[data-gd-skip]').addEventListener('click', () => {
      settle();
      update(s => { s.discover = Object.assign({}, s.discover, { hiddenUntil: addDays(today, 1) }); });
      renderAllViews();
    });
  }

  // ── All tab: search, path, tours, connections, new dots ──────

  const EXTRA_RESULTS = () => [
    { name: 'Your goal path', blurb: 'A short checklist for what you’re training for.', keywords: 'goal path start begin help guide what next checklist', action: openPathSheet },
    { name: 'How it all connects', blurb: 'How each part of the app feeds the others.', keywords: 'connect connects how works help explain overview', action: openConnections },
    { name: 'App tour', blurb: 'The full hands-on walkthrough.', keywords: 'tour help tutorial walkthrough guide learn', action: () => global.showTutorial?.({ force: true }) },
    ...Object.keys(global.GuideTours || {}).map(id => {
      const t = global.GuideTours[id];
      return { name: `Tour: ${t.title}`, blurb: t.blurb, keywords: `tour help how ${t.title} ${t.blurb}`, action: () => global.startGuideTour(id) };
    }),
  ];

  // Features whose tile is hidden for this user (archetype or coach
  // gating) shouldn't come up in search either.
  function hiddenTabs() {
    const out = {};
    document.querySelectorAll('#allTab .all-hub-tile[data-tab]').forEach(t => {
      if (getComputedStyle(t).display === 'none') out[t.dataset.tab] = true;
    });
    return out;
  }

  function renderSearchResults(query) {
    const allTab = document.getElementById('allTab');
    const box = document.getElementById('gdSearchResults');
    if (!allTab || !box) return;
    const q = query.trim();
    allTab.classList.toggle('gd-searching', !!q);
    if (!q) { box.innerHTML = ''; return; }
    const hidden = hiddenTabs();
    const list = G.FEATURES.filter(f => !hidden[f.tab]).concat(EXTRA_RESULTS());
    const hits = G.searchFeatures(q, list).slice(0, 8);
    box.innerHTML = hits.length
      ? hits.map((f, i) => `
          <button type="button" class="gd-result" data-gd-hit="${i}">
            <span class="gd-result-name">${esc(f.name)}</span>
            <span class="gd-result-blurb">${esc(f.blurb)}</span>
          </button>`).join('')
      : `<p class="mx-sub gd-noresult">Nothing matches “${esc(q)}”. Try words like weight, plan, photos or sleep.</p>`;
    box.querySelectorAll('[data-gd-hit]').forEach(b => b.addEventListener('click', () => {
      const f = hits[Number(b.dataset.gdHit)];
      const input = document.getElementById('gdSearchInput');
      if (input) input.value = '';
      renderSearchResults('');
      if (f.action) f.action(); else go(f.tab);
    }));
  }

  function renderAllSection(ctx) {
    const host = document.getElementById('guideAllSection');
    if (!host) return;
    if (!host.dataset.built) {
      host.dataset.built = '1';
      const tours = global.GuideTours || {};
      host.innerHTML = `
        <label class="gd-search">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="gdSearchInput" type="search" autocomplete="off" enterkeyhint="search"
                 placeholder="What do you want to do? Try “weight” or “photos”" aria-label="Search the app">
        </label>
        <div id="gdSearchResults" class="gd-results" aria-live="polite"></div>
        <div class="gd-all-extras">
          <div class="all-hub-section-label">Get the most out of the app</div>
          <div class="gd-all-row">
            <button type="button" class="all-hub-tile all-hub-card gd-all-card" data-gd-path>
              <span class="all-hub-text">
                <span class="all-hub-name">Your goal path</span>
                <span class="all-hub-sub" data-gd-path-sub></span>
              </span>
            </button>
            <button type="button" class="all-hub-tile all-hub-card gd-all-card" data-gd-connect>
              <span class="all-hub-text">
                <span class="all-hub-name">How it connects</span>
                <span class="all-hub-sub">What feeds what</span>
              </span>
            </button>
          </div>
          <div class="gd-tours-label">Show me how</div>
          <div class="gd-tours">${Object.keys(tours).map(id => `<button type="button" class="mx-chip gd-tour-chip" data-gd-tour="${id}">${esc(tours[id].title)}</button>`).join('')}</div>
        </div>`;
      const input = host.querySelector('#gdSearchInput');
      input.addEventListener('input', () => renderSearchResults(input.value));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') host.querySelector('[data-gd-hit="0"]')?.click();
        if (e.key === 'Escape') { input.value = ''; renderSearchResults(''); }
      });
      host.querySelector('[data-gd-path]').addEventListener('click', openPathSheet);
      host.querySelector('[data-gd-connect]').addEventListener('click', openConnections);
      host.querySelectorAll('[data-gd-tour]').forEach(b => b.addEventListener('click', () => global.startGuideTour?.(b.dataset.gdTour)));
    }
    const sub = host.querySelector('[data-gd-path-sub]');
    if (sub) {
      const p = ctx.s.goal ? G.goalProgress(ctx.s.goal, ctx.c) : null;
      sub.textContent = p ? `${p.goal.label} · ${p.doneCount}/${p.total} done` : 'Pick a goal to start';
    }
  }

  function renderNewDots(ctx) {
    // Feature cards only; the Settings pill isn't something to discover.
    document.querySelectorAll('#allTab .all-hub-card[data-tab]').forEach(t => {
      const show = G.isNew(t.dataset.tab, ctx.c);
      let dot = t.querySelector('.gd-new');
      if (show && !dot) {
        dot = document.createElement('span');
        dot.className = 'gd-new';
        dot.textContent = 'New';
        dot.setAttribute('aria-label', 'Not opened yet');
        t.appendChild(dot);
      } else if (!show && dot) {
        dot.remove();
      }
    });
  }

  // ── Render orchestration ─────────────────────────────────────

  function activeTabId() { return document.querySelector('.tab-content.active')?.id || null; }

  function renderAllViews() {
    const ctx = ctxNow();
    if (!ctx) return;
    const tab = activeTabId();
    if (tab === 'homeTab' || !tab) { renderPathCard(ctx); renderDiscoverCard(ctx); }
    renderAllSection(ctx);
    renderNewDots(ctx);
  }

  function recordVisit(tab) {
    if (!tab) return;
    const u = userId();
    if (!u) return;
    const s = loadState(u);
    if (!s.seeded) seedVisited(u, s);
    if (!s.visited[tab]) { s.visited[tab] = true; saveState(u, s); }
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAllViews, 120);
  }

  // showTab() removes and re-adds .active in one go, so re-showing the
  // current tab (e.g. Home after login) lands here as a mutation on an
  // already-active tab. Treat every mutation that leaves a tab active as
  // "shown"; recordVisit and the debounced render are idempotent.
  function watchTabs() {
    const onShown = el => {
      recordVisit(el.id);
      if (el.id !== 'allTab') {
        const input = document.getElementById('gdSearchInput');
        if (input && input.value) { input.value = ''; renderSearchResults(''); }
      }
      scheduleRender();
    };
    const mo = new MutationObserver(muts => {
      const shown = new Set(muts.map(m => m.target).filter(el => el.classList.contains('active')));
      shown.forEach(onShown);
    });
    document.querySelectorAll('.tab-content[id]').forEach(el => {
      mo.observe(el, { attributes: true, attributeFilter: ['class'] });
      if (el.classList.contains('active')) onShown(el);
    });
  }

  function init() {
    watchTabs();
    // Data that can tick off a step or unlock a feature.
    ['tl:set-logged', 'guide:tour-ended', 'cloudsync:applied', 'traininglog:settings-saved']
      .forEach(ev => document.addEventListener(ev, scheduleRender));
    scheduleRender();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.Guide = { openGoalPicker, openPathSheet, openConnections, render: renderAllViews, chooseGoal };
})(typeof window !== 'undefined' ? window : globalThis);
