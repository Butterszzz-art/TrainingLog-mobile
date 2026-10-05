/* =============================================================
   GUIDE CORE — pure data + rules behind the guidance features
   (src/js/guide-ui.js renders them, tests/guideCore.test.js covers
   them). Nothing here touches the DOM or storage.

   - GOALS: goal-based paths, a short checklist that crosses tabs.
     Steps tick themselves off from the user's own data (ctx).
   - FEATURES: one entry per destination, used by All-tab search,
     the "new" dots, and the Home "Discover" card. `ready(ctx)` is the
     usage milestone at which a feature is worth suggesting — nothing
     is ever locked, it just isn't pushed on day one.
   ============================================================= */
(function (global) {
  'use strict';

  // ── Context shape (built by guide-ui.js from local data) ──────
  //   workoutDays, hasProgram, hasMacroTargets, weighIns, checkIns,
  //   sleepNights, cardioSessions, daysActive, visited: { [tabId]: true }

  const v = (c, tab) => !!(c.visited && c.visited[tab]);

  const STEP = {
    logWorkout:  { id: 'log-workout',  label: 'Log your first workout',  why: 'Everything else builds on your logged sets.', tab: 'logTab',      tour: null,       done: c => c.workoutDays >= 1 },
    threeSessions: { id: 'three-sessions', label: 'Train 3 different days', why: 'Three sessions is enough for trends to start showing.', tab: 'logTab', tour: null, done: c => c.workoutDays >= 3 },
    program:     { id: 'program',      label: 'Pick or build a program', why: 'Your program puts what’s due today on Home.', tab: 'programTab', tour: 'plan',  done: c => c.hasProgram },
    macros:      { id: 'macros',       label: 'Set your macro targets',  why: 'Targets turn food logging into a daily score.', tab: 'macroTab',   tour: 'body',     done: c => c.hasMacroTargets },
    weighIn:     { id: 'weigh-in',     label: 'Log a weigh-in',          why: 'Your weight trend steers macro suggestions.', tab: 'weightTab',  tour: 'body',     done: c => c.weighIns >= 1 },
    weighIns3:   { id: 'weigh-ins-3',  label: 'Weigh in 3 times',        why: 'A few weigh-ins give a trend instead of noise.', tab: 'weightTab', tour: 'body',     done: c => c.weighIns >= 3 },
    checkIn:     { id: 'check-in',     label: 'Do a weekly check-in',    why: 'Check-ins track energy, sleep and stress week to week.', tab: 'checkInTab', tour: 'body', done: c => c.checkIns >= 1 },
    sleep:       { id: 'sleep',        label: 'Log a night of sleep',    why: 'Recovery explains good and bad sessions.', tab: 'sleepTab',   tour: null,       done: c => c.sleepNights >= 1 },
    cardio:      { id: 'cardio',       label: 'Log a cardio session',    why: 'Cardio counts towards your weekly activity.', tab: 'cardioTab',  tour: null,       done: c => c.cardioSessions >= 1 },
    insights:    { id: 'insights',     label: 'Open your Insights',      why: 'See e1RM, volume and PR trends from your sessions.', tab: 'progressTab', tour: 'progress', done: c => v(c, 'progressTab') },
    posing:      { id: 'posing',       label: 'Try posing practice',     why: 'Practise mandatories and compare photos over prep.', tab: 'posingTab', tour: null,  done: c => v(c, 'posingTab') },
    community:   { id: 'community',    label: 'Visit the community',     why: 'Groups and friends keep you showing up.', tab: 'communityTab', tour: 'social', done: c => v(c, 'communityTab') },
  };

  const GOALS = [
    { id: 'muscle',  label: 'Build muscle',    blurb: 'Train, eat enough and watch the trends.',
      steps: [STEP.logWorkout, STEP.program, STEP.macros, STEP.weighIn, STEP.insights] },
    { id: 'strength', label: 'Get stronger',   blurb: 'Follow a plan and track your e1RM.',
      steps: [STEP.logWorkout, STEP.program, STEP.insights, STEP.sleep, STEP.checkIn] },
    { id: 'prep',    label: 'Contest prep',    blurb: 'Macros, weigh-ins, check-ins and posing.',
      steps: [STEP.macros, STEP.weighIns3, STEP.checkIn, STEP.posing, STEP.insights] },
    { id: 'fatloss', label: 'Lose fat',        blurb: 'Hit your macros and let the trend guide you.',
      steps: [STEP.macros, STEP.weighIns3, STEP.cardio, STEP.sleep, STEP.checkIn] },
    { id: 'habit',   label: 'Stay consistent', blurb: 'Build the habit and train with others.',
      steps: [STEP.logWorkout, STEP.threeSessions, STEP.cardio, STEP.community, STEP.checkIn] },
  ];

  function goalById(id) { return GOALS.find(g => g.id === id) || null; }

  // Onboarding already asks for a training focus and a goal
  // (settings.profile.athleteArchetype / primaryGoal); suggest the
  // matching path so users aren't asked the same thing twice.
  function suggestGoal(profile) {
    const p = profile || {};
    if (p.athleteArchetype === 'powerlifter') return 'strength';
    return { cut: 'fatloss', bulk: 'muscle', recomp: 'muscle', maintain: 'habit' }[p.primaryGoal] || null;
  }

  function goalProgress(goalId, ctx) {
    const goal = goalById(goalId);
    if (!goal) return null;
    const steps = goal.steps.map(s => Object.assign({}, s, { isDone: !!s.done(ctx || {}) }));
    const doneCount = steps.filter(s => s.isDone).length;
    return { goal, steps, doneCount, total: steps.length, next: steps.find(s => !s.isDone) || null, complete: doneCount === steps.length };
  }

  // ── Features: search, "new" dots, Discover ────────────────────
  // ready: usage milestone before it's suggested. unlock: the line the
  // Discover card shows when that milestone is reached.
  const FEATURES = [
    { tab: 'logTab',        name: 'Train',       blurb: 'Log sets, rest timer and templates.', keywords: 'log workout set reps sets lift gym session train template rest timer', ready: () => true },
    { tab: 'homeTab',       name: 'Home',        blurb: 'What’s due today, your week and coach brief.', keywords: 'today dashboard due streak week brief', ready: () => true },
    { tab: 'weightTab',     name: 'Weight',      blurb: 'Weigh-ins and your trend line.', keywords: 'weight weigh in bodyweight scale kg lbs trend', ready: () => true },
    { tab: 'macroTab',      name: 'Macros',      blurb: 'Targets, meals and daily totals.', keywords: 'macros food nutrition calories protein carbs fat meals diet eat', ready: () => true },
    { tab: 'programTab',    name: 'Programs',    blurb: 'Follow a plan so Home shows what’s due.', keywords: 'program plan split block schedule routine periodization week', ready: c => c.workoutDays >= 3,
      unlock: c => `${c.workoutDays} sessions logged. A program can plan the next ones for you.` },
    { tab: 'progressTab',   name: 'Insights',    blurb: 'e1RM, volume, PRs and plateaus.', keywords: 'insights progress charts trends e1rm 1rm pr records volume plateau stats graph', ready: c => c.workoutDays >= 3,
      unlock: c => `${c.workoutDays} sessions in. Your strength and volume trends are ready.` },
    { tab: 'logHistoryTab', name: 'History',     blurb: 'Every session you’ve logged.', keywords: 'history past sessions previous workouts log book', ready: c => c.workoutDays >= 5,
      unlock: () => 'Your logbook is filling up. Browse every past session in History.' },
    { tab: 'checkInTab',    name: 'Check-in',    blurb: 'Weekly energy, sleep, stress and photos.', keywords: 'check in checkin weekly review photos progress pictures energy stress coach', ready: c => c.weighIns >= 3 || c.daysActive >= 7,
      unlock: () => 'You’ve been at it a week. A weekly check-in ties it all together.' },
    { tab: 'sleepTab',      name: 'Sleep',       blurb: 'Hours and quality, next to your training.', keywords: 'sleep recovery rest hours bed tired', ready: c => c.workoutDays >= 4,
      unlock: () => 'Training regularly now. Logging sleep shows how recovery affects your sessions.' },
    { tab: 'cardioTab',     name: 'Cardio',      blurb: 'Sessions and steps.', keywords: 'cardio run running walk steps bike cycling conditioning hiit', ready: () => true },
    { tab: 'mobilityTab',   name: 'Flexibility', blurb: 'Mobility routines.', keywords: 'mobility flexibility stretch stretching warm up yoga', ready: c => c.workoutDays >= 8,
      unlock: () => 'Eight sessions in. A short mobility routine keeps you moving well.' },
    { tab: 'librariesTab',  name: 'Libraries',   blurb: 'Exercises, guides and ebooks.', keywords: 'library exercises guide guides ebooks learn how technique form', ready: () => true },
    { tab: 'posingTab',     name: 'Posing',      blurb: 'Mandatories and photo comparisons.', keywords: 'posing poses mandatories bodybuilding stage photos physique', ready: c => c.checkIns >= 1 || v(c, 'checkInTab') },
    { tab: 'powerliftingTab', name: 'Lifting tools', blurb: 'Powerlifting attempts and peaking.', keywords: 'powerlifting meet attempts peak week squat bench deadlift total', ready: c => c.workoutDays >= 3 },
    { tab: 'communityTab',  name: 'Community',   blurb: 'Groups, feed and friends.', keywords: 'community friends groups feed social share people', ready: c => c.workoutDays >= 5,
      unlock: () => 'You’re consistent. Join a group to keep each other going.' },
    { tab: 'leaderboardTab', name: 'Leaderboard', blurb: 'Rankings against other lifters.', keywords: 'leaderboard ranking rank compete competition top', ready: c => c.workoutDays >= 8,
      unlock: () => 'Eight sessions logged. See where you rank on the leaderboard.' },
    { tab: 'settingsTab',   name: 'Settings',    blurb: 'Units, theme, reminders and account.', keywords: 'settings units theme colour color dark reminders notifications account password privacy export', ready: () => true },
  ];

  function featureByTab(tab) { return FEATURES.find(f => f.tab === tab) || null; }

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }

  // Task-aware search: name > keyword prefix > blurb. Multi-word
  // queries need every word to hit something.
  function searchFeatures(query, features) {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const list = features || FEATURES;
    const scored = [];
    list.forEach(f => {
      const name = norm(f.name);
      const kws = norm(f.keywords).split(/\s+/);
      const blurb = norm(f.blurb);
      let score = 0;
      for (const w of words) {
        let s = 0;
        if (name === w) s = 10;
        else if (name.startsWith(w)) s = 8;
        else if (name.includes(w)) s = 6;
        else if (kws.some(k => k === w)) s = 5;
        else if (w.length >= 2 && kws.some(k => k.startsWith(w))) s = 4;
        else if (w.length >= 3 && blurb.includes(w)) s = 2;
        if (!s) return;
        score += s;
      }
      scored.push({ f, score });
    });
    return scored.sort((a, b) => b.score - a.score).map(x => x.f);
  }

  // "New" dot: ready for this user and never opened.
  function isNew(tab, ctx) {
    const f = featureByTab(tab);
    if (!f || v(ctx, tab)) return false;
    return !!f.ready(ctx);
  }

  function isoWeek(today) {
    const d = new Date(`${today}T12:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const wk = 1 + Math.round(((d - firstThu) / 864e5 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
    return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
  }

  // Discover card. Milestone unlocks come first (each once); otherwise
  // one "did you know" per week for something ready but never opened.
  // state: { seen: { [tab]: true }, weekly: { week, tab }, hiddenUntil }
  function pickDiscover(ctx, state, today) {
    const s = state || {};
    const seen = s.seen || {};
    if (s.hiddenUntil && today < s.hiddenUntil) return null;
    const candidates = FEATURES.filter(f => !v(ctx, f.tab) && !seen[f.tab] && f.ready(ctx));
    const unlock = candidates.find(f => typeof f.unlock === 'function');
    if (unlock) return { kind: 'unlock', tab: unlock.tab, name: unlock.name, text: unlock.unlock(ctx) };

    const week = isoWeek(today);
    if (s.weekly && s.weekly.week === week) {
      if (s.weekly.done) return null;
      const f = featureByTab(s.weekly.tab);
      return f && !v(ctx, f.tab) ? { kind: 'tip', tab: f.tab, name: f.name, text: f.blurb } : null;
    }
    const pool = candidates.filter(f => f.tab !== 'homeTab' && f.tab !== 'logTab' && f.tab !== 'settingsTab');
    if (!pool.length) return null;
    // Deterministic pick per week so it doesn't change on every render.
    const n = Number(week.slice(-2)) + Number(week.slice(0, 4));
    const f = pool[n % pool.length];
    return { kind: 'tip', tab: f.tab, name: f.name, text: f.blurb, week };
  }

  // ── How it connects ───────────────────────────────────────────
  const CONNECTIONS = [
    { from: 'Workouts', fromTab: 'logTab', to: 'Insights', toTab: 'progressTab', text: 'Every set feeds your e1RM, volume and PR trends.' },
    { from: 'Program', fromTab: 'programTab', to: 'Home', toTab: 'homeTab', text: 'Your active program decides what’s due today.' },
    { from: 'Weigh-ins', fromTab: 'weightTab', to: 'Macros', toTab: 'macroTab', text: 'Your weight trend suggests calorie adjustments.' },
    { from: 'Sleep & check-ins', fromTab: 'checkInTab', to: 'Readiness', toTab: 'homeTab', text: 'Recovery scores shape how hard today should be.' },
    { from: 'Everything', fromTab: null, to: 'AI coach', toTab: null, coach: true, text: 'The coach reads all of it, so ask it anything about your training.' },
    { from: 'The week', fromTab: null, to: 'Weekly recap', toTab: 'homeTab', text: 'Each Monday, Home recaps last week’s sessions, PRs and body data.' },
  ];

  const api = { GOALS, FEATURES, CONNECTIONS, goalById, suggestGoal, goalProgress, featureByTab, searchFeatures, isNew, pickDiscover, isoWeek };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.GuideCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
