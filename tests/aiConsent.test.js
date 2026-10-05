const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/ai-consent.js'), 'utf8');

// Loads ai-consent.js over a fake fetch that records every request that
// actually reaches the network.
function setup({ stored = null } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  if (stored) w.localStorage.setItem('pc.aiConsent.v2', stored);
  const sent = [];
  w.fetch = async url => { sent.push(url); return { ok: true, status: 200 }; };
  w.Response = class { constructor(body, init) { this.body = body; this.status = init.status; } };
  w.showToast = () => {};
  w.eval(SRC);
  return { w, doc: w.document, sent };
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe('AI consent guard', () => {
  test('non-AI requests pass straight through', async () => {
    const { w, doc, sent } = setup();
    await w.fetch('https://api.test/api/profiles/lookup');
    expect(sent).toEqual(['https://api.test/api/profiles/lookup']);
    expect(doc.querySelector('.ai-consent-overlay')).toBeNull();
  });

  test('the first AI request waits for consent, then goes ahead', async () => {
    const { w, doc, sent } = setup();
    const pending = w.fetch('https://api.test/api/ai/coach', { method: 'POST' });
    const second = w.fetch('https://api.test/api/ai/coach/brief');
    await tick();
    expect(sent).toEqual([]);
    expect(doc.querySelectorAll('.ai-consent-overlay')).toHaveLength(1); // one sheet for both
    expect(doc.querySelector('.ai-consent-sheet').textContent).toMatch(/OpenRouter/);

    doc.querySelector('.ai-consent-agree').click();
    expect((await pending).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(sent).toEqual(['https://api.test/api/ai/coach', 'https://api.test/api/ai/coach/brief']);
    expect(w.localStorage.getItem('pc.aiConsent.v2')).toBe('granted');
    expect(doc.querySelector('.ai-consent-overlay')).toBeNull();
  });

  test('declining returns a 403 and never contacts the AI route', async () => {
    const { w, doc, sent } = setup();
    const pending = w.fetch('https://api.test/ai/chat');
    await tick();
    doc.querySelector('.ai-consent-decline').click();
    expect((await pending).status).toBe(403);
    expect((await w.fetch('https://api.test/api/ai/macro-advice')).status).toBe(403);
    expect(sent).toEqual([]);
    expect(doc.querySelector('.ai-consent-overlay')).toBeNull(); // no re-prompt
  });

  test('the settings toggle reflects and changes the stored choice', () => {
    const { w, doc, sent } = setup({ stored: 'declined' });
    doc.body.innerHTML = '<input type="checkbox" id="aiConsentToggle">';
    w.pocketCoachAIConsent.bindSettings(doc);
    const toggle = doc.getElementById('aiConsentToggle');
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new w.Event('change'));
    expect(w.localStorage.getItem('pc.aiConsent.v2')).toBe('granted');
    return w.fetch('https://api.test/api/ai/coach').then(() => {
      expect(sent).toEqual(['https://api.test/api/ai/coach']);
    });
  });
});

describe('Pro gate', () => {
  // Like setup(), but lets the fake server answer with a chosen status/body.
  function gated({ plan = null, paid = false, server = { status: 200, body: {} } } = {}) {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
    const w = dom.window;
    if (plan) w.localStorage.setItem('userPlan', plan);
    w.localStorage.setItem('pc.aiConsent.v2', 'granted');
    const sent = [];
    w.fetch = async url => {
      sent.push(url);
      const res = { ok: server.status < 400, status: server.status, json: async () => server.body };
      res.clone = () => res;
      return res;
    };
    w.Response = class { constructor(body, init) { this.body = JSON.parse(body); this.status = init.status; } };
    w.showToast = jest.fn();
    w.openUpgradeModal = jest.fn();
    w.hasPaidAccess = () => paid;
    w.eval(SRC);
    return { w, doc: w.document, sent };
  }

  test('known-free accounts are stopped before any request or consent prompt', async () => {
    const { w, doc, sent } = gated({ plan: 'free' });
    w.localStorage.removeItem('pc.aiConsent.v2');
    const res = await w.fetch('https://api.test/api/ai/coach');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('plan.upgrade_required');
    expect(sent).toEqual([]);
    expect(doc.querySelector('.ai-consent-overlay')).toBeNull();
  });

  test('background AI stays quiet; a tap opens the upgrade sheet', async () => {
    const { w, doc } = gated({ plan: 'free' });
    await w.fetch('https://api.test/api/ai/coach/brief');
    expect(w.openUpgradeModal).not.toHaveBeenCalled();
    doc.dispatchEvent(new w.Event('pointerdown'));
    await w.fetch('https://api.test/api/ai/generate-program');
    expect(w.openUpgradeModal).toHaveBeenCalledWith('pro');
    expect(w.showToast).toHaveBeenCalledWith('AI features are part of Pocket Coach Pro.');
  });

  test('paid accounts and admins go through', async () => {
    const { w, sent } = gated({ plan: 'free', paid: true });
    expect((await w.fetch('https://api.test/api/ai/coach')).status).toBe(200);
    expect(sent).toEqual(['https://api.test/api/ai/coach']);
  });

  test('an unknown plan lets the server decide', async () => {
    const { w, sent } = gated({ plan: null });
    await w.fetch('https://api.test/api/ai/coach');
    expect(sent).toHaveLength(1);
  });

  test('a server upgrade_required answer prompts the same way', async () => {
    const { w, doc } = gated({
      plan: 'pro',
      server: { status: 403, body: { success: false, error: { code: 'plan.upgrade_required' } } },
    });
    doc.dispatchEvent(new w.Event('keydown'));
    const res = await w.fetch('https://api.test/ai/chat');
    expect(res.status).toBe(403);
    expect(w.openUpgradeModal).toHaveBeenCalledWith('pro');
  });

  test('other 403s pass through untouched', async () => {
    const { w } = gated({
      plan: 'pro',
      server: { status: 403, body: { success: false, error: { code: 'auth.forbidden' } } },
    });
    const res = await w.fetch('https://api.test/api/ai/coach');
    expect(await res.json()).toEqual({ success: false, error: { code: 'auth.forbidden' } });
    expect(w.openUpgradeModal).not.toHaveBeenCalled();
  });
});

describe('AI consent after the provider change', () => {
  test('consent given to the old Anthropic wording is asked for again', async () => {
    const { w, doc, sent } = setup();
    w.localStorage.setItem('pc.aiConsent.v1', 'granted');
    const pending = w.fetch('https://api.test/api/ai/coach');
    await tick();
    expect(sent).toEqual([]);
    expect(doc.querySelector('.ai-consent-sheet').textContent).toMatch(/Ollama first[\s\S]*OpenRouter[\s\S]*may store it/);
    doc.querySelector('.ai-consent-agree').click();
    expect((await pending).status).toBe(200);
  });
});
