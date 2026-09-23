/* =============================================================
   POST /api/ai/coach — the AI coach conversation endpoint
   Mounted inside src/routes/ai.js, so requireAuth + the per-user AI
   rate limiter from server.js already apply.

   Request body:
     { message, history: [{role, content}], data: <coach data pack>,
       memory: [{text}], access: {workouts: bool, ...}, style, profile }

   Response: text/event-stream. Events, each `data:` a JSON object:
     trace  {label}            a tool looked something up ("Squat · 9 sessions")
     text   {delta}            reply text as it streams
     chart  {kind, ...}        data for an inline chart
     card   {type, ...}        a proposal the athlete can Apply
     memory {text}             a fact to add to the athlete's coach memory
     done   {}                 reply finished
     error  {message}          reply failed; show message
   ============================================================= */

'use strict';

const express = require('express');
const {
  Anthropic, provider, isConfigured, getClient, modelChain, markGood, isRetryable, perModelTimeoutMs,
  createMessage, anthropicOnlyParams, MalformedReply,
} = require('../coach/client');
const { TOOL_DEFS, runTool } = require('../coach/tools');
const { COACH_INSTRUCTIONS, athleteContext } = require('../coach/prompt');

const router = express.Router();

const COACH_MODEL = process.env.COACH_MODEL || 'claude-opus-5';
const COACH_EFFORT = process.env.COACH_EFFORT || 'medium';
const MAX_TOOL_ROUNDS = 8;
const MAX_HISTORY = 20;
const CHAIN_RETRY_PAUSE_MS = Number(process.env.COACH_CHAIN_RETRY_PAUSE_MS) || 5000;

// Tool inputs here are tiny, but eager streaming keeps tool calls from
// arriving in one late burst; runTool() validates every input itself.
const TOOLS = TOOL_DEFS.map(t => ({ ...t, eager_input_streaming: true }));

function cleanHistory(history) {
  const out = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

router.post('/', async (req, res) => {
  if (!isConfigured()) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }

  const { message, history, data, memory, access, style, profile } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  const pack = data && typeof data === 'object' ? data : {};

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop proxies (Render/nginx) buffering the stream
  });
  res.flushHeaders();

  const send = (event, payload) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  let activeStream = null;
  let clientGone = false;
  res.on('close', () => {
    clientGone = !res.writableEnded;
    if (clientGone && activeStream) activeStream.abort();
  });

  const system = [
    { type: 'text', text: COACH_INSTRUCTIONS },
    {
      type: 'text',
      text: athleteContext({
        profile: profile || pack.profile || {},
        memory,
        access,
        style,
        today: String(pack.generatedAt || new Date().toISOString()).slice(0, 10),
      }),
    },
  ];

  const messages = [...cleanHistory(history), { role: 'user', content: message.slice(0, 4000) }];
  let wroteText = false;
  let jsonRetries = 0;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS && !clientGone; round++) {
      // One model at a time from the chain (just COACH_MODEL on the Anthropic
      // API; several free models on OpenRouter). A rate-limited or overloaded
      // model is skipped — but only before any text reached the athlete, or
      // the reply would repeat itself.
      // Free models are often rate-limited for a few seconds ("retry shortly"),
      // so after the whole chain fails, pause and go round once more.
      const chain = modelChain(COACH_MODEL);
      const models = provider() === 'openrouter' ? [...chain, null, ...chain] : chain;
      let modelIndex = 0;
      let startedTextThisRound = false;
      let reply;

      for (;;) {
        if (models[modelIndex] === null) {
          await new Promise(r => setTimeout(r, CHAIN_RETRY_PAUSE_MS));
          if (clientGone) throw new Error('client gone');
          modelIndex++;
        }
        const model = models[modelIndex];
        activeStream = getClient().beta.messages.stream({
          model,
          max_tokens: 16000,
          ...anthropicOnlyParams(),
          output_config: { effort: COACH_EFFORT },
          cache_control: { type: 'ephemeral' },
          system,
          tools: TOOLS,
          messages,
        });

        // Watchdog: a model that goes quiet (queued free model, stalled
        // upstream) is abandoned and, if nothing streamed yet, the next tried.
        let stalled = false;
        let idleTimer = null;
        const stream = activeStream;
        const arm = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => { stalled = true; stream.abort(); }, perModelTimeoutMs(30000));
        };
        activeStream.on('streamEvent', arm);
        arm();

        activeStream.on('text', delta => {
          // Some providers stream empty chunks before stalling; only real text
          // commits this round to the current model.
          if (!delta) return;
          // Text from a later round is a new paragraph after the tool lookups.
          if (!startedTextThisRound && wroteText) send('text', { delta: '\n\n' });
          startedTextThisRound = true;
          wroteText = true;
          send('text', { delta });
        });

        try {
          reply = await activeStream.finalMessage();
          if (!Array.isArray(reply && reply.content)) throw new MalformedReply(model);
          markGood(model);
          jsonRetries = 0;
          break;
        } catch (err) {
          if (clientGone) throw err;
          if ((stalled || isRetryable(err) || err instanceof MalformedReply) && !startedTextThisRound && modelIndex < models.length - 1) {
            modelIndex++;
            continue;
          }
          if (stalled) throw new Error('Every model timed out.');
          // Otherwise only an unparseable streamed tool input is worth re-issuing.
          if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        } finally {
          clearTimeout(idleTimer);
        }
      }

      if (reply.stop_reason === 'refusal') {
        send('error', { message: "I can't help with that one. Try asking another way." });
        return res.end();
      }

      const toolUses = reply.content.filter(b => b.type === 'tool_use');
      if (!toolUses.length) break; // end_turn, or max_tokens on a plain answer

      if (reply.stop_reason === 'max_tokens') {
        throw new Error('Reply was cut off mid tool call.');
      }

      messages.push({ role: 'assistant', content: reply.content });

      const results = toolUses.map(tu => {
        const out = runTool(tu.name, tu.input, pack);
        if (out.trace) send('trace', { label: out.trace });
        if (out.chart) send('chart', out.chart);
        if (out.card) send('card', out.card);
        if (out.memory) send('memory', { text: out.memory });
        return {
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(out.result),
          ...(out.isError ? { is_error: true } : {}),
        };
      });
      messages.push({ role: 'user', content: results });

      if (round === MAX_TOOL_ROUNDS - 1) {
        send('text', { delta: (wroteText ? '\n\n' : '') + "I looked at a lot of data there. Ask me again more specifically and I'll give you a straight answer." });
      }
    }

    send('done', {});
    return res.end();
  } catch (err) {
    if (clientGone) return undefined;
    console.error('[AI coach]', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err.message);
    let msg = 'The coach hit a problem. Try again in a moment.';
    if (err instanceof Anthropic.RateLimitError) msg = 'The coach is busy right now (the free AI allowance may be used up for today). Try again later.';
    else if (err instanceof Anthropic.AuthenticationError) msg = 'The coach is not set up correctly on the server.';
    else if (err instanceof Anthropic.APIError && err.status === 402) msg = "The coach's AI account is out of credits. Try again later.";
    send('error', { message: msg });
    return res.end();
  }
});

// ── POST /api/ai/coach/brief — Home "Today's brief" ──────────────────────────
// Body: { data, memory, style, today: { session, restDay } }
// Returns { digest, headline, bullets, source: 'ai' | 'rules' }. The digest
// is computed by the same rules the phone uses offline; Claude only rewords
// it, so a failed or malformed AI reply still yields a usable brief.

const { buildBriefDigest } = require('../js/coach-data');

const BRIEF_MODEL = process.env.COACH_BRIEF_MODEL || COACH_MODEL;

const BRIEF_INSTRUCTIONS = `You write the morning brief on the Home screen of Pocket Coach, a training app. The athlete glances at it for five seconds.

You get a JSON digest computed from their log. Write:
- headline: one or two short sentences (max 30 words). Say what today is for (the planned session, or rest) and the single most useful adjustment, if any. Name the session exactly as given.
- bullets: up to 3 short lines (max 70 characters each), each restating one entry from "signals" in plain words, keeping its tone. Keep the numbers exactly as given; don't add numbers or facts that aren't in the digest.

Never mention the readiness score number or the word "digest". No greetings, no emoji, no exclamation marks.

Reply with only a JSON object, no other text: {"headline": string, "bullets": [{"text": string, "tone": "good" | "watch" | "info"}]}`;

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    bullets: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, tone: { type: 'string', enum: ['good', 'watch', 'info'] } },
        required: ['text', 'tone'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'bullets'],
  additionalProperties: false,
};

// Structured outputs guarantee the shape on the Anthropic API; through other
// providers it's best-effort, so parse defensively either way.
function parseBrief(text) {
  const raw = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj;
  try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  const headline = typeof obj.headline === 'string' ? obj.headline.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  if (!headline) return null;
  const bullets = (Array.isArray(obj.bullets) ? obj.bullets : [])
    .filter(b => b && typeof b.text === 'string' && b.text.trim())
    .slice(0, 3)
    .map(b => ({ text: b.text.trim().slice(0, 90), tone: ['good', 'watch', 'info'].includes(b.tone) ? b.tone : 'info' }));
  return { headline, bullets };
}

router.post('/brief', async (req, res) => {
  if (!isConfigured()) {
    return res.status(404).json({ error: 'AI_NOT_CONFIGURED' });
  }
  const { data, memory, style, today } = req.body || {};
  const pack = data && typeof data === 'object' ? data : {};
  const digest = buildBriefDigest(pack, {
    session: today && typeof today.session === 'string' ? today.session.slice(0, 60) : null,
    restDay: Boolean(today && today.restDay),
  });
  const rules = { digest, headline: digest.headline, bullets: digest.bullets, source: 'rules' };
  if (!digest.hasData) return res.json(rules);

  const facts = {
    date: digest.date,
    plannedSession: digest.session,
    restDay: digest.restDay,
    readiness: digest.readiness && digest.readiness.label,
    signals: digest.signals,
    needsAttention: digest.flag && digest.flag.text,
  };

  try {
    const reply = await createMessage(BRIEF_MODEL, {
      max_tokens: 2000,
      // Strict JSON is guaranteed on the Anthropic API; other providers get the
      // same shape from the instructions and parseBrief() checks it.
      output_config: provider() === 'anthropic'
        ? { effort: 'low', format: { type: 'json_schema', schema: BRIEF_SCHEMA } }
        : { effort: 'low' },
      system: [
        { type: 'text', text: BRIEF_INSTRUCTIONS },
        { type: 'text', text: athleteContext({ profile: pack.profile || {}, memory, style, today: digest.date }) },
      ],
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
    }, { timeoutMs: perModelTimeoutMs(20000) });
    if (reply.stop_reason === 'refusal') return res.json(rules);
    const text = reply.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const brief = parseBrief(text);
    if (!brief) return res.json(rules);
    return res.json({ digest, headline: brief.headline, bullets: brief.bullets.length ? brief.bullets : digest.bullets, source: 'ai' });
  } catch (err) {
    console.error('[AI brief]', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err.message);
    return res.json({ ...rules, aiError: err instanceof Anthropic.APIError ? err.status : 'failed' });
  }
});

router.parseBrief = parseBrief;
module.exports = router;
