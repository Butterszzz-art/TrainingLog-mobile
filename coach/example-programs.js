/* Example programs for the coach console's Programs page.
 *
 * Ready-made pocketcoach.program/2 programs a coach can open in the builder
 * to walk a prospect through (Week, Sheet and Volume views) and, if they
 * like, save a copy to their own library. Nothing here is saved until the
 * coach presses Save in the builder.
 *
 *   CoachExamplePrograms.list → [{ id, title, summary }]
 *   CoachExamplePrograms.build(id) → program/2 (a fresh copy each call)
 *
 * Each example is written as one line per exercise per mesocycle, the way a
 * coach's own sheet reads ("8x2 (1>0) 85%"), and expanded into weeks here. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CoachExamplePrograms = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  // ── shorthand → row ─────────────────────────────────────────────────────

  /**
   * "8x2 (1>0) 85%" → { repsMin: 8, sets: 2, rir: 1, lastSetRir: 0, loadPct: 85 }.
   * "15x2 35% myo" → myo-reps (no RIR). The full RIR order per set goes in the notes
   * when there are more than two sets, since a row holds only first and last.
   */
  function parseCell(text) {
    const s = String(text);
    const rs = s.match(/(\d+)x(\d+)/);
    const out = { repsMin: Number(rs[1]), sets: Number(rs[2]) };
    const rir = s.match(/\(([\d>]+)\)/);
    const notes = [];
    if (rir) {
      const seq = rir[1].split('>').map(Number);
      out.rir = seq[0];
      out.lastSetRir = seq[seq.length - 1] === seq[0] ? null : seq[seq.length - 1];
      if (seq.length > 2) notes.push('RIR per set ' + rir[1].replace(/>/g, ' > '));
    }
    const pct = s.match(/(\d+)%/);
    if (pct) out.loadPct = Number(pct[1]);
    if (/myo/.test(s)) notes.push('Myo-reps');
    out.cellNotes = notes;
    return out;
  }

  // Rest follows the exercise, not the calendar: 3 min the first mesocycle
  // it appears in on that day, 2 min the second, 1 min from the third.
  const REST_BY_APPEARANCE = [180, 120, 60];

  /**
   * Expands { blocks, days: [{ dayId, weekday, label, focus, notes,
   *   rows: [{ name, muscle, type, m: [cell|null ×3], notes?, mNotes?: [×3], rest?: [×3] }] }] }
   * into a program/2 with 4 weeks per block (weeks 2-4 repeat week 1).
   */
  function expandSpec(spec) {
    const weeks = [];
    spec.blocks.forEach((block, b) => {
      const days = spec.days.map(day => ({
        dayId: day.dayId,
        weekday: day.weekday,
        label: day.label,
        focus: day.focus || '',
        notes: (day.blockNotes && day.blockNotes[b]) || day.notes || '',
        exercises: day.rows.filter(r => r.m[b]).map(r => {
          const cell = parseCell(r.m[b]);
          const appearance = r.m.slice(0, b).filter(Boolean).length;
          const rest = r.rest ? r.rest[b] : REST_BY_APPEARANCE[Math.min(appearance, 2)];
          const notes = [r.mNotes && r.mNotes[b], r.notes].concat(cell.cellNotes).filter(Boolean).join('. ');
          return Object.assign({
            id: 'b' + (b + 1) + '-' + day.dayId + '-' + r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: r.name,
            type: r.type,
            sets: cell.sets,
            repsMin: cell.repsMin,
            repsMax: null,
            rir: cell.rir === undefined ? null : cell.rir,
            lastSetRir: cell.lastSetRir === undefined ? null : cell.lastSetRir,
            restSec: rest,
            restSecMax: null,
            notes: notes.slice(0, 300),
            muscle: r.muscle,
          }, cell.loadPct ? { loadPct: cell.loadPct } : {});
        }),
      }));
      const first = weeks.length + 1;
      weeks.push({ week: first, label: 'Week ' + first, note: block.weekNote || '', block: block.id, days });
      for (let i = 1; i < 4; i++) weeks.push({ week: first + i, label: 'Week ' + (first + i), sameAs: first, block: block.id });
    });
    return {
      schema: 'pocketcoach.program/2',
      name: spec.name,
      notes: spec.notes,
      progressionNotes: spec.progressionNotes,
      rules: spec.rules,
      blocks: spec.blocks.map(b => ({ id: b.id, name: b.name, goal: b.goal })),
      weeks,
    };
  }

  // ── Example 1: upper/lower, lower-body priority, 3 mesocycles ───────────

  const KNEE = 'Knee care: before set 1, 3×30 s isometric leg extension held at the angle where it hurts, RPE 8';
  const WAVE_HEAVY = ['Wave: heavy day (light day is Saturday)', 'Wave: heavy day (light day is Saturday)', 'Wave over: straight linear progression'];
  const WAVE_LIGHT = ['Wave: light day', 'Wave: light day, myo-reps', 'Wave over: same as Monday'];
  const SUPERSET = ['Straight sets', 'Superset with abductor', 'Superset with abductor'];
  const SUPERSET_B = ['Straight sets', 'Superset with adductor', 'Superset with adductor'];
  const ADD_REST = [120, 60, 60];

  // One table for both upper days. "Cap" is the top of the rep range:
  // reps stay inside it and the weight goes up.
  const UPPER_ROWS = [
    { name: 'Chest-Supported Row', muscle: 'back', type: 'compound', notes: 'Rep cap 10', m: ['6x1 (0)', '8x1 (0)', '10x2 (1>0)'] },
    { name: 'Diagonal Unilateral Pulldown', muscle: 'back', type: 'compound', notes: 'Rep cap 10', m: ['6x2 (1>0)', '8x3 (1>1>0)', '10x2 (1>0)'] },
    { name: 'Wide-Grip Lat Pulldown', muscle: 'back', type: 'compound', notes: 'Rep cap 8', m: ['8x2 (1>0)', '6x3 (1>1>0)', '8x1 (0)'] },
    { name: 'Cable Lat Prayer', muscle: 'back', type: 'isolation', notes: 'Rep cap 8', mNotes: [null, null, 'New in meso 3'], m: [null, null, '8x2 (1>0)'] },
    { name: 'Wide-Grip Row', muscle: 'traps', type: 'compound', notes: 'Rep cap 10', mNotes: [null, null, 'Back in meso 3'], m: [null, null, '10x2 (1>0)'] },
    { name: 'Machine Overhead Press', muscle: 'shoulders', type: 'compound', notes: 'Rep cap 8', m: ['4x2 (1>0)', '6x3 (1>1>0)', '8x4 (2>2>1>0)'] },
    { name: 'Cable Lateral Raise', muscle: 'shoulders', type: 'isolation', notes: 'Rep cap 10', m: ['8x2 (1>0)', '8x3 (1>1>0)', '10x4 (2>2>1>0)'] },
    { name: 'Cable Upright Row', muscle: 'shoulders', type: 'compound', notes: 'Rep cap 6', mNotes: [null, null, 'New in meso 3'], m: [null, null, '6x2 (1>0)'] },
    { name: 'Rear Delt Fly', muscle: 'shoulders', type: 'isolation', notes: 'Rep cap 10', m: ['8x1 (0)', '10x2 (1>0)', '10x1 (0)'] },
  ];

  const UPPER_LOWER_SPEC = {
    name: 'Example: Upper/Lower, lower-body focus (3 mesos, 12 wk)',
    notes: [
      'Case: advanced lifter (9 years training, former wellness competitor), 5 sessions a week, goal is to build muscle while staying lean. Desk job, 7 h sleep. Knee pain on hack squats, so hack squats are left out and the same pattern is trained with other exercises.',
      '',
      'Set-up: upper/lower split with more volume for the lower body than the upper body (wellness look: legs and glutes first, the upper body is already further along). Lower body is trained 3× a week (heavy Monday, Wednesday, light Saturday), upper body 2×.',
      '',
      'Periodisation: three 4-week mesocycles moving from MEV towards MRV. Each mesocycle adds about 4 lower-body sets a week, spread over the three lower days, with more reps, a lower %1RM and shorter rests.',
      '',
      'Weekly sets per muscle (direct + indirect) by mesocycle 1 / 2 / 3: glutes 15/19/22, quads 13/17/22, hamstrings 15/18/20, adductors 4/6/6, abductors 4/6/6, calves 10/13/17, erectors 4.5/7.5/7.5, abs 5/7/9, lats 8/12/14, traps 9/14/15, front delt 8/12/16, side delt 8/12/17, rear delt 8/10/8.',
      '',
      'Nutrition in this case: Katch-McArdle maintenance about 2045 kcal, +10% surplus = 2250 kcal on rest days and 2650 kcal on training days. Protein 1.8 g/kg (about 120 g), fat about 77 g, carbs fill the rest (about 270 g rest day, 370 g training day), over 4 meals with more protein in the two meals after training.',
    ].join('\n'),
    progressionNotes: [
      'Hip thrust and leg press: wave periodisation (heavy Monday, light Saturday) in mesos 1-2 to break a plateau, fixed %1RM. In meso 3 the wave stops and both go up linearly at higher volume.',
      'Other lower-body lifts: linear progression with a benchmark set. Hit the rep target on the first work set → the other sets stay at that weight. Miss it → the other sets become speed work, about 20-30% lighter.',
      'Upper body: rep-range progression. Reps stay under the cap and the weight goes up; the RIR target steers progress within a mesocycle.',
      'Starting weights: 1-5RM test, Epley estimate. At the end of each mesocycle, re-estimate the 1RM from the last performance and start the next one at 85% (into meso 2) or 75% (into meso 3). The % on those rows is that starting point.',
    ].join('\n'),
    rules: [
      'Warm-up: heavy lifts 2 sets at about 35% and 50% of the work weight, accessories 1 set at about 50%, 60 s rest.',
      'Rest on work sets: 3 min the first mesocycle an exercise appears, 2 min the second, 1 min from the third.',
      'Adductor/abductor: 2 min rest as straight sets, 60 s once they are a superset. Cable crunches: always 60 s.',
      'Reps × sets (RIR per set): "8x3 (2>1>1)" means 3 sets of 8, the first at 2 reps in reserve, the last two at 1.',
      'No hack squats (knee). Before the first hamstring curl set: 3×30 s isometric leg extension at the painful angle, RPE 8.',
    ],
    blocks: [
      { id: 'meso1', name: 'Meso 1 · MEV', goal: 'Start at MEV (about 12 lower-body sets a week): heavier, fewer reps, long rests. The jump to 3 lower days is already the overload.', weekNote: 'Test 1-5RM in week 1 to set starting weights (Epley).' },
      { id: 'meso2', name: 'Meso 2 · towards MAV', goal: 'About +4 lower-body sets a week, more reps, lower %1RM, 2-min rests. Adductor/abductor become a superset.', weekNote: 'New starting weights: 85% of the re-estimated 1RM.' },
      { id: 'meso3', name: 'Meso 3 · towards MRV', goal: 'Highest volume: wave stops, more reps and sets, 1-min rests, closer to failure. New exercises start at 3-min rest.', weekNote: 'New starting weights: 75% of the re-estimated 1RM.' },
    ],
    days: [
      {
        dayId: 'd1', weekday: 1, label: 'Lower A', focus: 'heavy',
        rows: [
          { name: 'Seated Hamstring Curl', muscle: 'hamstrings', type: 'isolation', notes: KNEE, m: ['8x2 (1>0)', '6x3 (1>1>0) 85%', '8x3 (2>1>1) 75%'] },
          { name: 'Hip Thrust', muscle: 'glutes', type: 'compound', mNotes: WAVE_HEAVY, m: ['4x2 (1>0) 85%', '6x2 (1>0) 75%', '12x2 (2>0) 70%'] },
          { name: 'Glute Kickback', muscle: 'glutes', type: 'isolation', m: [null, '8x1 (0)', '10x2 (1>0)'] },
          { name: 'Leg Press', muscle: 'quads', type: 'compound', mNotes: WAVE_HEAVY, m: ['4x2 (1>0) 95%', '6x2 (1>0) 85%', '12x3 (2>1>1) 80%'] },
          { name: 'Machine RDL', muscle: 'hamstrings', type: 'compound', m: ['4x1 (0)', '8x2 (1>0) 85%', '10x2 (1>1) 75%'] },
          { name: 'Leg Extension', muscle: 'quads', type: 'isolation', m: ['8x1 (0)', '6x2 (1>0) 85%', '8x2 (1>1) 75%'] },
          { name: 'Hip Adduction Machine', muscle: 'adductors', type: 'isolation', mNotes: SUPERSET, rest: ADD_REST, m: ['8x2 (1>0)', '10x3 (1>1>0) 85%', '12x3 (2>1>0) 75%'] },
          { name: 'Hip Abduction Machine', muscle: 'abductors', type: 'isolation', mNotes: SUPERSET_B, rest: ADD_REST, m: ['8x2 (1>0)', '10x3 (1>1>0) 85%', '12x3 (2>1>0) 75%'] },
          { name: 'Standing Calf Raise', muscle: 'calves', type: 'isolation', m: ['15x2 (1>0)', '15x3 (1>1>0) 85%', '15x3 (2>1>0) 75%'] },
          { name: 'Cable Crunch', muscle: 'abs', type: 'core', rest: [60, 60, 60], m: ['15x2 (1>0)', '15x3 (1>1>0) 85%', '15x3 (2>1>0) 75%'] },
        ],
      },
      { dayId: 'd2', weekday: 2, label: 'Upper A', focus: 'back + shoulders', rows: UPPER_ROWS },
      {
        dayId: 'd3', weekday: 3, label: 'Lower B',
        rows: [
          { name: 'Machine RDL', muscle: 'hamstrings', type: 'compound', m: ['4x1 (0)', '8x1 (0) 85%', '10x1 (0) 75%'] },
          { name: 'Bulgarian Split Squat', muscle: 'quads', type: 'compound', m: ['4x2 (1>0)', '6x2 (1>1) 85%', '8x2 (2>1) 75%'] },
          { name: 'Glute Kickback', muscle: 'glutes', type: 'isolation', m: ['8x2 (1>0)', '10x2 (1>1)', '12x2 (2>1)'] },
          { name: 'Leg Extension', muscle: 'quads', type: 'isolation', m: ['8x1 (0)', '6x1 (0) 85%', '8x1 (0) 75%'] },
          { name: 'Seated Hamstring Curl', muscle: 'hamstrings', type: 'isolation', notes: KNEE, m: ['8x2 (1>0)', '6x2 (1>0) 85%', '8x3 (2>1>1) 75%'] },
          { name: 'Standing Calf Raise', muscle: 'calves', type: 'isolation', mNotes: [null, null, 'New in meso 3'], m: [null, null, '15x2 (1>0)'] },
          { name: 'Cable Crunch', muscle: 'abs', type: 'core', mNotes: [null, null, 'New in meso 3'], rest: [60, 60, 60], m: [null, null, '15x2 (1>0)'] },
        ],
      },
      { dayId: 'd4', weekday: 4, label: 'Upper B', focus: 'back + shoulders', rows: UPPER_ROWS },
      {
        dayId: 'd5', weekday: 6, label: 'Lower C', focus: 'light',
        blockNotes: [null, null, 'Meso 3: same as Lower A (the wave has stopped).'],
        rows: [
          { name: 'Seated Hamstring Curl', muscle: 'hamstrings', type: 'isolation', notes: KNEE, m: ['8x2 (1>0)', '6x2 (1>0) 85%', '8x2 (2>1) 75%'] },
          { name: 'Hip Thrust', muscle: 'glutes', type: 'compound', mNotes: WAVE_LIGHT, m: ['15x2 (1>0) 45%', '15x2 35% myo', '12x2 (2>1) 70%'] },
          { name: 'Glute Kickback', muscle: 'glutes', type: 'isolation', m: [null, '8x1 (0)', '10x2 (2>1)'] },
          { name: 'Leg Press', muscle: 'quads', type: 'compound', mNotes: WAVE_LIGHT, m: ['15x2 (1>0) 55%', '15x3 45% myo', '12x3 (2>1>1) 80%'] },
          { name: 'Machine RDL', muscle: 'hamstrings', type: 'compound', m: ['4x1 (0)', '8x1 (0) 85%', '10x1 (1) 75%'] },
          { name: 'Leg Extension', muscle: 'quads', type: 'isolation', m: [null, null, '8x1 (0) 75%'] },
          { name: 'Hip Adduction Machine', muscle: 'adductors', type: 'isolation', mNotes: SUPERSET, rest: ADD_REST, m: ['8x2 (1>0)', '10x3 (1>1>0) 85%', '12x3 (2>1>0) 75%'] },
          { name: 'Hip Abduction Machine', muscle: 'abductors', type: 'isolation', mNotes: SUPERSET_B, rest: ADD_REST, m: ['8x2 (1>0)', '10x3 (1>1>0) 85%', '12x3 (2>1>0) 75%'] },
          { name: 'Standing Calf Raise', muscle: 'calves', type: 'isolation', m: ['15x2 (1>0)', '15x3 (1>1>0) 85%', '15x3 (2>1>1) 75%'] },
          { name: 'Cable Crunch', muscle: 'abs', type: 'core', rest: [60, 60, 60], m: ['15x2 (1>0)', '15x3 (1>1>0) 85%', '15x3 (2>1>1) 75%'] },
        ],
      },
    ],
  };

  const EXAMPLES = [
    {
      id: 'upper-lower-lower-focus',
      title: 'Upper/Lower, lower-body focus',
      summary: '5 days · 3 mesocycles × 4 weeks (MEV → MRV) · wave periodisation on hip thrust and leg press · knee-friendly',
      spec: UPPER_LOWER_SPEC,
    },
  ];

  return {
    list: EXAMPLES.map(e => ({ id: e.id, title: e.title, summary: e.summary })),
    build(id) {
      const ex = EXAMPLES.find(e => e.id === id);
      return ex ? expandSpec(ex.spec) : null;
    },
    _parseCell: parseCell,
  };
});
