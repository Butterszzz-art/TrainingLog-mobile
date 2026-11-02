/* Coach technique videos per exercise: which video belongs to an exercise
 * name, and the ▶ Watch buttons that play it.
 *
 * Shared by the athlete app (Today card, Log, My Plan) and the coach
 * dashboard (Exercise videos card, program builder). Videos are saved per
 * exercise name (POST /coach/exercise-videos); program names are often
 * longer ("Hack squat (or Smith squat), deep"), so matching is loose:
 *
 *   1. the exact name (case and spacing ignored),
 *   2. the name without its "(…)" parts and without what follows a comma,
 *   3. each alternative of "A or B",
 *   4. a video whose name the exercise starts with, word by word
 *      ("Romanian deadlift" covers "Romanian deadlift (dumbbells…)").
 * The most specific video wins.
 *
 *   ExerciseVideos.find(name, videos) → video | null
 *   ExerciseVideos.button(name, videos) → '<button data-ex-video=…>' | ''
 * A click on any [data-ex-video] plays the video (CoachVideos player, else a new tab). */
(function (globalScope) {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[‐-―]/g, '-').replace(/[^a-z0-9-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** The names an exercise also goes by, most specific first. */
  function candidates(name) {
    const raw = String(name == null ? '' : name);
    const out = [norm(raw)];
    const noParens = raw.replace(/\([^)]*\)/g, ' ');
    out.push(norm(noParens));
    const beforeComma = noParens.split(',')[0];
    out.push(norm(beforeComma));
    beforeComma.split(/\s+or\s+/i).forEach(part => out.push(norm(part)));
    return Array.from(new Set(out.filter(Boolean)));
  }

  function find(name, videos) {
    const list = Array.isArray(videos) ? videos.filter(v => v && v.videoUrl && v.exerciseName) : [];
    if (!list.length || !name) return null;
    const byName = new Map();
    list.forEach(v => { const k = norm(v.exerciseName); if (k && !byName.has(k)) byName.set(k, v); });
    for (const c of candidates(name)) if (byName.has(c)) return byName.get(c);
    // A video for the base movement: the exercise name starts with it, word by word.
    const full = norm(name);
    let best = null;
    byName.forEach((v, k) => {
      if ((full === k || full.startsWith(k + ' ')) && (!best || k.length > norm(best.exerciseName).length)) best = v;
    });
    return best;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** A small ▶ button for `name`, or '' when there's no video for it. */
  function button(name, videos, opts) {
    const v = find(name, videos === undefined ? cache() : videos);
    if (!v) return '';
    const cls = (opts && opts.className) || 'ev-watch';
    return `<button type="button" class="${cls}" data-ex-video="${esc(name)}" aria-label="Watch how to do ${esc(name)}" title="Watch technique video">▶</button>`;
  }

  /** The videos the app has: the athlete's coach's (index.html) or the coach's own (dashboard). */
  function cache() {
    return globalScope.exerciseVideosCache || globalScope.coachExerciseVideos || [];
  }

  function play(name, videos) {
    const v = find(name, videos === undefined ? cache() : videos);
    if (!v) return false;
    if (globalScope.CoachVideos && typeof globalScope.CoachVideos.openPlayer === 'function') {
      globalScope.CoachVideos.openPlayer({
        title: `${v.exerciseName} technique`, videoUrl: v.videoUrl, message: v.notes || '',
        category: 'technique', coachUsername: v.coachId || '',
      });
    } else if (typeof globalScope.open === 'function') {
      globalScope.open(v.videoUrl, '_blank', 'noopener');
    }
    return true;
  }

  // One listener for every ▶ button; it stops the tap so a row underneath
  // (e.g. a Log session row that starts logging) doesn't also react.
  if (globalScope.document && !globalScope.__exerciseVideoClicks) {
    globalScope.__exerciseVideoClicks = true;
    globalScope.document.addEventListener('click', e => {
      const btn = e.target && e.target.closest && e.target.closest('[data-ex-video]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      play(btn.getAttribute('data-ex-video'));
    }, true);
  }

  const api = { find, button, play, candidates, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.ExerciseVideos = api;
})(typeof window !== 'undefined' ? window : globalThis);
