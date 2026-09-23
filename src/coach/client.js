/* =============================================================
   AI provider — one place that decides which model API the server uses.

   ANTHROPIC_API_KEY set   → Anthropic API directly.
   OPENROUTER_API_KEY set  → the same Anthropic SDK pointed at
                             OpenRouter's Anthropic-compatible endpoint,
                             using free models by default (see
                             OPENROUTER_FREE_MODELS / OPENROUTER_MODELS).
   Neither                 → AI features answer 404 AI_NOT_CONFIGURED.

   Keys live in .env (gitignored) locally and in Render env vars in
   production — never in .env.development, which is committed.
   ============================================================= */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

function provider() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  return null;
}

function isConfigured() {
  return provider() !== null;
}

let cached = null;
function getClient() {
  const p = provider();
  if (!p) throw new Error('AI_NOT_CONFIGURED');
  if (cached && cached.provider === p) return cached.client;
  const client = p === 'openrouter'
    // maxRetries 0: on a rate limit, moving to the next model in the chain is
    // faster than backing off, and doesn't spend the free daily allowance.
    ? new Anthropic({ baseURL: OPENROUTER_BASE_URL, apiKey: null, authToken: process.env.OPENROUTER_API_KEY, maxRetries: 0 })
    : new Anthropic();
  cached = { provider: p, client };
  return client;
}

/**
 * Claude model id in OpenRouter's naming: "claude-haiku-4-5" →
 * "anthropic/claude-haiku-4.5". Only used when OPENROUTER_MODELS asks for
 * Claude (paid) models by their Anthropic ids.
 */
function openRouterSlug(id) {
  if (id.includes('/')) return id;
  const bare = id.replace(/-\d{8}$/, '');               // drop a date snapshot suffix
  return `anthropic/${bare.replace(/-(\d+)-(\d+)$/, '-$1.$2')}`;
}

// OpenRouter's free models (":free" — no credits needed; the account gets 50
// free requests/day, 1000/day once it has bought $10 of credits). Free
// providers rate-limit and overload often, so calls walk this list until one
// answers. All of these support tool calling. Override with OPENROUTER_MODELS
// (comma-separated), e.g. "anthropic/claude-opus-5" once the account has credits.
const OPENROUTER_FREE_MODELS = [
  'nex-agi/nex-n2.5-pro:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-31b-it:free',
];

/** Models to try, in order, for a call that would use Anthropic model `id`. */
function modelChain(id) {
  if (provider() !== 'openrouter') return [id];
  const configured = (process.env.OPENROUTER_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  const chain = (configured.length ? configured : OPENROUTER_FREE_MODELS).map(openRouterSlug);
  // Start from whichever model answered last, so a model that's rate-limited
  // right now isn't hit first on every request.
  const i = chain.indexOf(lastGood);
  return i > 0 ? [...chain.slice(i), ...chain.slice(0, i)] : chain;
}

/** First model of the chain — for single-shot calls that don't need fallback. */
function modelId(id) {
  return modelChain(id)[0];
}

/** A provider answered 200 but without a Messages-shaped body — try the next model. */
class MalformedReply extends Error {
  constructor(model) { super(`${model} returned a reply without content`); this.name = 'MalformedReply'; }
}

let lastGood = null;
function markGood(model) { lastGood = model; }

/** Worth trying the next model: rate limit, overload, upstream/server error, network. */
function isRetryable(err) {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (!(err instanceof Anthropic.APIError)) return false;
  return err.status === undefined || err.status === 429 || err.status === 408 || err.status >= 500;
}

/**
 * How long one model may take before the next in the chain is tried. Free
 * OpenRouter models can sit in a queue for minutes; the Anthropic API gets a
 * generous ceiling instead.
 */
function perModelTimeoutMs(openRouterMs) {
  return provider() === 'openrouter' ? openRouterMs : 120000;
}

/**
 * messages.create across the model chain. `base` is the Anthropic model id
 * the call would use on the Anthropic API. A model that errors retryably or
 * takes longer than `timeoutMs` is skipped. Throws the last error if every
 * model fails.
 */
async function createMessage(base, params, { timeoutMs, retryPauseMs = 5000 } = {}) {
  // Free models are often rate-limited for a few seconds ("retry shortly"):
  // after the whole chain fails, pause and go round once more.
  const chain = modelChain(base);
  const attempts = provider() === 'openrouter' && retryPauseMs > 0 ? [...chain, null, ...chain] : chain;
  let lastErr;
  for (const model of attempts) {
    if (model === null) { await new Promise(r => setTimeout(r, retryPauseMs)); continue; }
    const ctrl = timeoutMs ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const reply = await getClient().messages.create({ ...params, model }, ctrl ? { signal: ctrl.signal } : undefined);
      if (!Array.isArray(reply && reply.content)) throw new MalformedReply(model);
      markGood(model);
      return reply;
    } catch (err) {
      lastErr = err;
      const timedOut = Boolean(ctrl && ctrl.signal.aborted);
      if (!timedOut && !isRetryable(err) && !(err instanceof MalformedReply)) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Request fields that only the Anthropic API itself accepts. Server-side
 * refusal fallbacks are a Claude API feature; OpenRouter does its own routing.
 */
function anthropicOnlyParams() {
  if (provider() !== 'anthropic') return {};
  return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
}

module.exports = {
  provider, isConfigured, getClient, modelId, modelChain, markGood, isRetryable, perModelTimeoutMs,
  createMessage, anthropicOnlyParams, Anthropic, OPENROUTER_FREE_MODELS, MalformedReply,
};
