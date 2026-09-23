/* =============================================================
   HOME — "Today's brief" card (#coachBriefCard)
   Renders instantly from on-device rules (CoachData.buildBriefDigest),
   then swaps in Claude's wording from POST /api/ai/coach/brief. The AI
   version is cached per day and per set of facts, so re-rendering Home
   doesn't re-bill; new data (a check-in, last night's sleep) refreshes it.
   Taps hand off to the coach panel (window.openAiCoach).
   ============================================================= */
(function () {
  'use strict';

  const CACHE_KEY = u => `coachBrief_${u}`;
  const MAX_AI_CALLS_PER_DAY = 4;
  let inflight = null;

  function user() {
    return window.currentUser || localStorage.getItem('fitnessAppUser') || localStorage.getItem('currentUser');
  }

  function readCache(u) {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY(u))) || null; } catch { return null; }
  }
  function writeCache(u, v) {
    try { localStorage.setItem(CACHE_KEY(u), JSON.stringify(v)); } catch { /* quota */ }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function todayPlan(u) {
    const session = typeof window.getTodayWorkoutName === 'function' ? window.getTodayWorkoutName() : null;
    const hasProgram = Boolean(window.CoachData.resolveProgram(localStorage, u));
    return { session, restDay: hasProgram && !session };
  }

  // Changes whenever the facts behind the brief change.
  function fingerprint(digest) {
    return [digest.date, digest.session || '', digest.restDay ? 'r' : '', digest.readiness ? digest.readiness.score : '',
      digest.signals.map(s => s.text).join('|'), digest.flag ? digest.flag.text : ''].join('~');
  }

  function ring(readiness) {
    if (!readiness) return '';
    const C = 2 * Math.PI * 36;
    const filled = (readiness.score / 100) * C;
    return `
      <div class="cbr-ring" role="img" aria-label="Readiness: ${esc(readiness.label)}">
        <svg viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r="36" class="cbr-ring-track"/>
          <circle cx="42" cy="42" r="36" class="cbr-ring-fill cbr-ring-fill--${readiness.score >= 55 ? 'ok' : 'low'}"
            stroke-dasharray="${filled.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 42 42)"/>
        </svg>
        <div class="cbr-ring-label"><span class="cbr-ring-num">${readiness.score}</span><span class="cbr-ring-word">${esc(readiness.short)}</span></div>
      </div>`;
  }

  function render(el, view) {
    const { digest, headline, bullets, source, updatedAt } = view;
    const session = digest.session;
    const stamp = source === 'ai' && updatedAt
      ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : (view.loading ? 'Updating…' : '');

    const primary = session
      ? `<button type="button" class="cbr-btn cbr-btn--primary" data-cbr="start">Start ${esc(session)}</button>
         <button type="button" class="cbr-btn cbr-btn--ghost" data-cbr="adjust">Adjust session</button>`
      : `<button type="button" class="cbr-btn cbr-btn--ghost cbr-btn--wide" data-cbr="ask-day">${digest.restDay ? 'Plan my rest day' : 'Ask what to do today'}</button>`;

    el.innerHTML = `
      <section class="cbr-card" aria-labelledby="cbrTitle">
        <div class="cbr-head">
          <h2 id="cbrTitle" class="cbr-kicker">Today's brief</h2>
          <span class="cbr-stamp">${esc(stamp)}</span>
        </div>
        <div class="cbr-main">
          ${ring(digest.readiness)}
          <p class="cbr-headline">${esc(headline)}</p>
        </div>
        ${bullets.length ? `<ul class="cbr-bullets">${bullets.map(b =>
          `<li><span class="cbr-dot cbr-dot--${esc(b.tone)}" aria-hidden="true"></span>${esc(b.text)}</li>`).join('')}</ul>` : ''}
        ${digest.hasData ? `<div class="cbr-actions">${primary}</div>` : ''}
      </section>
      ${digest.flag ? `
        <button type="button" class="cbr-flag" data-cbr="flag">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
          <span class="cbr-flag-text"><strong>${esc(digest.flag.text)}</strong><span>Ask your coach why</span></span>
          <svg class="cbr-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        </button>` : ''}
      <form class="cbr-ask" data-cbr="ask-form">
        <label class="cbr-sr" for="cbrAskInput">Ask your coach</label>
        <input id="cbrAskInput" class="cbr-ask-input" placeholder="Ask your coach anything…" autocomplete="off">
        <button type="submit" class="cbr-ask-send" aria-label="Ask">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
        </button>
      </form>`;

    const ask = q => { if (typeof window.openAiCoach === 'function') window.openAiCoach(q); };
    el.querySelectorAll('[data-cbr]').forEach(node => {
      const kind = node.getAttribute('data-cbr');
      if (kind === 'ask-form') {
        node.addEventListener('submit', e => {
          e.preventDefault();
          const input = node.querySelector('input');
          const q = input.value.trim();
          if (!q) return;
          input.value = '';
          ask(q);
        });
        return;
      }
      node.addEventListener('click', () => {
        if (kind === 'start' && typeof window.showTab === 'function') window.showTab('logTab');
        if (kind === 'adjust') ask(`Adjust today's ${session} for how I'm doing today.`);
        if (kind === 'ask-day') ask(digest.restDay ? "It's a rest day. What should I do today?" : 'What should I train today?');
        if (kind === 'flag') ask(digest.flag.question);
      });
    });
  }

  async function fetchAiBrief(u, pack, plan) {
    const cd = window.CoachData;
    const settings = cd.loadCoachSettings(localStorage, u);
    const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
    const base = (typeof window.getServerUrl === 'function' ? window.getServerUrl() : null) || window.SERVER_URL || '';
    const ctrl = new AbortController();
    // The server tries several models, 20s each on free OpenRouter models.
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(`${base}/api/ai/coach/brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          data: pack,
          memory: cd.loadMemory(localStorage, u).map(m => ({ text: m.text })),
          style: settings.style,
          today: plan,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const body = await res.json();
      return body && body.source === 'ai' ? body : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function renderCoachBrief() {
    const el = document.getElementById('coachBriefCard');
    const u = user();
    if (!el || !u || !window.CoachData) return;

    const cd = window.CoachData;
    const settings = cd.loadCoachSettings(localStorage, u);
    const pack = cd.buildCoachDataPack(localStorage, u, settings.access);
    const plan = todayPlan(u);
    const digest = cd.buildBriefDigest(pack, plan);
    const fp = fingerprint(digest);
    const cache = readCache(u) || {};
    const sameDay = cache.date === digest.date;

    // Cached AI wording for exactly these facts → show it, no network.
    if (sameDay && cache.fp === fp && cache.ai) {
      render(el, { digest, headline: cache.ai.headline, bullets: cache.ai.bullets, source: 'ai', updatedAt: cache.at });
      return;
    }

    const calls = sameDay ? cache.calls || 0 : 0;
    const canAsk = digest.hasData && navigator.onLine !== false && calls < MAX_AI_CALLS_PER_DAY && !inflight;
    render(el, { digest, headline: digest.headline, bullets: digest.bullets, source: 'rules', loading: canAsk });
    if (!canAsk) return;

    writeCache(u, { date: digest.date, fp: cache.fp, ai: sameDay ? cache.ai : null, at: cache.at, calls: calls + 1 });
    inflight = fetchAiBrief(u, pack, plan).then(ai => {
      inflight = null;
      const now = new Date().toISOString();
      if (ai) writeCache(u, { date: digest.date, fp, ai: { headline: ai.headline, bullets: ai.bullets }, at: now, calls: calls + 1 });
      // Only repaint if the card is still showing this user's brief.
      if (document.getElementById('coachBriefCard') !== el || user() !== u) return;
      if (ai) render(el, { digest, headline: ai.headline, bullets: ai.bullets, source: 'ai', updatedAt: now });
      else render(el, { digest, headline: digest.headline, bullets: digest.bullets, source: 'rules' });
    });
  }

  window.renderCoachBrief = renderCoachBrief;

  // Home may render before this script loads; catch up once the page is ready,
  // and refresh when the coach changes the program or macros.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderCoachBrief);
  else renderCoachBrief();
  window.addEventListener('coach:program-updated', renderCoachBrief);
  window.addEventListener('coach:macros-updated', renderCoachBrief);
})();
