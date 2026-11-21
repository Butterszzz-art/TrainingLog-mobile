/* =============================================================
   COACH DASHBOARD — Walkthrough (for recording a Loom review)
   One client's data as a run of short chapters, each with a line
   to say, the chart that goes with it and a few talking points.
   "Present" shows one chapter at a time, full screen, stepped with
   the arrow keys, so the coach can screen-record and talk over it.
   Uses the helpers and state in coach.js (loaded before this file).
   ============================================================= */

(function () {
  const SCORES = [
    ['sleep', 'sleep'], ['energy', 'energy'], ['stress', 'stress', true], ['hunger', 'hunger'],
    ['trainingPerformance', 'training'], ['cardioAdherence', 'cardio'], ['mood', 'mood'],
    ['motivation', 'motivation'], ['digestion', 'digestion'], ['soreness', 'soreness', true],
  ];
  const NEXT_KEY = 'coachWalkthroughNext:';
  let _chapters = [];
  let _presentIndex = 0;
  let _showScript = true;

  const firstName = c => escapeHtml(String(c.clientName || 'there').split(' ')[0]);
  const round1 = n => Math.round(Number(n) * 10) / 10;
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const list = items => items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];

  function readNext(id) {
    try { return localStorage.getItem(NEXT_KEY + id) || ''; } catch { return ''; }
  }
  function writeNext(id, text) {
    try { localStorage.setItem(NEXT_KEY + id, text); } catch { /* private window */ }
  }

  // ── Chapters ────────────────────────────────────────────────
  // Each: { key, title, say (one spoken line), points [], visual (html) }.
  // A chapter with nothing to talk about is left out.

  function buildChapters(c) {
    const d = _clientDetails[c.id] || {};
    const checkIns = (d.checkIns || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const ci = checkIns[0] || c.latestCheckInData || {};
    const prev = checkIns[1];
    const bw = d.bodyweight || [];
    const weeks = d.weeklyWorkouts || [];
    const name = firstName(c);
    const out = [];

    // 1. Intro
    const program = c.activeProgramName || c.currentProgram;
    const started = c.activeProgramStartDate ? daysSinceIso(c.activeProgramStartDate) : null;
    const introPoints = [];
    if (program) introPoints.push('Program: <b>' + escapeHtml(program) + '</b>'
      + (started != null ? ' · week ' + (Math.floor(started / 7) + 1) : ''));
    if (c.trainingMode) introPoints.push('Phase: <b>' + escapeHtml(c.trainingMode) + '</b>');
    if (ci.date) introPoints.push('Check-in reviewed: <b>' + escapeHtml(shortDate(ci.date)) + '</b>');
    introPoints.push('Overall: ' + statusChip(c.alertStatus));
    out.push({
      key: 'intro', title: 'Where you\'re at',
      say: 'Hey ' + name + ', here\'s your review' + (ci.date ? ' for your ' + escapeHtml(shortDate(ci.date)) + ' check-in' : '')
        + '. I\'ll go through your weight, training, how the week felt, and what we\'re doing next.',
      points: introPoints,
      visual: '<div class="wt-hero"><div class="detail-avatar wt-hero-avatar">' + initialsOf(c.clientName) + '</div>'
        + '<div><div class="ca-kicker">Check-in review</div><div class="wt-hero-name">' + escapeHtml(c.clientName || '') + '</div>'
        + '<div class="detail-meta">' + new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + '</div></div></div>',
    });

    // 2. Bodyweight
    if (bw.length >= 2) {
      const first = bw[0], last = bw[bw.length - 1];
      const change = round1(last.weight - first.weight);
      const wk = Math.max(1, Math.round((Date.parse(last.date) - Date.parse(first.date)) / 604800000));
      const rate = c.weeklyWeightChangePercent;
      const dir = change < 0 ? 'down' : change > 0 ? 'up' : 'level';
      const recent = bw.filter(p => daysSinceIso(p.date) <= 14);
      out.push({
        key: 'weight', title: 'Bodyweight',
        say: (dir === 'level' ? 'Your weight has held steady' : 'You\'re ' + dir + ' ' + Math.abs(change) + ' kg')
          + ' over the last ' + plural(wk, 'week') + (rate != null ? ', about ' + Math.abs(round1(rate * 100) / 100) + '% of bodyweight a week' : '')
          + '. You\'re sitting at ' + last.weight + ' kg now.',
        points: [
          'Start → now: <b>' + first.weight + ' → ' + last.weight + ' kg</b> (' + signed(change, 1) + ')',
          rate != null ? 'Weekly rate: <b>' + signed(rate, 2) + '%</b>' : '',
          'Weigh-ins in the last 2 weeks: <b>' + recent.length + '</b>',
        ].filter(Boolean),
        visual: weightChart(bw).replace(/caWeightFill/g, 'wtWeightFill'),
      });
    }

    // 3. Training
    if (weeks.length || c.compliancePercent != null || c.workoutsLoggedThisWeek != null) {
      const avg = weeks.length ? round1(weeks.reduce((a, w) => a + w.count, 0) / weeks.length) : null;
      const p = c.compliancePercent;
      const verdict = p == null ? '' : p >= 85 ? ' — that\'s really consistent, great work.' : p >= 65 ? ' — solid, with a bit of room to tighten up.' : ' — let\'s talk about what got in the way.';
      out.push({
        key: 'training', title: 'Training',
        say: (c.workoutsLoggedThisWeek != null ? 'You\'ve logged ' + plural(c.workoutsLoggedThisWeek, 'session') + ' this week' : 'Here\'s your training')
          + (avg != null ? ', averaging ' + avg + ' a week' : '')
          + (p != null ? ', and you\'ve hit ' + p + '% of your planned sessions' + verdict : '.'),
        points: [
          p != null ? 'Compliance: <b>' + p + '%</b> ' + meter(p, complianceTone(p)) : '',
          avg != null ? 'Average: <b>' + avg + '</b> sessions / week over ' + plural(weeks.length, 'week') : '',
          program ? 'Following <b>' + escapeHtml(program) + '</b>' : '',
        ].filter(Boolean),
        visual: weekBars(weeks),
      });
    }

    // 4. Check-in scores
    const scored = SCORES.filter(([k]) => ci[k] != null);
    if (scored.length) {
      const moves = prev ? scored.filter(([k]) => prev[k] != null).map(([k, label, inv]) => {
        const delta = round1(ci[k] - prev[k]);
        return { label, delta, better: inv ? delta < 0 : delta > 0 };
      }).filter(m => m.delta) : [];
      const up = moves.filter(m => m.better).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).map(m => m.label);
      const down = moves.filter(m => !m.better).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).map(m => m.label);
      let say = 'Looking at how the week felt';
      if (!prev) say += ': this is our baseline, so we\'ll compare against it next time.';
      else if (!up.length && !down.length) say += ', everything held steady since last check-in.';
      else say += (up.length ? ', ' + list(up.slice(0, 3)) + (up.length === 1 ? ' improved' : ' all improved') : '')
        + (down.length ? (up.length ? ', but ' : ', ') + list(down.slice(0, 2)) + (down.length === 1 ? ' slipped' : ' slipped a bit') + ' — let\'s keep an eye on that' : '') + '.';
      out.push({
        key: 'scores', title: 'How the week felt',
        say,
        points: [
          up.length ? 'Better: <b>' + escapeHtml(list(up)) + '</b>' : '',
          down.length ? 'Worse: <b>' + escapeHtml(list(down)) + '</b>' : '',
          prev ? 'Compared with ' + escapeHtml(shortDate(prev.date)) : '',
        ].filter(Boolean),
        visual: scoreRows(ci, prev),
      });
    }

    // 5. In their words
    const answers = (ci.answers || []).filter(x => x && x.a);
    if (ci.notes || answers.length) {
      out.push({
        key: 'words', title: 'What you told me',
        say: 'You mentioned a few things in your check-in — let me answer those.',
        points: [],
        visual: (ci.notes ? '<p class="checkin-client-quote wt-quote">&ldquo;' + escapeHtml(ci.notes) + '&rdquo;</p>' : '')
          + answers.map(x => '<div class="ci-answer"><span class="ci-answer-q">' + escapeHtml(x.q) + '</span><span class="ci-answer-a">' + escapeHtml(x.a) + '</span></div>').join(''),
      });
    }

    // 6. Nutrition
    const m = c.macroTargets || {};
    if (c.macroPlan?.days || m.calories) {
      const days = c.macroPlan?.days ? MACRO_DAY_TYPES.filter(t => c.macroPlan.days[t.key]) : [];
      const tr = c.macroPlan?.days?.training;
      const kcal = tr ? macroKcal(tr.protein, tr.carbs, tr.fat) : m.calories;
      const protein = tr ? tr.protein : m.protein;
      out.push({
        key: 'nutrition', title: 'Nutrition',
        say: 'Your targets are ' + kcal + ' calories' + (days.length > 1 ? ' on training days' : '') + ' with ' + protein + ' g of protein'
          + (days.length > 1 ? ', and they shift on ' + list(days.slice(1).map(t => t.label.toLowerCase())) + ' days' : '') + '.',
        points: days.length
          ? days.map(t => { const x = c.macroPlan.days[t.key]; return t.label + ': <b>' + macroKcal(x.protein, x.carbs, x.fat) + ' kcal</b> · ' + x.protein + 'P / ' + x.carbs + 'C / ' + x.fat + 'F'; })
          : ['<b>' + m.calories + ' kcal</b> · ' + m.protein + 'P / ' + m.carbs + 'C / ' + m.fat + 'F'],
        visual: days.length
          ? '<div class="d-stat-grid">' + days.map(t => { const x = c.macroPlan.days[t.key]; return stat(t.label, macroKcal(x.protein, x.carbs, x.fat) + '<small>kcal</small>'); }).join('') + '</div>'
          : '<div class="d-stat-grid">' + stat('Calories', m.calories) + stat('Protein', m.protein + '<small>g</small>') + stat('Carbs', m.carbs + '<small>g</small>') + stat('Fat', m.fat + '<small>g</small>') + '</div>',
      });
    }

    // 7. What I'm watching
    if ((c.alerts || []).length) {
      out.push({
        key: 'watching', title: 'What I\'m watching',
        say: 'A couple of things I\'m keeping an eye on: ' + escapeHtml(list(c.alerts.slice(0, 3).map(a => String(a.label || '').toLowerCase()))) + '.',
        points: c.alerts.map(a => '<b>' + escapeHtml(a.label) + '</b> — ' + escapeHtml(a.reason)),
        visual: '',
      });
    }

    // 8. Next steps (typed by the coach, kept as a draft in this browser)
    const next = readNext(c.id).split('\n').map(s => s.trim()).filter(Boolean);
    out.push({
      key: 'next', title: 'Next steps',
      say: next.length ? 'So for this coming week, here\'s the plan.' : 'So for this coming week… (type your next steps below)',
      points: next.map(escapeHtml),
      visual: '<textarea class="coach-input wt-next" rows="3" placeholder="One per line, e.g. Keep calories the same&#10;Add a 4th session on Saturday"'
        + ' oninput="walkthroughNextChanged(\'' + escapeHtml(c.id) + '\', this.value)">' + escapeHtml(readNext(c.id)) + '</textarea>',
      editable: true,
    });
    out.push({
      key: 'outro', title: 'Wrap-up', say: 'That\'s it from me — reply in the app if anything\'s unclear. Keep it up, ' + name + '!',
      points: [], visual: '',
    });
    return out;
  }

  // ── Page view ───────────────────────────────────────────────

  function chapterHtml(ch, i, total) {
    return '<section class="d-card wt-chapter" data-wt="' + ch.key + '">'
      + '<div class="wt-chapter-head"><span class="wt-num">' + (i + 1) + '</span>'
      + '<span class="d-card-title">' + ch.title + '</span><span class="wt-of">' + (i + 1) + ' / ' + total + '</span></div>'
      + '<p class="wt-say">' + ic('message') + '<span>' + ch.say + '</span></p>'
      + '<div class="wt-body">' + (ch.visual ? '<div class="wt-visual">' + ch.visual + '</div>' : '')
      + (ch.points.length ? '<ul class="wt-points">' + ch.points.map(p => '<li>' + p + '</li>').join('') + '</ul>' : '') + '</div>'
      + '</section>';
  }

  window.renderWalkthrough = function (c) {
    const el = document.getElementById('dtab_walkthrough');
    if (!el) return;
    if (c.status === 'pending') {
      el.innerHTML = '<div class="d-card"><p class="ws-empty-note">The walkthrough fills in once ' + escapeHtml(c.clientName) + ' accepts and shares data.</p></div>';
      return;
    }
    if (_clientDetails[c.id] === undefined) {
      el.innerHTML = '<div class="d-card"><p class="ws-empty-note">Loading…</p></div>';
      return;
    }
    _chapters = buildChapters(c);
    const words = _chapters.reduce((n, ch) => n + ch.say.replace(/<[^>]+>/g, '').split(/\s+/).length + ch.points.length * 8, 0);
    const mins = Math.max(1, Math.round(words / 130));
    el.innerHTML = '<div class="d-card wt-bar">'
      + '<div><div class="ca-kicker">Loom walkthrough</div><div class="wt-bar-title">' + plural(_chapters.length, 'chapter') + ' · about ' + plural(mins, 'minute') + ' to talk through</div>'
      + '<p class="ws-empty-note">Read the line in each chapter, then the points. Hit Present for a full-screen, one-at-a-time view to record over.</p></div>'
      + '<div class="ca-actions"><button class="bulk-action-btn" onclick="walkthroughPresent(0)">' + ic('video') + ' Present</button>'
      + '<button class="bulk-action-btn bulk-action-btn--ghost" onclick="walkthroughCopyScript(this)">' + ic('pencil') + ' Copy script</button></div>'
      + '</div>'
      + _chapters.map((ch, i) => chapterHtml(ch, i, _chapters.length)).join('');
  };

  // Next-step lines are a local draft; refresh only the text of the page
  // (re-rendering would steal focus from the textarea).
  window.walkthroughNextChanged = function (id, value) {
    writeNext(id, value);
    const c = _clients.find(x => x.id === id);
    if (!c) return;
    const ch = buildChapters(c).find(x => x.key === 'next');
    _chapters = _chapters.map(x => (x.key === 'next' ? ch : x));
    const card = document.querySelector('.wt-chapter[data-wt="next"]');
    if (!card) return;
    card.querySelector('.wt-say span').innerHTML = ch.say;
    let ul = card.querySelector('.wt-points');
    if (!ul) { ul = document.createElement('ul'); ul.className = 'wt-points'; card.querySelector('.wt-body').appendChild(ul); }
    ul.innerHTML = ch.points.map(p => '<li>' + p + '</li>').join('');
  };

  window.walkthroughCopyScript = async function (btn) {
    const text = _chapters.map((ch, i) => {
      const strip = s => String(s).replace(/<[^>]+>/g, '').replace(/&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      return (i + 1) + '. ' + strip(ch.title) + '\n' + strip(ch.say) + ch.points.map(p => '\n  • ' + strip(p)).join('');
    }).join('\n\n');
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch { btn.textContent = 'Couldn\'t copy'; }
    setTimeout(() => { btn.innerHTML = ic('pencil') + ' Copy script'; }, 1600);
  };

  // ── Present mode ────────────────────────────────────────────

  function paintPresenter() {
    const ov = document.getElementById('wtPresenter');
    const ch = _chapters[_presentIndex];
    if (!ov || !ch) return;
    ov.classList.toggle('is-script-hidden', !_showScript);
    ov.innerHTML = '<div class="wt-p-top"><span class="ca-kicker">' + (_presentIndex + 1) + ' / ' + _chapters.length + '</span>'
      + '<div class="wt-p-dots">' + _chapters.map((_, i) => '<i class="' + (i === _presentIndex ? 'is-on' : i < _presentIndex ? 'is-done' : '') + '"></i>').join('') + '</div>'
      + '<span class="wt-p-keys">← → step · S script · Esc exit</span></div>'
      + '<div class="wt-p-stage"><h2 class="wt-p-title">' + ch.title + '</h2>'
      + '<p class="wt-p-say">' + ch.say + '</p>'
      + '<div class="wt-p-body">' + (ch.visual && !ch.editable ? '<div class="wt-visual">' + ch.visual + '</div>' : '')
      + (ch.points.length ? '<ul class="wt-points">' + ch.points.map(p => '<li>' + p + '</li>').join('') + '</ul>' : '') + '</div></div>';
  }

  function onKey(e) {
    if (e.key === 'Escape') return window.walkthroughExit();
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); _presentIndex = Math.min(_chapters.length - 1, _presentIndex + 1); paintPresenter(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); _presentIndex = Math.max(0, _presentIndex - 1); paintPresenter(); }
    if (e.key === 's' || e.key === 'S') { _showScript = !_showScript; paintPresenter(); }
  }

  window.walkthroughPresent = function (start) {
    if (!_chapters.length) return;
    _presentIndex = start || 0;
    let ov = document.getElementById('wtPresenter');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'wtPresenter';
      ov.className = 'wt-presenter';
      ov.addEventListener('click', e => {
        if (e.target.closest('button, a, textarea')) return;
        _presentIndex = Math.min(_chapters.length - 1, _presentIndex + 1);
        paintPresenter();
      });
      document.body.appendChild(ov);
    }
    paintPresenter();
    document.addEventListener('keydown', onKey);
    ov.requestFullscreen?.().catch(() => {});
  };

  window.walkthroughExit = function () {
    document.removeEventListener('keydown', onKey);
    document.getElementById('wtPresenter')?.remove();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
})();
