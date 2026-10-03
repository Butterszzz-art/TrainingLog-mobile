/* ── Story sticker (Strava-style workout overlay) ───────────────────
 * The stats half of the workout story: a transparent PNG that sits on
 * top of the user's own photo, either in our composer or as a movable
 * sticker inside Instagram's story editor.
 *
 * buildStickerData() is pure (tested in tests/storySticker.test.js);
 * drawSticker() renders it onto a transparent canvas.
 */
(function (root) {
  'use strict';

  const LEG = ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors', 'legs'];
  const PUSH = ['chest', 'shoulders', 'triceps'];
  const PULL = ['back', 'biceps', 'traps', 'forearms'];
  const HISTORY_POINTS = 8;

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function epley(weight, reps) {
    const w = num(weight);
    const r = num(reps);
    return w > 0 && r > 0 ? w * (1 + r / 30) : 0;
  }

  function nameKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function workoutVolume(workout) {
    let v = 0;
    (workout?.log || []).forEach((e) => {
      const reps = e.repsArray || [];
      (e.weightsArray || []).forEach((w, i) => { v += num(w) * num(reps[i]); });
    });
    return v;
  }

  // Best set of the session by estimated 1RM, with the weight × reps that
  // produced it. Duplicate log entries for one exercise are fine — every
  // set is considered on its own.
  function bestSet(workout, onlyKey) {
    let best = null;
    (workout?.log || []).forEach((e) => {
      const key = nameKey(e.exercise);
      if (!key || (onlyKey && key !== onlyKey)) return;
      const reps = e.repsArray || [];
      (e.weightsArray || []).forEach((w, i) => {
        const est = epley(w, reps[i]);
        if (est > 0 && (!best || est > best.e1rm)) {
          best = { exercise: e.exercise.trim(), key, weight: num(w), reps: num(reps[i]), e1rm: est, unit: e.unit || 'kg' };
        }
      });
    });
    return best;
  }

  // 'leg' / 'push' / 'pull' when at least 60% of the sets land in one
  // bucket, otherwise null (full-body or unmapped exercises).
  function sessionFocus(workout, getGroup) {
    if (typeof getGroup !== 'function') return null;
    const counts = { leg: 0, push: 0, pull: 0 };
    let total = 0;
    (workout?.log || []).forEach((e) => {
      const sets = (e.repsArray || []).length || 1;
      const g = getGroup(e.exercise);
      total += sets;
      if (LEG.includes(g)) counts.leg += sets;
      else if (PUSH.includes(g)) counts.push += sets;
      else if (PULL.includes(g)) counts.pull += sets;
    });
    if (!total) return null;
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    return counts[top] / total >= 0.6 ? top : null;
  }

  // Sets logged for one exercise across every entry of the session (quick
  // log saves each set as its own entry).
  function setCountFor(workout, key) {
    return (workout?.log || []).reduce((n, e) => (
      nameKey(e.exercise) === key ? n + (e.repsArray || []).length : n
    ), 0);
  }

  function exerciseKeys(workout) {
    return new Set((workout?.log || []).map((e) => nameKey(e.exercise)).filter(Boolean));
  }

  function overlap(a, b) {
    const ka = exerciseKeys(a);
    const kb = exerciseKeys(b);
    if (!ka.size || !kb.size) return 0;
    let shared = 0;
    ka.forEach((k) => { if (kb.has(k)) shared++; });
    return shared / Math.min(ka.size, kb.size);
  }

  function dateOf(w) {
    const t = new Date(String(w?.date || '').slice(0, 10) + 'T00:00:00').getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  // Sessions strictly before this one, newest first, without duplicates
  // (the live list and the archive can briefly hold the same workout).
  function earlierSessions(workout, history) {
    const now = dateOf(workout);
    const seen = new Set();
    return (history || [])
      .filter((w) => w && w !== workout && Array.isArray(w.log) && w.log.length)
      .filter((w) => {
        const t = dateOf(w);
        return Number.isFinite(t) && (!Number.isFinite(now) || t < now);
      })
      .filter((w) => {
        const sig = String(w.date).slice(0, 10) + '|' + [...exerciseKeys(w)].sort().join(',') + '|' + workoutVolume(w);
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      })
      .sort((a, b) => dateOf(b) - dateOf(a));
  }

  const FOCUS_LABEL = { leg: 'leg day', push: 'push day', pull: 'pull day' };

  /**
   * Everything the sticker shows, from the workout and the user's history.
   * @returns {{
   *   volume:number, unit:string, sets:number, exercises:number,
   *   topLift: null | {exercise, weight, reps, e1rm, unit, sets},  // sets: that exercise's sets this session
   *   progress: null | {text:string, kind:'pr'|'volume'|'strength'},
   *   trend: number[]   // top lift's best e1RM per session, oldest → today
   * }}
   */
  function buildStickerData(workout, history, getGroup) {
    const log = workout?.log || [];
    const unit = log[0]?.unit || workout?.unit || 'kg';
    const sets = log.reduce((s, e) => s + (e.repsArray || []).length, 0);
    const volume = workoutVolume(workout);
    const earlier = earlierSessions(workout, history);

    // The featured lift is the one that improved most over its recent
    // history (that's the story worth telling); with no improvement
    // anywhere it falls back to the heaviest lift by estimated 1RM.
    let topLift = null;
    let trend = [];
    let bestGain = 0;
    exerciseKeys(workout).forEach((key) => {
      const today = bestSet(workout, key);
      const past = [];
      for (const w of earlier) {
        const b = bestSet(w, key);
        if (b) past.push(b.e1rm);
      }
      const series = past.slice(0, HISTORY_POINTS - 1).reverse().concat(today.e1rm);
      const gain = series.length >= 2 ? today.e1rm / Math.min(...series.slice(0, -1)) - 1 : 0;
      if (gain > bestGain) {
        bestGain = gain;
        topLift = { ...today, past };
        trend = series;
      }
    });
    if (!topLift) {
      const heaviest = bestSet(workout);
      if (heaviest) {
        const past = earlier.map((w) => bestSet(w, heaviest.key)).filter(Boolean).map((b) => b.e1rm);
        topLift = { ...heaviest, past };
        trend = past.slice(0, HISTORY_POINTS - 1).reverse().concat(heaviest.e1rm);
      }
    }
    const isPR = !!topLift && topLift.past.length > 0 && topLift.e1rm > Math.max(...topLift.past);

    // Progress line: the strongest honest signal we have. Never shows a
    // drop — if nothing went up, the line is left off.
    let progress = null;
    if (isPR) {
      progress = { kind: 'pr', text: `New ${topLift.exercise} PR` };
    } else {
      const focus = sessionFocus(workout, getGroup);
      const prev = earlier.find((w) => (focus && sessionFocus(w, getGroup) === focus) || overlap(workout, w) >= 0.5);
      const prevVol = prev ? workoutVolume(prev) : 0;
      const pct = prevVol > 0 ? Math.round(((volume - prevVol) / prevVol) * 100) : 0;
      if (pct >= 2) {
        const label = focus && sessionFocus(prev, getGroup) === focus ? `last ${FOCUS_LABEL[focus]}` : 'last similar session';
        progress = { kind: 'volume', text: `${pct}% more volume than ${label}` };
      } else if (trend.length >= 3 && trend[trend.length - 1] > trend[0]) {
        const up = Math.round(((trend[trend.length - 1] - trend[0]) / trend[0]) * 100);
        if (up >= 1) progress = { kind: 'strength', text: `${topLift.exercise} up ${up}% over ${trend.length} sessions` };
      }
    }

    return {
      volume,
      unit,
      sets,
      exercises: exerciseKeys(workout).size,
      topLift: topLift ? { exercise: topLift.exercise, weight: topLift.weight, reps: topLift.reps, e1rm: topLift.e1rm, unit: topLift.unit, sets: setCountFor(workout, topLift.key) } : null,
      progress,
      trend,
    };
  }

  // "4 sets · 8 reps × 100 kg"
  function setsAndBest(t) {
    const sets = `${t.sets} set${t.sets === 1 ? '' : 's'}`;
    const reps = `${t.reps} rep${t.reps === 1 ? '' : 's'}`;
    return `${sets} · ${reps} × ${formatNumber(t.weight)} ${t.unit}`;
  }

  function formatNumber(n) {
    const r = Math.round(n * 10) / 10;
    return r.toLocaleString('en-US', { maximumFractionDigits: 1 });
  }

  // ── Drawing ────────────────────────────────────────────────────────
  const STICKER_W = 1080;
  const ACCENT = '#52d68a';
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // Trend line points, normalised into a w × h box. A flat history sits
  // on the middle line instead of hugging the bottom edge.
  function trendPoints(trend, w, h) {
    if (!trend || trend.length < 2) return [];
    const min = Math.min(...trend);
    const max = Math.max(...trend);
    const span = max - min;
    return trend.map((v, i) => ({
      x: (i / (trend.length - 1)) * w,
      y: span ? h - ((v - min) / span) * h : h / 2,
    }));
  }

  /**
   * Render the sticker onto `canvas` (resized to fit) with a transparent
   * background. Returns the canvas.
   */
  function drawSticker(canvas, data) {
    canvas.width = STICKER_W;
    canvas.height = 1600;
    // Paint once to measure, then trim the canvas to the content so the
    // sticker has no dead transparent space (Instagram sizes stickers by
    // their bounds).
    const endY = paintSticker(canvas.getContext('2d'), data);
    canvas.height = Math.ceil(endY + 60);
    paintSticker(canvas.getContext('2d'), data);
    return canvas;
  }

  function paintSticker(ctx, data) {
    const W = STICKER_W;
    const hasTrend = data.trend && data.trend.length >= 2;
    ctx.clearRect(0, 0, W, ctx.canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    // A soft shadow keeps white text readable on bright photos (sky,
    // white gym walls) without looking like a box.
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18;

    const cx = W / 2;
    let y = 90;

    function label(text) {
      ctx.font = `600 38px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
      ctx.fillText(text.toUpperCase(), cx, y);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      y += 104;
    }
    function value(text, size) {
      ctx.font = `800 ${size}px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      let s = size;
      while (ctx.measureText(text).width > W - 80 && s > 48) {
        s -= 4;
        ctx.font = `800 ${s}px ${FONT}`;
      }
      ctx.fillText(text, cx, y);
      y += 40;
    }

    label('Volume');
    value(`${formatNumber(data.volume)} ${data.unit}`, 104);

    if (data.progress) {
      y += 22;
      ctx.font = `600 36px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      const arrow = data.progress.kind === 'pr' ? '★ ' : '↗ ';
      ctx.fillText(arrow + data.progress.text, cx, y);
      y += 20;
    }

    // The featured lift: its sets this session, then its best set spelled
    // out as reps × weight — a bare "100×8" read as sets × reps.
    if (data.topLift) {
      y += 70;
      label('Top lift'); // a PR is already called out on the ★ line above
      const t = data.topLift;
      value(t.exercise, 84);
      y += 46;
      value(setsAndBest(t), 60);
    }

    if (hasTrend) {
      const boxW = 560;
      const boxH = 190;
      const x0 = cx - boxW / 2;
      const y0 = y + 40;
      const pts = trendPoints(data.trend, boxW, boxH).map((p) => ({ x: x0 + p.x, y: y0 + p.y }));
      ctx.lineWidth = 14;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.shadowBlur = 0;
      const first = pts[0];
      const last = pts[pts.length - 1];
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(first.x, first.y, 14, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(last.x, last.y, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ACCENT;
      ctx.beginPath(); ctx.arc(last.x, last.y, 17, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 18;
      y = y0 + boxH + 84;
      ctx.font = `500 32px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillText(`Est. 1RM · last ${data.trend.length} sessions`, cx, y);
    }

    y += 96;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
    ctx.fillText('POCKET COACH', cx, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.shadowBlur = 0;
    return y;
  }

  const api = { buildStickerData, sessionFocus, trendPoints, drawSticker, epley, setsAndBest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.StorySticker = api;
})(typeof window !== 'undefined' ? window : null);
