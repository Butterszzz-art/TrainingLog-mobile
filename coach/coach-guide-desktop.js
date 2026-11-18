/* =============================================================
   COACH GUIDE (computer) — the coach/ dashboard side of the coach
   onboarding (phone side: src/js/coach-guide.js).
   - First visit: a welcome card, then a tour over the sidebar that
     opens each page as it explains it.
   - "Get set up" card at the top of Today (#wsSetupCard) with the
     same six steps as the phone, ticked from the roster.
   - A Guide button (bottom right) brings both back any time.
   Rules: ../src/js/coach-guide-core.js. Progress: /api/coach/guide.
   Reads coach.js globals (_clients, coachFetch, authHeaders,
   SERVER_URL, railNavGo). Styles: coach-guide-desktop.css.
   ============================================================= */
(function (global) {
  'use strict';

  const Core = global.CoachGuideCore;
  if (!Core) return;

  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>';
  const HELP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  let guide = null;
  let started = false;   // first load done
  let blocked = false;   // not on the Coach plan: no guide here
  let tour = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // coach.js keeps these as top-level bindings, not window properties.
  /* global _clients, coachFetch, authHeaders, SERVER_URL, railNavGo, _clientsLoadError */
  const roster = () => (typeof _clients !== 'undefined' && Array.isArray(_clients) ? _clients : []);
  const rosterOk = () => typeof _clientsLoadError === 'undefined' || !_clientsLoadError;
  const go = section => { if (typeof railNavGo === 'function') railNavGo(section); };

  async function api(method, body) {
    const res = await coachFetch(SERVER_URL + '/api/coach/guide', {
      method,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const err = new Error((data.error && data.error.message) || 'HTTP ' + res.status);
      err.code = data.error && data.error.code;
      throw err;
    }
    return data.guide;
  }

  function current() { return guide || Core.emptyGuide(); }

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
    renderCard();
    return api('POST', body).then(s => { guide = s; renderCard(); }).catch(() => {});
  }

  // ── "Get set up" card ───────────────────────────────────────

  const ACTIONS = {
    code: { label: 'Show code', run: () => openCodeHint() },
    client: { label: 'Open Clients', run: () => go('clients') },
    program: { label: 'Open Programs', run: () => go('programs') },
    macros: { label: 'Open Clients', run: () => go('clients') },
    checkin: { label: 'Open Check-ins', run: () => go('checkins') },
  };

  function ensureSlot() {
    const panel = document.getElementById('wsPanel-queue');
    if (panel && !document.getElementById('wsSetupCard')) {
      const slot = document.createElement('div');
      slot.id = 'wsSetupCard';
      panel.insertBefore(slot, panel.firstChild);
      slot.addEventListener('click', onCardClick);
    }
    if (!document.getElementById('cgdGuideBtn')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'cgdGuideBtn';
      b.className = 'cgd-guide-btn';
      b.innerHTML = HELP + '<span>Guide</span>';
      b.setAttribute('aria-label', 'Coach guide: tour and setup');
      b.addEventListener('click', openWelcome.bind(null, { manual: true }));
      document.body.appendChild(b);
    }
  }

  function renderCard() {
    const slot = document.getElementById('wsSetupCard');
    if (!slot) return;
    const g = current();
    const prog = Core.progress(g, rosterOk() ? roster() : []);
    if (!started || !Core.showChecklist(g, prog)) { slot.innerHTML = ''; return; }
    const next = Core.nextStep(prog, 'desktop');
    const pct = Math.round((prog.doneCount / prog.total) * 100);
    slot.innerHTML = `
      <section class="pod cgd-card" aria-labelledby="cgdCardTitle">
        <div class="cgd-card-head">
          <div>
            <div class="ca-kicker">Get set up</div>
            <h3 class="cgd-card-title" id="cgdCardTitle">${prog.doneCount} of ${prog.total} done${next ? ' · next: ' + esc(next.title.toLowerCase()) : ''}</h3>
          </div>
          <button type="button" class="cgd-text" data-cgd="tour">Take the tour</button>
          <button type="button" class="cgd-x" data-cgd="hide" aria-label="Hide setup checklist">${CLOSE}</button>
        </div>
        <div class="cgd-meter"><span style="width:${pct}%"></span></div>
        <ol class="cgd-steps">
          ${prog.steps.map(s => {
            const act = !s.done && ACTIONS[s.id];
            return `<li class="cgd-step${s.done ? ' is-done' : ''}${next && next.id === s.id ? ' is-next' : ''}">
              <span class="cgd-tick" aria-hidden="true">${s.done ? CHECK : ''}</span>
              <span class="cgd-step-text"><strong>${esc(s.title)}</strong>${s.done ? '' : `<small>${esc(s.sub)}</small>`}</span>
              ${act ? `<button type="button" class="cgd-act" data-cgd-step="${s.id}">${esc(act.label)}</button>` : ''}
              <span class="cg-sr">${s.done ? 'Done' : 'To do'}</span>
            </li>`;
          }).join('')}
        </ol>
      </section>`;
    if (prog.newlyProven.length && guide && rosterOk()) update({ steps: prog.newlyProven });
  }

  function onCardClick(e) {
    const s = e.target.closest('[data-cgd-step]');
    if (s) { const a = ACTIONS[s.getAttribute('data-cgd-step')]; if (a) a.run(); return; }
    const b = e.target.closest('[data-cgd]');
    if (!b) return;
    if (b.getAttribute('data-cgd') === 'hide') update({ dismissed: true });
    else startTour();
  }

  // The coach code lives in the phone app (Settings › Account).
  async function openCodeHint() {
    let code = '';
    try {
      const res = await coachFetch(SERVER_URL + '/api/coach/code', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok && data.success) code = data.display || data.code;
    } catch { /* shown without the code */ }
    openModal(`
      <h2 class="cgd-modal-title" id="cgdModalTitle">Your coach code</h2>
      ${code ? `<p class="cgd-code">${esc(code)}</p>` : ''}
      <p class="cgd-modal-sub">Clients enter it in the Pocket Coach app under <b>Settings › Account</b>. They join your roster and get Pro while you're on the Coach plan.</p>
      <div class="cgd-modal-actions">
        ${code ? '<button type="button" class="cgd-primary" data-cgm="copy">Copy code</button>' : ''}
        <button type="button" class="cgd-secondary" data-cgm="close">Close</button>
      </div>`, async what => {
      if (what === 'copy' && code) {
        try { await navigator.clipboard.writeText(code); } catch { /* ignore */ }
        update({ steps: ['code'] });
      }
      closeModal();
    });
  }

  // ── Modal (welcome / code) ──────────────────────────────────

  function closeModal() {
    document.querySelectorAll('.cgd-backdrop').forEach(n => n.remove());
    document.removeEventListener('keydown', onModalKey);
  }
  let onModalEsc = null;
  function onModalKey(e) { if (e.key === 'Escape' && onModalEsc) onModalEsc(); }

  function openModal(html, onAction, onEsc) {
    closeModal();
    const el = document.createElement('div');
    el.className = 'cgd-backdrop';
    el.innerHTML = `<div class="cgd-modal" role="dialog" aria-modal="true" aria-labelledby="cgdModalTitle">${html}</div>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-cgm]');
      if (b) onAction(b.getAttribute('data-cgm'));
      else if (e.target === el) (onEsc || closeModal)();
    });
    onModalEsc = onEsc || closeModal;
    document.body.appendChild(el);
    document.addEventListener('keydown', onModalKey);
    const first = el.querySelector('.cgd-primary, button');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function openWelcome(opts) {
    const manual = !!(opts && opts.manual);
    const g = current();
    const prog = Core.progress(g, roster());
    const finishFirst = () => { closeModal(); if (!manual) update({ tour: 'desktop', welcomeSeen: true }); };
    openModal(`
      <div class="ca-kicker">${manual ? 'Coach guide' : 'Welcome, coach'}</div>
      <h2 class="cgd-modal-title" id="cgdModalTitle">${manual ? 'Your coaching dashboard' : 'This is your coaching dashboard'}</h2>
      <p class="cgd-modal-sub">The computer is where you build: programs, macro plans and side-by-side check-in reviews. Day-to-day replies work best on your phone.</p>
      <div class="cgd-split">
        <div><strong>On this computer</strong><ul><li>Build programs and assign them</li><li>Set macros and day-type plans</li><li>Review check-ins and photos</li><li>Groups, automations, videos</li></ul></div>
        <div><strong>${PHONE} On your phone</strong><ul><li>Who needs you today</li><li>Quick replies and messages</li><li>Share your coach code</li><li>Log a session for a client</li></ul></div>
      </div>
      <p class="cgd-modal-sub">Setup: ${prog.doneCount} of ${prog.total} done. The tour takes about a minute and opens each page as it goes.</p>
      <div class="cgd-modal-actions">
        <button type="button" class="cgd-primary" data-cgm="tour">${manual ? 'Replay the tour' : 'Take the tour'}</button>
        ${manual && g.dismissed ? '<button type="button" class="cgd-secondary" data-cgm="restore">Show the setup checklist</button>' : ''}
        <button type="button" class="cgd-secondary" data-cgm="close">${manual ? 'Close' : 'Skip for now'}</button>
      </div>`, what => {
      closeModal();
      if (what === 'tour') { if (!manual) update({ welcomeSeen: true }); startTour(); }
      else if (what === 'restore') { update({ dismissed: false }); go('queue'); }
      else finishFirst();
    }, finishFirst);
  }

  // ── Tour over the sidebar ───────────────────────────────────

  const rail = id => `.rail-nav-item[data-rail="${id}"]`;
  const STEPS = [
    { title: 'A minute around your dashboard', text: 'We’ll open each page as we go. Use <b>Next</b> or the arrow keys; <b>Esc</b> leaves.' },
    { target: rail('queue'), section: 'queue', title: 'Today: who needs you', text: 'Clients with alerts, new check-in photos or replies are listed under <b>Do this now</b>, most urgent first. Your setup checklist sits here too.' },
    { target: rail('clients'), section: 'clients', title: 'Clients', text: 'Pick a client to see their weight trend, training, check-ins and macros. Their page is where you <b>assign a program</b> and <b>set macros</b>.' },
    { target: rail('checkins'), section: 'checkins', title: 'Check-ins', text: 'Every check-in in one list. Compare photos side by side, comment on them, or mark them reviewed. Your reply shows on their phone.' },
    { target: rail('programs'), section: 'programs', title: 'Build a program once, assign it to many', text: 'Make weeks and days here (or import a sheet), then assign it from a client’s page. It shows on their phone as <b>Up today</b>.' },
    { target: rail('meals'), section: 'meals', title: 'Nutrition', text: '<b>Foods</b> and <b>Meals</b> are your library for meal plans. Macro targets, including training-day and rest-day plans, are set per client.' },
    { target: rail('automations'), section: 'automations', title: 'Groups and automations', text: '<b>Training Groups</b> coach many clients at once. <b>Automations</b> send reminders and check-in nudges for you.' },
    { target: rail('messages'), section: 'messages', title: 'Messages', text: 'Chat with clients here or from your phone. It’s the same conversation on both.' },
    { target: '#cgdGuideBtn', section: 'queue', title: 'That’s the tour', text: 'Work through <b>Get set up</b> on Today. The <b>Guide</b> button brings this back any time.', last: true },
  ];

  function startTour() {
    endTour(false);
    closeModal();
    const root = document.createElement('div');
    root.className = 'cgd-tour';
    root.innerHTML = '<div class="cgd-spot"></div><div class="cgd-tip" role="dialog" aria-live="polite"></div>';
    document.body.appendChild(root);
    tour = { i: 0, root };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-cgt]');
      if (!b) return;
      const what = b.getAttribute('data-cgt');
      if (what === 'next') step(1);
      else if (what === 'back') step(-1);
      else endTour(true);
    });
    document.addEventListener('keydown', onTourKey);
    window.addEventListener('resize', place);
    show();
  }

  function onTourKey(e) {
    if (!tour) return;
    if (e.key === 'Escape') endTour(true);
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') step(-1);
  }

  function step(d) {
    if (!tour) return;
    const n = tour.i + d;
    if (n >= STEPS.length) { endTour(true); return; }
    if (n < 0) return;
    tour.i = n;
    show();
  }

  function show() {
    const s = STEPS[tour.i];
    if (s.section) go(s.section);
    const tip = tour.root.querySelector('.cgd-tip');
    tip.innerHTML = `
      <div class="cgd-tip-count">${tour.i + 1} of ${STEPS.length}</div>
      <h3>${esc(s.title)}</h3>
      <p>${s.text}</p>
      <div class="cgd-tip-actions">
        ${tour.i > 0 ? '<button type="button" class="cgd-text" data-cgt="back">Back</button>' : '<button type="button" class="cgd-text cgd-dim" data-cgt="end">Skip</button>'}
        <button type="button" class="cgd-primary" data-cgt="next">${s.last ? 'Done' : tour.i === 0 ? 'Start' : 'Next'}</button>
      </div>`;
    requestAnimationFrame(place);
    setTimeout(() => { const n = tip.querySelector('[data-cgt="next"]'); if (n) n.focus(); }, 30);
  }

  function place() {
    if (!tour) return;
    const s = STEPS[tour.i];
    const spot = tour.root.querySelector('.cgd-spot');
    const tip = tour.root.querySelector('.cgd-tip');
    const target = s.target && document.querySelector(s.target);
    const r = target && target.getBoundingClientRect();
    if (!r || !r.width) {
      tour.root.classList.add('is-center');
      spot.style.cssText = '';
      tip.style.cssText = '';
      return;
    }
    tour.root.classList.remove('is-center');
    if (target.scrollIntoView && (r.top < 0 || r.bottom > innerHeight)) target.scrollIntoView({ block: 'center' });
    const rr = target.getBoundingClientRect();
    const pad = 6;
    spot.style.cssText = `top:${rr.top - pad}px;left:${rr.left - pad}px;width:${rr.width + pad * 2}px;height:${rr.height + pad * 2}px`;
    const tw = Math.min(340, innerWidth - 32);
    const th = tip.offsetHeight || 180;
    let left = rr.right + 18;
    let top = rr.top + rr.height / 2 - th / 2;
    if (left + tw > innerWidth - 16) { left = Math.max(16, rr.left - tw - 18); }
    if (left < 16 || (left + tw > innerWidth - 16)) { left = Math.max(16, Math.min(innerWidth - tw - 16, rr.left)); top = rr.top - th - 18; }
    top = Math.max(16, Math.min(innerHeight - th - 16, top));
    tip.style.cssText = `top:${top}px;left:${left}px;width:${tw}px`;
  }

  function endTour(record) {
    if (tour) {
      tour.root.remove();
      tour = null;
      document.removeEventListener('keydown', onTourKey);
      window.removeEventListener('resize', place);
      go('queue');
    }
    if (record) update({ tour: 'desktop', welcomeSeen: true });
  }

  // ── Wiring ──────────────────────────────────────────────────

  async function refresh() {
    if (blocked) return;
    ensureSlot();
    if (started) { renderCard(); return; }
    const shell = document.getElementById('appShell');
    if (!shell || shell.style.display === 'none') return;
    started = true;
    try {
      guide = await api('GET');
    } catch (err) {
      // Not on the Coach plan (or offline): no guide on this page.
      if (err && /plan/.test(err.code || '')) { blocked = true; hideAll(); return; }
      guide = Core.emptyGuide();
    }
    renderCard();
    // Opening the dashboard is a setup step itself.
    if (!current().steps.desktop) update({ steps: ['desktop'] });
    if (Core.shouldAutoTour(guide, 'desktop') && !new URLSearchParams(location.search).has('noguide')) {
      setTimeout(() => openWelcome(), 600);
    }
  }

  function hideAll() {
    const slot = document.getElementById('wsSetupCard');
    if (slot) slot.innerHTML = '';
    const b = document.getElementById('cgdGuideBtn');
    if (b) b.remove();
  }

  global.CoachGuideDesktop = { refresh, startTour, openWelcome, _steps: STEPS };
})(window);
