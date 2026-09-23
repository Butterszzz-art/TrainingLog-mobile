/**
 * @jest-environment node
 */
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; jest.resetModules(); });

function load(env) {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODELS;
  Object.assign(process.env, env);
  return require('../src/coach/client');
}

test('Anthropic key wins: Anthropic model ids and server-side fallbacks', () => {
  const c = load({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'o' });
  expect(c.provider()).toBe('anthropic');
  expect(c.modelChain('claude-opus-5')).toEqual(['claude-opus-5']);
  expect(c.anthropicOnlyParams()).toEqual({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
});

test('OpenRouter defaults to the free model chain, no retries, no Anthropic-only params', () => {
  const c = load({ OPENROUTER_API_KEY: 'o' });
  expect(c.provider()).toBe('openrouter');
  expect(c.modelChain('claude-opus-5')).toEqual(c.OPENROUTER_FREE_MODELS);
  expect(c.OPENROUTER_FREE_MODELS.every(m => m.endsWith(':free'))).toBe(true);
  expect(c.anthropicOnlyParams()).toEqual({});
  const client = c.getClient();
  expect(client.baseURL).toBe('https://openrouter.ai/api');
  expect(client.maxRetries).toBe(0);
});

test('OPENROUTER_MODELS overrides the chain; Claude ids map to OpenRouter slugs', () => {
  const c = load({ OPENROUTER_API_KEY: 'o', OPENROUTER_MODELS: 'claude-opus-5, claude-haiku-4-5-20251001 ,x/y:free' });
  expect(c.modelChain('anything')).toEqual(['anthropic/claude-opus-5', 'anthropic/claude-haiku-4.5', 'x/y:free']);
});

test('the chain starts from the last model that answered', () => {
  const c = load({ OPENROUTER_API_KEY: 'o', OPENROUTER_MODELS: 'a/1,b/2,c/3' });
  c.markGood('b/2');
  expect(c.modelChain('x')).toEqual(['b/2', 'c/3', 'a/1']);
});

test('createMessage skips rate-limited models and stops on a real error', async () => {
  const c = load({ OPENROUTER_API_KEY: 'o', OPENROUTER_MODELS: 'a/1,b/2,c/3' });
  const client = c.getClient();
  const tried = [];
  const rateLimited = new c.Anthropic.RateLimitError(429, { error: {} }, 'busy', new Headers());
  client.messages.create = async ({ model }) => {
    tried.push(model);
    if (model === 'a/1') throw rateLimited;
    return { model, content: [] };
  };
  expect((await c.createMessage('x', {})).model).toBe('b/2');
  expect(tried).toEqual(['a/1', 'b/2']);

  const bad = new c.Anthropic.BadRequestError(400, { error: {} }, 'bad', new Headers());
  client.messages.create = async () => { throw bad; };
  await expect(c.createMessage('x', {})).rejects.toBe(bad);
});

test('a 200 reply without content counts as a failed model', async () => {
  const c = load({ OPENROUTER_API_KEY: 'o', OPENROUTER_MODELS: 'a/1,b/2' });
  const client = c.getClient();
  client.messages.create = async ({ model }) => (model === 'a/1' ? { error: 'upstream' } : { model, content: [] });
  expect((await c.createMessage('x', {})).model).toBe('b/2');
});

test('no key → not configured', () => {
  const c = load({});
  expect(c.isConfigured()).toBe(false);
  expect(() => c.getClient()).toThrow('AI_NOT_CONFIGURED');
});
