/* AI Coaching Assistant — floating chat widget + Coach tab embed
   Calls POST /ai/chat on the Render backend.
   Falls back gracefully when offline or endpoint not yet live. */
(function () {
  'use strict';

  const HISTORY_KEY  = u => `aiChatHistory_${u}`;
  const MAX_HISTORY  = 40; // messages kept in localStorage (20 turns)

  /* ── Storage ──────────────────────────────────────────────── */

  function getHistory(username) {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY(username))) || []; }
    catch { return []; }
  }

  function saveHistory(username, messages) {
    const trimmed = messages.slice(-MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY(username), JSON.stringify(trimmed));
  }

  function clearHistory(username) {
    localStorage.removeItem(HISTORY_KEY(username));
  }

  /* ── Context builder ──────────────────────────────────────── */

  function buildContext(username) {
    const ctx = { currentDate: new Date().toISOString().slice(0, 10) };

    try {
      const settings = JSON.parse(localStorage.getItem(`settings_${username}`) || '{}');
      const profile  = settings.profile || {};
      ctx.profile = {
        mode:      profile.mode || profile.currentPhase || null,
        archetype: profile.archetype || null,
        goals:     profile.goals || null,
        name:      profile.athleteName || username,
      };
    } catch {}

    try {
      const raw = JSON.parse(localStorage.getItem(`workouts_${username}`) || '[]');
      ctx.recentWorkouts = raw
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(0, 5)
        .map(w => ({ date: w.date, name: w.name || w.templateName, sets: w.sets?.length }));
    } catch {}

    try {
      const sessions = JSON.parse(localStorage.getItem(`mobilitySessions_${username}`) || '[]');
      ctx.recentMobilitySessions = sessions.slice(-3).map(s => ({ date: s.date, routine: s.routineName }));
    } catch {}

    return ctx;
  }

  /* ── API call ─────────────────────────────────────────────── */

  async function sendToAI(username, userMessage, history) {
    const serverUrl = (typeof window.getServerUrl === 'function' ? window.getServerUrl() : null)
      || window.SERVER_URL
      || 'https://traininglog-backend.onrender.com';

    const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';

    const payload = {
      message: userMessage,
      history: history
        .filter(m => m.role !== 'system')
        .slice(-16) // last 8 turns for context
        .map(m => ({ role: m.role, content: m.content })),
      context: buildContext(username),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000); // 30s — AI can be slow

    try {
      const res = await fetch(`${serverUrl}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        if (res.status === 404) throw new Error('AI_NOT_CONFIGURED');
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      return data.reply || data.message || data.content || '…';
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Request timed out. The AI may be warming up — try again in a moment.');
      if (err.message === 'AI_NOT_CONFIGURED') throw new Error('The AI assistant is not yet enabled on this server. Check back soon!');
      if (!navigator.onLine) throw new Error('You appear to be offline. Connect to the internet and try again.');
      throw err;
    }
  }

  /* ── DOM helpers ──────────────────────────────────────────── */

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function makeBubble(role, content, timestamp) {
    const wrap = document.createElement('div');
    wrap.className = `aic-msg aic-msg--${role === 'user' ? 'user' : 'ai'}`;

    const bubble = document.createElement('div');
    bubble.className = 'aic-bubble';
    bubble.textContent = content;
    wrap.appendChild(bubble);

    if (timestamp) {
      const ts = document.createElement('div');
      ts.className = 'aic-msg-time';
      ts.textContent = fmtTime(timestamp);
      wrap.appendChild(ts);
    }
    return wrap;
  }

  function makeErrorBubble(text) {
    const wrap = document.createElement('div');
    wrap.className = 'aic-msg aic-msg--ai aic-msg--error';
    const bubble = document.createElement('div');
    bubble.className = 'aic-bubble';
    bubble.textContent = '⚠️ ' + text;
    wrap.appendChild(bubble);
    return wrap;
  }

  function makeTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'aic-typing-indicator';
    el.id = 'aicTypingIndicator';
    el.innerHTML = '<div class="aic-dot"></div><div class="aic-dot"></div><div class="aic-dot"></div>';
    return el;
  }

  function scrollToBottom(container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  /* ── Welcome screen ───────────────────────────────────────── */

  const SUGGESTION_CHIPS = [
    'What should I train today?',
    'How do I improve my squat?',
    'Give me a 5-minute warm-up',
    'How many rest days do I need?',
  ];

  function renderWelcome(messagesEl, onSuggest) {
    const welcome = document.createElement('div');
    welcome.className = 'aic-welcome';
    welcome.innerHTML = `
      <div class="aic-welcome-icon">🤖</div>
      <h3>Pocket Coach AI</h3>
      <p>Ask me anything about your training, nutrition, mobility, or recovery.</p>
    `;
    const chips = document.createElement('div');
    chips.className = 'aic-suggestions';
    SUGGESTION_CHIPS.forEach(text => {
      const btn = document.createElement('button');
      btn.className = 'aic-suggestion-chip';
      btn.textContent = text;
      btn.addEventListener('click', () => onSuggest(text));
      chips.appendChild(btn);
    });
    welcome.appendChild(chips);
    messagesEl.appendChild(welcome);
  }

  /* ── Shared chat controller ───────────────────────────────── */

  function createChatController(messagesEl, statusEl, inputEl, sendBtn, username) {
    let history = getHistory(username);
    let sending = false;

    function renderHistory() {
      messagesEl.innerHTML = '';
      if (history.length === 0) {
        renderWelcome(messagesEl, text => {
          inputEl.value = text;
          submit();
        });
        return;
      }
      history.forEach(m => {
        if (m.role === 'system') return;
        messagesEl.appendChild(makeBubble(m.role, m.content, m.timestamp));
      });
      scrollToBottom(messagesEl);
    }

    function setTyping(active) {
      if (statusEl) {
        statusEl.textContent = active ? 'typing…' : 'AI Fitness Assistant';
        statusEl.className = active ? 'aic-status aic-typing' : 'aic-status';
      }
      const existing = document.getElementById('aicTypingIndicator');
      if (active && !existing) {
        messagesEl.appendChild(makeTypingIndicator());
        scrollToBottom(messagesEl);
      } else if (!active && existing) {
        existing.remove();
      }
    }

    async function submit() {
      const text = inputEl.value.trim();
      if (!text || sending) return;
      sending = true;
      sendBtn.disabled = true;
      inputEl.value = '';
      inputEl.style.height = '';

      // Remove welcome screen on first message
      const welcome = messagesEl.querySelector('.aic-welcome');
      if (welcome) welcome.remove();

      const now = new Date().toISOString();
      const userMsg = { role: 'user', content: text, timestamp: now };
      history.push(userMsg);
      saveHistory(username, history);
      messagesEl.appendChild(makeBubble('user', text, now));
      scrollToBottom(messagesEl);

      setTyping(true);

      try {
        const reply = await sendToAI(username, text, history);
        setTyping(false);
        const aiMsg = { role: 'assistant', content: reply, timestamp: new Date().toISOString() };
        history.push(aiMsg);
        saveHistory(username, history);
        messagesEl.appendChild(makeBubble('assistant', reply, aiMsg.timestamp));
      } catch (err) {
        setTyping(false);
        messagesEl.appendChild(makeErrorBubble(err.message || 'Something went wrong. Please try again.'));
      }

      scrollToBottom(messagesEl);
      sending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }

    function clear() {
      history = [];
      clearHistory(username);
      renderHistory();
    }

    sendBtn.addEventListener('click', submit);
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });

    // Auto-grow textarea
    inputEl.addEventListener('input', () => {
      inputEl.style.height = '';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    renderHistory();
    return { clear };
  }

  /* ── Floating panel ──────────────────────────────────────────*/

  let panelCtrl = null;

  function buildFloatingPanel(username) {
    // backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'aiCoachBackdrop';
    document.body.appendChild(backdrop);

    // panel
    const panel = document.createElement('div');
    panel.id = 'aiCoachPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Pocket Coach AI');
    panel.innerHTML = `
      <div class="aic-header">
        <div class="aic-header-drag"></div>
        <div class="aic-header-info">
          <div class="aic-avatar">🤖</div>
          <div>
            <div class="aic-name">Pocket Coach</div>
            <div class="aic-status" id="aicFloatStatus">AI Fitness Assistant</div>
          </div>
        </div>
        <div class="aic-header-actions">
          <button class="aic-clear-btn" id="aicFloatClearBtn" title="Clear conversation">🗑️</button>
          <button class="aic-close-btn" id="aicFloatCloseBtn" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="aic-messages" id="aicFloatMessages"></div>
      <div class="aic-input-area">
        <textarea class="aic-input" id="aicFloatInput"
          placeholder="Ask about your training…" rows="1"
          aria-label="Message"></textarea>
        <button class="aic-send-btn" id="aicFloatSendBtn" aria-label="Send">↑</button>
      </div>
    `;
    document.body.appendChild(panel);

    const ctrl = createChatController(
      panel.querySelector('#aicFloatMessages'),
      panel.querySelector('#aicFloatStatus'),
      panel.querySelector('#aicFloatInput'),
      panel.querySelector('#aicFloatSendBtn'),
      username
    );

    panel.querySelector('#aicFloatClearBtn').addEventListener('click', () => {
      if (confirm('Clear conversation history?')) ctrl.clear();
    });

    function close() {
      panel.classList.remove('aic-open');
      backdrop.classList.remove('aic-open');
      const fab = document.getElementById('aiCoachFab');
      if (fab) { fab.hidden = false; fab.innerHTML = '🤖'; }
    }

    function open() {
      panel.classList.add('aic-open');
      backdrop.classList.add('aic-open');
      const fab = document.getElementById('aiCoachFab');
      if (fab) fab.hidden = true;
      setTimeout(() => panel.querySelector('#aicFloatInput')?.focus(), 350);
    }

    panel.querySelector('#aicFloatCloseBtn').addEventListener('click', close);
    backdrop.addEventListener('click', close);

    return { open, close };
  }

  function initFloatingButton(username) {
    if (document.getElementById('aiCoachFab')) return; // already created

    const fab = document.createElement('button');
    fab.id = 'aiCoachFab';
    fab.setAttribute('aria-label', 'Open AI Coach');
    fab.textContent = '🤖';
    document.body.appendChild(fab);

    panelCtrl = buildFloatingPanel(username);

    fab.addEventListener('click', () => {
      panelCtrl.open();
    });

    // Subtle pulse on first visit
    const seenKey = `aiCoachSeen_${username}`;
    if (!localStorage.getItem(seenKey)) {
      setTimeout(() => fab.classList.add('aic-pulse'), 800);
      setTimeout(() => {
        fab.classList.remove('aic-pulse');
        localStorage.setItem(seenKey, '1');
      }, 5200);
    }
  }

  /* ── Embedded view (Coach tab) ───────────────────────────── */

  function renderEmbedded(container, username) {
    container.innerHTML = `
      <h3 style="margin:16px 0 8px; font-size:1rem;">🤖 AI Fitness Assistant</h3>
      <p style="font-size:0.82rem; color:var(--secondary-text); margin:0 0 12px;">
        Ask about programming, form cues, nutrition, or recovery.
      </p>
      <div class="aic-embedded">
        <div class="aic-messages" id="aicEmbedMessages"></div>
        <div class="aic-input-area">
          <textarea class="aic-input" id="aicEmbedInput"
            placeholder="Ask anything…" rows="1" aria-label="Message"></textarea>
          <button class="aic-send-btn" id="aicEmbedSendBtn" aria-label="Send">↑</button>
        </div>
      </div>
    `;

    createChatController(
      container.querySelector('#aicEmbedMessages'),
      null,
      container.querySelector('#aicEmbedInput'),
      container.querySelector('#aicEmbedSendBtn'),
      username
    );
  }

  /* ── Public API ──────────────────────────────────────────── */

  window.initAiCoach = function (username) {
    if (!username) return;
    initFloatingButton(username);
  };

  window.initAiCoachEmbed = function (container, username) {
    if (!container || !username) return;
    renderEmbedded(container, username);
  };

  window.openAiCoach = function () {
    if (panelCtrl) panelCtrl.open();
  };

})();
