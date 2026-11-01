/* Program import, the part both screens share: the athlete app's Import
   sheet (src/js/program-import.js) and the coach dashboard's Import file
   button (coach/coach.js).

   A file goes to POST /api/ai/coach/import-program as base64. The server
   reads Week | Day | Exercise sheets directly and sends anything else to the
   AI (traininglog-backend src/coach/tableImport.js / programImport.js).
   target 'coach' asks for pocketcoach.program/2 plus rowWarnings; the app
   gets the Library document shape.

   No DOM here: callers render. */
(function (globalScope) {
  'use strict';

  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const TIMEOUT_MS = 500000; // the server gives up at 480 s
  const ACCEPT = '.xlsx,.docx,.pdf,.csv,.tsv,.txt,image/jpeg,image/png,image/webp';

  /** A user-facing reason the file can't be sent, or null. */
  function checkFile(file) {
    if (!file) return 'Choose a file to import.';
    if (file.size > MAX_FILE_BYTES) return 'That file is over 8 MB. Import one month at a time.';
    return null;
  }

  function readAsBase64(file, FileReaderCtor) {
    const Reader = FileReaderCtor || globalScope.FileReader;
    return new Promise((resolve, reject) => {
      const reader = new Reader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
  }

  /** The message to show for a failed response. */
  function errorFor(status, json) {
    if (status === 401) return 'Please log in again to import a program.';
    if (status === 402 || status === 403) return 'Importing programs is a Pro feature.';
    if (status === 404 && json && json.error === 'AI_NOT_CONFIGURED') return 'The AI is not switched on for this server yet.';
    return (json && (json.message || (json.error && json.error.message))) || "Couldn't import the program. Try again.";
  }

  /** The message to show for a thrown error (abort, offline, …). */
  function friendlyError(err, online) {
    if (err && err.name === 'AbortError') return 'That took too long. Try again, or import a shorter part of the program.';
    if (online === false) return 'You are offline.';
    return (err && err.message) || "Couldn't import the program. Try again.";
  }

  /**
   * Upload one file. opts: { serverUrl, headers, target ('coach'), signal,
   * fetchFn, data (base64, skips reading the file) }.
   * Resolves with the server's { program, warnings, rowWarnings?, source };
   * rejects with an Error whose message is ready to show.
   */
  async function upload(file, opts) {
    const o = opts || {};
    const problem = checkFile(file);
    if (problem) throw new Error(problem);
    const data = o.data || await readAsBase64(file);
    const fetchFn = o.fetchFn || globalScope.fetch;
    const res = await fetchFn(String(o.serverUrl || '').replace(/\/$/, '') + '/api/ai/coach/import-program', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, o.headers || {}),
      body: JSON.stringify(Object.assign({ fileName: file.name, data }, o.target ? { target: o.target } : {})),
      signal: o.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorFor(res.status, json));
    if (!json.program) throw new Error("Couldn't import the program. Try again.");
    return json;
  }

  /** Upload with a timeout; returns { promise, abort }. */
  function start(file, opts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (opts && opts.timeoutMs) || TIMEOUT_MS);
    const promise = upload(file, Object.assign({}, opts, { signal: controller.signal }))
      .finally(() => clearTimeout(timer));
    return { promise, abort: () => controller.abort() };
  }

  /** "3 × 8-10 RIR 2, 1 × 8-10 RIR 1" for a Library set list. */
  function setsSummary(sets, formatReps) {
    const groups = [];
    (sets || []).forEach(set => {
      let reps = formatReps ? formatReps(set) : String(set.reps == null ? '?' : set.reps);
      if (set.weight != null) reps += ' @ ' + set.weight + ' kg';
      if (set.rpe != null) reps += ' RPE ' + set.rpe;
      else if (set.rir != null) reps += ' RIR ' + set.rir;
      if (set.setType && set.setType !== 'straight') reps += ' ' + set.setType;
      const last = groups[groups.length - 1];
      if (last && last.label === reps) last.n += 1; else groups.push({ n: 1, label: reps });
    });
    return groups.map(g => g.n + ' × ' + g.label).join(', ');
  }

  const api = { MAX_FILE_BYTES, TIMEOUT_MS, ACCEPT, checkFile, readAsBase64, errorFor, friendlyError, upload, start, setsSummary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.ProgramImportCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
