/* =============================================================
   GUIDE TOURS — short themed tours on the app-tour engine
   (src/js/app-tour.js → startAppTour(steps, { onEnd })).

   Each tour is 5–7 steps around one job ("plan your training"),
   so users can learn a corner of the app when they need it rather
   than all of it on day one. Started from All → "Show me how", the
   goal-path sheet, or startGuideTour(id). Steps whose target isn't on
   screen for this user are skipped by the engine.
   ============================================================= */
(function (global) {
  'use strict';

  const nav = tab => `#bottomNav .bn-item[data-tab="${tab}"]`;
  const tile = tab => `#allTab .all-hub-tile[data-tab="${tab}"]`;
  const show = tab => () => { if (typeof global.showTab === 'function') global.showTab(tab); };

  const TOURS = {
    plan: {
      title: 'Plan your training',
      blurb: 'Programs, and how they fill your Home screen.',
      steps: [
        { title: 'Plan your training', text: 'A program decides what you train each day, and Home then shows exactly what’s due. Tap the glowing spots as we go.', next: 'Start' },
        { target: nav('allTab'), tap: true, title: 'Tap All', text: 'Programs live in the All tab.' },
        { target: tile('programTab'), tap: true, title: 'Open Programs', text: 'Your splits and training blocks.' },
        { target: ['#progListView', '#programTabContent'], title: 'Your programs', text: 'Pick a ready-made program or build your own split. Set one as <b>active</b> to follow it.' },
        { target: '#progAiGenBtnWrap', title: 'Or let AI build it', text: 'Describe your goal and schedule, and get a program made for you.' },
        { target: nav('homeTab'), tap: true, title: 'Back to Home', text: 'Now see where the plan shows up.' },
        { target: ['#todayProgramCard', '#dueNowRail', '#homeDashboardContent'], title: 'Today’s session', text: 'With an active program, today’s workout appears here. Tap it to start logging.' },
        { title: 'That’s planning', text: 'Program → Home → Train. Log the session and your progress updates by itself.', next: 'Done', finale: true },
      ],
    },
    body: {
      title: 'Track your body',
      blurb: 'Weight, macros and the weekly check-in.',
      steps: [
        { title: 'Track your body', text: 'Weigh-ins, macros and check-ins work together: your weight trend steers your macros, and check-ins record the week.', next: 'Start' },
        { target: nav('bodyTab'), tap: true, title: 'Tap Body', text: 'Everything about your body starts here.' },
        { target: ['#bodyTab .pill-nav', '#bodyHubSummary'], title: 'Weight, Macros, Sleep, Cardio', text: 'Each has its own page. The cards below give you the week at a glance. Tap any card to open it.' },
        { target: '#bodyHubCoach', title: 'Your coach’s take', text: 'A quick read on how your body data is trending.' },
        { target: nav('allTab'), tap: true, title: 'Tap All', text: 'The weekly check-in is in All.' },
        { target: tile('checkInTab'), tap: true, title: 'Open Check-In', text: 'Your weekly update.' },
        { target: ['#ciNav', '#checkInTab'], title: 'Weekly check-in', text: 'Once a week, record bodyweight, waist, energy, sleep and stress, plus optional photos. Your history and coach review are here too.' },
        { title: 'That’s body tracking', text: 'Weigh in often, set your macros once, and check in weekly. The trends handle the rest.', next: 'Done', finale: true },
      ],
    },
    progress: {
      title: 'See your progress',
      blurb: 'Insights, PRs and your weekly recap.',
      steps: [
        { title: 'See your progress', text: 'Every set you log feeds your charts, PRs and weekly recap. Here’s where to find them.', next: 'Start' },
        { target: nav('allTab'), tap: true, title: 'Tap All', text: 'Insights live in the All tab.' },
        { target: tile('progressTab'), tap: true, title: 'Open Insights', text: 'Your trends and records.' },
        { target: ['#progressTogglePanel', '#progressSubNav'], title: 'Pick what to chart', text: 'Workouts, cardio, bodyweight, recovery, or a single exercise.' },
        { target: ['#progressChartsPanel'], title: 'Your charts', text: 'Estimated 1RM, volume and more over any date range.' },
        { target: '#aiPlateauCard', title: 'Plateau spotting', text: 'If a lift stalls, you’ll get a heads-up here with ideas to break through.' },
        // The recap card stays empty until there's a finished week to recap.
        { target: ['#weeklyRecapCard .wr-card', '.home-zone--weekly'], before: show('homeTab'), title: 'Your week on Home', text: 'Home tracks this week as you go, and every Monday adds a recap of last week: sessions, PRs and body data.' },
        { title: 'That’s progress', text: 'Log consistently and these fill in by themselves. Check back weekly.', next: 'Done', finale: true },
      ],
    },
    social: {
      title: 'Train with others',
      blurb: 'Groups, friends and the leaderboard.',
      steps: [
        { title: 'Train with others', text: 'Groups, friends and rankings help you stay consistent.', next: 'Start' },
        { target: nav('allTab'), tap: true, title: 'Tap All', text: 'Social features are in the All tab.' },
        { target: tile('communityTab'), tap: true, title: 'Open Community', text: 'Your groups and friends.' },
        { target: ['#commNav', '#communityTab'], title: 'Groups, feed and friends', text: '<b>Groups</b> to train together, <b>Feed</b> for updates, <b>Friends</b> to follow people, and <b>Share</b> to post a session.' },
        { target: nav('allTab'), tap: true, title: 'Tap All', text: 'One more stop.' },
        { target: tile('leaderboardTab'), tap: true, title: 'Open Leaderboard', text: 'See how you rank.' },
        { target: ['#lbPodium', '#lbPage'], title: 'Rankings', text: 'Sort by different stats and find yourself in <b>Around you</b>.' },
        { title: 'That’s the social side', text: 'Join one group this week. It makes showing up easier.', next: 'Done', finale: true },
      ],
    },
  };

  function startGuideTour(id) {
    const t = TOURS[id];
    if (!t || typeof global.startAppTour !== 'function') return false;
    // Close any open guide sheet first so the tour isn't hidden behind it.
    document.querySelectorAll('.gd-sheet-backdrop').forEach(n => n.remove());
    global.startAppTour(t.steps, {
      onEnd(completed) {
        document.dispatchEvent(new CustomEvent('guide:tour-ended', { detail: { id, completed } }));
      },
    });
    return true;
  }

  global.GuideTours = TOURS;
  global.startGuideTour = startGuideTour;
})(typeof window !== 'undefined' ? window : globalThis);
