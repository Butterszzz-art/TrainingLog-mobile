/* =============================================================
   COACH GUIDE (phone) — what a coach sees after taking the Coach
   plan:
   1. A welcome sheet, once: what the phone is for, what the
      computer is for, then "Take the tour" / "Send me the
      computer link" / "Later".
   2. A "Get set up" checklist at the top of the Coach tab
      (#coachGuideCard) that ticks itself from the client list.
   3. A short tour of the coach screens on the app-tour engine.

   Rules: src/js/coach-guide-core.js. Progress: GET/POST
   /api/coach/guide, cached in localStorage `coachGuide_<user>` so
   the card draws before the network answers. The computer side is
   coach/coach-guide-desktop.js. Styles: css/coach-guide.css.
   ============================================================= */
(function (global) {
  'use strict';

  const Core = global.CoachGuideCore;
  if (!Core) return;

  const LAPTOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>';
  const PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  let guide = null;        // last known server guide
  let loading = null;      // in-flight GET
  let welcomeTimer = 0;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const user = () => global.currentUser || (global.localStorage && global.localStorage.getItem('fitnessAppUser')) || '';
  const cacheKey = () => `coachGuide_${user()}`;
  const isCoachPlan = () => global.currentUserPlan === 'coach';

  function toast(msg, kind) {
    if (typeof global.showToast === 'function') global.showToast(msg, kind);
  }

  function readCache() {
    try { return JSON.parse(global.localStorage.getItem(cacheKey()) || 'null'); } catch { return null; }
  }
  function writeCache(g) {
    try { global.localStorage.setItem(cacheKey(), JSON.stringify(g)); } catch { /* quota */ }
  }

  async function api(method, body) {
    const base = String(global.SERVER_URL || '').replace(/\/$/, '');
    const headers = typeof global.getAuthHeaders === 'function'
      ? global.getAuthHeaders()
      : { Authorization: `Bearer ${global.localStorage.getItem('token') || ''}` };
    const res = await fetch(`${base}/api/coach/guide`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);
    return data.guide;
  }

  function current() {
    return guide || readCache() || Core.emptyGuide();
  }

  function load(force) {
    if (!isCoachPlan()) return Promise.resolve(current());
    if (loading && !force) return loading;
    loading = api('GET').then(g => { guide = g; writeCache(g); return g; })
      .catch(() => current())
      .finally(() => { loading = null; });
    return loading;
  }

  // Apply locally first (so the UI never waits), then tell the server.
  function update(body) {
    const g = JSON.parse(JSON.stringify(current()));
    const ts = new Date().toISOString();
    (body.steps || []).forEach(id => { if (Core.STEP_IDS.includes(id) && !g.steps[id]) g.steps[id] = ts; });
    if (body.welcomeSeen && !g.welcomeSeen) g.welcomeSeen = ts;
    if (body.tour && !g.tours[body.tour]) g.tours[body.tour] = ts;
    if (body.replay) delete g.tours[body.replay];
    if (body.dismissed === true) g.dismissed = ts;
    if (body.dismissed === false) g.dismissed = null;
    guide = g;
    writeCache(g);
    renderCard();
    return api('POST', body).then(serverGuide => { guide = serverGuide; writeCache(serverGuide); renderCard(); })
      .catch(() => { /* kept locally; next load re-syncs */ });
  }

  function mark(stepId) {
    const g = current();
    if (!isCoachPlan() || (g.steps && g.steps[stepId])) return;
    update({ steps: [stepId] });
  }

  function clients() {
    const s = global.coachDashboardState;
    return (s && s.source === 'backend' && Array.isArray(s.clients)) ? s.clients : [];
  }

  // ── Actions ─────────────────────────────────────────────────

  async function copyCoachCode() {
    try {
      const base = String(global.SERVER_URL || '').replace(/\/$/, '');
      const res = await fetch(`${base}/api/coach/code`, { headers: global.getAuthHeaders ? global.getAuthHeaders() : {} });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error();
      const code = data.display || data.code;
      await copyText(code);
      toast(`Coach code ${code} copied`, 'success');
      mark('code');
      return code;
    } catch {
      toast('Couldn’t load your code. It’s also in Settings › Account.', 'error');
      return null;
    }
  }

  async function copyText(text) {
    if (global.navigator && global.navigator.clipboard) {
      try { await global.navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
    }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return true;
  }

  async function shareInvite() {
    const code = await copyCoachCode();
    if (!code) return;
    const text = `Join me on Pocket Coach: download the app, then enter my coach code ${code} under Settings › Account. You get Pro while I coach you.`;
    if (global.navigator && typeof global.navigator.share === 'function') {
      try { await global.navigator.share({ title: 'Train with me on Pocket Coach', text }); } catch { /* cancelled */ }
    } else {
      await copyText(text);
      toast('Invite message copied. Paste it to your client.', 'success');
    }
  }

  // The computer dashboard: share the link to yourself (AirDrop, mail,
  // notes…), or copy it where sharing isn't available.
  async function sendDesktopLink() {
    const url = Core.DASHBOARD_URL;
    if (global.navigator && typeof global.navigator.share === 'function') {
      try {
        await global.navigator.share({ title: 'Pocket Coach dashboard', text: 'Open this on your computer to build programs and plans:', url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    await copyText(url);
    toast('Link copied. Open it on your computer: pocketcoachcoms.org/coach', 'success');
  }

  // New accounts are in "athlete" mode, which hides every coach screen.
  // A coach who just upgraded gets "both" (their own training + coaching);
  // Settings › App mode still switches it back.
  function enableCoachMode() {
    if (typeof global.isCoachModeEnabled !== 'function' || global.isCoachModeEnabled()) return;
    if (typeof global.getCurrentAppMode === 'function' && global.getCurrentAppMode() === 'athlete' && typeof global.setCurrentAppMode === 'function') {
      global.setCurrentAppMode('both');
    }
    if (typeof global.setCoachModeEnabled === 'function') global.setCoachModeEnabled(true);
    if (typeof global.applyAppModeToNavigation === 'function') global.applyAppModeToNavigation();
  }

  function openCoachTab() {
    enableCoachMode();
    if (typeof global.showTab === 'function') global.showTab('clientsTab'); // renders the roster
  }

  const ACTIONS = {
    code: { label: 'Copy', run: copyCoachCode },
    client: { label: 'Invite', run: shareInvite },
    program: { label: 'Send link', run: sendDesktopLink },
    macros: { label: 'Send link', run: sendDesktopLink },
    desktop: { label: 'Send link', run: sendDesktopLink },
  };

  // ── Checklist card ──────────────────────────────────────────

  function renderCard() {
    const slot = document.getElementById('coachGuideCard');
    if (!slot) return;
    if (!isCoachPlan()) { slot.innerHTML = ''; return; }
    const g = current();
    const prog = Core.progress(g, clients());
    if (!Core.showChecklist(g, prog)) { slot.innerHTML = ''; return; }
    const next = Core.nextStep(prog, 'phone');
    const pct = Math.round((prog.doneCount / prog.total) * 100);
    slot.innerHTML = `
      <section class="pod mx-pod cg-card" aria-labelledby="cgCardTitle">
        <div class="cg-card-head">
          <h3 class="pod-title mx-h3" id="cgCardTitle">Get set up</h3>
          <span class="cg-count">${prog.doneCount} of ${prog.total}</span>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost cg-x" data-cg="hide" aria-label="Hide setup checklist">${CLOSE}</button>
        </div>
        <div class="cg-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${prog.total}" aria-valuenow="${prog.doneCount}"><span style="width:${pct}%"></span></div>
        <ol class="cg-steps">
          ${prog.steps.map(s => {
            const act = !s.done && ACTIONS[s.id];
            return `<li class="cg-step${s.done ? ' is-done' : ''}${next && next.id === s.id ? ' is-next' : ''}">
              <span class="cg-tick" aria-hidden="true">${s.done ? CHECK : ''}</span>
              <span class="cg-step-text"><span class="cg-step-title">${esc(s.title)}${s.where === 'desktop' ? `<span class="cg-where" title="Easiest on a computer">${LAPTOP}</span>` : ''}</span>
              ${s.done ? '' : `<small>${esc(s.sub)}</small>`}</span>
              ${act ? `<button type="button" class="cg-act" data-cg-step="${s.id}">${esc(act.label)}</button>` : ''}
              <span class="cg-sr">${s.done ? 'Done' : 'To do'}</span>
            </li>`;
          }).join('')}
        </ol>
        <div class="cg-card-foot">
          <button type="button" class="cg-link" data-cg="tour">Take the tour</button>
          <button type="button" class="cg-link cg-dim" data-cg="help">Phone or computer?</button>
        </div>
      </section>`;
    // Save what the client list proved, once.
    if (prog.newlyProven.length && guide) update({ steps: prog.newlyProven });
  }

  function onCardClick(e) {
    const stepBtn = e.target.closest('[data-cg-step]');
    if (stepBtn) {
      const a = ACTIONS[stepBtn.getAttribute('data-cg-step')];
      if (a) a.run();
      return;
    }
    const btn = e.target.closest('[data-cg]');
    if (!btn) return;
    const what = btn.getAttribute('data-cg');
    if (what === 'hide') {
      update({ dismissed: true });
      toast('Setup hidden. Bring it back from the Guide button.', 'info');
    } else if (what === 'tour') startTour();
    else if (what === 'help') openWelcome({ manual: true });
  }

  // ── Welcome sheet ───────────────────────────────────────────

  function closeSheet() {
    document.querySelectorAll('.cg-sheet-backdrop').forEach(n => n.remove());
    document.removeEventListener('keydown', onSheetKey);
  }
  function onSheetKey(e) { if (e.key === 'Escape') { closeSheet(); update({ welcomeSeen: true }); } }

  function openWelcome(opts) {
    const manual = !!(opts && opts.manual);
    closeSheet();
    enableCoachMode();
    const g = current();
    const prog = Core.progress(g, clients());
    const overlay = document.createElement('div');
    overlay.className = 'mx-sheet-backdrop cg-sheet-backdrop';
    overlay.innerHTML = `
      <div class="mx-sheet cg-sheet" role="dialog" aria-modal="true" aria-labelledby="cgSheetTitle">
        <div class="mx-sheet-head">
          <h3 class="pod-title mx-h3" id="cgSheetTitle">${manual ? 'Your coaching platform' : 'Welcome, coach'}</h3>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-cgw="later" aria-label="Close">${CLOSE}</button>
        </div>
        <p class="mx-sub cg-lead">${manual ? 'It works in two places. Use whichever fits the job.' : 'Your coaching platform is ready. It works in two places:'}</p>
        <div class="cg-split">
          <div class="cg-split-col">
            <span class="cg-split-icon">${PHONE}</span>
            <strong>Phone</strong>
            <ul>
              <li>See who needs you today</li>
              <li>Reply to check-ins and messages</li>
              <li>Share your coach code</li>
              <li>Log a session for a client</li>
            </ul>
          </div>
          <div class="cg-split-col">
            <span class="cg-split-icon">${LAPTOP}</span>
            <strong>Computer</strong>
            <ul>
              <li>Build programs and assign them</li>
              <li>Set macros and day-type plans</li>
              <li>Review check-ins side by side</li>
              <li>Groups, automations and videos</li>
            </ul>
          </div>
        </div>
        <p class="cg-url">${LAPTOP}<span>pocketcoachcoms.org/coach</span><small>Same login as the app</small></p>
        <div class="cg-sheet-actions">
          <button type="button" class="mx-cta cg-primary" data-cgw="tour"><span>${manual ? 'Replay the phone tour' : 'Take the 60-second tour'}</span></button>
          <button type="button" class="mx-outline cg-secondary" data-cgw="link">Send me the computer link</button>
          ${manual && g.dismissed ? '<button type="button" class="cg-link" data-cgw="restore">Show the setup checklist again</button>' : ''}
          ${!manual ? '<button type="button" class="cg-link cg-dim" data-cgw="later">Later</button>' : ''}
        </div>
        ${manual ? `<p class="mx-sub cg-progress-note">Setup: ${prog.doneCount} of ${prog.total} done.</p>` : ''}
      </div>`;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { closeSheet(); update({ welcomeSeen: true }); return; }
      const b = e.target.closest('[data-cgw]');
      if (!b) return;
      const what = b.getAttribute('data-cgw');
      closeSheet();
      update({ welcomeSeen: true });
      if (what === 'tour') startTour();
      else if (what === 'link') { openCoachTab(); sendDesktopLink(); }
      else if (what === 'restore') { update({ dismissed: false }); openCoachTab(); }
      else if (what === 'later' && !manual) {
        openCoachTab();
        toast('Your setup checklist is on the Coach tab.', 'info');
      }
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onSheetKey);
    const first = overlay.querySelector('[data-cgw="tour"]');
    if (first) setTimeout(() => first.focus(), 50);
  }

  // ── Tour ────────────────────────────────────────────────────

  const nav = tab => `#bottomNav .bn-item[data-tab="${tab}"]`;
  const tile = tab => `#allTab .all-hub-tile[data-tab="${tab}"]`;
  const show = tab => () => { if (typeof global.showTab === 'function') global.showTab(tab); };

  const TOUR_STEPS = [
    { title: 'Your coaching platform', text: 'A quick look at the coach screens on your phone. When you see <b>Tap</b>, tap the glowing spot yourself.', next: 'Start' },
    { target: nav('allTab'), tap: true, title: 'Tap All', text: 'Your coach screens live in All.' },
    { target: tile('clientsTab'), tap: true, title: 'Open Coach', text: 'Your clients and what needs you today.' },
    { target: '#coachGuideCard .cg-card', title: 'Your setup checklist', text: 'Six steps to your first coached client. They tick themselves as you go, on your phone or your computer.' },
    { target: ['#coachQueueSection > *', '#coachStatsBar'], title: 'Needs you today', text: 'Check-ins waiting for a reply and clients who’ve gone quiet land here first. Start each day here.' },
    { target: ['#coachDashboardContent .coach-dashboard-header', '#coachDashboardContent'], title: 'Your roster', text: 'Tap a client to see their weight trend, training and macros. <b>Add Client</b> invites someone by username.' },
    { target: '#clientsTab .coach-desktop-link', title: 'The computer dashboard', text: 'Programs, macro plans and side-by-side check-in reviews are quicker on a bigger screen. Same login: <b>pocketcoachcoms.org/coach</b>.' },
    { target: '#coachOpsSubtabNav', before: show('coachOpsTab'), title: 'Coach tools', text: '<b>Programs</b>, <b>Messages</b>, <b>Insights</b>, <b>AI</b> help and <b>Videos</b> for your clients. Find it under All › Coach Ops.' },
    { title: 'That’s the phone side', text: 'Phone for the day-to-day, computer for building. Your coach code is in Settings › Account, and the <b>Guide</b> button on the Coach tab brings this back.', next: 'Done', finale: true },
  ];

  function startTour() {
    if (typeof global.startAppTour !== 'function') { openCoachTab(); return; }
    openCoachTab();
    if (typeof global.showTab === 'function') global.showTab('homeTab');
    setTimeout(() => {
      global.startAppTour(TOUR_STEPS, {
        onEnd: () => { update({ tour: 'phone' }); show('clientsTab')(); },
      });
    }, 150);
  }

  // ── Wiring ──────────────────────────────────────────────────

  function appVisible() {
    const nav = document.getElementById('bottomNav');
    return !!(nav && nav.getClientRects().length);
  }

  // Called whenever the plan is (re)loaded. Opens the welcome once.
  async function onPlan() {
    ensureSlot();
    if (!isCoachPlan()) { renderCard(); return; }
    renderCard();
    const g = await load();
    renderCard();
    // Only when the server answered: offline, another device may already
    // have shown it.
    if (!guide || !Core.shouldWelcome(g, true)) return;
    clearTimeout(welcomeTimer);
    const tryOpen = (n) => {
      if (document.querySelector('.cg-sheet-backdrop, .tour-root, .tour-card, .mx-sheet-backdrop, #onboardingOverlay:not([hidden])')) {
        if (n < 20) welcomeTimer = setTimeout(() => tryOpen(n + 1), 1500);
        return;
      }
      if (!appVisible()) { if (n < 20) welcomeTimer = setTimeout(() => tryOpen(n + 1), 1500); return; }
      openWelcome();
    };
    welcomeTimer = setTimeout(() => tryOpen(0), 1200);
  }

  // The card slot and the Guide button, added to the Coach tab once.
  function ensureSlot() {
    const tab = document.getElementById('clientsTab');
    if (!tab) return;
    if (!document.getElementById('coachGuideCard')) {
      const slot = document.createElement('div');
      slot.id = 'coachGuideCard';
      const queue = document.getElementById('coachQueueSection');
      tab.insertBefore(slot, queue || tab.firstChild);
      slot.addEventListener('click', onCardClick);
    }
    const head = tab.querySelector('.coach-page-header');
    if (head && !head.querySelector('.cg-guide-btn')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cg-guide-btn';
      b.textContent = 'Guide';
      b.setAttribute('aria-label', 'Coach guide: tour and setup');
      b.addEventListener('click', () => openWelcome({ manual: true }));
      head.appendChild(b);
    }
  }

  function init() {
    ensureSlot();
    renderCard();
    global.addEventListener('pc:plan-loaded', onPlan);
    if (global.currentUserPlanLoaded) onPlan();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.CoachGuide = { refresh: renderCard, mark, openWelcome, startTour, load, sendDesktopLink, copyCoachCode, _steps: TOUR_STEPS };
})(typeof window !== 'undefined' ? window : globalThis);
