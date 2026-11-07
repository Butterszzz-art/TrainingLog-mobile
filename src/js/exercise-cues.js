/**
 * exercise-cues.js
 * "Cues" — a small button under the exercise name in performance mode that
 * opens a speech bubble of Butters University biomechanical cues for the
 * armed exercise (setup, execution, what you should feel).
 *
 * Cues are written per movement pattern, not per exact exercise name, so
 * "Incline DB Press", "Incline Smith Press" and "Low-incline bench" all get
 * the incline press cues. find() walks CUES in order and returns the first
 * entry whose pattern matches — specific patterns sit above general ones.
 *
 *   ExerciseCues.find(name) → { title, setup, execute, feel } | null
 *   renderExerciseCues(name) — show/hide the button for this exercise
 */
(function (global) {
  'use strict';

  // Order matters: most specific first.
  const CUES = [
    // ── Chest ─────────────────────────────────────────────────────
    {
      match: /^(?!.*\b(row|curl|fly|flye)\b).*(incline.*(press|bench)|(press|bench).*incline)/,
      title: 'Incline press',
      setup: ['Bench at 15–30° — steeper turns it into a shoulder press', 'Shoulder blades pinned back and down, slight arch'],
      execute: ['Lower to the upper chest, just under the collarbone', 'Elbows ~45–60° from the torso, forearms stacked under the bar', 'Press up and slightly back over the shoulders'],
      feel: 'Upper chest stretching at the bottom — not the front delts taking over',
    },
    {
      match: /^(?!.*\b(row|curl)\b).*(decline.*(press|bench)|\bdips?\b)/,
      title: 'Decline press / dip',
      setup: ['Lock shoulder blades down before the first rep', 'For dips: slight forward lean, legs behind you'],
      execute: ['Lower until the upper arm is about parallel to the floor', 'Keep the chest proud — no shoulders rolling forward', 'Drive through the palms, squeeze the lower chest at the top'],
      feel: 'Lower chest and triceps — stop shy of any pinch in the front of the shoulder',
    },
    {
      match: /^(?!.*\b(row|curl|fly|flye)\b).*((bench|chest) press|\bbench\b|press.*chest|floor press)/,
      title: 'Flat press',
      setup: ['Eyes under the bar, feet planted and pushing the floor', 'Squeeze shoulder blades together and down — keep them there', 'Grip just wider than shoulders, wrists stacked over elbows'],
      execute: ['Lower under control to mid-chest / nipple line', 'Tuck elbows to ~45°, not flared at 90°', 'Press up and back toward the face — the bar path is a slight J'],
      feel: 'A deep pec stretch at the bottom, chest doing the pushing',
    },
    {
      match: /^(?!.*\b(reverse|rear)\b).*(fly|flye|pec deck|crossover|cable.*chest)/,
      title: 'Fly',
      setup: ['Soft, fixed bend in the elbows — they don\'t open or close', 'Chest up, shoulder blades back'],
      execute: ['Open wide until you feel a full stretch across the chest', 'Bring the hands together by hugging a big tree — lead with the elbows', 'Pause and squeeze for a beat where the hands meet'],
      feel: 'All chest, no biceps or front delt — if arms burn, the elbows are bending',
    },
    {
      match: /push[ -]?ups?/,
      title: 'Push-up',
      setup: ['Hands just outside shoulders, body one straight line', 'Squeeze glutes and brace abs — hips don\'t sag'],
      execute: ['Elbows ~45° from the body on the way down', 'Chest to an inch off the floor', 'Push the floor away and spread the shoulder blades at the top'],
      feel: 'Chest and triceps working, core holding the plank',
    },

    // ── Shoulders ────────────────────────────────────────────────
    {
      match: /lateral raise|side raise|lat raise|\by[ -]raise/,
      title: 'Lateral raise',
      setup: ['Slight forward lean, weights a touch in front of the thighs', 'Shoulders down, away from the ears'],
      execute: ['Lead with the elbows, not the hands — pinkies don\'t need to tip up', 'Raise out to the sides to about shoulder height', 'Lower slowly — the way down is half the rep'],
      feel: 'The side of the shoulder — if traps take over, go lighter and drop the shoulders',
    },
    {
      match: /rear delt|reverse fly|reverse pec|face pull/,
      title: 'Rear delt',
      setup: ['Arms slightly bent and locked at that angle', 'Chest supported or hinged, neck neutral'],
      execute: ['Sweep the arms out and back in a wide arc', 'Think "hands away from each other", not "squeeze the shoulder blades"', 'Stop when the arms line up with the torso'],
      feel: 'The back of the shoulder — not the mid-back or traps',
    },
    {
      match: /front raise/,
      title: 'Front raise',
      setup: ['Stand tall, glutes tight so you don\'t sway'],
      execute: ['Raise to eye level with a soft elbow', 'No swinging — control both directions'],
      feel: 'Front of the shoulder',
    },
    {
      match: /(shoulder|overhead|military|ohp|arnold|seated db) press|\bohp\b|push press/,
      title: 'Overhead press',
      setup: ['Grip just outside shoulders, forearms vertical', 'Squeeze glutes and brace — ribs down, no big lean back'],
      execute: ['Press straight up and move the head back out of the way', 'Push the head "through the window" once the bar passes the face', 'Lock out with the bar over mid-foot'],
      feel: 'Shoulders and triceps — lower back should feel nothing',
    },
    {
      match: /upright row|shrug/,
      title: 'Shrug / upright row',
      setup: ['Stand tall, arms long'],
      execute: ['Shrugs: straight up toward the ears, not rolled', 'Upright rows: lead with the elbows, stop at chest height', 'Pause at the top, lower slow'],
      feel: 'Upper traps (and side delts for rows)',
    },

    // ── Back ─────────────────────────────────────────────────────
    {
      match: /pull[ -]?ups?|chin[ -]?ups?|pulldown|pull down|lat pull/,
      title: 'Vertical pull',
      setup: ['Start from a full hang — let the lats stretch', 'Slight lean back, chest up'],
      execute: ['Start by pulling the shoulders down, then bend the elbows', 'Drive the elbows down to the back pockets', 'Bring the chest to the bar / bar to the upper chest, then control up'],
      feel: 'Lats along the side of the back — not biceps or forearms doing it all',
    },
    {
      match: /pullover|straight[ -]arm/,
      title: 'Straight-arm pulldown / pullover',
      setup: ['Soft elbows, fixed for the whole set', 'Hinge slightly, ribs down'],
      execute: ['Sweep the hands in an arc down to the thighs', 'Think "elbows to hips"', 'Let the arms rise back until the lats are stretched'],
      feel: 'Pure lat — no triceps pushing',
    },
    {
      match: /row/,
      title: 'Row',
      setup: ['Hinge or brace on the pad so the torso doesn\'t move', 'Neutral spine, let the shoulder blades reach forward at the start'],
      execute: ['Pull with the elbows, hands just hooks', 'Elbows tight to the body → lats; flared out → upper back', 'Squeeze for a beat at the top, then control the stretch'],
      feel: 'Mid-back and lats — no lower-back swing to move the weight',
    },
    {
      match: /back extension|hyperextension|45 ?°?\s*ext/,
      title: 'Back extension',
      setup: ['Pad just below the hip crease', 'Arms crossed or weight hugged to the chest'],
      execute: ['Hinge at the hips with a long spine', 'Rise until the body is in a straight line — no hyperextending', 'Round the upper back slightly to bias glutes'],
      feel: 'Glutes and hamstrings, with the low back holding position',
    },

    // ── Legs ─────────────────────────────────────────────────────
    {
      match: /romanian|\brdl\b|stiff[ -]?leg|sldl|good morning/,
      title: 'Romanian deadlift',
      setup: ['Feet hip-width, soft bend in the knees that stays put', 'Lats tight — "squeeze oranges in the armpits"'],
      execute: ['Push the hips straight back like closing a car door', 'Keep the bar dragging along the thighs', 'Lower until the hamstrings stop you — not until the plates touch'],
      feel: 'A big hamstring stretch — back stays flat and quiet',
    },
    {
      match: /deadlift|\bdl\b|rack pull/,
      title: 'Deadlift',
      setup: ['Bar over mid-foot, shins close', 'Grip, then pull the slack out — hear the bar click', 'Big breath, brace, chest up, lats tight'],
      execute: ['Push the floor away rather than pulling the bar', 'Hips and shoulders rise together', 'Finish tall by squeezing glutes — don\'t lean back'],
      feel: 'Whole posterior chain — any rounding means it\'s too heavy',
    },
    {
      match: /hip thrust|glute bridge/,
      title: 'Hip thrust',
      setup: ['Bench under the shoulder blades, feet so shins are vertical at the top', 'Chin tucked, eyes forward'],
      execute: ['Tuck the pelvis slightly and drive through the heels', 'Ribs down and lock out with the glutes, not the lower back', 'Hold the squeeze for a beat at the top'],
      feel: 'Glutes on fire — hamstrings or low back means fix foot or rib position',
    },
    {
      match: /bulgarian|split squat|lunge|step[ -]?up/,
      title: 'Split squat / lunge',
      setup: ['Long stance → glutes, short stance → quads', 'Most weight in the front foot'],
      execute: ['Drop the back knee straight down', 'Front knee travels forward over the toes — that\'s fine', 'Drive up through the whole front foot'],
      feel: 'Front-leg quad and glute — back leg is only for balance',
    },
    {
      match: /hack squat|leg press|pendulum|belt squat/,
      title: 'Hack squat / leg press',
      setup: ['Feet mid-platform, shoulder-width — lower on the plate = more quads', 'Back and hips glued to the pad'],
      execute: ['Lower as deep as you can without the hips peeling off', 'Knees track over the toes', 'Push through the whole foot, don\'t lock out hard'],
      feel: 'Quads loaded deep in the stretch',
    },
    {
      match: /squat/,
      title: 'Squat',
      setup: ['Bar on the upper traps, grip tight, elbows down', 'Feet shoulder-width, toes out 15–30°', 'Breathe into the belly and brace like you\'re about to get punched'],
      execute: ['Sit down between the heels — hips and knees break together', 'Knees track over the toes, push them out', 'Hit depth, then drive the back up into the bar'],
      feel: 'Quads and glutes, braced core — whole foot stays on the floor',
    },
    {
      match: /leg extension|quad extension/,
      title: 'Leg extension',
      setup: ['Knee lined up with the machine pivot', 'Lean back slightly and grab the handles — stretches the rectus femoris'],
      execute: ['Kick up to full lockout and squeeze for a beat', 'Lower slow — 2–3 seconds', 'Keep the hips down in the seat'],
      feel: 'Quads only — especially at the top',
    },
    {
      match: /(leg|hamstring|lying|seated|nordic).*curl|\bham curl/,
      title: 'Leg curl',
      setup: ['Knee lined up with the machine pivot', 'Seated: lean forward to stretch the hamstrings more'],
      execute: ['Curl through the full range, hips pinned down', 'Point toes slightly to reduce calf help', 'Control the way up to the full stretch'],
      feel: 'Hamstrings — not the lower back or calves',
    },
    {
      match: /calf|calves|heel raise/,
      title: 'Calf raise',
      setup: ['Balls of the feet on the edge, knees soft but fixed'],
      execute: ['Drop into a deep stretch and pause 1–2 seconds at the bottom', 'Rise onto the big toe as high as you can', 'No bouncing — calves respond to the paused stretch'],
      feel: 'Calves burning deep in the stretch',
    },
    {
      match: /adduct|abduct|hip (in|out)/,
      title: 'Hip ab/adduction',
      setup: ['Sit tall or lean slightly forward (leaning forward = more glute for abduction)'],
      execute: ['Move through the full range under control', 'Pause at the end of each rep'],
      feel: 'Inner thighs (adduction) or side glutes (abduction)',
    },

    // ── Arms ─────────────────────────────────────────────────────
    {
      match: /hammer curl|reverse curl|cross[ -]?body curl/,
      title: 'Hammer curl',
      setup: ['Neutral grip — thumbs up', 'Elbows pinned at the sides'],
      execute: ['Curl without the elbows drifting forward', 'Squeeze the handle hard', 'Lower all the way down'],
      feel: 'Brachialis and forearm, outer side of the arm',
    },
    {
      match: /preacher|spider curl|concentration/,
      title: 'Preacher curl',
      setup: ['Armpit tight to the top of the pad', 'Upper arm flat on the pad the whole set'],
      execute: ['Lower until the arm is almost straight — don\'t drop it', 'Curl up without lifting the elbows', 'Stop just before the forearm is vertical to keep tension'],
      feel: 'Biceps, hardest near the bottom',
    },
    {
      match: /curl/,
      title: 'Biceps curl',
      setup: ['Stand tall, elbows at your sides or slightly behind the body'],
      execute: ['Turn the pinky up as you curl (supinate)', 'Elbows stay put — no swinging', 'Lower under control to a full stretch'],
      feel: 'Biceps only — front delts stay out of it',
    },
    {
      match: /skull ?crusher|overhead (tricep|extension)|french press|tricep.*extension|jm press/,
      title: 'Triceps extension',
      setup: ['Upper arms fixed, elbows pointed forward/up', 'Overhead versions stretch the long head most'],
      execute: ['Bend only at the elbow', 'Get a deep stretch behind the head', 'Lock out fully and squeeze'],
      feel: 'Triceps, especially the long head — elbows shouldn\'t ache',
    },
    {
      match: /pushdown|push down|tricep|kickback|close[ -]?grip/,
      title: 'Triceps pushdown',
      setup: ['Elbows tucked to the sides, slight forward lean', 'Shoulders down'],
      execute: ['Only the forearms move', 'Lock out and squeeze for a beat at the bottom', 'Let the forearms come up past 90° on the way back'],
      feel: 'Back of the arm — no shoulders or chest pushing',
    },

    // ── Core ─────────────────────────────────────────────────────
    {
      match: /crunch|sit[ -]?up|ab (wheel|roller)|leg raise|knee raise|hanging/,
      title: 'Abs',
      setup: ['Exhale and pull ribs toward the hips before you start'],
      execute: ['Curl the spine — think "ribs to pelvis", not hips swinging', 'Hold the squeeze at the end', 'Lower slowly, keep tension'],
      feel: 'Abs cramping — hip flexors or neck should stay quiet',
    },
    {
      match: /plank|pallof|dead bug|carry|farmer/,
      title: 'Core stability',
      setup: ['Ribs down, glutes squeezed'],
      execute: ['Breathe behind the brace — don\'t hold your breath', 'Resist movement; the goal is nothing moves'],
      feel: 'Whole trunk working to stay still',
    },
  ];

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
  }

  /** The cues for an exercise name, or null when none fit. */
  function find(name) {
    const n = norm(name);
    if (!n) return null;
    const hit = CUES.find((c) => c.match.test(n));
    return hit ? { title: hit.title, setup: hit.setup, execute: hit.execute, feel: hit.feel } : null;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _list(label, items) {
    if (!items || !items.length) return '';
    return `<div class="exc-sec"><div class="exc-sec-label">${esc(label)}</div><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  }

  // ── DOM ─────────────────────────────────────────────────────────

  function _close() {
    const wrap = document.getElementById('exerciseCues');
    const pop = document.getElementById('exerciseCuesPop');
    const btn = document.getElementById('exerciseCuesBtn');
    if (pop) pop.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (wrap) wrap.classList.remove('is-open');
  }

  function toggleExerciseCues(force) {
    const wrap = document.getElementById('exerciseCues');
    const pop = document.getElementById('exerciseCuesPop');
    const btn = document.getElementById('exerciseCuesBtn');
    if (!wrap || !pop || wrap.hidden) return;
    const open = typeof force === 'boolean' ? force : pop.hidden;
    if (!open) { _close(); return; }
    pop.hidden = false;
    wrap.classList.add('is-open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  let _lastName = null;
  function renderExerciseCues(name) {
    if (typeof document === 'undefined') return;
    const wrap = document.getElementById('exerciseCues');
    const pop = document.getElementById('exerciseCuesPop');
    if (!wrap || !pop) return;
    const cues = find(name);
    if (!cues) { wrap.hidden = true; _close(); _lastName = null; return; }
    wrap.hidden = false;
    if (_lastName === cues.title) return; // same movement — keep the bubble as it is
    _lastName = cues.title;
    pop.innerHTML = `
      <div class="exc-head">
        <div>
          <div class="exc-brand">Butters University</div>
          <div class="exc-title">${esc(cues.title)}</div>
        </div>
        <button type="button" class="exc-close" onclick="toggleExerciseCues(false)" aria-label="Close cues">×</button>
      </div>
      ${_list('Setup', cues.setup)}
      ${_list('Execute', cues.execute)}
      ${cues.feel ? `<div class="exc-feel"><span>Feel it</span>${esc(cues.feel)}</div>` : ''}`;
  }

  function _init() {
    // Tap outside the bubble closes it
    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('exerciseCues');
      if (wrap && wrap.classList.contains('is-open') && !wrap.contains(e.target)) _close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') _close(); });
    // A logged set closes it so it never covers the next set's numbers
    document.addEventListener('tl:set-logged', _close);
    const ex = document.getElementById('exercise');
    if (ex && ex.value) renderExerciseCues(ex.value);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
    else _init();
  }

  const api = { CUES, find };
  global.ExerciseCues = api;
  global.renderExerciseCues = renderExerciseCues;
  global.toggleExerciseCues = toggleExerciseCues;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
