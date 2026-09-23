/* =============================================================
   APP TOUR — hands-on guided walkthrough over the real app.

   Started from the last intro-tutorial slide (showTutorial() in
   index.html) or from All → App tour. Each step spotlights a real
   element: "next" steps just explain it, "tap" steps wait for the
   user to actually tap it (so they learn the nav by using it), and
   "until" steps wait for a condition (e.g. an exercise picked).
   Styles: css/tutorial.css (.tour-*).
   ============================================================= */
(function (global) {
  'use strict';

  const PAD = 8;           // spotlight padding around the target
  const GAP = 14;          // space between spotlight and card
  const EDGE = 16;         // min distance from viewport edges

  function navItem(tab) { return `#bottomNav .bn-item[data-tab="${tab}"]`; }

  // Returns the first matching element that's actually on screen, so a
  // step can list fallbacks for cards that render empty for new users.
  function firstVisible(selectors) {
    for (const sel of [].concat(selectors)) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 4 && r.height > 12 && getComputedStyle(el).visibility !== 'hidden') return el;
      }
    }
    return null;
  }

  function flowCaptureOpen() {
    const fc = document.getElementById('flowCaptureOverlay');
    return !!fc && fc.style.display !== 'none' && fc.style.display !== '';
  }

  function ensureLogSubtab() {
    const btn = document.querySelector('#logSubtabNav .log-subtab[data-log-subtab="log"]');
    if (btn && !btn.classList.contains('active')) btn.click();
  }

  const STEPS = [
    {
      title: 'Quick hands-on tour',
      text: "We'll highlight each part of the app. When you see <b>Tap</b>, tap the glowing spot yourself. You can leave anytime.",
      next: "Let's go",
    },
    {
      target: '#bottomNav',
      title: 'Your navigation bar',
      text: 'These five buttons get you everywhere. Let\'s try them one by one.',
    },
    {
      target: navItem('homeTab'),
      tap: true,
      title: 'Tap Home',
      text: 'Home is your daily dashboard.',
    },
    {
      target: ['#dueNowRail', '#dailyPulseCard', '#todayProgramCard', '#homeDashboardContent', '#homeGreetingRow'],
      title: 'Start each day here',
      text: "Home shows what's due today: your next workout, check-ins and weigh-ins, plus your streak. When you're not sure what to do next, open Home.",
    },
    {
      target: navItem('logTab'),
      tap: true,
      title: 'Tap Train',
      text: 'Train is where you log your workouts. Let\'s log your first set.',
    },
    {
      target: '#exercise',
      before: ensureLogSubtab,
      title: 'Pick an exercise',
      text: 'Start typing, then choose from the suggestions. Or try it with Bench Press.',
      until: () => {
        const panel = document.getElementById('quickLogPanel');
        const ex = document.getElementById('exercise');
        const known = typeof global.isKnownExerciseName !== 'function' || global.isKnownExerciseName(ex ? ex.value.trim() : '');
        return panel && !panel.hidden && known;
      },
      helper: {
        label: 'Use Bench Press',
        run() {
          const ex = document.getElementById('exercise');
          if (!ex) return;
          ex.value = 'Bench Press';
          ex.dispatchEvent(new Event('input', { bubbles: true }));
        },
      },
      waitText: 'Pick an exercise',
    },
    {
      target: '#quickLogPanel .ql-row',
      title: 'Set weight & reps',
      text: 'Tap <b>+</b> / <b>−</b> to adjust. Tap the weight number to type it in or add plates. We\'ll fill in your last numbers next time.',
    },
    {
      target: '#quickLogPanel .ql-setopts-row',
      title: 'Tag special sets (optional)',
      text: '<b>Top</b> = your main heavy set, <b>BO</b> = back-off, <b>Drop</b> = drop set, <b>RP</b> = rest-pause, <b>L/R</b> = one side at a time. For a normal set, leave these off.',
    },
    {
      target: '#addLogBtn',
      tap: true,
      optional: 'Skip, I\'ll log later',
      title: 'Log it!',
      text: 'Tap <b>Log set</b> to save it. The form stays ready, so your next set is one more tap.',
      // addLogEntry() pops the Flow Capture "How did that feel?" sheet
      // above the tour; wait for the user to finish it before moving on.
      afterTap: () => new Promise((resolve) => {
        const started = Date.now();
        (function poll() {
          if (!flowCaptureOpen() && Date.now() - started > 700) return resolve();
          setTimeout(poll, 250);
        })();
      }),
    },
    {
      target: '#logSubtabNav',
      title: 'More inside Train',
      text: '<b>Rest</b> timer between sets, <b>History</b> of every workout, saved <b>Templates</b> to load a full workout in one tap, and your <b>Streaks</b>.',
    },
    {
      target: '#bnFab',
      title: 'Log from anywhere',
      text: 'The <b>+</b> button jumps straight to this log form from any screen, even mid-scroll on Home.',
    },
    {
      target: navItem('bodyTab'),
      tap: true,
      title: 'Tap Body',
      text: 'Everything about your body lives here.',
    },
    {
      target: ['#bodyTab .pill-nav', '#bodyTab'],
      title: 'Body tracking',
      text: 'Log <b>Weight</b>, <b>Macros</b>, <b>Sleep</b> and <b>Cardio</b>. Your summary shows underneath so you can spot trends quickly.',
    },
    {
      target: navItem('allTab'),
      tap: true,
      title: 'Tap All',
      text: 'The rest of the app is here.',
    },
    {
      target: ['#allTab .all-hub-section'],
      title: 'Everything else',
      text: '<b>Programs</b> to follow a plan, <b>History</b>, <b>Insights</b> with your PRs and trends. Scroll down for check-ins, libraries, community and <b>Settings</b>.',
    },
    {
      title: "You're all set",
      text: 'That\'s the whole app. You can replay this tour anytime from <b>All → App tour</b>. Now go train!',
      next: 'Finish',
      finale: true,
    },
  ];

  let tour = null; // active tour state, or null

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function buildDom() {
    const root = el('div', 'tour-root');
    const blocks = ['t', 'r', 'b', 'l'].map(() => {
      const b = el('div', 'tour-block');
      root.appendChild(b);
      return b;
    });
    const spot = el('div', 'tour-spot is-center');
    const card = el('div', 'tour-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = `
      <div class="tour-card-head">
        <div class="tour-card-progress"><span></span></div>
        <span class="tour-card-count"></span>
        <button type="button" class="tour-card-close">Exit tour</button>
      </div>
      <div class="tour-card-body">
        <h3 class="tour-card-title"></h3>
        <p class="tour-card-text"></p>
      </div>
      <div class="tour-card-actions"></div>`;
    root.appendChild(spot);
    root.appendChild(card);
    document.body.appendChild(root);
    card.querySelector('.tour-card-close').addEventListener('click', () => endTour(false));
    return { root, blocks, spot, card };
  }

  function resolveTarget(step) {
    if (!step.target) return null;
    return firstVisible(step.target);
  }

  // Lay out the hole, the blockers around it and the card next to it.
  function layout() {
    if (!tour) return;
    const { spot, blocks, card } = tour.dom;
    const vw = window.innerWidth;
    // Layout viewport for the hole; if the on-screen keyboard is up, keep
    // the card inside the part that's still visible above it.
    const lvh = window.innerHeight;
    const vv = window.visualViewport;
    const vh = vv && lvh - vv.height > 120 ? vv.height + vv.offsetTop : lvh;
    const target = tour.target;

    let hole = null;
    if (target && target.isConnected) {
      const r = target.getBoundingClientRect();
      // Clamp tall targets to the viewport so the hole stays on screen.
      const top = Math.max(r.top - PAD, 6);
      const bottom = Math.min(r.bottom + PAD, lvh - 6);
      if (bottom - top > 10) {
        hole = { top, left: Math.max(r.left - PAD, 6), width: 0, height: bottom - top };
        hole.width = Math.min(r.right + PAD, vw - 6) - hole.left;
      }
    }

    const key = hole ? `${hole.top|0},${hole.left|0},${hole.width|0},${hole.height|0},${vw},${vh}` : `c,${vw},${vh}`;
    if (key === tour.lastKey && !tour.forceLayout) return;
    tour.lastKey = key;
    tour.forceLayout = false;

    if (hole) {
      spot.classList.remove('is-center');
      Object.assign(spot.style, { top: `${hole.top}px`, left: `${hole.left}px`, width: `${hole.width}px`, height: `${hole.height}px` });
      const radius = Math.min(18, hole.height / 2);
      spot.style.borderRadius = `${radius}px`;
      // Blockers: top, right, bottom, left of the hole.
      Object.assign(blocks[0].style, { top: 0, left: 0, width: '100vw', height: `${hole.top}px` });
      Object.assign(blocks[1].style, { top: `${hole.top}px`, left: `${hole.left + hole.width}px`, width: `${Math.max(vw - hole.left - hole.width, 0)}px`, height: `${hole.height}px` });
      Object.assign(blocks[2].style, { top: `${hole.top + hole.height}px`, left: 0, width: '100vw', height: `${Math.max(lvh - hole.top - hole.height, 0) + 200}px` });
      Object.assign(blocks[3].style, { top: `${hole.top}px`, left: 0, width: `${hole.left}px`, height: `${hole.height}px` });
    } else {
      spot.classList.add('is-center');
      Object.assign(blocks[0].style, { top: 0, left: 0, width: '100vw', height: '100vh' });
      [1, 2, 3].forEach((i) => Object.assign(blocks[i].style, { width: 0, height: 0 }));
    }

    // Card: below the hole if it fits, else above, else centered.
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let top, left;
    if (hole) {
      const below = hole.top + hole.height + GAP;
      const above = hole.top - GAP - ch;
      if (below + ch <= vh - EDGE) top = below;
      else if (above >= EDGE) top = above;
      else top = vh - ch - EDGE; // overlaps a tall target; bottom is least in the way
      left = hole.left + hole.width / 2 - cw / 2;
    } else {
      top = vh / 2 - ch / 2;
      left = vw / 2 - cw / 2;
    }
    left = Math.max(EDGE, Math.min(left, vw - cw - EDGE));
    top = Math.max(EDGE, top);
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }

  function loop() {
    if (!tour) return;
    layout();
    tour.raf = requestAnimationFrame(loop);
  }

  function renderCard(step, index) {
    const { card } = tour.dom;
    const total = STEPS.length;
    card.querySelector('.tour-card-progress span').style.width = `${((index + 1) / total) * 100}%`;
    card.querySelector('.tour-card-count').textContent = `${index + 1} / ${total}`;
    card.querySelector('.tour-card-close').hidden = !!step.finale;
    card.querySelector('.tour-card-title').textContent = step.title;
    card.querySelector('.tour-card-text').innerHTML = step.text;

    const actions = card.querySelector('.tour-card-actions');
    actions.innerHTML = '';
    if (step.tap || step.until) {
      actions.appendChild(el('span', 'tour-card-hint', step.waitText || `Tap the highlighted ${step.target === '#addLogBtn' ? 'button' : 'spot'}`));
    }
    if (step.optional) {
      const skip = el('button', 'tour-btn tour-btn--link', step.optional);
      skip.type = 'button';
      skip.addEventListener('click', () => goTo(tour.index + 1));
      actions.appendChild(skip);
    }
    if (step.helper) {
      const h = el('button', 'tour-btn tour-btn--ghost', step.helper.label);
      h.type = 'button';
      h.addEventListener('click', () => { step.helper.run(); checkUntil(); });
      actions.appendChild(h);
    }
    if (!step.tap && !step.until) {
      if (index > 0 && !step.finale) {
        const back = el('button', 'tour-btn tour-btn--link', 'Back');
        back.type = 'button';
        back.addEventListener('click', () => goBack());
        actions.appendChild(back);
      }
      const next = el('button', 'tour-btn tour-btn--primary', step.next || 'Next');
      next.type = 'button';
      next.addEventListener('click', () => (step.finale ? endTour(true) : goTo(index + 1)));
      actions.appendChild(next);
      setTimeout(() => next.focus({ preventScroll: true }), 50);
    }

    card.classList.remove('is-swapping');
    void card.offsetWidth; // restart the swap animation
    card.classList.add('is-swapping');
  }

  function checkUntil() {
    if (!tour) return;
    const step = STEPS[tour.index];
    if (step.until && step.until()) {
      const idx = tour.index;
      setTimeout(() => { if (tour && tour.index === idx) goTo(idx + 1); }, 450);
    }
  }

  // Tap steps: let the app handle the tap first, then advance.
  function onDocClick(e) {
    if (!tour || tour.busy) return;
    const step = STEPS[tour.index];
    if (!step.tap || !tour.target || !tour.target.contains(e.target)) return;
    tour.busy = true;
    const idx = tour.index;
    const after = step.afterTap ? step.afterTap : () => new Promise((r) => setTimeout(r, 350));
    if (step.afterTap) tour.dom.root.classList.add('is-paused');
    after().then(() => {
      if (!tour || tour.index !== idx) return;
      tour.dom.root.classList.remove('is-paused');
      tour.busy = false;
      goTo(idx + 1);
    });
  }

  function onKey(e) {
    if (!tour) return;
    if (e.key === 'Escape' && !flowCaptureOpen()) endTour(false);
  }

  function goBack() {
    // Step back over tap/until steps too: they're reached by doing, so
    // land on the nearest plain explanation step instead.
    let i = tour.index - 1;
    while (i > 0 && (STEPS[i].tap || STEPS[i].until)) i--;
    goTo(Math.max(i, 0));
  }

  function goTo(index) {
    if (!tour) return;
    if (index >= STEPS.length) { endTour(true); return; }
    const step = STEPS[index];
    tour.index = index;
    tour.busy = false;
    if (typeof step.before === 'function') {
      try { step.before(); } catch (err) { console.warn('[AppTour] step setup failed:', err); }
    }

    // Give tab switches a moment to render before measuring.
    setTimeout(() => {
      if (!tour || tour.index !== index) return;
      const target = resolveTarget(step);
      if (step.target && !target) {
        // Nothing to point at (feature hidden for this user) — skip it.
        goTo(index + 1);
        return;
      }
      tour.target = target;
      tour.dom.spot.classList.toggle('is-tap', !!step.tap);
      const isFixed = target && getComputedStyle(target).position === 'fixed'
        || (target && target.closest('#bottomNav'));
      if (target && !isFixed) {
        const r = target.getBoundingClientRect();
        if (r.top < 70 || r.bottom > window.innerHeight - 200) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      renderCard(step, index);
      tour.forceLayout = true;
      layout();
      if (step.until) checkUntil();
    }, 60);
  }

  function confetti() {
    const card = tour && tour.dom.card.getBoundingClientRect();
    if (!card) return;
    const colors = ['#38a870', '#2f8a63', '#c79a54', '#e8d3a8', '#ffffff'];
    for (let i = 0; i < 28; i++) {
      const c = el('span', 'tour-confetti');
      const angle = (Math.PI * 2 * i) / 28;
      const dist = 90 + Math.random() * 120;
      c.style.left = `${card.left + card.width / 2}px`;
      c.style.top = `${card.top + 20}px`;
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      c.style.setProperty('--dy', `${Math.sin(angle) * dist + 120}px`);
      c.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
      c.style.animationDelay = `${Math.random() * 0.12}s`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 1600);
    }
  }

  function doneKey() {
    const user = global.currentUser || localStorage.getItem('fitnessAppUser');
    return user ? `app_tour_done_${user}` : 'app_tour_done';
  }

  function endTour(completed) {
    if (!tour) return;
    const t = tour;
    if (completed) confetti();
    try { localStorage.setItem(doneKey(), completed ? 'done' : 'exited'); } catch (_) { /* storage blocked */ }
    tour = null;
    cancelAnimationFrame(t.raf);
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('input', checkUntil, true);
    document.removeEventListener('change', checkUntil, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', layout, true);
    window.removeEventListener('resize', layout);
    t.dom.root.style.transition = 'opacity 0.3s';
    t.dom.root.style.opacity = '0';
    setTimeout(() => t.dom.root.remove(), 320);
    if (completed && typeof global.showTab === 'function') {
      global.showTab('homeTab');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function startAppTour() {
    if (tour) return;
    const nav = document.getElementById('bottomNav');
    if (!nav || !nav.getClientRects().length) {
      console.warn('[AppTour] app shell not visible; tour not started');
      return;
    }
    tour = { index: 0, target: null, dom: buildDom(), raf: 0, lastKey: '', busy: false };
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('input', checkUntil, true);
    document.addEventListener('change', checkUntil, true);
    document.addEventListener('keydown', onKey);
    // The rAF loop tracks moving targets; these cover frames it misses.
    window.addEventListener('scroll', layout, { capture: true, passive: true });
    window.addEventListener('resize', layout);
    goTo(0);
    loop();
  }

  global.startAppTour = startAppTour;
  global.endAppTour = () => endTour(false);
})(typeof window !== 'undefined' ? window : globalThis);
