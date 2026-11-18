/* =============================================================
   COACH GUIDE — pure rules for the "Get set up" checklist a coach
   sees after taking the Coach plan. Shared by the phone app
   (src/js/coach-guide.js) and the computer dashboard
   (coach/coach-guide-desktop.js); progress is stored server-side
   on GET/POST /api/coach/guide so both show the same count.

   A step is done when the server has a mark for it, or when the
   coach's client list shows it happened (so coaches who already
   did the work never see it as "to do").
   ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CoachGuideCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // where: 'phone' | 'desktop' | 'both' — the device it's easiest on.
  const STEPS = [
    { id: 'code', title: 'Copy your coach code', sub: 'Clients enter it to join you and get Pro.', where: 'both' },
    { id: 'client', title: 'Invite your first client', sub: 'Share your code or add them by username.', where: 'both' },
    { id: 'program', title: 'Assign a program', sub: 'Build it once, assign it from their page.', where: 'desktop' },
    { id: 'macros', title: 'Set their macros', sub: 'Targets show up in their Macros tab.', where: 'desktop' },
    { id: 'checkin', title: 'Reply to a check-in', sub: 'Comment or mark it reviewed.', where: 'both' },
    { id: 'desktop', title: 'Open the dashboard on a computer', sub: 'pocketcoachcoms.org/coach', where: 'desktop' },
  ];
  const STEP_IDS = STEPS.map(s => s.id);

  const DASHBOARD_URL = 'https://pocketcoachcoms.org/coach';

  function hasMacros(m) {
    if (!m || typeof m !== 'object') return false;
    return ['calories', 'protein', 'carbs', 'fat', 'kcal'].some(k => Number(m[k]) > 0)
      || !!(m.training || m.rest || m.plan); // day-type macro plans
  }

  // Steps the client list proves, whatever the stored marks say.
  function stepsFromClients(clients) {
    const list = Array.isArray(clients) ? clients : [];
    const done = new Set();
    if (list.length) { done.add('client'); done.add('code'); }
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      if (c.currentProgramId || c.currentProgram || c.activeProgramName) done.add('program');
      if (hasMacros(c.macroTargets)) done.add('macros');
      if (c.reviewedCheckInDate || (Array.isArray(c.coachCommentDates) && c.coachCommentDates.length)) done.add('checkin');
    }
    return done;
  }

  function emptyGuide() {
    return { welcomeSeen: null, dismissed: null, steps: {}, tours: {} };
  }

  // Merge server guide + client evidence into what the UI shows.
  // Returns { steps: [{...step, done}], doneCount, total, complete, newlyProven }
  // newlyProven = ids the client list proves but the server hasn't stored yet,
  // so the caller can send them up once.
  function progress(guide, clients) {
    const g = guide || emptyGuide();
    const marks = g.steps || {};
    const proven = stepsFromClients(clients);
    const steps = STEPS.map(s => ({ ...s, done: !!marks[s.id] || proven.has(s.id) }));
    const doneCount = steps.filter(s => s.done).length;
    const newlyProven = STEP_IDS.filter(id => proven.has(id) && !marks[id]);
    return { steps, doneCount, total: STEPS.length, complete: doneCount === STEPS.length, newlyProven };
  }

  // The first step still to do, preferring ones that fit this device.
  function nextStep(prog, device) {
    const open = prog.steps.filter(s => !s.done);
    return open.find(s => s.where === device || s.where === 'both') || open[0] || null;
  }

  // Show the checklist card? Hidden once complete or dismissed.
  function showChecklist(guide, prog) {
    return !prog.complete && !(guide && guide.dismissed);
  }

  // Open the welcome sheet automatically? Only once, and only for a coach.
  function shouldWelcome(guide, isCoachPlan) {
    return !!isCoachPlan && !(guide && guide.welcomeSeen);
  }

  // Start the tour for this device automatically? After the welcome on the
  // phone (the sheet offers it), straight away on the computer's first visit.
  function shouldAutoTour(guide, device) {
    const tours = (guide && guide.tours) || {};
    if (device === 'desktop') return !tours.desktop;
    return false;
  }

  return { STEPS, STEP_IDS, DASHBOARD_URL, stepsFromClients, progress, nextStep, showChecklist, shouldWelcome, shouldAutoTour, emptyGuide, hasMacros };
});
