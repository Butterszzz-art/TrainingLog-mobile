/**
 * @jest-environment node
 */
// POST /api/ai/coach with the Anthropic SDK mocked: checks the SSE protocol,
// that tool calls run against the posted data pack, and that tool results
// are threaded back into the next request.

process.env.COACH_CHAIN_RETRY_PAUSE_MS = '10';
const mockCalls = [];
let mockScript = [];

jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class APIConnectionError extends APIError {}
  function Anthropic() {
    this.messages = {
      async create(params) {
        mockCalls.push(JSON.parse(JSON.stringify(params)));
        const step = mockScript.shift();
        if (step.throw) throw step.throw;
        return step.message;
      },
    };
    this.beta = {
      messages: {
        stream(params) {
          mockCalls.push(JSON.parse(JSON.stringify(params)));
          const step = mockScript.shift();
          const handlers = {};
          return {
            on(evt, fn) { handlers[evt] = fn; return this; },
            abort() {},
            async finalMessage() {
              if (step.throw) throw step.throw;
              (step.text || []).forEach(t => handlers.text && handlers.text(t));
              return step.message;
            },
          };
        },
      },
    };
  }
  Anthropic.APIError = APIError;
  Anthropic.RateLimitError = RateLimitError;
  Anthropic.AuthenticationError = AuthenticationError;
  Anthropic.APIConnectionError = APIConnectionError;
  Anthropic.mockRateLimit = () => Object.assign(new RateLimitError('busy'), { status: 429 });
  return Anthropic;
});

const express = require('express');
const coachRouter = require('../src/routes/coach');

function parseSSE(body) {
  return body.split('\n\n').filter(Boolean).map(frame => {
    const type = /event: (.*)/.exec(frame)[1];
    const data = JSON.parse(/data: (.*)/.exec(frame)[1]);
    return { type, data };
  });
}

describe('POST /api/ai/coach', () => {
  let server;
  let base;

  beforeAll(done => {
    process.env.ANTHROPIC_API_KEY = 'test';
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/coach', coachRouter);
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}/coach`;
      done();
    });
  });
  afterAll(done => { server.closeAllConnections(); server.close(done); });
  beforeEach(() => { mockCalls.length = 0; });

  const pack = {
    generatedAt: '2026-09-23T07:00:00.000Z',
    workouts: [
      { date: '2026-09-09', title: 'Legs A', exercises: [{ name: 'Back Squat', sets: [{ w: 120, r: 5 }] }] },
      { date: '2026-09-16', title: 'Legs A', exercises: [{ name: 'Back Squat', sets: [{ w: 120, r: 5 }] }] },
    ],
    program: { id: 'p1', name: 'PPL', days: [{ name: 'Legs A', exercises: [{ name: 'Back Squat', sets: [{ reps: 5, weight: 120 }] }] }] },
  };

  test('runs a tool round then streams the answer', async () => {
    mockScript = [
      {
        text: ['Let me check.'],
        message: {
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 't1', name: 'get_exercise_history', input: { exercise: 'squat' } },
            { type: 'tool_use', id: 't2', name: 'propose_program_change', input: {
              title: 'Restart squat', day: 'Legs A', rationale: 'Flat for 2 weeks.',
              changes: [{ op: 'set_sets', exercise: 'Back Squat', sets: [{ reps: 3, weight: 125 }] }],
            } },
            { type: 'tool_use', id: 't3', name: 'remember', input: { fact: 'Trains at 6am' } },
          ],
        },
      },
      { text: ['Your squat is ', '**flat**.'], message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Your squat is **flat**.' }] } },
    ];

    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Why has my squat stalled?',
        history: [{ role: 'assistant', content: 'orphan' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
        data: pack,
        memory: [{ text: 'Hates lunges' }],
        access: { recovery: false },
        style: 'balanced',
      }),
    });
    expect(res.headers.get('content-type')).toMatch('text/event-stream');
    const events = parseSSE(await res.text());
    const types = events.map(e => e.type);

    expect(types[types.length - 1]).toBe('done');
    expect(events.filter(e => e.type === 'trace').map(e => e.data.label)).toEqual(['Back Squat · 2 sessions']);
    expect(events.find(e => e.type === 'card').data).toMatchObject({ type: 'program_change', day: 'Legs A' });
    expect(events.find(e => e.type === 'memory').data.text).toBe('Trains at 6am');
    expect(events.find(e => e.type === 'chart').data.kind).toBe('e1rm');
    const text = events.filter(e => e.type === 'text').map(e => e.data.delta).join('');
    expect(text).toBe('Let me check.\n\nYour squat is **flat**.');

    // First request: cleaned history (leading assistant dropped), then the question.
    expect(mockCalls[0].messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(mockCalls[0].system[1].text).toMatch('Hates lunges');
    expect(mockCalls[0].system[1].text).toMatch('recovery');
    expect(mockCalls[0].tools.every(t => t.eager_input_streaming)).toBe(true);
    // Second request carries all three tool results in one user message.
    const last = mockCalls[1].messages[mockCalls[1].messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content.map(c => c.tool_use_id)).toEqual(['t1', 't2', 't3']);
    expect(JSON.parse(last.content[0].content).sessionsLogged).toBe(2);
  });

  test('refusal ends with an error event', async () => {
    mockScript = [{ message: { stop_reason: 'refusal', content: [] } }];
    const res = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'x', data: pack }),
    });
    const events = parseSSE(await res.text());
    expect(events.map(e => e.type)).toEqual(['error']);
  });

  test('rejects an empty message before streaming', async () => {
    const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(400);
  });

  const briefPack = {
    generatedAt: '2026-09-23T07:00:00.000Z',
    sleep: [{ date: '2026-09-22', hours: 5.5 }],
  };

  test('brief: AI wording comes back when the reply parses', async () => {
    mockScript = [{ message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"headline":"Push B today, keep it at RPE 8.","bullets":[{"text":"Sleep 5.5 h last night","tone":"watch"}]}' }] } }];
    const res = await fetch(base + '/brief', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: briefPack, today: { session: 'Push B' } }),
    });
    const body = await res.json();
    expect(body.source).toBe('ai');
    expect(body.headline).toBe('Push B today, keep it at RPE 8.');
    expect(body.digest.readiness.score).toBeLessThan(70);
    expect(JSON.parse(mockCalls[0].messages[0].content)).toMatchObject({ plannedSession: 'Push B' });
    expect(mockCalls[0].output_config.format.type).toBe('json_schema');
  });

  test('brief: malformed or failed AI falls back to the rules brief', async () => {
    mockScript = [{ message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sure! Here you go.' }] } }];
    let body = await (await fetch(base + '/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: briefPack }) })).json();
    expect(body.source).toBe('rules');
    expect(body.headline).toBe(body.digest.headline);

    mockScript = [{ throw: new Error('network down') }];
    body = await (await fetch(base + '/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: briefPack }) })).json();
    expect(body).toMatchObject({ source: 'rules', aiError: 'failed' });
  });

  test('OpenRouter: a fully rate-limited chain is retried once after a pause', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const saved = { a: process.env.ANTHROPIC_API_KEY, m: process.env.OPENROUTER_MODELS };
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.OPENROUTER_MODELS = 'a/1:free,b/2:free';
    try {
      mockScript = [
        { throw: Anthropic.mockRateLimit() },
        { throw: Anthropic.mockRateLimit() },
        { text: ['Back on track.'], message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Back on track.' }] } },
      ];
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi', data: pack }) });
      const events = parseSSE(await res.text());
      expect(mockCalls.map(c => c.model)).toEqual(['a/1:free', 'b/2:free', 'a/1:free']);
      expect(mockCalls[0]).not.toHaveProperty('fallbacks');
      expect(events.map(e => e.type)).toEqual(['text', 'done']);
    } finally {
      process.env.ANTHROPIC_API_KEY = saved.a;
      delete process.env.OPENROUTER_API_KEY;
      if (saved.m === undefined) delete process.env.OPENROUTER_MODELS; else process.env.OPENROUTER_MODELS = saved.m;
    }
  });
});
