/* =============================================================
   PROGRESS STORY
   Renders the 30-day progress report as a single portrait canvas
   image (1080×1920 — Instagram Story ratio), styled with the app's
   Modernist design tokens (Anton / Barlow Condensed / Archivo,
   green ramp + brass accents from css/tokens.css) instead of the
   old white printable HTML report.

   Shows: overview stats, personal records, and every exercise
   trained in the period with its sets/reps/best weight/volume.
   Replaces the previous "Generate Progress Report (PDF)" flow.
   ============================================================= */

(function initProgressStory() {
  'use strict';

  /* ── Palette — mirrors css/tokens.css so this stays in sync with
     the app's real theme instead of hardcoding a second palette. ── */
  const T = {
    ground:      '#050807',
    groundMid:   '#0a120e',
    podBg:       '#101614',
    surfaceRaised:'#161f1a',
    border:      'rgba(116,138,126,0.20)',
    borderSoft:  'rgba(116,138,126,0.14)',
    text:        '#f4f7f5',
    textSecondary:'#c9d2cc',
    textLabel:   '#6d8076',
    textFaint:   '#5a675f',
    green100:    '#8ec2a4',
    green90:     '#6fae8b',
    green70:     '#3d9d73',
    green60:     '#2f8a63',
    green50:     '#236b4e',
    green30:     '#17472f',
    green20:     '#143c2b',
    brassLight:  '#e0bd82',
    brass:       '#c79a54',
    brassDeep:   '#6d5124',
  };

  const FONT_DISPLAY = 'Anton';
  const FONT_LABEL   = 'Barlow Condensed';
  const FONT_BODY    = 'Archivo';

  function closeProgressStoryModal() {
    const modal = document.getElementById('progressStoryModal');
    if (modal) modal.style.display = 'none';
  }

  function _ensureModal() {
    if (document.getElementById('progressStoryModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="progressStoryModal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);overflow-y:auto;padding:24px 16px;">
        <div style="max-width:420px;margin:0 auto;">
          <div style="border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.6);margin-bottom:20px;">
            <canvas id="progressStoryCanvas" style="display:block;width:100%;height:auto;"></canvas>
          </div>
          <div style="display:flex;gap:10px;">
            <button id="progressStoryDownloadBtn" style="flex:1;padding:14px;border-radius:12px;border:none;background:${T.green60};color:#fff;font-size:0.95rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
              <span class="ui-icon" data-icon="download"></span> Save Image
            </button>
            <button id="progressStoryShareBtn" style="flex:1;padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.12);color:#fff;font-size:0.95rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
              <span class="ui-icon" data-icon="share"></span> Share
            </button>
            <button id="progressStoryCloseBtn" style="padding:14px 18px;border-radius:12px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.6);font-size:0.9rem;cursor:pointer;">
              <span class="ui-icon" data-icon="x"></span>
            </button>
          </div>
          <p style="text-align:center;color:rgba(255,255,255,0.35);font-size:0.75rem;margin-top:12px;">
            Save to camera roll · Post to your story <span class="ui-icon" data-icon="camera"></span>
          </p>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);

    document.getElementById('progressStoryCloseBtn').addEventListener('click', closeProgressStoryModal);
    document.getElementById('progressStoryModal').addEventListener('click', function (e) {
      if (e.target === this) closeProgressStoryModal();
    });
  }

  function openProgressStoryModal() {
    if (!window.__gatherProgressReportData) {
      window.showToast?.('Report data is unavailable right now.', 'warn');
      return;
    }
    const data = window.__gatherProgressReportData();
    if (!data) { window.showToast?.('Please log in first.', 'warn'); return; }

    _ensureModal();
    const modal = document.getElementById('progressStoryModal');
    modal.style.display = 'block';

    // Force the webfonts used on the canvas to be ready first — canvas
    // text draws synchronously and silently falls back to a system font
    // if Anton/Barlow Condensed/Archivo haven't finished loading yet.
    const fontsReady = Promise.all([
      document.fonts.load(`400 100px "${FONT_DISPLAY}"`),
      document.fonts.load(`600 100px "${FONT_LABEL}"`),
      document.fonts.load(`700 100px "${FONT_LABEL}"`),
      document.fonts.load(`500 100px "${FONT_BODY}"`),
      document.fonts.load(`600 100px "${FONT_BODY}"`),
      document.fonts.load(`700 100px "${FONT_BODY}"`),
    ]).catch(() => {});

    Promise.race([fontsReady, new Promise((res) => setTimeout(res, 800))])
      .then(() => requestAnimationFrame(() => drawProgressStory(data)));
  }

  function drawProgressStory(d) {
    const canvas = document.getElementById('progressStoryCanvas');
    const W = 1080, H = 1920;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const em = (n) => Math.round(n * (W / 375));

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
    function truncate(text, maxW) {
      if (ctx.measureText(text).width <= maxW) return text;
      let t = text;
      // Shrink until text + the ellipsis we're about to append actually
      // fits — checking `t` alone here would let the appended '…' push
      // the result back over maxW and into whatever sits to its right.
      while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      return t + '…';
    }
    function fmtVol(v) {
      return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
    }
    // Shrinks font-size until `text` fits maxW, so short-lived values (a
    // 5-digit volume, say) never bleed into a neighbouring column.
    function fitFont(text, weight, family, baseSize, minSize, maxW) {
      let size = baseSize;
      ctx.font = `${weight} ${size}px "${family}", sans-serif`;
      while (ctx.measureText(text).width > maxW && size > minSize) {
        size -= 1;
        ctx.font = `${weight} ${size}px "${family}", sans-serif`;
      }
      return size;
    }

    /* ── 1. Background — mirrors the app's radial wash over --ground ── */
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.groundMid);
    bg.addColorStop(0.35, T.ground);
    bg.addColorStop(1, '#040605');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.5, -H * 0.05, 0, W * 0.5, -H * 0.05, W * 1.1);
    glow.addColorStop(0, 'rgba(52,122,88,0.42)');
    glow.addColorStop(0.5, 'rgba(35,84,62,0.18)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    /* ── 2. Top accent bar ── */
    const accent = ctx.createLinearGradient(0, 0, W, 0);
    accent.addColorStop(0, T.green60);
    accent.addColorStop(1, T.green70);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, em(5));

    /* ── 3. Header — single-line title so it can't eat the whole
       page; shrinks to fit if the two words run wide. ── */
    ctx.font = `600 ${em(12)}px "${FONT_LABEL}", sans-serif`;
    ctx.fillStyle = T.textLabel;
    ctx.letterSpacing = `${em(2)}px`;
    ctx.fillText('POCKET COACH', em(36), em(46));
    ctx.letterSpacing = '0px';

    const titleMaxW = W - em(72);
    const titleSize = fitFont('PROGRESS REPORT', 400, FONT_DISPLAY, em(46), em(28), titleMaxW);
    ctx.font = `400 ${titleSize}px "${FONT_DISPLAY}", sans-serif`;
    ctx.fillStyle = T.text;
    ctx.fillText('PROGRESS ', em(34), em(104));
    const progressW = ctx.measureText('PROGRESS ').width;
    ctx.fillStyle = T.green90;
    ctx.fillText('REPORT', em(34) + progressW, em(104));

    const rangeStr = `${d.range.start} → ${d.range.end}`;
    ctx.font = `500 ${em(14)}px "${FONT_BODY}", sans-serif`;
    ctx.fillStyle = T.textFaint;
    ctx.fillText(`${d.username} · last 30 days · ${rangeStr}`, em(36), em(130));

    /* ── 4. Reserve footer space, then lay out sections top-down,
       computing how many PR/exercise rows actually fit into what's
       left — nothing here is allowed to draw past footerTop. ── */
    const footerH = em(80);
    const footerTop = H - footerH - em(20);
    let curY = em(154);

    /* Stats row */
    const statsH = em(96);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(em(24), curY, W - em(48), statsH, em(18));
    ctx.fill();
    ctx.strokeStyle = T.border;
    ctx.lineWidth = em(1);
    roundRect(em(24), curY, W - em(48), statsH, em(18));
    ctx.stroke();

    const stats = [
      { val: String(d.workoutCount), lbl: 'WORKOUTS' },
      { val: `${fmtVol(d.totalVolume)} ${d.unit}`, lbl: 'VOLUME' },
      { val: `${d.avgFrequency}×`, lbl: 'PER WEEK' },
      { val: d.streak > 0 ? `🔥${d.streak}` : String(d.streak), lbl: 'STREAK' },
    ];
    const colW = (W - em(48)) / stats.length;
    const colPad = em(10);
    ctx.textAlign = 'center';
    stats.forEach((s, i) => {
      const cx = em(24) + colW * i + colW / 2;
      const size = fitFont(s.val, 400, FONT_DISPLAY, em(24), em(13), colW - colPad * 2);
      ctx.font = `400 ${size}px "${FONT_DISPLAY}", sans-serif`;
      ctx.fillStyle = T.text;
      ctx.fillText(s.val, cx, curY + em(44));
      ctx.font = `600 ${em(10)}px "${FONT_LABEL}", sans-serif`;
      ctx.fillStyle = T.textLabel;
      ctx.letterSpacing = `${em(0.5)}px`;
      ctx.fillText(s.lbl, cx, curY + em(68));
      ctx.letterSpacing = '0px';
    });
    ctx.textAlign = 'left';
    curY += statsH + em(22);

    /* PR section — compact single-line rows, capped at 3, so the
       exercise list below (the main ask) keeps most of the room. */
    const prs = d.topPRs.slice(0, 3);
    const prRowH = em(38);
    if (prs.length) {
      ctx.font = `700 ${em(13)}px "${FONT_LABEL}", sans-serif`;
      ctx.fillStyle = T.brass;
      ctx.letterSpacing = `${em(1.2)}px`;
      ctx.fillText('🏆 PERSONAL RECORDS', em(36), curY + em(10));
      ctx.letterSpacing = '0px';
      curY += em(26);

      prs.forEach((p) => {
        ctx.fillStyle = 'rgba(199,154,84,0.10)';
        roundRect(em(24), curY - em(10), W - em(48), prRowH - em(8), em(10));
        ctx.fill();
        ctx.fillStyle = T.brass;
        roundRect(em(24), curY - em(10), em(4), prRowH - em(8), em(2));
        ctx.fill();

        const detailStr = `${p.weight ?? '—'}${p.unit || d.unit} × ${p.reps ?? '—'} → ${p.e1rm ?? '—'}${p.unit || d.unit} e1RM`;
        ctx.font = `600 ${em(13)}px "${FONT_BODY}", sans-serif`;
        const detailW = ctx.measureText(detailStr).width;
        ctx.font = `700 ${em(15)}px "${FONT_BODY}", sans-serif`;
        ctx.fillStyle = T.text;
        ctx.fillText(truncate(p.exercise || 'Exercise', W - em(104) - detailW), em(40), curY + em(6));

        ctx.textAlign = 'right';
        ctx.font = `600 ${em(13)}px "${FONT_BODY}", sans-serif`;
        ctx.fillStyle = T.brassLight;
        ctx.fillText(detailStr, W - em(40), curY + em(6));
        ctx.textAlign = 'left';

        curY += prRowH;
      });
      curY += em(10);
    }

    /* Exercises section — the main event. Fills whatever space remains
       above the footer, switching to compact single-line rows (the same
       adaptive pattern the single-workout story card uses) so a month
       with many exercises isn't clipped down to just two or three. */
    const exercises = d.exerciseBreakdown || [];
    if (exercises.length) {
      ctx.font = `700 ${em(14)}px "${FONT_LABEL}", sans-serif`;
      ctx.fillStyle = T.green90;
      ctx.letterSpacing = `${em(1.2)}px`;
      ctx.fillText('💪 EXERCISES', em(36), curY + em(12));
      ctx.letterSpacing = '0px';
      curY += em(28);

      const listBottom = footerTop - em(12);
      const availableListH = Math.max(0, listBottom - curY);
      const detailedRowH = em(58);
      const compactRowH = em(34);
      const useDetailed = exercises.length * detailedRowH <= availableListH;
      const rowH = useDetailed ? detailedRowH : compactRowH;
      const maxRows = Math.max(0, Math.floor(availableListH / rowH));
      const shown = exercises.slice(0, maxRows);
      const maxVolume = Math.max(...exercises.map(e => e.volume), 1);

      shown.forEach((e) => {
        const volStr = `${fmtVol(e.volume)} ${e.unit}`;

        if (useDetailed) {
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          roundRect(em(24), curY - em(14), W - em(48), rowH - em(10), em(12));
          ctx.fill();

          ctx.font = `700 ${em(15)}px "${FONT_BODY}", sans-serif`;
          const volW = ctx.measureText(volStr).width;
          ctx.fillStyle = T.text;
          ctx.fillText(truncate(e.name, W - em(96) - volW), em(40), curY + em(2));

          ctx.textAlign = 'right';
          ctx.fillStyle = T.green100;
          ctx.fillText(volStr, W - em(40), curY + em(2));
          ctx.textAlign = 'left';

          ctx.font = `500 ${em(12)}px "${FONT_BODY}", sans-serif`;
          ctx.fillStyle = T.textFaint;
          ctx.fillText(`${e.totalSets} sets · ${e.totalReps} reps · best ${e.maxWeight}${e.unit}`, em(40), curY + em(22));

          /* relative-volume bar */
          const barY = curY + em(30);
          const barW = W - em(80);
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          roundRect(em(40), barY, barW, em(4), em(2));
          ctx.fill();
          const fillGrad = ctx.createLinearGradient(em(40), 0, em(40) + barW, 0);
          fillGrad.addColorStop(0, T.green60);
          fillGrad.addColorStop(1, T.green100);
          ctx.fillStyle = fillGrad;
          roundRect(em(40), barY, Math.max(em(6), barW * (e.volume / maxVolume)), em(4), em(2));
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          roundRect(em(24), curY - em(10), W - em(48), rowH - em(8), em(10));
          ctx.fill();

          ctx.font = `600 ${em(14)}px "${FONT_BODY}", sans-serif`;
          const summary = `${e.totalSets}× · best ${e.maxWeight}${e.unit} · ${volStr}`;
          const sumW = ctx.measureText(summary).width;
          ctx.fillStyle = T.text;
          ctx.fillText(truncate(e.name, W - em(96) - sumW), em(40), curY + em(5));

          ctx.textAlign = 'right';
          ctx.fillStyle = T.green100;
          ctx.fillText(summary, W - em(40), curY + em(5));
          ctx.textAlign = 'left';
        }

        curY += rowH;
      });

      if (exercises.length > shown.length) {
        ctx.font = `500 ${em(12)}px "${FONT_BODY}", sans-serif`;
        ctx.fillStyle = T.textFaint;
        ctx.fillText(`+ ${exercises.length - shown.length} more exercise${exercises.length - shown.length > 1 ? 's' : ''}…`, em(40), curY + em(2));
      }
    } else if (!prs.length) {
      ctx.font = `500 ${em(15)}px "${FONT_BODY}", sans-serif`;
      ctx.fillStyle = T.textFaint;
      ctx.fillText('No workouts logged in the last 30 days yet.', em(36), curY + em(18));
    }

    /* ── 5. Footer branding pod ── */
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(em(24), footerTop, W - em(48), footerH, em(18));
    ctx.fill();
    ctx.strokeStyle = T.border;
    ctx.lineWidth = em(1);
    roundRect(em(24), footerTop, W - em(48), footerH, em(18));
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `400 ${em(20)}px "${FONT_DISPLAY}", sans-serif`;
    ctx.fillStyle = T.green90;
    ctx.fillText('POCKET COACH', W / 2, footerTop + em(42));
    ctx.font = `500 ${em(13)}px "${FONT_BODY}", sans-serif`;
    ctx.fillStyle = T.textFaint;
    ctx.fillText('Track it. Lift it. Own it.', W / 2, footerTop + em(68));
    ctx.textAlign = 'left';

    /* ── 6. Wire up actions ── */
    const downloadBtn = document.getElementById('progressStoryDownloadBtn');
    const shareBtn = document.getElementById('progressStoryShareBtn');
    const getBlob = () => new Promise((res) => canvas.toBlob(res, 'image/png'));

    downloadBtn.onclick = () => {
      const link = document.createElement('a');
      link.download = `progress-report-${d.range.end || 'today'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };

    shareBtn.onclick = async () => {
      try {
        if (navigator.share && navigator.canShare) {
          const blob = await getBlob();
          const file = new File([blob], `progress-${d.range.end || 'today'}.png`, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'My Progress', text: 'Check out my last 30 days! 💪' });
            return;
          }
        }
        if (navigator.clipboard?.write) {
          const blob = await getBlob();
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          window.showToast?.('Image copied to clipboard!', 'success');
        } else {
          window.open(canvas.toDataURL('image/png'), '_blank');
        }
      } catch (e) {
        console.warn('Share failed:', e);
        window.showToast?.('Use Save Image instead', 'warn');
      }
    };
  }

  window.openProgressStoryModal = openProgressStoryModal;
  window.closeProgressStoryModal = closeProgressStoryModal;
})();
