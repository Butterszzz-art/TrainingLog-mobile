/* Coach dashboard: import the coach's own master plan file.
 *
 * The file (PDF, Word, Excel, photo) goes to POST /api/ai/coach/import-plan,
 * which reads phases and training/rest-day nutrition as the document states
 * them and fills gaps as suggestions. reviewHtml() shows the result for a
 * check before anything is saved; draftBody() is what POST /api/coach/plans
 * gets to create the draft (with the PDF attached for the client if chosen).
 * After that the plan opens in the normal editor, suggested values marked.
 *
 * Pure: no fetch, no storage. coach.js does the calls. */
(function (root) {
  'use strict';

  const LABELS = { cut: 'Cut', maintain: 'Maintain', build: 'Build', deload: 'Deload' };
  const ACCEPT = '.pdf,.docx,.xlsx,.csv,.txt,image/jpeg,image/png,image/webp';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function dayCell(phase, dayType) {
    const d = phase[dayType] || {};
    const s = new Set(phase.suggested || []);
    const part = (key, label, unit) => {
      const v = d[key] == null ? '—' : Math.round(d[key]) + unit;
      const text = label ? label + ' ' + v : v;
      return s.has(dayType + '.' + key) ? '<mark class="pi-suggested" title="Suggested: not in the file">' + esc(text) + '</mark>' : esc(text);
    };
    return part('kcal', '', ' kcal') + '<br><small>' + part('proteinG', 'P', 'g') + ' · ' + part('carbG', 'C', 'g') + ' · ' + part('fatG', 'F', 'g') + '</small>';
  }

  /** result: the import response; opts: { fileName, clientName }. */
  function reviewHtml(result, opts) {
    const o = opts || {};
    const plan = result.plan;
    let week = 1;
    const rows = plan.phases.map(p => {
      const from = week;
      week += p.weeks;
      return '<tr><td><span class="pi-phase pp-phase--' + esc(p.type) + '">' + esc(LABELS[p.type] || p.type) + '</span></td>'
        + '<td>' + (p.weeks === 1 ? 'wk ' + from : 'wk ' + from + '–' + (from + p.weeks - 1)) + '</td>'
        + '<td>' + esc(p.goalText || '') + '</td>'
        + '<td>' + dayCell(p, 'trainingDay') + '</td><td>' + dayCell(p, 'restDay') + '</td></tr>';
    }).join('');
    const warnings = result.warnings || [];
    return '<div class="pi-review">'
      + '<div class="pi-banner"><strong>Read from ' + esc(o.fileName || 'your file') + ':</strong> ' + esc(plan.name) + ' · ' + (week - 1) + ' weeks.'
      + (plan.suggested ? ' <mark class="pi-suggested">' + plan.suggested + ' value' + (plan.suggested === 1 ? '' : 's') + '</mark> weren’t in the file and were filled in. Check them now or in Edit plan.' : ' Every number came from the file.')
      + (warnings.length ? '<ul>' + warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '')
      + '</div>'
      + '<table class="pi-table"><thead><tr><th>Phase</th><th>Weeks</th><th>Goal</th><th>Training day</th><th>Rest day</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + (plan.notes ? '<p class="ws-empty-note"><strong>Notes:</strong> ' + esc(plan.notes) + '</p>' : '')
      + (result.isPdf ? '<label class="pi-attach"><input type="checkbox" id="planImportAttach" checked> Show this PDF to ' + esc(o.clientName || 'the client') + ' in their app (My Plan)</label>' : '')
      + '<div class="mp-adjust-actions"><button type="button" class="mp-btn mp-btn--gold" onclick="createDraftFromImport()">Create draft</button>'
      + '<button type="button" class="pb-link" onclick="cancelPlanImport()">Cancel</button></div>'
      + '</div>';
  }

  /** Body for POST /api/coach/plans. attach: send the PDF (base64 `data`) along. */
  function draftBody({ result, fileName, data, clientUid, startDate, tier, attach }) {
    return Object.assign(
      { clientUid, imported: result.plan, fileName, startDate, tier },
      attach && result.isPdf && data ? { attachment: { fileName, data } } : {}
    );
  }

  root.PlanImport = { ACCEPT, reviewHtml, draftBody };
})(typeof window !== 'undefined' ? window : globalThis);
