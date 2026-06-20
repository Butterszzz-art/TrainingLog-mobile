const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();

const SYSTEM_PROMPT = `You are a knowledgeable fitness coach assistant inside Pocket Coach, a \
fitness tracking app. You write concise, direct, data-driven check-in summaries for athletes. \
You are factual, encouraging but honest. Never use filler phrases like 'Great job!' or 'Keep it up!'. \
Reference the specific numbers provided. Write in second person (you/your). Max 3 sentences.`;

router.post('/checkin-summary', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }

  const {
    sleep, energy, stress, hunger, digestion, trainingPerformance,
    bodyweightThisWeek, bodyweightLastWeek,
    compliancePercent, adjustmentNotes, goal, archetype,
  } = req.body;

  // Validate required fields
  const required = { sleep, energy, stress, bodyweightThisWeek, compliancePercent, goal, archetype };
  for (const [key, val] of Object.entries(required)) {
    if (val === undefined || val === null || val === '') {
      return res.status(400).json({ error: `Missing required field: ${key}` });
    }
  }

  const delta = bodyweightLastWeek != null
    ? ((bodyweightThisWeek - bodyweightLastWeek) >= 0 ? '+' : '') +
      (bodyweightThisWeek - bodyweightLastWeek).toFixed(1)
    : 'no prior data';

  const parts = [
    `Summarise this week's check-in for a ${archetype} in a ${goal} phase.`,
    `Sleep: ${sleep}/10, Energy: ${energy}/10, Stress: ${stress}/10.`,
  ];
  if (hunger !== undefined && hunger !== '') parts.push(`Hunger: ${hunger}/10.`);
  if (digestion !== undefined && digestion !== '') parts.push(`Digestion: ${digestion}/10.`);
  if (trainingPerformance !== undefined && trainingPerformance !== '') {
    parts.push(`Training performance: ${trainingPerformance}/10.`);
  }
  parts.push(`Bodyweight: ${bodyweightThisWeek}kg (${delta}kg vs last week).`);
  parts.push(`Weekly compliance: ${compliancePercent}%.`);
  parts.push(`Adjustment notes: ${adjustmentNotes || 'None'}.`);

  const userPrompt = parts.join(' ');

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const summary = message.content?.[0]?.text?.trim() || '';
    return res.json({ summary });
  } catch (err) {
    console.error('[AI checkin-summary]', err.message);
    return res.status(502).json({ error: 'AI request failed', details: err.message });
  }
});

// ── Macro Advisor ─────────────────────────────────────────────────────────────

const MACRO_SYSTEM_PROMPT = `You are a precision sports nutrition coach inside Pocket Coach. \
You give specific, data-driven macro adjustment advice. Always provide exact numbers \
(e.g. 'increase carbs by 30g'). Never give vague advice like 'eat more'. \
Reference the actual trend data. Keep response to 3-4 sentences max. Write in second person. \
Always end your response with a JSON block in this exact format:\nTARGETS:{"protein":X,"carbs":X,"fats":X,"calories":X}`;

// Expected rate of change per week in kg, by goal + preference
const TARGET_RATES = {
  cut:      { slow: -0.25, moderate: -0.5, aggressive: -0.75 },
  maintain: { slow: 0,     moderate: 0,    aggressive: 0 },
  bulk:     { slow: 0.15,  moderate: 0.25, aggressive: 0.4 },
};

router.post('/macro-advice', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }

  const {
    currentTargets, goal, ratePreference,
    bodyweightHistory, averageHunger, sex, archetype,
  } = req.body;

  if (!currentTargets || !goal || !ratePreference) {
    return res.status(400).json({ error: 'Missing required fields: currentTargets, goal, ratePreference' });
  }

  // Calculate actual rate of weight change from bodyweight history
  let actualRateKgPerWeek = null;
  if (Array.isArray(bodyweightHistory) && bodyweightHistory.length >= 2) {
    const oldest = bodyweightHistory[0];
    const newest = bodyweightHistory[bodyweightHistory.length - 1];
    const daysDiff = (new Date(newest.date) - new Date(oldest.date)) / 86400000;
    if (daysDiff > 0) {
      actualRateKgPerWeek = ((newest.weight - oldest.weight) / daysDiff) * 7;
    }
  }

  const targetRate = TARGET_RATES[goal]?.[ratePreference] ?? 0;
  const { protein, carbs, fats, calories } = currentTargets;

  const parts = [
    `Advise macro adjustments for a ${sex || 'male'} ${archetype || 'bodybuilder'} in a ${goal} phase (${ratePreference} rate).`,
    `Current targets: ${protein}g protein, ${carbs}g carbs, ${fats}g fats, ${calories} kcal.`,
  ];
  if (actualRateKgPerWeek !== null) {
    parts.push(`Actual weight change: ${actualRateKgPerWeek >= 0 ? '+' : ''}${actualRateKgPerWeek.toFixed(2)} kg/week. Target rate: ${targetRate >= 0 ? '+' : ''}${targetRate} kg/week.`);
  } else {
    parts.push(`Insufficient weight history to calculate rate. Target rate: ${targetRate >= 0 ? '+' : ''}${targetRate} kg/week.`);
  }
  if (averageHunger != null) {
    parts.push(`Average hunger score (last 2 check-ins): ${averageHunger}/10.`);
  }

  const userPrompt = parts.join(' ');

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: MACRO_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content?.[0]?.text?.trim() || '';

    // Strip TARGETS block from advice text and parse it
    const targetsMatch = raw.match(/TARGETS:\s*(\{[^}]+\})/);
    const advice = raw.replace(/TARGETS:\s*\{[^}]+\}/, '').trim();
    let suggestedTargets = null;
    if (targetsMatch) {
      try { suggestedTargets = JSON.parse(targetsMatch[1]); } catch {}
    }
    // Fallback: pass through current targets unchanged if parse fails
    if (!suggestedTargets) suggestedTargets = { protein, carbs, fats, calories };

    return res.json({ advice, suggestedTargets });
  } catch (err) {
    console.error('[AI macro-advice]', err.message);
    return res.status(502).json({ error: 'AI request failed', details: err.message });
  }
});

// ── Program Analyser ──────────────────────────────────────────────────────────

const PROGRAM_SYSTEM_PROMPT = `You are an elite strength and conditioning coach reviewing training programs \
inside Pocket Coach. You identify specific structural issues, recovery gaps, volume imbalances, and progression \
problems. Be direct and specific — reference actual exercise names and day numbers from the program. \
Tailor feedback to the training mode. Format your response as:\n\
VERDICT: one sentence overall assessment\n\
ISSUES: bullet list of 2-4 specific problems found (or 'None identified')\n\
SUGGESTIONS: bullet list of 2-4 concrete improvements with specifics`;

function parseProgramAnalysis(text) {
  const verdict = (text.match(/VERDICT:\s*(.+?)(?:\n|$)/i)?.[1] || '').trim();

  const issuesRaw     = text.match(/ISSUES:\s*([\s\S]+?)(?=SUGGESTIONS:|$)/i)?.[1] || '';
  const suggestionsRaw = text.match(/SUGGESTIONS:\s*([\s\S]+?)$/i)?.[1] || '';

  function bullets(raw) {
    return raw.split('\n')
      .map(l => l.replace(/^[\s•\-*\d.]+/, '').trim())
      .filter(l => l.length > 0 && !/^none\s+identified$/i.test(l));
  }

  return { verdict, issues: bullets(issuesRaw), suggestions: bullets(suggestionsRaw) };
}

router.post('/program-analysis', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }

  const { program, trainingMode, experienceLevel, goal, daysPerWeek } = req.body;
  if (!program || !Array.isArray(program.days)) {
    return res.status(400).json({ error: 'Missing required field: program.days' });
  }

  // Serialise program for the prompt
  const programText = program.days.map((day, i) => {
    const dayLabel = `Day ${i + 1}${day.name ? ` - ${day.name}` : ''}`;
    const exList = (day.exercises || []).map(ex => {
      const parts = [ex.name || 'Unknown'];
      if (ex.sets)       parts.push(`${ex.sets}×${ex.reps || '?'}`);
      if (ex.restSeconds) parts.push(`${ex.restSeconds}s rest`);
      return parts.join(' ');
    });
    return `${dayLabel}: ${exList.join(', ') || 'No exercises'}`;
  }).join('\n');

  const userPrompt = [
    `Analyse this ${trainingMode || 'general'} program for a ${experienceLevel || 'intermediate'} athlete`,
    `targeting ${goal || 'general fitness'}, training ${daysPerWeek || program.days.length} days/week:`,
    '',
    programText,
  ].join('\n');

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: PROGRAM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content?.[0]?.text?.trim() || '';
    return res.json(parseProgramAnalysis(raw));
  } catch (err) {
    console.error('[AI program-analysis]', err.message);
    return res.status(502).json({ error: 'AI request failed', details: err.message });
  }
});

// ── AI Program Generator ──────────────────────────────────────────────────────

const GENERATE_PROGRAM_SYSTEM_PROMPT = `You are an expert program designer inside Pocket Coach. Generate a complete, \
structured training program based on the user's inputs. Apply sound periodisation \
principles appropriate to their training mode and experience level. \
Respond ONLY with valid JSON in this exact structure: \
{ \
  "name": string, \
  "daysPerWeek": number, \
  "days": [{ \
    "name": string, \
    "focus": string, \
    "exercises": [{ \
      "name": string, \
      "sets": number, \
      "reps": string, \
      "restSeconds": number, \
      "notes": string \
    }] \
  }], \
  "progressionNotes": string, \
  "deloadRecommendation": string \
} \
Use standard exercise names. Rep ranges as strings e.g. '8-12' or '5'. Rest in seconds.`;

router.post('/generate-program', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }

  const {
    goal, daysPerWeek, sessionLengthMinutes,
    equipment, trainingMode, experienceLevel,
    focusAreas, currentMaxes,
  } = req.body;

  if (!goal || !daysPerWeek) {
    return res.status(400).json({ error: 'Missing required fields: goal, daysPerWeek' });
  }

  const parts = [
    `Goal: ${goal}`,
    `Training days per week: ${daysPerWeek}`,
    `Session length: ${sessionLengthMinutes || 60} minutes`,
    `Training mode: ${trainingMode || 'general'}`,
    `Experience level: ${experienceLevel || 'intermediate'}`,
    `Available equipment: ${Array.isArray(equipment) && equipment.length ? equipment.join(', ') : 'full gym'}`,
  ];
  if (focusAreas) parts.push(`Focus areas / lagging points: ${focusAreas}`);
  if (currentMaxes) {
    const maxLines = [];
    if (currentMaxes.squat) maxLines.push(`squat ${currentMaxes.squat}kg`);
    if (currentMaxes.bench) maxLines.push(`bench ${currentMaxes.bench}kg`);
    if (currentMaxes.deadlift) maxLines.push(`deadlift ${currentMaxes.deadlift}kg`);
    if (maxLines.length) parts.push(`Current 1RMs: ${maxLines.join(', ')}`);
  }
  parts.push(`Generate exactly ${daysPerWeek} training days.`);

  const userPrompt = parts.join('\n');

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: GENERATE_PROGRAM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = (message.content?.[0]?.text || '').trim();
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let prog;
    try {
      prog = JSON.parse(jsonStr);
    } catch {
      console.error('[AI generate-program] JSON parse failed:', jsonStr.slice(0, 200));
      return res.status(502).json({ error: 'AI returned invalid JSON' });
    }

    // Validate minimum structure
    if (!prog.name || !Array.isArray(prog.days) || !prog.days.length) {
      return res.status(502).json({ error: 'AI returned incomplete program structure' });
    }

    // Sanitise each day and exercise
    prog.days = prog.days.map((day, i) => ({
      name: String(day.name || `Day ${i + 1}`),
      focus: String(day.focus || ''),
      exercises: Array.isArray(day.exercises)
        ? day.exercises.map(ex => ({
            name: String(ex.name || 'Exercise'),
            sets: Math.max(1, Number(ex.sets) || 3),
            reps: String(ex.reps || '8-12'),
            restSeconds: Math.max(30, Number(ex.restSeconds) || 90),
            notes: String(ex.notes || ''),
          }))
        : [],
    }));

    return res.json({
      name: String(prog.name),
      daysPerWeek: Number(prog.daysPerWeek) || daysPerWeek,
      days: prog.days,
      progressionNotes: String(prog.progressionNotes || ''),
      deloadRecommendation: String(prog.deloadRecommendation || ''),
    });
  } catch (err) {
    console.error('[AI generate-program]', err.message);
    return res.status(502).json({ error: 'AI request failed', details: err.message });
  }
});

// ── Plateau Detector ──────────────────────────────────────────────────────────

const PLATEAU_SYSTEM_PROMPT = `You are analysing training data inside Pocket Coach to detect stagnation \
or plateaus. Look for: exercises with no weight or volume increase over \
4+ weeks, bodyweight stalling against the user's implied goal, declining \
performance scores. Only report a plateau if you find clear evidence. \
If no plateau is detected, return plateauDetected: false and nothing else. \
If detected, be specific about which lift or metric has stalled and for \
how long, and give one concrete actionable suggestion. \
Respond ONLY with valid JSON: \
{ "plateauDetected": boolean, "stall": string|null, "duration": string|null, "suggestion": string|null }`;

router.post('/plateau-check', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }

  const { recentLogs, bodyweightHistory, trainingMode, recentPerformanceScores } = req.body;

  if (!Array.isArray(recentLogs) && !Array.isArray(bodyweightHistory)) {
    return res.status(400).json({ error: 'Missing training data' });
  }

  const logText = Array.isArray(recentLogs) && recentLogs.length
    ? recentLogs.map(session => {
        const exList = (session.exercises || [])
          .map(ex => `  ${ex.name}: ${ex.sets}×${ex.reps} @ ${ex.weightKg}kg`)
          .join('\n');
        return `${session.date}:\n${exList || '  (no exercises)'}`;
      }).join('\n\n')
    : 'No workout data provided.';

  const bwText = Array.isArray(bodyweightHistory) && bodyweightHistory.length
    ? bodyweightHistory.map(e => `${e.date}: ${e.weight}kg`).join(', ')
    : 'No bodyweight data provided.';

  const perfText = Array.isArray(recentPerformanceScores) && recentPerformanceScores.length
    ? `Recent training performance scores (newest first): ${recentPerformanceScores.join(', ')}/10`
    : 'No performance scores available.';

  const userPrompt = [
    `Training mode: ${trainingMode || 'general'}`,
    '',
    'WORKOUT SESSIONS (last 8 weeks):',
    logText,
    '',
    `BODYWEIGHT HISTORY: ${bwText}`,
    '',
    perfText,
  ].join('\n');

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: PLATEAU_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = (message.content?.[0]?.text || '').trim();
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      // If JSON parse fails, treat as no plateau (safe default)
      return res.json({ plateauDetected: false, stall: null, duration: null, suggestion: null });
    }

    // Sanitise: ensure required shape
    return res.json({
      plateauDetected: Boolean(result.plateauDetected),
      stall: result.stall || null,
      duration: result.duration || null,
      suggestion: result.suggestion || null,
    });
  } catch (err) {
    console.error('[AI plateau-check]', err.message);
    return res.status(502).json({ error: 'AI request failed', details: err.message });
  }
});

// ── Coach Draft Message ────────────────────────────────────────────────────────

const COACH_DRAFT_SYSTEM_PROMPT = `You are drafting a weekly check-in response message on behalf of a fitness \
coach using Pocket Coach. The message will be sent directly to the athlete. \
Write in a professional but warm coaching tone — not corporate. Be specific, \
reference the actual numbers. Do not use generic encouragement. Address any \
alerts or concerns directly. Keep it under 150 words. Do not use bullet points \
— write in natural prose paragraphs. Start with the athlete's first name.`;

router.post('/coach-draft-message', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }

  const {
    clientName, archetype, currentPhase,
    compliancePercent, checkIn, bodyweightChange,
    alerts, currentProgramSummary, currentNutritionSummary, coachNotes,
  } = req.body;

  if (!clientName) {
    return res.status(400).json({ error: 'Missing required field: clientName' });
  }

  const firstName = clientName.split(' ')[0];
  const parts = [
    `Draft a check-in response for ${firstName}, a ${archetype || 'athlete'} in a ${currentPhase || 'general'} phase.`,
    `Compliance this week: ${compliancePercent ?? '?'}%.`,
  ];

  if (checkIn) {
    const { sleep, energy, stress, hunger, trainingPerformance } = checkIn;
    const metrics = [];
    if (sleep != null)              metrics.push(`sleep ${sleep}/10`);
    if (energy != null)             metrics.push(`energy ${energy}/10`);
    if (stress != null)             metrics.push(`stress ${stress}/10`);
    if (hunger != null)             metrics.push(`hunger ${hunger}/10`);
    if (trainingPerformance != null) metrics.push(`training performance ${trainingPerformance}/10`);
    if (metrics.length) parts.push(`Recovery metrics: ${metrics.join(', ')}.`);
  }

  if (bodyweightChange != null) {
    const sign = Number(bodyweightChange) >= 0 ? '+' : '';
    parts.push(`Bodyweight change this week: ${sign}${Number(bodyweightChange).toFixed(1)} kg.`);
  }

  if (Array.isArray(alerts) && alerts.length) {
    const alertText = alerts.map(a => `${a.label} (${a.reason})`).join('; ');
    parts.push(`Active alerts: ${alertText}.`);
  }

  if (currentProgramSummary) parts.push(`Current program: ${currentProgramSummary}.`);
  if (currentNutritionSummary) parts.push(`Current nutrition: ${currentNutritionSummary}.`);
  if (coachNotes)              parts.push(`Coach notes to incorporate: ${coachNotes}.`);

  const userPrompt = parts.join(' ');

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: COACH_DRAFT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const draft = message.content?.[0]?.text?.trim() || '';
    return res.json({ draft });
  } catch (err) {
    console.error('[AI coach-draft-message]', err.message);
    return res.status(502).json({ error: 'AI request failed', details: err.message });
  }
});

// ── AI Profile Summary ───────────────────────────────────────────────────────

const PROFILE_SUMMARY_SYSTEM_PROMPT = `You are an expert fitness coach inside Pocket Coach creating a personalized \
training profile summary. Based on the user's archetype, experience level, and goals, generate a concise, \
motivating profile that feels personal — not generic. \
Respond ONLY with valid JSON in this exact structure: \
{ \
  "philosophy": string (1-2 sentences — their training philosophy based on archetype), \
  "splitRecommendation": string (specific split recommendation e.g. "Push/Pull/Legs" or "Upper/Lower"), \
  "weeklyStructure": string (e.g. "4 days lifting, 2 days cardio, 1 rest"), \
  "keyFocusAreas": [string] (3-4 specific focus areas for their archetype + experience), \
  "estimatedSessionLength": string (e.g. "60-75 minutes"), \
  "coachNote": string (1-2 sentences — a personal coaching insight, reference their specific archetype and level) \
}`;

router.post('/profile-summary', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }

  const { archetype, experienceLevel, goal, daysPerWeek, sex, bodyweight, unit } = req.body;

  if (!archetype) {
    return res.status(400).json({ error: 'Missing required field: archetype' });
  }

  const parts = [
    `Generate a personalized training profile summary for:`,
    `Archetype: ${archetype}`,
    `Experience: ${experienceLevel || 'intermediate'}`,
    `Primary goal: ${goal || 'general fitness'}`,
  ];
  if (daysPerWeek) parts.push(`Available training days: ${daysPerWeek} per week`);
  if (sex) parts.push(`Sex: ${sex}`);
  if (bodyweight && unit) parts.push(`Bodyweight: ${bodyweight}${unit}`);

  const userPrompt = parts.join('\n');

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: PROFILE_SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = (message.content?.[0]?.text || '').trim();
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let profile;
    try {
      profile = JSON.parse(jsonStr);
    } catch {
      console.error('[AI profile-summary] JSON parse failed:', jsonStr.slice(0, 200));
      return res.status(502).json({ error: 'AI returned invalid JSON' });
    }

    return res.json({
      philosophy: String(profile.philosophy || ''),
      splitRecommendation: String(profile.splitRecommendation || ''),
      weeklyStructure: String(profile.weeklyStructure || ''),
      keyFocusAreas: Array.isArray(profile.keyFocusAreas) ? profile.keyFocusAreas.map(String) : [],
      estimatedSessionLength: String(profile.estimatedSessionLength || ''),
      coachNote: String(profile.coachNote || ''),
    });
  } catch (err) {
    console.error('[AI profile-summary]', err.message);
    return res.status(502).json({ error: 'AI request failed', details: err.message });
  }
});

module.exports = router;
