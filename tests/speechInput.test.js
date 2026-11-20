const { createSpeechInput } = require('../src/js/speech-input');

// A fake native SpeechToText plugin (plugins/speech-to-text).
function nativeWin({ available = true, granted = true, result = { text: ' two eggs and toast ' }, startError = null } = {}) {
  const listeners = {};
  const calls = [];
  const plugin = {
    available: async () => ({ available }),
    requestPermission: async () => { calls.push('perm'); return { granted }; },
    addListener: async (ev, fn) => { listeners[ev] = fn; return { remove: () => { delete listeners[ev]; } }; },
    start: async (opts) => {
      calls.push(['start', opts]);
      if (startError) throw startError;
      listeners.partial && listeners.partial({ text: 'two eggs' });
      return result;
    },
    stop: async () => { calls.push('stop'); },
  };
  return {
    calls, listeners,
    win: {
      navigator: { language: 'nl-NL' },
      Capacitor: { isNativePlatform: () => true, isPluginAvailable: n => n === 'SpeechToText', Plugins: { SpeechToText: plugin } },
    },
  };
}

// A fake Web Speech API recogniser.
function webWin(script) {
  class Rec {
    start() {
      Rec.last = this;
      setTimeout(() => script(this), 0);
    }
    stop() { this.stopped = true; this.onend && this.onend(); }
  }
  const results = (...parts) => ({ results: parts.map(t => [{ transcript: t }]) });
  return { win: { navigator: { language: 'en-GB' }, webkitSpeechRecognition: Rec }, Rec, results };
}

describe('speech input: native plugin', () => {
  test('kind and supported', async () => {
    const { win } = nativeWin();
    const si = createSpeechInput({ win });
    expect(si.kind()).toBe('native');
    expect(await si.supported()).toBe(true);
    expect(await createSpeechInput(nativeWin({ available: false })).supported()).toBe(false);
  });

  test('asks permission, streams partial text, returns the trimmed result', async () => {
    const n = nativeWin();
    const si = createSpeechInput({ win: n.win });
    const partials = [];
    const text = await si.listen({ onPartial: t => partials.push(t) });
    expect(text).toBe('two eggs and toast');
    expect(partials).toEqual(['two eggs']);
    expect(n.calls[0]).toBe('perm');
    expect(n.calls[1]).toEqual(['start', { language: 'nl-NL' }]);
    expect(n.listeners.partial).toBeUndefined(); // listener removed afterwards
    expect(si.listening()).toBe(false);
  });

  test('permission refused → permission error, nothing started', async () => {
    const n = nativeWin({ granted: false });
    await expect(createSpeechInput({ win: n.win }).listen()).rejects.toMatchObject({ code: 'permission' });
    expect(n.calls.some(c => Array.isArray(c) && c[0] === 'start')).toBe(false);
  });

  test('plugin errors keep known codes, others become failed', async () => {
    const busy = Object.assign(new Error('x'), { code: 'busy' });
    await expect(createSpeechInput(nativeWin({ startError: busy })).listen()).rejects.toMatchObject({ code: 'busy' });
    await expect(createSpeechInput(nativeWin({ startError: new Error('boom') })).listen()).rejects.toMatchObject({ code: 'failed' });
  });

  test('no plugin in the native app → not offered (no web fallback there)', () => {
    const win = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false }, webkitSpeechRecognition: function () {} };
    expect(createSpeechInput({ win }).kind()).toBe(null);
  });
});

describe('speech input: Web Speech API', () => {
  test('interim results stream, final text resolves', async () => {
    const w = webWin(rec => {
      rec.onresult(w.results('2 eggs'));
      rec.onresult(w.results('2 eggs', ' and toast'));
      rec.onend();
    });
    const si = createSpeechInput({ win: w.win });
    expect(si.kind()).toBe('web');
    const partials = [];
    const text = await si.listen({ onPartial: t => partials.push(t) });
    expect(text).toBe('2 eggs and toast');
    expect(partials).toEqual(['2 eggs', '2 eggs and toast']);
    expect(w.Rec.last.lang).toBe('en-GB');
    expect(w.Rec.last.interimResults).toBe(true);
  });

  test('no speech → empty text, not an error', async () => {
    const w = webWin(rec => { rec.onerror({ error: 'no-speech' }); rec.onend(); });
    expect(await createSpeechInput({ win: w.win }).listen()).toBe('');
  });

  test('blocked microphone → permission error', async () => {
    const w = webWin(rec => { rec.onerror({ error: 'not-allowed' }); rec.onend(); });
    await expect(createSpeechInput({ win: w.win }).listen()).rejects.toMatchObject({ code: 'permission' });
  });

  test('stop() ends listening; a second listen while busy is refused', async () => {
    const w = webWin(rec => { rec.onresult(w.results('banana')); });
    const si = createSpeechInput({ win: w.win });
    const p = si.listen();
    await expect(si.listen()).rejects.toMatchObject({ code: 'busy' });
    await new Promise(r => setTimeout(r, 5));
    si.stop();
    expect(await p).toBe('banana');
    expect(si.listening()).toBe(false);
  });

  test('nothing available → unavailable', async () => {
    const si = createSpeechInput({ win: { navigator: {} } });
    expect(si.kind()).toBe(null);
    expect(await si.supported()).toBe(false);
    await expect(si.listen()).rejects.toMatchObject({ code: 'unavailable' });
  });
});
