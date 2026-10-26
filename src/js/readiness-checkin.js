/* =============================================================
   DAILY READINESS CHECK-IN
   A quick 3-question morning modal (separate from the weekly
   athlete check-in tab). Produces a 0-100 readiness score
   shown as a card on the Home dashboard.
   ============================================================= */

(function initReadinessCheckin() {
  'use strict';

  const KEY   = 'dailyReadiness_v1';
  const TODAY = () => new Date().toDateString();

  /* ── Storage ─────────────────────────────────────────────── */

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
  }

  function _save(data) { localStorage.setItem(KEY, JSON.stringify(data)); }

  function getTodayEntry() {
    const all = _load();
    return all[TODAY()] || null;
  }

  function saveEntry(sleep, soreness, motivation) {
    const all   = _load();
    const score = Math.round(((sleep + soreness + motivation) / 15) * 100);
    all[TODAY()] = { sleep, soreness, motivation, score, time: Date.now() };
    _save(all);
    return score;
  }

  /* ── Score helpers ───────────────────────────────────────── */

  function _tier(score) {
    if (score >= 67) return { label: 'Good to go 💪', cls: 'high',   tip: 'Great readiness — train hard today!' };
    if (score >= 40) return { label: 'Moderate',       cls: 'medium', tip: 'Decent readiness — stay within your plan.' };
    return              { label: 'Low readiness',     cls: 'low',    tip: 'Consider a lighter session or extra rest.' };
  }

  /* ── Modal ───────────────────────────────────────────────── */

  const QUESTIONS = [
    {
      key: 'sleep', label: 'Sleep quality', icon: 'moon',
      options: ['Terrible', 'Poor', 'OK', 'Good', 'Great'],
    },
    {
      key: 'soreness', label: 'Muscle soreness', icon: 'activity',
      options: ['Very sore', 'Sore', 'Mild', 'Fine', 'None'],
    },
    {
      key: 'motivation', label: 'Motivation', icon: 'zap',
      options: ['None', 'Low', 'Some', 'Ready', 'Fired up'],
    },
  ];

  const TIER_SHORT = { high: 'Good to go', medium: 'Moderate', low: 'Low readiness' };

  function _icon(name) {
    const svg = (typeof ICONS !== 'undefined' && ICONS[name]) || '';
    return svg ? `<span class="ui-icon" aria-hidden="true">${svg}</span>` : '';
  }

  let _ratings = { sleep: 0, soreness: 0, motivation: 0 };

  function _onKeydown(e) {
    if (e.key === 'Escape') window.dismissReadiness();
  }

  function _buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'tl-sheet-overlay readiness-overlay';
    overlay.id = 'readinessOverlay';

    const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

    overlay.innerHTML = `
      <div class="tl-sheet readiness-modal" role="dialog" aria-modal="true" aria-labelledby="readinessTitle" tabindex="-1">
        <header class="tl-sheet-head">
          <div>
            <p class="tl-sheet-kicker">${_icon('sparkles')}Daily check-in · ${dateLabel}</p>
            <h2 class="tl-sheet-title" id="readinessTitle">How are you feeling?</h2>
            <p class="tl-sheet-sub">Three taps for today's readiness score.</p>
          </div>
          <button type="button" class="tl-sheet-close" aria-label="Skip for today" onclick="dismissReadiness()">${_icon('x') || '✕'}</button>
        </header>

        <div class="tl-sheet-body">
          ${QUESTIONS.map(q => `
            <div class="tl-q" data-q="${q.key}">
              <div class="tl-q-head">
                <span class="tl-q-icon">${_icon(q.icon)}</span>
                <span class="tl-q-label" id="rq-${q.key}">${q.label}</span>
                <span class="tl-q-value" data-value-for="${q.key}">Tap 1–5</span>
              </div>
              <div class="tl-seg" role="radiogroup" aria-labelledby="rq-${q.key}">
                ${q.options.map((opt, i) => `
                  <button type="button" class="tl-seg-btn readiness-emoji-btn" role="radio" aria-checked="false"
                    aria-label="${i + 1} — ${opt}" data-val="${i + 1}" data-qkey="${q.key}">${i + 1}</button>
                `).join('')}
              </div>
              <div class="tl-seg-ends"><span>${q.options[0]}</span><span>${q.options[4]}</span></div>
            </div>
          `).join('')}

          <div class="tl-score" id="readinessScorePreview" aria-live="polite">
            <span class="tl-score-num" id="readinessScoreNum">—</span>
            <div class="tl-score-info">
              <span class="tl-score-label" id="readinessScoreLabel">Readiness</span>
              <span class="tl-score-tip" id="readinessScoreTip">Answer all three to see your score.</span>
              <div class="tl-score-meter"><i id="readinessScoreBar"></i></div>
            </div>
          </div>
        </div>

        <footer class="tl-sheet-actions">
          <button type="button" class="tl-sheet-btn tl-sheet-btn--ghost readiness-skip-btn" onclick="dismissReadiness()">Skip</button>
          <button type="button" class="tl-sheet-btn tl-sheet-btn--primary readiness-submit-btn" aria-disabled="true" onclick="submitReadiness()">${_icon('check')}Log readiness</button>
        </footer>
      </div>
    `;

    overlay.querySelectorAll('.tl-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const qkey = btn.dataset.qkey;
        const val  = parseInt(btn.dataset.val, 10);
        _ratings[qkey] = val;

        overlay.querySelectorAll(`.tl-seg-btn[data-qkey="${qkey}"]`).forEach(b => {
          const v = parseInt(b.dataset.val, 10);
          b.classList.toggle('on', v === val);
          b.classList.toggle('filled', v < val);
          b.classList.toggle('selected', v === val);
          b.setAttribute('aria-checked', v === val ? 'true' : 'false');
        });

        const q = QUESTIONS.find(x => x.key === qkey);
        const valueEl = overlay.querySelector(`[data-value-for="${qkey}"]`);
        if (valueEl && q) valueEl.textContent = q.options[val - 1];
        overlay.querySelector(`.tl-q[data-q="${qkey}"]`)?.classList.add('answered');

        _updateScorePreview(overlay);
      });
    });

    document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKeydown);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.classList.add('visible');
      overlay.querySelector('.tl-sheet')?.focus({ preventScroll: true });
    }));
  }

  function _updateScorePreview(overlay) {
    const { sleep, soreness, motivation } = _ratings;
    if (!sleep || !soreness || !motivation) return;

    const score = Math.round(((sleep + soreness + motivation) / 15) * 100);
    const tier  = _tier(score);
    const card  = overlay.querySelector('#readinessScorePreview');
    const numEl = overlay.querySelector('#readinessScoreNum');
    const lblEl = overlay.querySelector('#readinessScoreLabel');
    const tipEl = overlay.querySelector('#readinessScoreTip');
    const bar   = overlay.querySelector('#readinessScoreBar');
    if (card)  card.dataset.tier = tier.cls;
    if (numEl) numEl.innerHTML = `${score}<small>%</small>`;
    if (lblEl) lblEl.textContent = TIER_SHORT[tier.cls] || tier.label;
    if (tipEl) tipEl.textContent = tier.tip;
    if (bar)   bar.style.width = score + '%';
    overlay.querySelector('.readiness-submit-btn')?.setAttribute('aria-disabled', 'false');
  }

  window.submitReadiness = function () {
    const { sleep, soreness, motivation } = _ratings;
    if (!sleep || !soreness || !motivation) {
      window.showToast('Please answer all 3 questions.', 'warn');
      return;
    }
    const score = saveEntry(sleep, soreness, motivation);
    dismissReadiness();
    renderReadinessHomeCard();

    // Show tip if low readiness
    const tier = _tier(score);
    if (tier.cls !== 'high') {
      setTimeout(() => window.showToast('ℹ️ ' + tier.tip, 'info', 5000), 300);
    }
  };

  window.dismissReadiness = function () {
    const overlay = document.getElementById('readinessOverlay');
    if (!overlay) return;
    overlay.removeAttribute('id');
    overlay.classList.remove('visible');
    document.removeEventListener('keydown', _onKeydown);
    setTimeout(() => overlay.remove(), 340);
    // Mark as skipped today so we don't re-prompt
    const all = _load();
    if (!all[TODAY()]) {
      all[TODAY()] = { skipped: true };
      _save(all);
    }
  };

  window.retakeReadiness = function () {
    const existing = document.getElementById('readinessOverlay');
    if (existing) existing.remove();
    document.removeEventListener('keydown', _onKeydown);
    _ratings = { sleep: 0, soreness: 0, motivation: 0 };
    _buildModal();
  };

  /* ── Home card ───────────────────────────────────────────── */

  function renderReadinessHomeCard() {
    const host = document.getElementById('readinessHomeCard');
    if (!host) return;

    const entry = getTodayEntry();
    if (!entry || entry.skipped) {
      host.innerHTML = `
        <div role="button" tabindex="0" class="readiness-home-card" onclick="retakeReadiness()">
          <span class="readiness-home-score medium">?</span>
          <div class="readiness-home-info">
            <p class="readiness-home-label">Readiness not logged</p>
            <p class="readiness-home-detail">Tap to do your morning check-in</p>
          </div>
        </div>
      `;
      return;
    }

    const tier = _tier(entry.score);
    host.innerHTML = `
      <div class="readiness-home-card">
        <span class="readiness-home-score ${tier.cls}">${entry.score}%</span>
        <div class="readiness-home-info">
          <p class="readiness-home-label">Today's readiness — ${tier.label}</p>
          <p class="readiness-home-detail">${tier.tip}</p>
        </div>
        <button class="readiness-home-retake" onclick="retakeReadiness()">Redo</button>
      </div>
    `;
  }

  /* ── Boot ─────────────────────────────────────────────────── */

  function showReadinessIfNeeded() {
    const entry = getTodayEntry();
    if (!entry) _buildModal();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderReadinessHomeCard, 1200);
  });

  window.renderReadinessHomeCard = renderReadinessHomeCard;
  window.showReadinessIfNeeded = showReadinessIfNeeded;
  window.getTodayReadinessEntry = getTodayEntry;

})();
