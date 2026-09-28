const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/ai-consent.js'), 'utf8');

// Loads ai-consent.js over a fake fetch that records every request that
// actually reaches the network.
function setup({ stored = null } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  if (stored) w.localStorage.setItem('pc.aiConsent.v1', stored);
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
    expect(doc.querySelector('.ai-consent-sheet').textContent).toMatch(/Anthropic/);

    doc.querySelector('.ai-consent-agree').click();
    expect((await pending).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(sent).toEqual(['https://api.test/api/ai/coach', 'https://api.test/api/ai/coach/brief']);
    expect(w.localStorage.getItem('pc.aiConsent.v1')).toBe('granted');
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
    expect(w.localStorage.getItem('pc.aiConsent.v1')).toBe('granted');
    return w.fetch('https://api.test/api/ai/coach').then(() => {
      expect(sent).toEqual(['https://api.test/api/ai/coach']);
    });
  });
});
