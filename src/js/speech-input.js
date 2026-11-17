/* =============================================================
   SPEECH INPUT — speech to text for logging food by voice
   In the app: the local SpeechToText plugin (plugins/speech-to-text,
   iOS Speech framework / Android SpeechRecognizer). In a browser: the
   Web Speech API where it exists (Chrome, Safari). Elsewhere voice isn't
   offered (the keyboard's own dictation mic still works in the text box).

   window.SpeechInput:
     kind()                       'native' | 'web' | null
     supported()                  Promise<boolean>
     listen({ lang, onPartial })  Promise<string>  the words heard ('' for
                                  nothing); rejects with err.code
                                  'permission' | 'unavailable' | 'busy' | 'failed'
     stop()                       finish listening now (listen() resolves)
     listening()                  boolean
   ============================================================= */

(function (root) {
  'use strict';

  const PLUGIN = 'SpeechToText';

  function speechError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
  }

  function createSpeechInput({ win } = {}) {
    const w = win || root;
    let active = null; // { stop() }

    function cap() { return w.Capacitor || null; }

    function nativePlugin() {
      const c = cap();
      if (!c || typeof c.isNativePlatform !== 'function' || !c.isNativePlatform()) return null;
      if (typeof c.isPluginAvailable === 'function' && !c.isPluginAvailable(PLUGIN)) return null;
      return (c.Plugins && c.Plugins[PLUGIN]) || (typeof c.registerPlugin === 'function' ? c.registerPlugin(PLUGIN) : null);
    }

    function WebRecognition() {
      return w.SpeechRecognition || w.webkitSpeechRecognition || null;
    }

    function kind() {
      if (nativePlugin()) return 'native';
      if (cap() && typeof cap().isNativePlatform === 'function' && cap().isNativePlatform()) return null;
      return WebRecognition() ? 'web' : null;
    }

    async function supported() {
      const k = kind();
      if (k === 'native') {
        try { return !!(await nativePlugin().available()).available; } catch { return false; }
      }
      return k === 'web';
    }

    function defaultLang() {
      const n = w.navigator || {};
      return (n.language || (n.languages && n.languages[0]) || 'en-US');
    }

    async function listenNative({ lang, onPartial }) {
      const p = nativePlugin();
      const perm = await p.requestPermission().catch(() => ({ granted: false }));
      if (!perm || !perm.granted) throw speechError('permission', 'Microphone permission not granted');
      let handle = null;
      if (onPartial && typeof p.addListener === 'function') {
        handle = await p.addListener('partial', d => { if (d && typeof d.text === 'string') onPartial(d.text); });
      }
      active = { stop: () => p.stop().catch(() => {}) };
      try {
        const r = await p.start({ language: lang || defaultLang() });
        return String((r && r.text) || '').trim();
      } catch (e) {
        const code = e && ['permission', 'unavailable', 'busy'].includes(e.code) ? e.code : 'failed';
        throw speechError(code, e && e.message);
      } finally {
        active = null;
        if (handle && typeof handle.remove === 'function') handle.remove();
      }
    }

    function listenWeb({ lang, onPartial }) {
      const Rec = WebRecognition();
      return new Promise((resolve, reject) => {
        const rec = new Rec();
        rec.lang = lang || defaultLang();
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;
        let text = '';
        let failed = null;
        rec.onresult = (e) => {
          let all = '';
          for (let i = 0; i < e.results.length; i++) all += e.results[i][0].transcript;
          text = all.trim();
          if (onPartial) onPartial(text);
        };
        rec.onerror = (e) => {
          const err = e && e.error;
          if (err === 'not-allowed' || err === 'service-not-allowed') failed = speechError('permission', 'Microphone permission not granted');
          else if (err === 'no-speech' || err === 'aborted') failed = null;
          else failed = speechError(err === 'audio-capture' || err === 'network' ? 'unavailable' : 'failed', err);
        };
        rec.onend = () => {
          active = null;
          if (failed && !text) reject(failed);
          else resolve(text);
        };
        active = { stop: () => { try { rec.stop(); } catch { /* already stopped */ } } };
        try { rec.start(); } catch (e) { active = null; reject(speechError('busy', e && e.message)); }
      });
    }

    async function listen(opts = {}) {
      if (active) throw speechError('busy', 'Already listening');
      const k = kind();
      if (k === 'native') return listenNative(opts);
      if (k === 'web') return listenWeb(opts);
      throw speechError('unavailable', 'Speech input is not available here');
    }

    function stop() { if (active) active.stop(); }

    return { kind, supported, listen, stop, listening: () => !!active };
  }

  const api = { createSpeechInput };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpeechInput = createSpeechInput({ win: root });
})(typeof window !== 'undefined' ? window : globalThis);
