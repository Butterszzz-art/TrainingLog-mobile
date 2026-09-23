/* =============================================================
   AI COACH — chat UI (floating panel + Coach tab embed)
   Streams from POST /api/ai/coach (src/routes/coach.js). Each reply
   can carry, besides text: "checked" traces (what the coach looked
   up), inline e1RM charts, proposal cards the athlete can Apply, and
   facts saved to coach memory. Data, memory and settings live on the
   device — see src/js/coach-data.js.
   ============================================================= */
(function () {
  'use strict';

  const CD = () => window.CoachData;
  const HISTORY_KEY = u => `aiChatHistory_${u}`;
  const MAX_HISTORY = 40;         // stored turns (user + assistant)
  const SEND_HISTORY = 16;        // turns sent as context
  const STREAM_TIMEOUT_MS = 150000; // free models may be skipped after 30s each

  const QUICK_ASKS = [
    'Review my week',
    'Why has my squat stalled?',
    'Are my macros right?',
    'What should I train today?',
  ];

  const ACCESS_LABELS = {
    workouts: 'Workouts, cardio & program',
    body: 'Bodyweight & check-ins',
    recovery: 'Sleep & recovery',
    nutrition: 'Macro targets',
  };

  const ICON = {
    brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6c0 2.2 1.2 3.7 2.4 4.9.8.8 1.1 1.6 1.1 2.6V18h5v-1.5c0-1 .3-1.8 1.1-2.6C16.8 12.7 18 11.2 18 9a6 6 0 0 0-6-6z"/><path d="M9.5 21h5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    coach: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg>',
  };

  /* ── helpers ─────────────────────────────────────────────── */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function iconBtn(cls, icon, label) {
    const b = el('button', cls);
    b.type = 'button';
    b.innerHTML = ICON[icon];
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Plain text with **bold** and "- " lists. Escapes first, so model output
  // can never inject markup.
  function renderRichText(target, text) {
    const blocks = String(text || '').split(/\n{2,}/);
    target.innerHTML = blocks.map(block => {
      const lines = block.split('\n');
      const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (lines.every(l => /^\s*[-•]\s+/.test(l))) {
        return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }

  function serverUrl() {
    return (typeof window.getServerUrl === 'function' ? window.getServerUrl() : null)
      || window.SERVER_URL
      || 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'success', 2500);
  }

  /* ── history ─────────────────────────────────────────────── */

  function getHistory(u) {
    try {
      const list = JSON.parse(localStorage.getItem(HISTORY_KEY(u))) || [];
      return Array.isArray(list) ? list.filter(m => m && m.role !== 'system') : [];
    } catch { return []; }
  }

  function saveHistory(u, list) {
    try { localStorage.setItem(HISTORY_KEY(u), JSON.stringify(list.slice(-MAX_HISTORY))); } catch { /* quota */ }
  }

  /* ── streaming request ───────────────────────────────────── */

  // Calls onEvent(type, payload) for each server-sent event.
  async function streamCoach(u, message, history, signal, onEvent) {
    const cd = CD();
    const settings = cd.loadCoachSettings(localStorage, u);
    const token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';

    const res = await fetch(`${serverUrl()}/api/ai/coach`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message,
        history: history.slice(-SEND_HISTORY).map(m => ({ role: m.role, content: m.content })),
        data: cd.buildCoachDataPack(localStorage, u, settings.access),
        memory: cd.loadMemory(localStorage, u).map(m => ({ text: m.text })),
        access: settings.access,
        style: settings.style,
      }),
      signal,
    });

    if (!res.ok) {
      if (res.status === 404) throw new Error('The AI coach isn\'t switched on for this server yet.');
      if (res.status === 401) throw new Error('Please log in again to talk to your coach.');
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `Server error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        let type = 'message';
        let data = '';
        frame.split('\n').forEach(line => {
          if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        });
        if (!data) continue;
        let payload;
        try { payload = JSON.parse(data); } catch { continue; }
        onEvent(type, payload);
      }
    }
  }

  /* ── rendering pieces ────────────────────────────────────── */

  function renderTraces(wrap, traces) {
    let row = wrap.querySelector('.aic-trace');
    if (!traces.length) { if (row) row.remove(); return; }
    if (!row) {
      row = el('div', 'aic-trace');
      wrap.prepend(row);
    }
    row.innerHTML = `<span class="aic-trace-icon">${ICON.check}</span><span></span>`;
    row.lastChild.textContent = `Checked: ${traces.join(' · ')}`;
  }

  function renderChart(chart) {
    const pts = (chart.points || []).filter(p => Number.isFinite(p.value));
    if (pts.length < 2) return null;
    const card = el('div', 'aic-chart');
    const head = el('div', 'aic-chart-head');
    head.appendChild(el('span', 'aic-kicker', `${chart.exercise} · est. 1RM`));
    head.appendChild(el('span', 'aic-chart-now', `${pts[pts.length - 1].value}`));
    card.appendChild(head);

    const W = 300, H = 64, pad = 6;
    const vals = pts.map(p => p.value);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || 1;
    const xy = pts.map((p, i) => [
      pad + (i * (W - pad * 2)) / (pts.length - 1),
      H - pad - ((p.value - lo) / span) * (H - pad * 2),
    ]);
    const label = `Estimated 1RM for ${chart.exercise}, from ${vals[0]} to ${vals[vals.length - 1]} over ${pts.length} sessions`;
    card.insertAdjacentHTML('beforeend',
      `<svg class="aic-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">` +
      `<polyline points="${xy.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" />` +
      xy.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" />`).join('') +
      '</svg>');
    card.appendChild(el('div', 'aic-chart-foot', `${pts[0].date} → ${pts[pts.length - 1].date}`));
    return card;
  }

  function currentDayExercises(u, dayName) {
    const program = CD().resolveProgram(localStorage, u);
    const day = program && program.days.find(d => String(d.name).toLowerCase() === String(dayName).toLowerCase());
    return day ? day.exercises : [];
  }

  function programChangeLines(u, card) {
    const unit = (CD().buildCoachDataPack(localStorage, u, { workouts: false, body: false, recovery: false, nutrition: false }).profile || {}).unit;
    // Once applied, the stored program already holds the new sets, so there's no 'before' to show.
    const existing = card.status === 'applied' ? [] : currentDayExercises(u, card.day);
    const find = name => existing.find(e => String(e.name).toLowerCase() === String(name).toLowerCase());
    return (card.changes || []).map(c => {
      const was = find(c.exercise);
      switch (c.op) {
        case 'set_sets':
          return { name: c.exercise, from: was ? CD().describeSets(was.sets, unit) : '', to: CD().describeSets(c.sets, unit) };
        case 'add_exercise':
          return { name: `Add ${c.exercise}`, to: CD().describeSets(c.sets, unit) };
        case 'remove_exercise':
          return { name: `Remove ${c.exercise}`, from: was ? CD().describeSets(was.sets, unit) : '' };
        case 'replace_exercise':
          return { name: `${c.exercise} → ${c.newExercise}`, to: 'same sets' };
        case 'set_note':
          return { name: c.exercise, to: `Note: ${c.note}` };
        default:
          return { name: c.exercise };
      }
    });
  }

  function renderCard(u, card, onStatus) {
    const box = el('div', `aic-card aic-card--${card.type}`);
    const kicker = card.type === 'macro_targets' ? 'Proposed · macros' : `Proposed · ${card.day}`;
    box.appendChild(el('div', 'aic-kicker aic-kicker--accent', kicker));
    box.appendChild(el('div', 'aic-card-title', card.title));

    const list = el('div', 'aic-card-lines');
    if (card.type === 'macro_targets') {
      const from = card.from || {};
      [['calories', 'kcal'], ['protein', 'g protein'], ['carbs', 'g carbs'], ['fat', 'g fat']].forEach(([k, unit]) => {
        const row = el('div', 'aic-card-line');
        const changed = from[k] != null && from[k] !== card.to[k];
        if (changed) row.appendChild(el('s', 'aic-from', `${from[k]}`));
        row.appendChild(el('span', changed ? 'aic-to' : '', `${card.to[k]} ${unit}`));
        list.appendChild(row);
      });
    } else {
      programChangeLines(u, card).forEach(line => {
        const row = el('div', 'aic-card-line aic-card-line--stack');
        row.appendChild(el('span', 'aic-card-ex', line.name));
        if (line.from) row.appendChild(el('s', 'aic-from', line.from));
        if (line.to) row.appendChild(el('span', 'aic-to', line.to));
        list.appendChild(row);
      });
    }
    box.appendChild(list);
    if (card.rationale) box.appendChild(el('p', 'aic-card-why', card.rationale));

    const actions = el('div', 'aic-card-actions');
    const setDone = (status, text) => {
      card.status = status;
      actions.innerHTML = '';
      actions.appendChild(el('span', `aic-card-status aic-card-status--${status}`, text));
      onStatus();
    };
    if (card.status === 'applied') setDone('applied', 'Applied');
    else if (card.status === 'dismissed') setDone('dismissed', 'Dismissed');
    else {
      const apply = el('button', 'aic-btn aic-btn--primary', card.type === 'macro_targets' ? 'Apply targets' : 'Apply to program');
      const dismiss = el('button', 'aic-btn aic-btn--ghost', 'Dismiss');
      apply.type = dismiss.type = 'button';
      apply.addEventListener('click', () => {
        const res = card.type === 'macro_targets'
          ? CD().applyMacroTargets(localStorage, u, card)
          : CD().applyProgramChange(localStorage, u, card);
        if (!res.ok) { toast(res.reason, 'error'); return; }
        window.dispatchEvent(new CustomEvent(card.type === 'macro_targets' ? 'coach:macros-updated' : 'coach:program-updated', { detail: card }));
        toast(card.type === 'macro_targets' ? 'Macro targets updated' : `${card.day} updated`);
        setDone('applied', 'Applied');
      });
      dismiss.addEventListener('click', () => setDone('dismissed', 'Dismissed'));
      actions.append(apply, dismiss);
    }
    box.appendChild(actions);
    return box;
  }

  /* ── controller shared by the panel and the embed ────────── */

  function createChat(root, u, opts) {
    root.classList.add('aic-root');
    root.innerHTML = '';

    const header = el('div', 'aic-header');
    if (opts.floating) header.appendChild(el('div', 'aic-header-drag'));
    const info = el('div', 'aic-header-info');
    const avatar = el('div', 'aic-avatar');
    avatar.innerHTML = ICON.coach;
    const names = el('div');
    names.appendChild(el('div', 'aic-name', 'Coach'));
    const status = el('div', 'aic-status');
    names.appendChild(status);
    info.append(avatar, names);
    const actions = el('div', 'aic-header-actions');
    const memBtn = iconBtn('aic-icon-btn', 'brain', 'What your coach knows');
    const newBtn = iconBtn('aic-icon-btn', 'plus', 'New conversation');
    actions.append(memBtn, newBtn);
    if (opts.floating) actions.appendChild(iconBtn('aic-icon-btn aic-close', 'close', 'Close'));
    header.append(info, actions);

    const messages = el('div', 'aic-messages');
    messages.setAttribute('role', 'log');
    messages.setAttribute('aria-live', 'polite');

    const inputArea = el('form', 'aic-input-area');
    const input = el('textarea', 'aic-input');
    input.rows = 1;
    input.placeholder = 'Ask your coach…';
    input.setAttribute('aria-label', 'Message your coach');
    const sendBtn = iconBtn('aic-send-btn', 'send', 'Send');
    sendBtn.type = 'submit';
    inputArea.append(input, sendBtn);

    const settingsView = el('div', 'aic-settings');
    settingsView.hidden = true;

    root.append(header, messages, inputArea, settingsView);

    let history = getHistory(u);
    let controller = null;

    function scrollDown() {
      requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
    }

    function setStatus(text, busy) {
      status.textContent = text;
      status.classList.toggle('aic-typing', Boolean(busy));
    }

    function idleStatus() {
      const s = CD().loadCoachSettings(localStorage, u);
      const pack = CD().buildCoachDataPack(localStorage, u, s.access);
      const parts = [];
      if (pack.workouts) parts.push(`${pack.workouts.length} workout${pack.workouts.length === 1 ? '' : 's'}`);
      if (pack.checkIns && pack.checkIns.length) parts.push(`${pack.checkIns.length} check-ins`);
      if (pack.sleep && pack.sleep.length) parts.push('sleep');
      if (pack.macros) parts.push('macros');
      setStatus(parts.length ? `Can see ${parts.join(', ')}` : 'No data shared yet');
    }

    function renderWelcome() {
      const w = el('div', 'aic-welcome');
      w.appendChild(el('div', 'aic-kicker', 'Your coach'));
      w.appendChild(el('h3', null, 'Ask about your training'));
      w.appendChild(el('p', null, 'It reads your log, check-ins and program, and can suggest changes you approve with one tap.'));
      const chips = el('div', 'aic-suggestions');
      QUICK_ASKS.forEach(q => {
        const b = el('button', 'aic-suggestion-chip', q);
        b.type = 'button';
        b.addEventListener('click', () => submit(q));
        chips.appendChild(b);
      });
      w.appendChild(chips);
      messages.appendChild(w);
    }

    function userBubble(text) {
      const m = el('div', 'aic-msg aic-msg--user');
      m.appendChild(el('div', 'aic-bubble', text));
      return m;
    }

    // One assistant turn: traces, text, charts, cards, memory notes.
    function assistantTurn(turn) {
      const wrap = el('div', 'aic-msg aic-msg--ai');
      const text = el('div', 'aic-text');
      wrap.appendChild(text);
      const extras = el('div', 'aic-extras');
      wrap.appendChild(extras);

      const view = {
        wrap,
        setText(t) { renderRichText(text, t); },
        traces() { renderTraces(wrap, turn.traces || []); },
        chart(c) { const n = renderChart(c); if (n) extras.appendChild(n); },
        card(c) { extras.appendChild(renderCard(u, c, () => saveHistory(u, history))); },
        memory(t) {
          const n = el('div', 'aic-memory-note');
          n.innerHTML = ICON.brain;
          n.appendChild(el('span', null, `Saved to memory: ${t}`));
          extras.appendChild(n);
        },
        error(t) { wrap.classList.add('aic-msg--error'); extras.appendChild(el('div', 'aic-error', t)); },
      };
      view.setText(turn.content || '');
      view.traces();
      (turn.charts || []).forEach(view.chart);
      (turn.cards || []).forEach(view.card);
      (turn.memories || []).forEach(view.memory);
      return view;
    }

    function renderAll() {
      messages.innerHTML = '';
      if (!history.length) renderWelcome();
      history.forEach(m => {
        if (m.role === 'user') messages.appendChild(userBubble(m.content));
        else messages.appendChild(assistantTurn(m).wrap);
      });
      scrollDown();
    }

    function setBusy(busy) {
      sendBtn.innerHTML = busy ? ICON.stop : ICON.send;
      sendBtn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
      sendBtn.title = busy ? 'Stop' : 'Send';
      sendBtn.classList.toggle('aic-send-btn--stop', busy);
    }

    async function submit(textArg) {
      if (controller) { controller.abort(); return; }   // button doubles as Stop
      const text = String(textArg != null ? textArg : input.value).trim();
      if (!text) return;
      input.value = '';
      input.style.height = '';

      const welcome = messages.querySelector('.aic-welcome');
      if (welcome) welcome.remove();

      const prior = history.slice();
      history.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
      messages.appendChild(userBubble(text));

      const turn = { role: 'assistant', content: '', traces: [], charts: [], cards: [], memories: [], timestamp: new Date().toISOString() };
      const view = assistantTurn(turn);
      view.wrap.classList.add('aic-msg--pending');
      messages.appendChild(view.wrap);
      scrollDown();

      controller = new AbortController();
      const timer = setTimeout(() => controller && controller.abort(), STREAM_TIMEOUT_MS);
      setBusy(true);
      setStatus('Reading your log…', true);

      let failed = null;
      try {
        await streamCoach(u, text, prior, controller.signal, (type, p) => {
          if (type === 'text') {
            turn.content += p.delta || '';
            view.setText(turn.content);
            setStatus('Writing…', true);
          } else if (type === 'trace') {
            turn.traces.push(p.label);
            view.traces();
          } else if (type === 'chart') {
            turn.charts.push(p);
            view.chart(p);
          } else if (type === 'card') {
            turn.cards.push(p);
            view.card(p);
          } else if (type === 'memory') {
            CD().addMemory(localStorage, u, p.text, 'chat');
            turn.memories.push(p.text);
            view.memory(p.text);
          } else if (type === 'error') {
            failed = p.message;
          }
          scrollDown();
        });
      } catch (err) {
        if (err.name === 'AbortError') failed = turn.content ? null : 'Stopped.';
        else if (!navigator.onLine) failed = 'You\'re offline. Connect and try again.';
        else failed = err.message || 'Something went wrong. Try again.';
      } finally {
        clearTimeout(timer);
        controller = null;
        setBusy(false);
        view.wrap.classList.remove('aic-msg--pending');
      }

      if (failed) view.error(failed);
      if (turn.content || turn.cards.length) {
        history.push(turn);
      } else {
        history.pop(); // nothing came back — don't keep a dangling question
      }
      saveHistory(u, history);
      idleStatus();
      scrollDown();
    }

    /* ── memory & settings view ────────────────────────────── */

    function renderSettings() {
      const cd = CD();
      const s = cd.loadCoachSettings(localStorage, u);
      settingsView.innerHTML = '';

      const top = el('div', 'aic-settings-head');
      const back = iconBtn('aic-icon-btn', 'back', 'Back to chat');
      back.addEventListener('click', () => toggleSettings(false));
      top.append(back, el('h3', null, 'Your coach knows'));
      settingsView.appendChild(top);

      // Memory
      settingsView.appendChild(el('div', 'aic-kicker', 'Remembered'));
      const memList = el('ul', 'aic-list');
      const mem = cd.loadMemory(localStorage, u);
      if (!mem.length) memList.appendChild(el('li', 'aic-list-empty', 'Nothing yet. The coach saves lasting facts (injuries, schedule, preferences) as you chat.'));
      mem.forEach(m => {
        const li = el('li', 'aic-list-row');
        const txt = el('div', 'aic-list-text');
        txt.appendChild(el('span', null, m.text));
        txt.appendChild(el('small', null, `${m.source === 'you' ? 'Added by you' : 'From chat'} · ${m.date}`));
        const del = iconBtn('aic-icon-btn aic-icon-btn--quiet', 'close', `Forget "${m.text}"`);
        del.addEventListener('click', () => { cd.removeMemory(localStorage, u, m.id); renderSettings(); });
        li.append(txt, del);
        memList.appendChild(li);
      });
      settingsView.appendChild(memList);

      const addForm = el('form', 'aic-add-note');
      const addInput = el('input', 'aic-input');
      addInput.placeholder = 'Add a note for your coach';
      addInput.maxLength = 200;
      addInput.setAttribute('aria-label', 'Add a note for your coach');
      const addBtn = el('button', 'aic-btn aic-btn--ghost', 'Add');
      addBtn.type = 'submit';
      addForm.append(addInput, addBtn);
      addForm.addEventListener('submit', e => {
        e.preventDefault();
        if (!addInput.value.trim()) return;
        cd.addMemory(localStorage, u, addInput.value, 'you');
        renderSettings();
      });
      settingsView.appendChild(addForm);

      // Data access
      settingsView.appendChild(el('div', 'aic-kicker', 'What it can read'));
      const accessList = el('div', 'aic-list');
      cd.ACCESS_KEYS.forEach(k => {
        const row = el('label', 'aic-list-row aic-toggle-row');
        row.appendChild(el('span', null, ACCESS_LABELS[k]));
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = s.access[k];
        cb.addEventListener('change', () => {
          s.access[k] = cb.checked;
          cd.saveCoachSettings(localStorage, u, s);
          idleStatus();
        });
        row.appendChild(cb);
        accessList.appendChild(row);
      });
      settingsView.appendChild(accessList);

      // Style
      settingsView.appendChild(el('div', 'aic-kicker', 'Coaching style'));
      const seg = el('div', 'aic-segmented');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', 'Coaching style');
      [['direct', 'Direct'], ['balanced', 'Balanced'], ['hype', 'Hype']].forEach(([v, label]) => {
        const b = el('button', 'aic-seg', label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(s.style === v));
        b.addEventListener('click', () => {
          s.style = v;
          cd.saveCoachSettings(localStorage, u, s);
          renderSettings();
        });
        seg.appendChild(b);
      });
      settingsView.appendChild(seg);

      const wipe = el('button', 'aic-btn aic-btn--danger', 'Clear chats & memory');
      wipe.type = 'button';
      wipe.addEventListener('click', () => {
        if (!confirm('Delete your coach conversations and everything it remembers?')) return;
        history = [];
        saveHistory(u, history);
        cd.loadMemory(localStorage, u).forEach(m => cd.removeMemory(localStorage, u, m.id));
        renderAll();
        renderSettings();
      });
      settingsView.appendChild(wipe);
    }

    function toggleSettings(show) {
      settingsView.hidden = !show;
      messages.hidden = show;
      inputArea.hidden = show;
      if (show) renderSettings();
    }

    memBtn.addEventListener('click', () => toggleSettings(settingsView.hidden));
    newBtn.addEventListener('click', () => {
      if (controller) controller.abort();
      if (history.length && !confirm('Start a new conversation? This one will be cleared.')) return;
      history = [];
      saveHistory(u, history);
      toggleSettings(false);
      renderAll();
    });
    inputArea.addEventListener('submit', e => { e.preventDefault(); submit(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    input.addEventListener('input', () => {
      input.style.height = '';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    idleStatus();
    renderAll();

    return {
      focus() { setTimeout(() => input.focus(), 300); },
      ask(text) { toggleSettings(false); submit(text); },
      closeButton: root.querySelector('.aic-close'),
    };
  }

  /* ── floating panel ──────────────────────────────────────── */

  let panelCtrl = null;

  function buildFloatingPanel(u) {
    const backdrop = el('div');
    backdrop.id = 'aiCoachBackdrop';
    const panel = el('div');
    panel.id = 'aiCoachPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Coach');
    document.body.append(backdrop, panel);

    const chat = createChat(panel, u, { floating: true });

    function close() {
      panel.classList.remove('aic-open');
      backdrop.classList.remove('aic-open');
      const fab = document.getElementById('aiCoachFab');
      if (fab) fab.hidden = false;
    }
    function open(question) {
      panel.classList.add('aic-open');
      backdrop.classList.add('aic-open');
      const fab = document.getElementById('aiCoachFab');
      if (fab) fab.hidden = true;
      if (question) chat.ask(question); else chat.focus();
    }
    chat.closeButton.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panel.classList.contains('aic-open')) close();
    });
    return { open, close };
  }

  function initFloatingButton(u) {
    if (document.getElementById('aiCoachFab')) return;
    const fab = el('button');
    fab.id = 'aiCoachFab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Open your coach');
    fab.innerHTML = ICON.coach;
    document.body.appendChild(fab);

    panelCtrl = buildFloatingPanel(u);
    fab.addEventListener('click', () => panelCtrl.open());

    const seenKey = `aiCoachSeen_${u}`;
    if (!localStorage.getItem(seenKey)) {
      setTimeout(() => fab.classList.add('aic-pulse'), 800);
      setTimeout(() => {
        fab.classList.remove('aic-pulse');
        localStorage.setItem(seenKey, '1');
      }, 5200);
    }
  }

  /* ── public API ──────────────────────────────────────────── */

  window.initAiCoach = function (username) {
    if (!username || !window.CoachData) return;
    initFloatingButton(username);
  };

  window.initAiCoachEmbed = function (container, username) {
    if (!container || !username || !window.CoachData) return;
    container.innerHTML = '';
    const box = el('div', 'aic-embedded');
    container.appendChild(box);
    createChat(box, username, { floating: false });
  };

  // openAiCoach('Why has my squat stalled?') opens the panel and asks it.
  window.openAiCoach = function (question) {
    if (panelCtrl) panelCtrl.open(typeof question === 'string' ? question : undefined);
  };
})();
