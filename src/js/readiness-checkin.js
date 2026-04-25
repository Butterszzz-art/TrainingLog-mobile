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
      key: 'sleep', label: '😴 Sleep quality',
      options: ['😫 Terrible', '😕 Poor', '😐 OK', '😊 Good', '😁 Great'],
    },
    {
      key: 'soreness', label: '💪 Muscle soreness',
      options: ['🔥 Very sore', '😣 Sore', '😐 Mild', '🙂 Fine', '✅ None'],
    },
    {
      key: 'motivation', label: '⚡ Motivation',
      options: ['😴 None', '😕 Low', '😐 Some', '😊 Ready', '🔥 Fired up!'],
    },
  ];

  let _ratings = { sleep: 0, soreness: 0, motivation: 0 };

  function _buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'readiness-overlay';
    overlay.id = 'readinessOverlay';

    overlay.innerHTML = `
      <div class="readiness-modal">
        <p class="readiness-modal-title">☀️ Morning check-in</p>
        <p class="readiness-modal-sub">Quick 3-question readiness score — takes 10 seconds.</p>

        ${QUESTIONS.map(q => `
          <div class="readiness-question">
            <span class="readiness-question-label">${q.label}</span>
            <div class="readiness-emoji-row" data-qkey="${q.key}">
              ${q.options.map((opt, i) => `
                <button type="button" class="readiness-emoji-btn" data-val="${i + 1}" data-qkey="${q.key}">
                  <span>${opt.split(' ')[0]}</span>
                  <span>${i + 1}</span>
                </button>
              `).join('')}
            </div>
          </div>
        `).join('')}

        <div class="readiness-score-preview" id="readinessScorePreview">
          <span class="readiness-score-num" id="readinessScoreNum">—</span>
          <span>Tap above to see your score</span>
        </div>

        <button type="button" class="readiness-submit-btn" onclick="submitReadiness()">Log Readiness</button>
        <button type="button" class="readiness-skip-btn" onclick="dismissReadiness()">Skip for today</button>
      </div>
    `;

    // Wire emoji buttons
    overlay.querySelectorAll('.readiness-emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const qkey = btn.dataset.qkey;
        const val  = parseInt(btn.dataset.val, 10);
        _ratings[qkey] = val;

        // Highlight selected
        overlay.querySelectorAll(`.readiness-emoji-btn[data-qkey="${qkey}"]`).forEach(b => {
          b.classList.toggle('selected', b === btn);
        });

        _updateScorePreview(overlay);
      });
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));
  }

  function _updateScorePreview(overlay) {
    const { sleep, soreness, motivation } = _ratings;
    if (!sleep || !soreness || !motivation) return;

    const score  = Math.round(((sleep + soreness + motivation) / 15) * 100);
    const tier   = _tier(score);
    const numEl  = overlay.querySelector('#readinessScoreNum');
    if (numEl) {
      numEl.textContent = score + '%';
      numEl.className   = 'readiness-score-num ' + tier.cls;
    }
  }

  window.submitReadiness = function () {
    const { sleep, soreness, motivation } = _ratings;
    if (!sleep || !soreness || !motivation) {
      alert('Please answer all 3 questions.');
      return;
    }
    const score = saveEntry(sleep, soreness, motivation);
    dismissReadiness();
    renderReadinessHomeCard();

    // Show inline tip if low
    const tier = _tier(score);
    if (tier.cls !== 'high') {
      setTimeout(() => alert('ℹ️ ' + tier.tip), 300);
    }
  };

  window.dismissReadiness = function () {
    const overlay = document.getElementById('readinessOverlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 320);
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
        <div class="readiness-home-card" onclick="retakeReadiness()">
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

  document.addEventListener('DOMContentLoaded', () => {
    // Render home card immediately
    setTimeout(renderReadinessHomeCard, 1200);

    // Show modal if not already completed or skipped today
    setTimeout(() => {
      const entry = getTodayEntry();
      if (!entry) _buildModal();
    }, 2500);
  });

  window.renderReadinessHomeCard = renderReadinessHomeCard;

})();
