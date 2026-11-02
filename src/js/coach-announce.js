/* "New from your coach": when the coach publishes a plan (or a new version)
 * or sends a program, the client gets a short sheet that says what arrived,
 * shows the coach's note, where today stands, and where everything lives in
 * the app, with Start program / Open My Plan / Show me around.
 *
 * - It opens by itself once, the first time the app is open after something
 *   new arrives (decided by the coach: "pop up once"). If it can't open right
 *   then (another sheet or tour is up), a card on Home waits until it's seen.
 * - Tapping the coach's notification opens it too.
 * - "Show me around" runs the coaching tour (src/js/guide-tours.js 'coach').
 *
 *   CoachAnnounce.latest({ plan, assignments, activeUids }) → announcement | null  (pure)
 *   CoachAnnounce.sheetHtml(a, { today, following, plan })  → HTML               (pure)
 *   CoachAnnounce.sync(state)   called by client-coaching.js after each refresh
 *   CoachAnnounce.open(data?)   the notification tap */
(function (globalScope) {
  'use strict';

  const PHASE = { cut: 'Cut', maintain: 'Maintain', build: 'Build', deload: 'Deload' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function tsMs(t) {
    if (!t) return 0;
    if (typeof t === 'string') return Date.parse(t) || 0;
    if (t._seconds) return t._seconds * 1000;
    if (t.seconds) return t.seconds * 1000;
    return Number(t) || 0;
  }

  /** The most recent thing the coach sent: the published plan or an assigned program. */
  function latest({ plan, assignments, activeUids }) {
    const out = [];
    const active = activeUids || new Set();
    if (plan && plan.status === 'published' && plan.client && active.has(plan.client.coachUid)) {
      const a = plan.announcement || {};
      const coach = (assignments || []).find(x => x && x.coachUid === plan.client.coachUid);
      out.push({
        kind: 'plan',
        key: a.key || `plan:${plan.planId}`,
        name: (plan.package && plan.package.name) || 'Your plan',
        version: plan.version || 1,
        message: a.message || '',
        coach: (coach && coach.coachUsername) || '',
        at: tsMs(a.at || (plan.approval && plan.approval.publishedAt)),
      });
    }
    (assignments || []).forEach(asn => {
      const a = asn && asn.programAnnouncement;
      if (!a || !a.key || !active.has(asn.coachUid)) return;
      out.push({ kind: 'program', key: a.key, name: a.title || 'New program', version: 1, message: a.message || '', coach: asn.coachUsername || '', at: tsMs(a.at) });
    });
    (assignments || []).forEach(asn => {
      const m = asn && asn.mealPlan;
      if (!m || !m.key || !active.has(asn.coachUid)) return;
      out.push({ kind: 'meals', key: m.key, name: 'Your meal plan', version: 1, message: m.note || '', coach: asn.coachUsername || '', at: tsMs(m.sentAt) });
    });
    out.sort((x, y) => y.at - x.at);
    return out[0] || null;
  }

  function localIso(d) {
    const x = d || new Date();
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  function fmtDay(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  }

  /** Where today stands in the plan, one or two lines. */
  function todayLine(plan, today) {
    const T = globalScope.PlanToday;
    if (!plan || !T) return '';
    const r = T.resolve(plan, today);
    if (!r) return '';
    if (!r.phase) return r.before ? `Your plan starts ${esc(fmtDay(plan.startDate))}.` : '';
    const t = r.targets;
    const day = r.dayType === 'training' ? `Today is a training day${r.day ? `: <b>${esc(r.day.name)}</b>` : ''}` : r.dayType === 'rest' ? 'Today is a rest day' : '';
    return `Week ${r.planWeek} of ${r.totalWeeks} · ${esc(PHASE[r.phase.type] || r.phase.type)}.`
      + (day ? ` ${day}` : '')
      + (t ? ` · ${Math.round(t.kcal)} kcal, ${Math.round(t.protein)} g protein.` : '.');
  }

  /** opts: { today, following (already following the plan's program), plan, hasProgram } */
  function sheetHtml(a, opts) {
    const o = opts || {};
    const isPlan = a.kind === 'plan';
    const title = isPlan ? (a.version > 1 ? `Your plan, version ${a.version}` : a.name) : a.name;
    const from = a.coach ? `From ${esc(a.coach)}` : 'From your coach';
    if (a.kind === 'meals') {
      return `<div class="mx-sheet ca-sheet" role="dialog" aria-modal="true" aria-labelledby="caTitle">
      <div class="mx-sheet-head">
        <div><span class="mx-kicker">New from your coach · ${from}</span>
          <h3 class="pod-title mx-h3" id="caTitle">Your meal plan</h3></div>
        <button type="button" class="mx-iconbtn mx-iconbtn--ghost ca-close" data-ca-act="close" aria-label="Close">✕</button>
      </div>
      ${a.message ? `<blockquote class="ca-note">“${esc(a.message)}”</blockquote>` : ''}
      <p class="ca-lead">Your coach planned your meals. Every day your food log fills with that day’s meals, for a training day or a rest day, already counted.</p>
      <div class="ca-where-title mx-kicker">How it works</div>
      <ul class="ca-where">
        <li><b>Macros → Food log</b><span>Your meals are in today’s log. Tap <b>✓ Ate this</b> when you’ve eaten one.</span></li>
        <li><b>Something different?</b><span>Tap a food to change the amount, remove it, or add what you had extra. Use <b>Swap</b> for another option your coach gave you.</span></li>
        <li><b>End of the day</b><span>Tap <b>Complete day</b>. Meals still in the log count as eaten.</span></li>
      </ul>
      <div class="ca-actions"><button type="button" class="mx-cta" data-ca-act="food"><span>Open my food log</span><span class="mx-cta-icon">→</span></button>
        <button type="button" class="ca-link" data-ca-act="close">Got it</button></div>
    </div>`;
    }
    const lead = isPlan
      ? (a.version > 1 ? 'Your coach updated your plan. The app already follows the new version.' : 'Your coach made your plan: your training, your nutrition and how they change over the weeks. The app follows it for you.')
      : 'Your coach sent you a new program.';
    const where = [
      ['Home → Up today', 'Your session for the day, with sets, reps and how hard to go. Tap <b>▶</b> next to an exercise to see how it’s done.'],
      ['Log', 'Tap an exercise from your plan to log it. <b>RIR</b> means reps in reserve: stop with that many reps left in the tank. “RIR 2/1” means 1 on the last set.'],
      ...(isPlan ? [
        ['Macros', 'Your targets switch between training and rest days by themselves, and change when a new phase starts.'],
        ['Program → My Plan', 'Your phases, today’s targets' + (o.plan && o.plan.attachment ? ', and your coach’s plan document' : '') + '.'],
      ] : [['Program → My Programs', 'The full program, every week.']]),
    ];
    const primary = o.hasProgram && !o.following
      ? '<button type="button" class="mx-cta" data-ca-act="start"><span>Start program</span><span class="mx-cta-icon">▶</span></button>'
      : `<button type="button" class="mx-cta" data-ca-act="plan"><span>${isPlan ? 'Open My Plan' : 'Open the program'}</span><span class="mx-cta-icon">→</span></button>`;
    return `<div class="mx-sheet ca-sheet" role="dialog" aria-modal="true" aria-labelledby="caTitle">
      <div class="mx-sheet-head">
        <div><span class="mx-kicker">New from your coach · ${from}</span>
          <h3 class="pod-title mx-h3" id="caTitle">${esc(title)}</h3></div>
        <button type="button" class="mx-iconbtn mx-iconbtn--ghost ca-close" data-ca-act="close" aria-label="Close">✕</button>
      </div>
      ${a.message ? `<blockquote class="ca-note">“${esc(a.message)}”</blockquote>` : ''}
      <p class="ca-lead">${lead}</p>
      ${isPlan && o.plan ? `<p class="ca-today">${todayLine(o.plan, o.today || localIso())}</p>` : ''}
      ${o.hasProgram && !o.following ? '<p class="ca-today">Tap <b>Start program</b> so Home and the Log follow it, from the right week.</p>' : ''}
      <div class="ca-where-title mx-kicker">Where to find things</div>
      <ul class="ca-where">${where.map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join('')}</ul>
      <div class="ca-actions">${primary}
        <button type="button" class="mx-outline mx-outline--block" data-ca-act="tour">Show me around</button>
        <button type="button" class="ca-link" data-ca-act="close">Got it</button></div>
    </div>`;
  }

  function cardHtml(a) {
    return `<button type="button" class="ca-card" data-ca-act="open">
      <span class="ca-card-dot" aria-hidden="true"></span>
      <span class="ca-card-text"><span class="mx-kicker">New from your coach</span>
      <b>${esc(a.kind === 'plan' ? (a.version > 1 ? `Plan updated (version ${a.version})` : a.name) : a.kind === 'meals' ? 'Your meal plan' : `New program: ${a.name}`)}</b></span>
      <span class="ca-card-go">See what’s new →</span></button>`;
  }

  // ── browser side ─────────────────────────────────────────────────

  const api = { latest, sheetHtml, cardHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.CoachAnnounce = api;
  const doc = globalScope.document;
  if (!doc) return;

  let current = null;   // the latest announcement
  let ctx = {};         // { plan, startPlanProgram, planFollowing }

  const user = () => globalScope.currentUser || globalScope.localStorage.getItem('fitnessAppUser') || '';
  const seenKey = () => `coachAnnounceSeen_${user()}`;
  function seenList() {
    try { return JSON.parse(globalScope.localStorage.getItem(seenKey()) || '[]') || []; } catch (_e) { return []; }
  }
  function markSeen(key) {
    const list = seenList().filter(k => k !== key);
    list.push(key);
    try { globalScope.localStorage.setItem(seenKey(), JSON.stringify(list.slice(-30))); } catch (_e) { /* storage full */ }
  }
  const isSeen = a => !!a && seenList().includes(a.key);

  function renderCard() {
    let slot = doc.getElementById('coachAnnounceCard');
    const home = doc.getElementById('todayProgramCard');
    if (!slot && home && home.parentNode) {
      slot = doc.createElement('div');
      slot.id = 'coachAnnounceCard';
      home.parentNode.insertBefore(slot, home);
    }
    if (!slot) return;
    slot.innerHTML = current && !isSeen(current) ? cardHtml(current) : '';
  }

  function close() {
    const root = doc.getElementById('coachAnnounceSheet');
    if (root) root.remove();
    if (current) markSeen(current.key);
    renderCard();
  }

  function open(data) {
    // From a notification: the in-app data names the announcement; if the
    // app hasn't caught up yet, the latest one is still the right one.
    const a = current || (data && data.kind ? { kind: data.kind, key: data.key || '', name: data.name || '', version: data.version || 1, message: data.message || '', coach: data.coach || '' } : null);
    if (!a) return false;
    doc.getElementById('coachAnnounceSheet')?.remove();
    const root = doc.createElement('div');
    root.id = 'coachAnnounceSheet';
    root.className = 'mx-sheet-backdrop ca-backdrop';
    root.innerHTML = sheetHtml(a, {
      plan: a.kind === 'plan' ? ctx.plan : null,
      hasProgram: typeof ctx.startPlanProgram === 'function' && a.kind === 'plan' && !!ctx.composed,
      following: !!ctx.following,
    });
    root.addEventListener('click', e => { if (e.target === root) close(); });
    doc.body.appendChild(root);
    if (a.key) markSeen(a.key);
    renderCard();
    root.querySelector('.ca-cta, .mx-cta')?.focus();
    return true;
  }

  // One listener for the sheet and the Home card.
  doc.addEventListener('click', e => {
    const btn = e.target && e.target.closest && e.target.closest('[data-ca-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-ca-act');
    if (act === 'open') { open(); return; }
    if (act === 'close') { close(); return; }
    if (act === 'start') {
      if (ctx.startPlanProgram && ctx.startPlanProgram()) {
        close();
        if (typeof globalScope.showTab === 'function') globalScope.showTab('homeTab');
        if (typeof globalScope.showToast === 'function') globalScope.showToast('Started. Home now shows today’s session from your plan.', 'success');
      }
      return;
    }
    if (act === 'plan') {
      close();
      if (typeof globalScope.showTab === 'function') globalScope.showTab('programTab');
      if (typeof globalScope.showProgramView === 'function') globalScope.showProgramView(current && current.kind === 'program' ? 'list' : 'plan');
      return;
    }
    if (act === 'food') {
      close();
      if (typeof globalScope.showTab === 'function') globalScope.showTab('macroTab');
      return;
    }
    if (act === 'tour') {
      close();
      if (typeof globalScope.startGuideTour === 'function') globalScope.startGuideTour('coach');
    }
  });

  // Something else is on screen (a sheet, a tour, onboarding): don't pop up over it.
  function busy() {
    if (doc.hidden) return true;
    return !!doc.querySelector('#coachAnnounceSheet, .tour-root, .gd-sheet-backdrop, #cvPlayer, .ai-sheet[style*="flex"], #onboardingOverlay:not([hidden])');
  }

  /**
   * After each Your Coach refresh. state: { plan, assignments, activeUids },
   * ctx: { startPlanProgram(): bool, composed, following } from client-coaching.js.
   */
  function sync(state, context) {
    ctx = { plan: state.plan, ...(context || {}) };
    current = latest(state);
    renderCard();
    const coachMode = typeof globalScope.isCoachModeEnabled === 'function' && globalScope.isCoachModeEnabled();
    if (current && !isSeen(current) && !busy() && !coachMode) open();
  }

  Object.assign(api, { sync, open, close, renderCard });
})(typeof window !== 'undefined' ? window : globalThis);
