/**
 * native-ui.js
 * Mobile-safe replacements for alert(), confirm(), prompt().
 *
 * Globals exposed:
 *   window.showToast(msg, type, duration)  → void  (alias: window.nativeToast)
 *   window.showConfirm(msg, opts)          → Promise<boolean>
 *   window.showPrompt(msg, opts)           → Promise<string|null>
 *
 * window.alert is overridden → showToast
 * window.confirm / window.prompt are NOT overridden (they're sync; callers
 * must migrate to the async versions explicitly).
 */
(function () {
  'use strict';

  // ── Toast ──────────────────────────────────────────────────────────────────
  // Toasts stack (max 3, newest nearest the nav) in #toastStack. Tap to
  // dismiss. Styling lives in css/base.css (.tst*).

  const TOAST_MAX = 3;
  const TOAST_ICONS = {
    success: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    error:   '<path d="M7 7l10 10M17 7L7 17"/>',
    warn:    '<path d="M12 6v8"/><circle cx="12" cy="18" r=".6" fill="currentColor"/>',
    info:    '<path d="M12 11v7"/><circle cx="12" cy="6.5" r=".6" fill="currentColor"/>',
  };
  const TOAST_KICKERS = { success: 'Done', error: 'Something went wrong', warn: 'Heads up', info: 'Note' };
  // Many callers prefix messages with an emoji; the badge already carries the tone.
  const LEADING_EMOJI = /^(?:\p{Extended_Pictographic}|ℹ)[️‍]*\s*/u;

  function _toastStack() {
    let stack = document.getElementById('toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.className = 'tst-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function _dismissToast(el) {
    if (!el || el._closing) return;
    el._closing = true;
    clearTimeout(el._timer);
    el.classList.add('tst--out');
    setTimeout(() => el.remove(), 220);
  }

  /**
   * @param {string} msg
   * @param {'info'|'success'|'error'|'warn'} [type='info']
   * @param {number} [duration=3000]
   */
  function showToast(msg, type, duration) {
    type     = TOAST_ICONS[type] ? type : 'info';
    duration = duration || 3000;

    const text  = String(msg == null ? '' : msg).replace(LEADING_EMOJI, '').trim();
    const stack = _toastStack();

    // Same message already up: replace it rather than stacking a duplicate.
    let live = Array.from(stack.children).filter(t => !t._closing);
    live.filter(t => t._text === text && t._type === type).forEach(_dismissToast);
    live = live.filter(t => !t._closing);
    live.slice(0, Math.max(0, live.length - TOAST_MAX + 1)).forEach(_dismissToast);

    const el = document.createElement('div');
    el.className = `tst tst--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML =
      `<span class="tst-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${TOAST_ICONS[type]}</svg></span>` +
      `<span class="tst-body"><span class="tst-kick">${TOAST_KICKERS[type]}</span><span class="tst-msg">${_esc(text)}</span></span>` +
      `<span class="tst-meter" aria-hidden="true"><span style="animation-duration:${duration}ms"></span></span>`;
    el._text = text;
    el._type = type;
    el.addEventListener('click', () => _dismissToast(el));
    stack.appendChild(el);
    el._timer = setTimeout(() => _dismissToast(el), duration);
  }

  // ── Confirm modal ──────────────────────────────────────────────────────────

  /**
   * @param {string} msg
   * @param {{ confirmText?: string, cancelText?: string, danger?: boolean }} [opts]
   * @returns {Promise<boolean>}
   */
  function showConfirm(msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      const overlay = _getOrCreateOverlay();
      overlay.innerHTML = `
        <div class="nm-dialog" role="dialog" aria-modal="true">
          <p class="nm-body">${_esc(msg)}</p>
          <div class="nm-actions">
            <button class="nm-btn nm-btn--cancel" id="nmCancel">
              ${_esc(opts.cancelText || 'Cancel')}
            </button>
            <button class="nm-btn ${opts.danger ? 'nm-btn--danger' : 'nm-btn--confirm'}" id="nmConfirm">
              ${_esc(opts.confirmText || 'OK')}
            </button>
          </div>
        </div>`;
      overlay.style.display = 'flex';

      function cleanup(val) {
        overlay.style.display = 'none';
        overlay.innerHTML = '';
        resolve(val);
      }

      overlay.querySelector('#nmConfirm').addEventListener('click', () => cleanup(true),  { once: true });
      overlay.querySelector('#nmCancel').addEventListener('click',  () => cleanup(false), { once: true });
      // tap outside = cancel
      overlay.addEventListener('click', function handler(e) {
        if (e.target === overlay) { overlay.removeEventListener('click', handler); cleanup(false); }
      });
    });
  }

  // ── Prompt modal ───────────────────────────────────────────────────────────

  /**
   * @param {string} msg
   * @param {{ placeholder?: string, defaultValue?: string, confirmText?: string }} [opts]
   * @returns {Promise<string|null>}  null = cancelled
   */
  function showPrompt(msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      const overlay = _getOrCreateOverlay();
      overlay.innerHTML = `
        <div class="nm-dialog" role="dialog" aria-modal="true">
          <p class="nm-body">${_esc(msg)}</p>
          <input class="nm-input" id="nmInput"
                 type="text"
                 placeholder="${_esc(opts.placeholder || '')}"
                 value="${_esc(opts.defaultValue || '')}" />
          <div class="nm-actions">
            <button class="nm-btn nm-btn--cancel"  id="nmCancel">Cancel</button>
            <button class="nm-btn nm-btn--confirm" id="nmConfirm">
              ${_esc(opts.confirmText || 'OK')}
            </button>
          </div>
        </div>`;
      overlay.style.display = 'flex';

      const input = overlay.querySelector('#nmInput');
      input.focus();
      input.select();

      function cleanup(val) {
        overlay.style.display = 'none';
        overlay.innerHTML = '';
        resolve(val);
      }

      overlay.querySelector('#nmConfirm').addEventListener('click', () => cleanup(input.value), { once: true });
      overlay.querySelector('#nmCancel').addEventListener('click',  () => cleanup(null),         { once: true });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  cleanup(input.value);
        if (e.key === 'Escape') cleanup(null);
      }, { once: true });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _getOrCreateOverlay() {
    let el = document.getElementById('nativeModalOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nativeModalOverlay';
      el.className = 'nm-overlay';
      document.body.appendChild(el);
    }
    return el;
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Override window.alert ─────────────────────────────────────────────────
  // confirm/prompt are synchronous by spec; callers must migrate explicitly.

  window.alert = function (msg) { showToast(String(msg), 'info'); };

  // ── openReportWindow ──────────────────────────────────────────────────────
  /**
   * Open an HTML report document for viewing / printing / sharing.
   *
   * • Native Capacitor  → Web Share API (native share sheet).
   *                       Falls back to a data: URI if Share is unavailable.
   * • Web browser       → window.open() with HTML written in (existing behaviour).
   *
   * @param {string} html          Full HTML document string
   * @param {{ title?: string, filename?: string }} [opts]
   */
  async function openReportWindow(html, opts) {
    const title    = (opts && opts.title)    || 'Report';
    const filename = (opts && opts.filename) || 'report.html';
    const isNative = !!(
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform()
    );

    if (isNative) {
      // ── Native path: Web Share API ───────────────────────────────────────
      if (typeof navigator.share === 'function') {
        const blob = new Blob([html], { type: 'text/html' });
        const file = new File([blob], filename, { type: 'text/html' });
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title });
          } else {
            // Fallback: share plain-text summary (strips HTML tags)
            const text = html
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s{2,}/g, ' ')
              .trim()
              .substring(0, 3000);
            await navigator.share({ title, text });
          }
          return;
        } catch (e) {
          if (e.name === 'AbortError') return; // user cancelled — not an error
          console.warn('[openReportWindow] Share API failed, trying data URI', e);
        }
      }

      // ── Native fallback: data URI in a new window ────────────────────────
      try {
        const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
        const w = window.open(dataUrl, '_blank');
        if (w) return;
      } catch (_) {}

      showToast('Could not open report on this device.', 'warn');
      return;
    }

    // ── Web path: open new window and write HTML into it ──────────────────
    const win = window.open('', '_blank', 'width=960,height=800,scrollbars=yes');
    if (!win) {
      showToast('Pop-up blocked — allow pop-ups for this site and try again.', 'warn');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  window.showToast        = showToast;
  // ~35 call sites use nativeToast(), which was never defined, so they were silent.
  window.nativeToast      = function (msg, type, duration) { window.showToast(msg, type, duration); };
  window.showConfirm      = showConfirm;
  window.showPrompt       = showPrompt;
  window.openReportWindow = openReportWindow;
})();
