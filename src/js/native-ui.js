/**
 * native-ui.js
 * Mobile-safe replacements for alert(), confirm(), prompt().
 *
 * Globals exposed:
 *   window.showToast(msg, type, duration)  → void
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

  let _toastTimer = null;

  /**
   * @param {string} msg
   * @param {'info'|'success'|'error'|'warn'} [type='info']
   * @param {number} [duration=3000]
   */
  function showToast(msg, type, duration) {
    type     = type     || 'info';
    duration = duration || 3000;

    let el = document.getElementById('nativeToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nativeToast';
      document.body.appendChild(el);
    }

    const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' };
    el.className = `native-toast native-toast--${type} native-toast--show`;
    el.innerHTML = `<span class="nt-icon">${icons[type] || icons.info}</span><span class="nt-msg">${_esc(msg)}</span>`;

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.classList.remove('native-toast--show');
    }, duration);
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
  window.showConfirm      = showConfirm;
  window.showPrompt       = showPrompt;
  window.openReportWindow = openReportWindow;
})();
