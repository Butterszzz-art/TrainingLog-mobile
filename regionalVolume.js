// Regional hypertrophy volume (Pro).
//
// Splits each muscle into the regions bodybuilders care about (upper chest,
// side delts, biceps long head…) and counts weekly hard sets per region.
//
// How a set is credited: every exercise maps to a set of regions, each with a
// credit from 0 to 1 — 1 means a set fully trains that region, 0.5 means it
// trains it partly. 3 sets of incline press = 3 sets of upper chest, 2.1 of
// mid chest, 1.5 of front delts… A muscle's sets are the best-trained region
// of that muscle per set, so a muscle never counts more sets than were done.
//
// Where the mapping comes from, in order:
//   1. REGION_RULES — keyword rules for common movements, each tagged with how
//      well the research backs the regional split (strong/moderate/theoretical).
//   2. MUSCLE_FALLBACK — the exercise's whole-muscle group (getMuscleGroup,
//      including the user's custom and AI-classified exercises) spread across
//      that muscle's regions. Marked estimated.
// Phase 2 will add AI movement analysis for names neither step can place.

const MUSCLE_REGIONS = [
  { muscle: 'chest', label: 'Chest', regions: [
    { id: 'chest_upper', label: 'Upper chest', tip: 'Add incline presses or low-to-high flyes (bench ~30°).' },
    { id: 'chest_mid', label: 'Mid chest', tip: 'Add flat presses or flat flyes.' },
    { id: 'chest_lower', label: 'Lower chest', tip: 'Add dips, decline presses or high-to-low flyes.' }
  ] },
  { muscle: 'delts', label: 'Delts', regions: [
    { id: 'delt_front', label: 'Front delts', tip: 'Overhead presses cover these; front raises if still lagging.' },
    { id: 'delt_side', label: 'Side delts', tip: 'Add lateral raises (cable or dumbbell) — key for width.' },
    { id: 'delt_rear', label: 'Rear delts', tip: 'Add reverse flyes, rear-delt rows or face pulls.' }
  ] },
  { muscle: 'back', label: 'Back', regions: [
    { id: 'lats', label: 'Lats', tip: 'Add pulldowns, pull-ups or pullovers — key for V-taper.' },
    { id: 'upper_back', label: 'Mid traps & rhomboids', tip: 'Add rows with elbows out or chest-supported rows.' },
    // supporting: tracked, but never flagged as lagging next to the lats
    { id: 'traps_upper', label: 'Upper traps', tip: 'Add shrugs or heavy carries.', supporting: true },
    { id: 'erectors', label: 'Lower back', tip: 'Add back extensions or a deadlift variation.', supporting: true }
  ] },
  { muscle: 'biceps', label: 'Biceps', regions: [
    { id: 'biceps_long', label: 'Long head (peak)', tip: 'Add incline or Bayesian curls (arm behind the body).' },
    { id: 'biceps_short', label: 'Short head', tip: 'Add preacher or spider curls (arm in front of the body).' },
    { id: 'brachialis', label: 'Brachialis', tip: 'Add hammer or reverse curls.' }
  ] },
  { muscle: 'triceps', label: 'Triceps', regions: [
    { id: 'triceps_long', label: 'Long head', tip: 'Add overhead extensions — they grow the long head most.' },
    { id: 'triceps_lateral', label: 'Lateral & medial heads', tip: 'Add pushdowns or close-grip presses.' }
  ] },
  { muscle: 'forearms', label: 'Forearms', regions: [
    { id: 'forearms', label: 'Forearms', tip: 'Add wrist curls, reverse curls or carries.' }
  ] },
  { muscle: 'quads', label: 'Quads', regions: [
    { id: 'rectus_femoris', label: 'Rectus femoris', tip: 'Add leg extensions — squats barely grow this head.' },
    { id: 'vasti', label: 'Vasti (outer & inner quad)', tip: 'Add squats, hack squats or leg presses.' }
  ] },
  { muscle: 'hamstrings', label: 'Hamstrings', regions: [
    { id: 'hams_bf', label: 'Biceps femoris (outer)', tip: 'Add Romanian deadlifts or seated leg curls.' },
    { id: 'hams_semis', label: 'Semis (inner)', tip: 'Add Nordic curls or seated leg curls.' }
  ] },
  { muscle: 'glutes', label: 'Glutes', regions: [
    { id: 'glute_upper', label: 'Upper glutes & medius', tip: 'Add hip abductions (machine or cable).' },
    { id: 'glute_lower', label: 'Lower glute max', tip: 'Add hip thrusts, lunges or deep squats.' }
  ] },
  { muscle: 'adductors', label: 'Adductors', regions: [
    { id: 'adductors', label: 'Adductors', tip: 'Add adduction machine or Copenhagen planks.' }
  ] },
  { muscle: 'calves', label: 'Calves', regions: [
    { id: 'gastrocs', label: 'Gastrocnemius', tip: 'Add straight-knee calf raises (standing or leg press).' },
    { id: 'soleus', label: 'Soleus', tip: 'Add bent-knee (seated) calf raises.' }
  ] },
  { muscle: 'abs', label: 'Core', regions: [
    { id: 'abs_rectus', label: 'Six-pack (rectus)', tip: 'Add cable crunches or hanging leg raises.' },
    { id: 'obliques', label: 'Obliques', tip: 'Add woodchops, side bends or Pallof presses.' }
  ] }
];

const REGION_INDEX = {};
MUSCLE_REGIONS.forEach((m) => m.regions.forEach((r) => {
  REGION_INDEX[r.id] = { ...r, muscle: m.muscle, muscleLabel: m.label };
}));

// Shared synergist credits so rules stay readable.
const PRESS_TRICEPS = { triceps_lateral: 0.5, triceps_long: 0.3 };
const PULL_BICEPS = { biceps_long: 0.5, biceps_short: 0.5, brachialis: 0.5 };

// Ordered: the first match wins, so specific patterns sit above general ones.
// Names are matched lower-cased and normalized (abbreviations expanded).
const REGION_RULES = [
  // ── Not muscle-building work: logged, but counts toward no region ──
  { id: 'not_hypertrophy', match: /stretch|\bsmr\b|foam roll|mobility|circles/,
    regions: {}, evidence: null, note: 'Stretching and mobility work does not count as hard sets.' },

  // ── Exceptions that would otherwise hit a broader rule ──
  { id: 'handstand_push_up', match: /handstand push up|pike push up/,
    regions: { delt_front: 1, delt_side: 0.5, ...PRESS_TRICEPS, traps_upper: 0.3, chest_upper: 0.3 },
    evidence: 'moderate', note: 'Vertical pressing is mostly front delts.' },
  { id: 'rear_delt', match: /rear delt|reverse (pec deck|.*fl(y|ye|yes|ies)\b)|back fl(y|ye|yes|ies)\b|face pull|band pull apart/,
    regions: { delt_rear: 1, upper_back: 0.6, traps_upper: 0.2 },
    evidence: 'strong', note: 'Horizontal pulls with the arms out to the side train the rear delts.' },
  { id: 'upright_row', match: /upright .*row/,
    regions: { delt_side: 0.8, traps_upper: 0.8, delt_front: 0.3, brachialis: 0.3 },
    evidence: 'moderate', note: 'Wide-grip upright rows hit side delts and upper traps.' },
  { id: 'glute_kickback', match: /glute kickback|cable kickback|donkey kick|rear leg raise/,
    regions: { glute_lower: 0.8, glute_upper: 0.6 },
    evidence: 'theoretical', note: 'Kickbacks isolate glute max; kicking out to the side adds upper glute.' },
  { id: 'close_grip_press', match: /close grip (barbell |dumbbell |ez bar )*(bench|press|push up)|push up.*close|jm press|diamond push up|triceps bench press|board press|pin press/,
    regions: { triceps_lateral: 1, triceps_long: 0.6, chest_mid: 0.6, chest_upper: 0.4, chest_lower: 0.4, delt_front: 0.5 },
    evidence: 'moderate', note: 'A narrow grip shifts work from the chest to the triceps.' },
  { id: 'triceps_dip', match: /bench dip|triceps? dip|dip machine|dips? triceps/,
    regions: { triceps_lateral: 1, triceps_long: 0.6, chest_lower: 0.4, delt_front: 0.4 },
    evidence: 'moderate', note: 'Upright dips load the triceps more than the chest.' },

  // ── Back ──
  { id: 'pullover', match: /pullover|straight arm pulldown|straight arm pushdown/,
    regions: { lats: 1, triceps_long: 0.3 },
    evidence: 'moderate', note: 'Straight-arm work isolates the lats without the biceps.' },
  { id: 'vertical_pull', match: /pulldown|pull up|chin up|muscle up/,
    regions: { lats: 1, upper_back: 0.6, delt_rear: 0.4, ...PULL_BICEPS },
    evidence: 'moderate', note: 'Vertical pulls are lat-dominant.' },
  { id: 'wide_row', match: /(wide|elbows? out|high) .*row|row .*(wide|elbows? out)|rear delt row/,
    regions: { upper_back: 1, delt_rear: 0.8, lats: 0.5, ...PULL_BICEPS },
    evidence: 'theoretical', note: 'Flared elbows shift rows toward the mid traps, rhomboids and rear delts.' },
  { id: 'row', match: /\brows?\b|row machine/,
    regions: { upper_back: 1, lats: 0.8, delt_rear: 0.6, ...PULL_BICEPS },
    evidence: 'moderate', note: 'Rows train the whole upper back; tucked elbows bias the lats.' },
  { id: 'shrug', match: /shrug/,
    regions: { traps_upper: 1, forearms: 0.3 },
    evidence: 'strong', note: 'Shrugs isolate the upper traps.' },
  { id: 'carry', match: /farmer|suitcase carry|carry/,
    regions: { forearms: 1, traps_upper: 0.6, obliques: 0.4 },
    evidence: 'moderate', note: 'Loaded carries train grip and upper traps.' },

  // ── Chest ──
  { id: 'incline_fly', match: /low to high|incline (cable |dumbbell )?fly/,
    regions: { chest_upper: 1, chest_mid: 0.7, chest_lower: 0.2, delt_front: 0.3 },
    evidence: 'moderate', note: 'Moving the arms upward lines up with the clavicular (upper) fibres.' },
  { id: 'decline_fly', match: /high to low|decline (cable |dumbbell )?fly/,
    regions: { chest_lower: 1, chest_mid: 0.8, chest_upper: 0.2, delt_front: 0.2 },
    evidence: 'theoretical', note: 'Moving the arms downward lines up with the lower (costal) fibres.' },
  { id: 'incline_press', match: /incline .*(press|push up)|landmine press/,
    regions: { chest_upper: 1, chest_mid: 0.7, chest_lower: 0.3, delt_front: 0.7, ...PRESS_TRICEPS },
    evidence: 'moderate', note: 'Incline pressing (~30°) grows the upper chest more than flat pressing (Chaves 2024).' },
  { id: 'decline_press', match: /decline .*(press|bench|push up)|chest dip|\bdips?\b(?! squat)/,
    regions: { chest_lower: 1, chest_mid: 0.8, chest_upper: 0.3, delt_front: 0.4, triceps_lateral: 0.6, triceps_long: 0.4 },
    evidence: 'moderate', note: 'Decline presses and dips bias the lower (costal) chest.' },
  { id: 'flat_fly', match: /\bfly\b|flye|pec deck|butterfly|(cable|band) cross ?over|crossover fly|svend press/,
    regions: { chest_mid: 1, chest_upper: 0.6, chest_lower: 0.6, delt_front: 0.3 },
    evidence: 'moderate', note: 'Flat flyes train the whole chest, mid fibres most.' },
  { id: 'flat_press', match: /bench press|chest press|floor press|push up/,
    regions: { chest_mid: 1, chest_upper: 0.6, chest_lower: 0.7, delt_front: 0.5, ...PRESS_TRICEPS },
    evidence: 'moderate', note: 'Flat pressing grows the mid and lower chest best; the upper chest less (Chaves 2024).' },

  // ── Shoulders ──
  { id: 'lateral_raise', match: /lateral raise|side raise|\by raise|lu raise/,
    regions: { delt_side: 1, delt_front: 0.2, traps_upper: 0.3 },
    evidence: 'strong', note: 'Lateral raises are the main side-delt builder; presses barely reach it.' },
  { id: 'front_raise', match: /front raise/,
    regions: { delt_front: 1, chest_upper: 0.3 },
    evidence: 'strong', note: 'Front raises isolate the front delts.' },
  { id: 'overhead_press', match: /overhead press|shoulder press|military press|arnold press|push press|z press/,
    regions: { delt_front: 1, delt_side: 0.5, ...PRESS_TRICEPS, traps_upper: 0.3, chest_upper: 0.3 },
    evidence: 'moderate', note: 'Overhead pressing is mostly front delts; side delts get some work.' },

  // ── Hamstrings and hinges (before generic curls) ──
  { id: 'nordic', match: /nordic|glute ham raise|razor curl/,
    regions: { hams_semis: 1, hams_bf: 0.7, gastrocs: 0.3 },
    evidence: 'moderate', note: 'Nordic curls grow semitendinosus (inner hamstring) the most (Bourne 2017).' },
  { id: 'seated_leg_curl', match: /seated (leg|hamstring) curl/,
    regions: { hams_bf: 1, hams_semis: 1, gastrocs: 0.2 },
    evidence: 'strong', note: 'Curling with the hip bent stretches the hamstrings and grew them more than lying curls (Maeo 2021).' },
  { id: 'leg_curl', match: /leg curl|hamstring curl|lying curl|standing curl machine/,
    regions: { hams_bf: 1, hams_semis: 1, gastrocs: 0.3 },
    evidence: 'moderate', note: 'Leg curls train both sides of the hamstrings; seated beats lying for growth.' },
  { id: 'hip_hinge', match: /romanian|stiff leg|good morning|\brdl\b|single leg deadlift/,
    regions: { hams_bf: 1, hams_semis: 1, glute_lower: 0.8, erectors: 0.6, adductors: 0.5 },
    evidence: 'moderate', note: 'Hip hinges load the hamstrings at long lengths; biceps femoris long head and semimembranosus work hardest.' },
  { id: 'deadlift', match: /deadlift|rack pull/,
    regions: { erectors: 1, glute_lower: 0.8, hams_bf: 0.5, hams_semis: 0.5, vasti: 0.4, adductors: 0.5, traps_upper: 0.5, lats: 0.3, forearms: 0.5 },
    evidence: 'moderate', note: 'Deadlifts are a whole posterior-chain lift led by the lower back and glutes.' },
  { id: 'back_extension', match: /back extension|hyperextension|reverse hyper/,
    regions: { erectors: 1, glute_lower: 0.7, hams_bf: 0.5, hams_semis: 0.5 },
    evidence: 'moderate', note: 'Back extensions train the lower back, glutes and hamstrings.' },

  // ── Biceps ──
  { id: 'long_head_curl', match: /incline .*curl|bayesian|drag curl|behind (the )?back curl/,
    regions: { biceps_long: 1, biceps_short: 0.6, brachialis: 0.5 },
    evidence: 'theoretical', note: 'With the arm behind the body the long head is stretched, so it works harder.' },
  { id: 'short_head_curl', match: /preacher|spider curl|concentration curl|scott curl/,
    regions: { biceps_short: 1, biceps_long: 0.6, brachialis: 0.6 },
    evidence: 'theoretical', note: 'With the arm in front of the body the short head takes more of the load.' },
  { id: 'hammer_curl', match: /\bhammer curl|\bhammer (cable|rope|dumbbell)|reverse (barbell |cable |ez bar )?curl|cross body curl|zottman|pinwheel/,
    regions: { brachialis: 1, biceps_long: 0.5, biceps_short: 0.3, forearms: 0.6 },
    evidence: 'moderate', note: 'Neutral and overhand grips shift work to the brachialis and brachioradialis.' },
  { id: 'wrist_curl', match: /wrist (curl|extension)|wrist roller|finger curl/,
    regions: { forearms: 1 },
    evidence: 'strong', note: 'Wrist curls isolate the forearms.' },
  { id: 'curl', match: /\bcurl/,
    regions: { biceps_long: 1, biceps_short: 1, brachialis: 0.6, forearms: 0.3 },
    evidence: 'moderate', note: 'Standard curls train both biceps heads.' },

  // ── Triceps ──
  { id: 'overhead_extension', match: /overhead .*(extension|triceps)|french press|triceps? overhead|katana/,
    regions: { triceps_long: 1, triceps_lateral: 0.5 },
    evidence: 'strong', note: 'Overhead extensions grew the long head ~1.5× more than pushdowns (Maeo 2022).' },
  { id: 'skull_crusher', match: /skull ?crusher|lying (triceps )?extension|tate press/,
    regions: { triceps_lateral: 1, triceps_long: 0.8 },
    evidence: 'moderate', note: 'Lying extensions train all three heads, the long head moderately.' },
  { id: 'pushdown', match: /pushdown|kickback|triceps? press machine|triceps? extension/,
    regions: { triceps_lateral: 1, triceps_long: 0.6 },
    evidence: 'strong', note: 'Arms-at-side extensions bias the lateral and medial heads (Maeo 2022).' },

  // ── Glutes and hips ──
  { id: 'abduction', match: /abduct|clamshell|lateral band walk|monster walk|fire hydrant|side (lying )?leg raise/,
    regions: { glute_upper: 1 },
    evidence: 'moderate', note: 'Hip abduction trains glute medius and the upper glute max.' },
  { id: 'adduction', match: /adduct|copenhagen/,
    regions: { adductors: 1 },
    evidence: 'strong', note: 'Adduction isolates the inner thigh.' },
  { id: 'hip_thrust', match: /hip thrust|glute bridge|glute drive/,
    regions: { glute_lower: 1, glute_upper: 0.6, hams_bf: 0.3, hams_semis: 0.3 },
    evidence: 'moderate', note: 'Hip thrusts load the glutes hardest at the top, where they are short.' },

  // ── Calves (before squats, so "leg press calf raise" stays a calf raise) ──
  { id: 'seated_calf', match: /seated calf|bent knee calf/,
    regions: { soleus: 1, gastrocs: 0.3 },
    evidence: 'moderate', note: 'Bending the knee slackens the gastrocnemius, so the soleus does the work.' },
  { id: 'calf', match: /calf|calves|donkey raise/,
    regions: { gastrocs: 1, soleus: 0.6 },
    evidence: 'moderate', note: 'Straight-knee raises train the gastrocnemius most.' },

  // ── Quads ──
  { id: 'leg_extension', match: /leg extension|quad extension/,
    regions: { rectus_femoris: 1, vasti: 1 },
    evidence: 'strong', note: 'Leg extensions grow the rectus femoris, which squats barely touch (Ema 2013).' },
  { id: 'sissy_squat', match: /sissy squat|reverse nordic/,
    regions: { rectus_femoris: 1, vasti: 0.8 },
    evidence: 'moderate', note: 'Keeping the hips extended stretches the rectus femoris.' },
  { id: 'lunge', match: /lunge|split squat|step up|bulgarian/,
    regions: { vasti: 1, glute_lower: 0.8, adductors: 0.5, rectus_femoris: 0.3, glute_upper: 0.3 },
    evidence: 'moderate', note: 'Lunges hit quads and glutes; longer strides bias the glutes.' },
  { id: 'squat', match: /squat|leg press|hack|pendulum|belt squat/,
    regions: { vasti: 1, glute_lower: 0.7, adductors: 0.6, rectus_femoris: 0.3, erectors: 0.2 },
    evidence: 'strong', note: 'Squats grow the vasti, glutes and adductors, but barely the rectus femoris (Kubo 2019).' },

  // ── Core ──
  { id: 'obliques', match: /oblique|woodchop|wood chop|russian twist|side bend|side plank|pallof|landmine rotation/,
    regions: { obliques: 1, abs_rectus: 0.3 },
    evidence: 'moderate', note: 'Rotation and side-bending work trains the obliques.' },
  { id: 'abs', match: /crunch|sit up|ab wheel|rollout|leg raise|knee raise|toes to bar|hollow|dragon flag|v up|\babs?\b/,
    regions: { abs_rectus: 1, obliques: 0.3 },
    evidence: 'moderate', note: 'Flexing the spine trains the rectus abdominis.' },
  { id: 'plank', match: /plank|dead bug/,
    regions: { abs_rectus: 0.7, obliques: 0.5 },
    evidence: 'moderate', note: 'Planks are anti-extension work: useful, but a weak growth stimulus.' }
];

// Whole-muscle fallback when no rule matches: spreads the set across the
// muscle's regions the way a typical exercise for that muscle would.
const MUSCLE_FALLBACK = {
  chest: { chest_mid: 1, chest_upper: 0.6, chest_lower: 0.6 },
  shoulders: { delt_front: 0.7, delt_side: 0.7, delt_rear: 0.4 },
  back: { lats: 0.8, upper_back: 0.8 },
  traps: { traps_upper: 1 },
  biceps: { biceps_long: 1, biceps_short: 1, brachialis: 0.5 },
  triceps: { triceps_lateral: 1, triceps_long: 0.7 },
  forearms: { forearms: 1 },
  quads: { vasti: 1, rectus_femoris: 0.4 },
  hamstrings: { hams_bf: 1, hams_semis: 1 },
  glutes: { glute_lower: 1, glute_upper: 0.6 },
  abductors: { glute_upper: 1 },
  adductors: { adductors: 1 },
  calves: { gastrocs: 1, soleus: 0.6 },
  abs: { abs_rectus: 1, obliques: 0.3 },
  legs: { vasti: 1, glute_lower: 0.6, hams_bf: 0.3, hams_semis: 0.3 }
};

function getNormalizer() {
  if (typeof normalizeExerciseKey === 'function') return normalizeExerciseKey;
  if (typeof window !== 'undefined' && typeof window.normalizeExerciseKey === 'function') return window.normalizeExerciseKey;
  if (typeof require === 'function') {
    try { return require('./exerciseMuscleMap.js').normalizeExerciseKey; } catch (_) { /* not available */ }
  }
  return null;
}

function getMuscleLookup() {
  if (typeof getMuscleGroup === 'function') return getMuscleGroup;
  if (typeof window !== 'undefined' && typeof window.getMuscleGroup === 'function') return window.getMuscleGroup;
  if (typeof require === 'function') {
    try { return require('./exerciseMuscleMap.js').getMuscleGroup; } catch (_) { /* not available */ }
  }
  return null;
}

function cleanName(exerciseName) {
  const raw = String(exerciseName || '').toLowerCase();
  const normalize = getNormalizer();
  const normalized = normalize ? String(normalize(exerciseName) || '') : '';
  // Match on both: the normalizer expands "db"/"ohp"/"rdl"; the raw name keeps
  // words the normalizer may drop. Hyphens become spaces ("low-to-high").
  return `${raw} | ${normalized}`.replace(/[-_]/g, ' ').replace(/[^a-z0-9| ]/g, ' ').replace(/\s+/g, ' ');
}

const mappingCache = new Map();

// How one exercise maps to regions:
// { regions: {regionId: credit}, source: 'rule'|'muscle'|'none', ruleId, evidence, note, estimated }
function getExerciseRegions(exerciseName, explicitMuscle) {
  const key = `${exerciseName}::${explicitMuscle || ''}`;
  if (mappingCache.has(key)) return mappingCache.get(key);

  const name = cleanName(exerciseName);
  let result = null;
  const rule = REGION_RULES.find((r) => r.match.test(name));
  if (rule) {
    result = { regions: rule.regions, source: 'rule', ruleId: rule.id, evidence: rule.evidence, note: rule.note, estimated: false };
  } else {
    const lookup = getMuscleLookup();
    const muscle = String(explicitMuscle || (lookup ? lookup(exerciseName) : '') || '').toLowerCase();
    if (MUSCLE_FALLBACK[muscle]) {
      result = {
        regions: MUSCLE_FALLBACK[muscle], source: 'muscle', ruleId: null, evidence: 'estimated',
        note: `Spread evenly across ${muscle} regions — we don't know this movement's regional bias yet.`,
        estimated: true
      };
    } else {
      result = { regions: {}, source: 'none', ruleId: null, evidence: null, note: null, estimated: true };
    }
  }
  mappingCache.set(key, result);
  return result;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIsoWeekStart(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split('T')[0];
}

const WARMUP_TYPES = new Set(['warmup', 'warm-up', 'warm up', 'w']);

// Hard sets in a log entry: logged sets with reps, warm-ups excluded. Older
// entries that only store a set count fall back to that count.
function countWorkingSets(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
  const types = Array.isArray(entry.setTypeArray) ? entry.setTypeArray : [];
  if (reps.length) {
    return reps.filter((r, i) => toNumber(r) > 0 && !WARMUP_TYPES.has(String(types[i] || '').toLowerCase())).length;
  }
  return Math.max(0, Math.round(toNumber(entry.sets)));
}

const round1 = (n) => Math.round(n * 10) / 10;

// Weekly regional volume for a list of workouts.
// Returns {
//   weeks: [{ weekStart, regions: {id: sets}, muscles: {muscle: sets} }],   oldest first
//   latest: { weekStart, muscles: [{ muscle, label, sets, regions: [{ id, label, sets, share }] }] } | null,
//   gaps: [{ muscle, regionId, label, sets, topLabel, topSets, tip }],     latest week only
//   exercises: [{ exercise, sets, source, evidence, note, regions }],     latest week only
//   unmapped: [exercise names that counted toward nothing]
// }
function computeRegionalVolume(workouts) {
  const source = Array.isArray(workouts) ? workouts : [];
  const byWeek = {};
  const exercisesByWeek = {};
  const unmapped = new Set();

  source.forEach((workout) => {
    const weekStart = toIsoWeekStart(workout?.date);
    if (!weekStart || !Array.isArray(workout?.log)) return;
    if (!byWeek[weekStart]) byWeek[weekStart] = { regions: {}, muscles: {} };
    if (!exercisesByWeek[weekStart]) exercisesByWeek[weekStart] = {};
    const week = byWeek[weekStart];

    workout.log.forEach((entry) => {
      const exercise = entry?.exercise || entry?.name;
      if (!exercise) return;
      const sets = countWorkingSets(entry);
      if (!sets) return;
      const mapping = getExerciseRegions(exercise, entry?.muscleGroup);
      const regionIds = Object.keys(mapping.regions);
      if (!regionIds.length) {
        if (mapping.source === 'none') unmapped.add(exercise); // stretches etc. are skipped quietly
        return;
      }

      const bestPerMuscle = {};
      regionIds.forEach((id) => {
        const info = REGION_INDEX[id];
        if (!info) return;
        const credit = mapping.regions[id];
        week.regions[id] = (week.regions[id] || 0) + credit * sets;
        bestPerMuscle[info.muscle] = Math.max(bestPerMuscle[info.muscle] || 0, credit);
      });
      Object.entries(bestPerMuscle).forEach(([muscle, credit]) => {
        week.muscles[muscle] = (week.muscles[muscle] || 0) + credit * sets;
      });

      const exStats = exercisesByWeek[weekStart];
      if (!exStats[exercise]) {
        exStats[exercise] = {
          exercise, sets: 0, source: mapping.source, evidence: mapping.evidence, note: mapping.note,
          regions: regionIds.map((id) => ({ id, label: REGION_INDEX[id]?.label || id, credit: mapping.regions[id] }))
            .sort((a, b) => b.credit - a.credit)
        };
      }
      exStats[exercise].sets += sets;
    });
  });

  const weeks = Object.keys(byWeek).sort().map((weekStart) => {
    const w = byWeek[weekStart];
    const regions = {};
    const muscles = {};
    Object.entries(w.regions).forEach(([id, v]) => { regions[id] = round1(v); });
    Object.entries(w.muscles).forEach(([m, v]) => { muscles[m] = round1(v); });
    return { weekStart, regions, muscles };
  });

  const last = weeks[weeks.length - 1];
  let latest = null;
  const gaps = [];
  if (last) {
    latest = {
      weekStart: last.weekStart,
      muscles: MUSCLE_REGIONS
        .map((m) => {
          const sets = last.muscles[m.muscle] || 0;
          const regions = m.regions.map((r) => {
            const regionSets = last.regions[r.id] || 0;
            return { id: r.id, label: r.label, sets: regionSets, share: sets > 0 ? Math.min(1, regionSets / sets) : 0 };
          });
          return { muscle: m.muscle, label: m.label, sets, regions };
        })
        .filter((m) => m.sets > 0)
        .sort((a, b) => b.sets - a.sets)
    };

    // A region is a gap when its muscle got real work (4+ sets) but the
    // region got under half of what the muscle's best-trained region got.
    latest.muscles.forEach((m) => {
      if (m.sets < 4 || m.regions.length < 2) return;
      const top = m.regions.reduce((a, b) => (b.sets > a.sets ? b : a));
      m.regions.forEach((r) => {
        if (r.id === top.id || REGION_INDEX[r.id].supporting || r.sets >= top.sets * 0.5) return;
        gaps.push({
          muscle: m.muscle, regionId: r.id, label: r.label, sets: r.sets,
          topLabel: top.label, topSets: top.sets, tip: REGION_INDEX[r.id].tip
        });
      });
    });
    gaps.sort((a, b) => (a.sets / a.topSets) - (b.sets / b.topSets));
  }

  const exercises = last
    ? Object.values(exercisesByWeek[last.weekStart] || {}).sort((a, b) => b.sets - a.sets)
    : [];

  return { weeks, latest, gaps, exercises, unmapped: [...unmapped] };
}

if (typeof module !== 'undefined') {
  module.exports = {
    MUSCLE_REGIONS,
    REGION_RULES,
    getExerciseRegions,
    countWorkingSets,
    computeRegionalVolume
  };
}

if (typeof window !== 'undefined') {
  window.MUSCLE_REGIONS = MUSCLE_REGIONS;
  window.getExerciseRegions = getExerciseRegions;
  window.computeRegionalVolume = computeRegionalVolume;
}
