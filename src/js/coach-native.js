/* =============================================================
   COACH — NATIVE SHELL
   The coach tab bar (Clients · Programs · Inbox · Insights · More),
   a shared bottom sheet, and the icon set the coach screens use.
   The tab bar drives the existing tabs: Clients = #clientsTab,
   the rest = #coachOpsTab sub-views (via their existing sub-tab
   buttons, so every render hook in index.html still fires).
   Styles: css/coach-native.css.
   ============================================================= */

(function () {
  'use strict';

  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const CN_ICONS = {
    clients: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
    programs: I('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>'),
    inbox: I('<path d="M4 5h16v11H8l-4 4z"/>'),
    insights: I('<path d="M4 19V11M10 19V5M16 19v-6M22 19H2"/>'),
    more: I('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    back: I('<path d="M15 6l-6 6 6 6"/>'),
    chevron: I('<path d="M9 6l6 6-6 6"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    x: I('<path d="M6 6l12 12M18 6 6 18"/>'),
    send: I('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    message: I('<path d="M4 5h16v11H8l-4 4z"/>'),
    dumbbell: I('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'),
    fork: I('<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 1-3 4-3 7h3v11"/>'),
    alert: I('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.2v.1"/>'),
    clipboard: I('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 11h6M9 15h4"/>'),
    bot: I('<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12v1M15 12v1"/>'),
    video: I('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>'),
    lock: I('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    download: I('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    home: I('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
    grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>'
  };
  window.CN_ICONS = CN_ICONS;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.cnEsc = esc;

  /* ── Bottom sheet ──────────────────────────────────────────── */

  // Opens a sheet with the given inner HTML. Returns { el, close }.
  // Closes on backdrop tap, Escape, or any [data-sheet-close].
  function cnSheet(innerHtml, options) {
    const opts = options || {};
    document.querySelector('.cn-sheet-backdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'cn-sheet-backdrop cn';
    backdrop.innerHTML = `<div class="cn-sheet" role="dialog" aria-modal="true" aria-label="${esc(opts.label || 'Sheet')}"><span class="cn-sheet-grab" aria-hidden="true"></span>${innerHtml}</div>`;
    const prevFocus = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
      if (typeof opts.onClose === 'function') opts.onClose();
    }
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-sheet-close]')) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    const first = backdrop.querySelector('input, textarea, select, button:not([data-sheet-close])');
    if (first && opts.autofocus !== false) setTimeout(() => first.focus(), 60);
    return { el: backdrop.querySelector('.cn-sheet'), close };
  }
  window.cnSheet = cnSheet;

  /* ── Coach tab bar ─────────────────────────────────────────── */

  const SUBVIEW_FOR = { programs: 'programs', inbox: 'messaging', insights: 'analytics' };
  const TAB_FOR_SUBVIEW = { programs: 'programs', messaging: 'inbox', analytics: 'insights', ai: 'more', videos: 'more', gdpr: 'more' };

  function activeSubview() {
    return document.querySelector('#coachOpsSubtabNav .coach-subtab.active')?.dataset.coachSubtab || 'programs';
  }

  function openCoachOps(subview) {
    if (typeof window.showTab === 'function') window.showTab('coachOpsTab');
    const btn = document.querySelector(`#coachOpsSubtabNav [data-coach-subtab="${subview}"]`);
    if (btn) btn.click();
    syncCoachNav('coachOpsTab');
    window.scrollTo({ top: 0 });
  }
  window.openCoachOps = openCoachOps;

  function syncCoachNav(tabName) {
    const inCoach = tabName === 'clientsTab' || tabName === 'coachOpsTab';
    const enabled = typeof window.isCoachModeEnabled !== 'function' || window.isCoachModeEnabled();
    document.body.classList.toggle('coach-shell', inCoach && enabled);
    const current = tabName === 'clientsTab' ? 'clients' : TAB_FOR_SUBVIEW[activeSubview()] || 'programs';
    document.querySelectorAll('#coachNav [data-coach-nav]').forEach((b) => {
      if (b.dataset.coachNav === current && inCoach) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }
  window.syncCoachNav = syncCoachNav;

  function openMoreSheet() {
    const row = (action, icon, title, sub) => `
      <button type="button" class="cn-row" data-more="${action}">
        <span class="cn-avatar cn-avatar--sm is-pending">${CN_ICONS[icon]}</span>
        <span class="cn-row-main"><span class="cn-row-title">${title}</span>${sub ? `<span class="cn-row-sub">${sub}</span>` : ''}</span>
        <span class="cn-chev">${CN_ICONS.chevron}</span>
      </button>`;
    const sheet = cnSheet(`
      <h2 class="cn-sheet-title">Coach tools</h2>
      <div class="cn-group">
        ${row('ai', 'bot', 'AI assistant', 'Ask about any client')}
        ${row('videos', 'video', 'Technique videos', 'Links clients see while logging')}
        ${row('gdpr', 'lock', 'Client data', 'What each client shares, exports')}
        ${row('export', 'download', 'Export roster', 'CSV of every active client')}
      </div>
      <div class="cn-group">
        ${row('home', 'home', 'Back to my training', '')}
      </div>`, { label: 'Coach tools', autofocus: false });
    sheet.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-more]');
      if (!b) return;
      const action = b.dataset.more;
      sheet.close();
      if (action === 'export') { if (typeof window.exportRosterCSV === 'function') window.exportRosterCSV(); return; }
      if (action === 'home') { if (typeof window.showTab === 'function') window.showTab('homeTab'); return; }
      openCoachOps(action);
    });
  }

  function init() {
    const nav = document.getElementById('coachNav');
    if (!nav || nav.dataset.bound) return;
    nav.dataset.bound = 'true';
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-coach-nav]');
      if (!b) return;
      const target = b.dataset.coachNav;
      if (target === 'clients') {
        if (typeof window.showTab === 'function') window.showTab('clientsTab');
        window.scrollTo({ top: 0 });
      } else if (target === 'more') {
        openMoreSheet();
      } else {
        openCoachOps(SUBVIEW_FOR[target]);
      }
    });
    // Sub-view changes made elsewhere (e.g. Message on a client page) keep the bar in sync.
    document.getElementById('coachOpsSubtabNav')?.addEventListener('click', () => {
      setTimeout(() => syncCoachNav(document.querySelector('.tab-content.active')?.id || ''), 0);
    });
    // Some flows switch tabs without showTab() (login, openSection, deep
    // links), so follow whichever panel is actually active.
    // Use the panel that most recently became active, not the first one
    // in the DOM, in case two briefly carry .active during a transition.
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const nowActive = r.target.classList.contains('active');
        const wasActive = /\bactive\b/.test(r.oldValue || '');
        if (nowActive && !wasActive) { syncCoachNav(r.target.id); return; }
      }
      const current = document.querySelector('.tab-content.active');
      if (!current) syncCoachNav('');
    });
    document.querySelectorAll('.tab-content').forEach((el) => observer.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true }));
    syncCoachNav(document.querySelector('.tab-content.active')?.id || '');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
