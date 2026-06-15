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

module.exports = router;
