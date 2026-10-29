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

describe('Plan gate', () => {
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
  const upgrade = { status: 403, body: { success: false, error: { code: 'plan.upgrade_required' } } };
  const quota = { status: 403, body: { success: false, error: { code: 'ai.quota_exceeded', resetsAt: '2026-11-01T00:00:00Z' } } };

  test('free accounts are never blocked on the client — the server decides', async () => {
    const { w, sent } = gated({ plan: 'free' });
    const res = await w.fetch('https://api.test/api/ai/coach');
    expect(res.status).toBe(200);
    expect(sent).toEqual(['https://api.test/api/ai/coach']);
  });

  test('auto-loading AI gets the 403 back quietly: no modal, no toast', async () => {
    const { w, doc } = gated({ plan: 'free', server: upgrade });
    doc.dispatchEvent(new w.Event('pointerdown')); // e.g. a tab switch or a save tap
    const res = await w.fetch('https://api.test/api/ai/coach/brief');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('plan.upgrade_required');
    expect(w.openUpgradeModal).not.toHaveBeenCalled();
    expect(w.showToast).not.toHaveBeenCalled();
  });

  test('a tap on an AI control opens the upgrade sheet on upgrade_required', async () => {
    const { w } = gated({ plan: 'free', server: upgrade });
    w.markAiUserAction('program-generator');
    await w.fetch('https://api.test/api/ai/generate-program');
    expect(w.openUpgradeModal).toHaveBeenCalledWith('pro');
  });

  test('quota_exceeded after a tap: free → upgrade sheet, paid → toast only', async () => {
    const free = gated({ plan: 'free', server: quota });
    free.w.markAiUserAction('sleep-insight');
    await free.w.fetch('https://api.test/api/ai/sleep-insight');
    expect(free.w.openUpgradeModal).toHaveBeenCalledWith('pro');

    const paid = gated({ plan: 'pro', paid: true, server: quota });
    paid.w.markAiUserAction('sleep-insight');
    await paid.w.fetch('https://api.test/api/ai/sleep-insight');
    expect(paid.w.openUpgradeModal).not.toHaveBeenCalled();
    expect(paid.w.showToast).toHaveBeenCalledWith(expect.stringMatching(/^Monthly AI limit reached/));
  });

  test('one tap gives at most one prompt', async () => {
    const { w } = gated({ plan: 'free', server: upgrade });
    w.markAiUserAction('coach-chat');
    await w.fetch('https://api.test/api/ai/coach');
    await w.fetch('https://api.test/api/ai/coach/brief');
    expect(w.openUpgradeModal).toHaveBeenCalledTimes(1);
  });

  test('other 403s pass through untouched', async () => {
    const { w } = gated({
      plan: 'pro',
      server: { status: 403, body: { success: false, error: { code: 'auth.forbidden' } } },
    });
    w.markAiUserAction('coach-chat');
    const res = await w.fetch('https://api.test/api/ai/coach');
    expect(await res.json()).toEqual({ success: false, error: { code: 'auth.forbidden' } });
    expect(w.openUpgradeModal).not.toHaveBeenCalled();
  });
});

describe('isUserInitiatedAi timing', () => {
  afterEach(() => jest.useRealTimers());

  function load() {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
    const w = dom.window;
    w.fetch = async () => ({ ok: true, status: 200 });
    w.eval(SRC);
    return w;
  }

  test('false until an AI control is tapped', () => {
    const w = load();
    expect(w.pocketCoachAIConsent.isUserInitiatedAi()).toBe(false);
  });

  test('true within 4 s of markAiUserAction, false after', () => {
    jest.useFakeTimers({ now: new Date('2026-10-29T10:00:00Z') });
    const w = load();
    const realNow = Date.now;
    let now = realNow();
    w.Date.now = () => now;
    w.markAiUserAction('macro-advisor');
    expect(w.__pcAiAction.feature).toBe('macro-advisor');
    now += 3999;
    expect(w.pocketCoachAIConsent.isUserInitiatedAi()).toBe(true);
    now += 1;
    expect(w.pocketCoachAIConsent.isUserInitiatedAi()).toBe(false);
  });

  test('ordinary taps (pointerdown/keydown) do not count', () => {
    const w = load();
    w.document.dispatchEvent(new w.Event('pointerdown'));
    w.document.dispatchEvent(new w.Event('keydown'));
    expect(w.pocketCoachAIConsent.isUserInitiatedAi()).toBe(false);
  });
});

describe('AI consent after the provider change', () => {
  test('consent given to the old Anthropic wording is asked for again', async () => {
    const { w, doc, sent } = setup();
    w.localStorage.setItem('pc.aiConsent.v1', 'granted');
    const pending = w.fetch('https://api.test/api/ai/coach');
    await tick();
    expect(sent).toEqual([]);
    expect(doc.querySelector('.ai-consent-sheet').textContent).toMatch(/may store your requests/);
    doc.querySelector('.ai-consent-agree').click();
    expect((await pending).status).toBe(200);
  });
});
