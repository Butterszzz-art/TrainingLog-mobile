/* =============================================================
   WEEKLY REVIEW — coach section at the top of the weekly recap sheet
   (src/js/weekly-recap.js calls window.renderCoachReview(host, recap)).

   Rules-only summary / wins / watch render immediately from
   CoachData.buildWeeklyReviewFacts; for a finished week the coach's
   review (POST /api/ai/coach/review) replaces it, with proposed changes
   the athlete ticks and applies in one go. Reviews are cached per week
   and per set of facts, so reopening the sheet doesn't re-bill.
   ============================================================= */
(function () {
  'use strict';

  const CACHE_KEY = u => `coachReview_${u}`;
  const KEEP_WEEKS = 8;
  const MAX_AI_CALLS_PER_DAY = 3;
  const inflight = {};

  function user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      window.currentUser || localStorage.getItem('fitnessAppUser') || localStorage.getItem('username') || '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function readCache(u) {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY(u))) || {}; } catch { return {}; }
  }
  function writeCache(u, all) {
    const weeks = Object.keys(all).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-KEEP_WEEKS);
    const kept = { calls: all.calls };
    weeks.forEach(k => { kept[k] = all[k]; });
    try { localStorage.setItem(CACHE_KEY(u), JSON.stringify(kept)); } catch { /* quota */ }
  }

  // Cheap stable hash of the facts — a new log for that week means a new review.
  function hash(obj) {
    const s = JSON.stringify(obj);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /* ── proposal rendering ───────────────────────────────────── */

  function programLines(u, card) {
    const cd = window.CoachData;
    const program = cd.resolveProgram(localStorage, u);
    const day = program && program.days.find(d => String(d.name).toLowerCase() === String(card.day).toLowerCase());
    const find = name => day && day.exercises.find(e => String(e.name).toLowerCase() === String(name).toLowerCase());
    return (card.changes || []).map(c => {
      const was = card.status === 'applied' ? null : find(c.exercise);
      if (c.op === 'set_sets') return { name: c.exercise, from: was ? cd.describeSets(was.sets) : '', to: cd.describeSets(c.sets) };
      if (c.op === 'add_exercise') return { name: `Add ${c.exercise}`, to: cd.describeSets(c.sets) };
      if (c.op === 'remove_exercise') return { name: `Remove ${c.exercise}`, from: was ? cd.describeSets(was.sets) : '' };
      if (c.op === 'replace_exercise') return { name: `${c.exercise} → ${c.newExercise}`, to: 'same sets' };
      if (c.op === 'set_note') return { name: c.exercise, to: `Note: ${c.note}` };
      return { name: c.exercise };
    });
  }

  function cardHtml(u, card, i) {
    let lines;
    if (card.type === 'macro_targets') {
      const from = card.from || {};
      lines = [['calories', 'kcal'], ['protein', 'g protein'], ['carbs', 'g carbs'], ['fat', 'g fat']]
        .filter(([k]) => from[k] == null || from[k] !== card.to[k])
        .map(([k, unit]) => ({ name: '', from: from[k] != null ? `${from[k]}` : '', to: `${card.to[k]} ${unit}` }));
    } else {
      lines = programLines(u, card);
    }
    const done = card.status === 'applied';
    const where = card.type === 'macro_targets' ? 'Macros' : card.day;
    return `
      <li class="crv-prop${done ? ' is-done' : ''}">
        <label class="crv-prop-label">
          ${done
            ? '<span class="crv-prop-done" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>'
            : `<input type="checkbox" class="crv-prop-check" data-crv-card="${i}" ${card.status === 'skipped' ? '' : 'checked'}>`}
          <span class="crv-prop-body">
            <span class="crv-prop-where">${esc(where)}${done ? ' · Applied' : ''}</span>
            <span class="crv-prop-title">${esc(card.title)}</span>
            ${lines.map(l => `<span class="crv-prop-line">${l.name ? `<span class="crv-prop-ex">${esc(l.name)}</span>` : ''}${
              l.from ? `<s>${esc(l.from)}</s>` : ''}${l.to ? `<span class="crv-prop-to">${esc(l.to)}</span>` : ''}</span>`).join('')}
            ${card.rationale ? `<span class="crv-prop-why">${esc(card.rationale)}</span>` : ''}
          </span>
        </label>
      </li>`;
  }

  function listHtml(label, cls, items) {
    if (!items.length) return '';
    return `<div class="crv-list crv-list--${cls}"><span class="crv-list-label">${label}</span>
      <ul>${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  }

  function shareText(recap, review) {
    const lines = [`Week ${recap.start} – ${recap.end}`, '', review.summary];
    if (review.wins.length) lines.push('', 'Wins:', ...review.wins.map(w => `- ${w}`));
    if (review.watch.length) lines.push('', 'Watch:', ...review.watch.map(w => `- ${w}`));
    const applied = (review.cards || []).filter(c => c.status === 'applied');
    if (applied.length) lines.push('', 'Changes I made for next week:', ...applied.map(c => `- ${c.title}${c.day ? ` (${c.day})` : ''}`));
    return lines.join('\n');
  }

  /* ── render ───────────────────────────────────────────────── */

  function render(host, ctx) {
    const { u, recap, review, loading } = ctx;
    const cards = review.cards || [];
    const pending = cards.filter(c => c.status !== 'applied');
    const stamp = loading ? 'Reviewing…' : review.source === 'ai' ? 'Coach' : (recap.inProgress ? 'Week in progress' : 'Summary');

    host.innerHTML = `
      <section class="crv" aria-labelledby="crvTitle">
        <div class="crv-head">
          <h4 id="crvTitle" class="crv-kicker">Coach review</h4>
          <span class="crv-stamp">${esc(stamp)}</span>
        </div>
        <p class="crv-summary${loading ? ' is-loading' : ''}">${esc(review.summary)}</p>
        ${listHtml('Wins', 'win', review.wins || [])}
        ${listHtml('Watch', 'watch', review.watch || [])}
        ${cards.length ? `
          <div class="crv-props">
            <span class="crv-list-label">Proposed for next week</span>
            <ul>${cards.map((c, i) => cardHtml(u, c, i)).join('')}</ul>
          </div>` : ''}
        <div class="crv-actions">
          ${pending.length ? `<button type="button" class="crv-btn crv-btn--primary" data-crv="apply"></button>` : ''}
          ${review.summary && !recap.inProgress ? '<button type="button" class="crv-btn crv-btn--ghost" data-crv="share">Share with my coach</button>' : ''}
        </div>
        ${recap.inProgress ? '<p class="crv-note">The full coach review is ready once the week is over.</p>' : ''}
      </section>`;

    const applyBtn = host.querySelector('[data-crv="apply"]');
    const syncApplyLabel = () => {
      if (!applyBtn) return;
      const n = host.querySelectorAll('.crv-prop-check:checked').length;
      applyBtn.textContent = n ? `Apply ${n} change${n === 1 ? '' : 's'}` : 'Nothing selected';
      applyBtn.disabled = n === 0;
    };
    syncApplyLabel();

    host.querySelectorAll('.crv-prop-check').forEach(cb => cb.addEventListener('change', () => {
      cards[Number(cb.dataset.crvCard)].status = cb.checked ? undefined : 'skipped';
      syncApplyLabel();
    }));

    if (applyBtn) applyBtn.addEventListener('click', () => {
      const cd = window.CoachData;
      let ok = 0;
      const problems = [];
      host.querySelectorAll('.crv-prop-check:checked').forEach(cb => {
        const card = cards[Number(cb.dataset.crvCard)];
        const res = card.type === 'macro_targets' ? cd.applyMacroTargets(localStorage, u, card) : cd.applyProgramChange(localStorage, u, card);
        if (res.ok) {
          card.status = 'applied';
          ok++;
          window.dispatchEvent(new CustomEvent(card.type === 'macro_targets' ? 'coach:macros-updated' : 'coach:program-updated', { detail: card }));
        } else {
          problems.push(res.reason);
        }
      });
      ctx.save();
      if (typeof window.showToast === 'function') {
        if (ok) window.showToast(`${ok} change${ok === 1 ? '' : 's'} applied for next week`, 'success', 2500);
        if (problems.length) window.showToast(problems[0], 'error', 3500);
      }
      render(host, ctx);
    });

    const shareBtn = host.querySelector('[data-crv="share"]');
    if (shareBtn) shareBtn.addEventListener('click', async () => {
      const text = shareText(recap, review);
      try {
        if (navigator.share) { await navigator.share({ title: 'My weekly review', text }); return; }
        await navigator.clipboard.writeText(text);
        if (typeof window.showToast === 'function') window.showToast('Review copied. Paste it to your coach.', 'success', 2500);
      } catch { /* share sheet dismissed */ }
    });
  }

  async function fetchReview(u, built, pack) {
    const cd = window.CoachData;
    const settings = cd.loadCoachSettings(localStorage, u);
    const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
    const base = (typeof window.getServerUrl === 'function' ? window.getServerUrl() : null) || window.SERVER_URL || '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 150000); // free models queue; server tries several
    try {
      const res = await fetch(`${base}/api/ai/coach/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          facts: built.facts,
          rules: built.rules,
          data: pack,
          memory: cd.loadMemory(localStorage, u).map(m => ({ text: m.text })),
          style: settings.style,
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

  /**
   * @param host   element to render into
   * @param recap  buildWeeklyRecap() result for the week shown in the sheet
   */
  function renderCoachReview(host, recap) {
    const u = user();
    const cd = window.CoachData;
    if (!host || !u || !cd || !recap || !recap.hasData) { if (host) host.innerHTML = ''; return; }

    const settings = cd.loadCoachSettings(localStorage, u);
    const pack = cd.buildCoachDataPack(localStorage, u, settings.access);
    const built = cd.buildWeeklyReviewFacts(recap, pack);
    // Key the cache on what was logged that week only. The current program and
    // targets are left out, or applying the review's own proposals would make
    // the review look stale and trigger a new (billed) one.
    const { program, macroTargets, ...logged } = built.facts;
    const fp = hash(logged);
    const all = readCache(u);
    const cached = all[recap.start];

    const ctx = {
      u,
      recap,
      review: cached && cached.fp === fp && cached.review ? cached.review : { ...built.rules, cards: [], source: 'rules' },
      save() {
        const latest = readCache(u);
        latest[recap.start] = { fp, review: ctx.review, at: new Date().toISOString() };
        writeCache(u, latest);
      },
    };

    const calls = all.calls && all.calls.date === today() ? all.calls.n : 0;
    const wantAi = ctx.review.source !== 'ai' && !recap.inProgress && navigator.onLine !== false &&
      calls < MAX_AI_CALLS_PER_DAY && !inflight[recap.start];

    render(host, { ...ctx, loading: wantAi });
    if (!wantAi) return;

    writeCache(u, { ...all, calls: { date: today(), n: calls + 1 } });
    inflight[recap.start] = fetchReview(u, built, pack).then(ai => {
      delete inflight[recap.start];
      if (ai) {
        ctx.review = { summary: ai.summary, wins: ai.wins, watch: ai.watch, cards: ai.cards || [], source: 'ai' };
        ctx.save();
      }
      // The sheet may have moved to another week, or closed, meanwhile.
      if (host.isConnected && host.dataset.week === recap.start) render(host, ctx);
    });
  }

  window.renderCoachReview = renderCoachReview;
})();
