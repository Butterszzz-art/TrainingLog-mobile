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

module.exports = router;
