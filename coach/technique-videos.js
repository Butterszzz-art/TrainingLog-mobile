/* Coach dashboard: technique videos per exercise.
 *
 * One row per exercise in your program library (every week of every
 * program), plus any video saved for an exercise that isn't in a program.
 * Each row says whether the client will see a video, and which one: a video
 * saved as "Hack squat" also covers "Hack squat (or Smith squat), deep"
 * (src/js/exercise-videos.js decides). Add or change the link and cue in
 * place; clients see a ▶ next to the exercise on Home, in the Log and in My
 * Plan, and under the exercise when they log it.
 *
 * Videos are saved per exercise name with the existing endpoints
 * (GET/POST/DELETE /coach/exercise-videos); coach.js does the calls.
 *
 *   TechniqueVideos.rows(programs, videos) → [{ name, programs, video, own }]
 *   TechniqueVideos.html(rows, { filter }) → card body */
(function (root) {
  'use strict';

  const EV = root.ExerciseVideos;
  const M = root.ProgramModel;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Exercises in the library → which programs use them and which video they get. */
  function rows(programs, videos) {
    const byName = new Map();
    (programs || []).forEach(prog => {
      const p = M && M.readProgram(prog);
      if (!p) return;
      for (let w = 1; w <= p.weeks.length; w++) {
        M.weekDays(p, w).forEach(d => d.exercises.forEach(e => {
          const key = EV.norm(e.name);
          if (!key) return;
          if (!byName.has(key)) byName.set(key, { name: e.name, programs: new Set() });
          byName.get(key).programs.add(p.name);
        }));
      }
    });
    const list = (videos || []).filter(v => v && v.exerciseName);
    const out = [...byName.values()].map(r => {
      const video = EV.find(r.name, list);
      return { name: r.name, programs: [...r.programs], video, own: !!video && EV.norm(video.exerciseName) === EV.norm(r.name) };
    });
    // Videos for exercises no program uses (or saved under a shorter name) still get a row.
    list.forEach(v => {
      if (!out.some(r => r.own && EV.norm(r.name) === EV.norm(v.exerciseName))) {
        const covers = out.filter(r => r.video === v).map(r => r.name);
        out.push({ name: v.exerciseName, programs: [], covers, video: v, own: true });
      }
    });
    return out.sort((a, b) => (!!a.video - !!b.video) || a.name.localeCompare(b.name));
  }

  function rowHtml(r, i) {
    const v = r.video;
    const status = !v ? '<span class="tv-status tv-status--missing">No video</span>'
      : r.own ? '<span class="tv-status tv-status--ok">▶ Video</span>'
        : `<span class="tv-status tv-status--ok" title="Saved for “${esc(v.exerciseName)}”">▶ Uses “${esc(v.exerciseName)}”</span>`;
    const where = r.programs.length ? `<span class="tv-programs">${esc(r.programs.join(', '))}</span>`
      : r.covers && r.covers.length ? `<span class="tv-programs">Covers ${esc(r.covers.join(', '))}</span>`
        : '<span class="tv-programs">Not in a program</span>';
    // An inherited video is edited where it's saved; here you can add a specific one.
    const url = r.own ? v.videoUrl : '';
    const cue = r.own ? v.notes || '' : '';
    return `<tr data-tv="${i}">
      <td class="tv-name">${esc(r.name)}${where}</td>
      <td>${status}</td>
      <td><input class="pb-in tv-url" type="url" value="${esc(url)}" placeholder="${r.video && !r.own ? 'Specific video for this exercise (optional)' : 'YouTube, Loom, Drive link'}" aria-label="Video link for ${esc(r.name)}"></td>
      <td><input class="pb-in tv-cue" value="${esc(cue)}" placeholder="Coaching cue (optional)" maxlength="200" aria-label="Coaching cue for ${esc(r.name)}"></td>
      <td class="tv-acts"><button type="button" class="pb-link" data-tv-act="save" data-tv="${i}">Save</button>
        ${v ? `<button type="button" class="pb-link" data-tv-act="watch" data-tv="${i}">Watch</button>` : ''}
        ${r.own ? `<button type="button" class="pb-link pb-link--danger" data-tv-act="delete" data-tv="${i}">Remove</button>` : ''}</td>
    </tr>`;
  }

  /** opts: { filter: 'missing' | 'all', message } */
  function html(list, opts) {
    const o = opts || {};
    const missing = list.filter(r => !r.video).length;
    const shown = o.filter === 'all' ? list : list.filter(r => !r.video);
    return `<p class="ws-empty-note">Clients see a ▶ next to the exercise on Home, in the Log and in My Plan, and can watch it while they train. A video saved for “Hack squat” also covers “Hack squat (or Smith squat), deep”.</p>
      <div class="tv-bar">
        <span class="pb-stats">${list.length} exercise${list.length === 1 ? '' : 's'} · ${missing} without a video</span>
        <label class="tv-filter"><input type="checkbox" data-tv-filter ${o.filter === 'all' ? 'checked' : ''}> Show exercises that have a video</label>
      </div>
      ${shown.length
        ? `<table class="tv-table"><thead><tr><th>Exercise</th><th>Client sees</th><th>Video link</th><th>Cue</th><th></th></tr></thead>
           <tbody>${list.map((r, i) => (shown.includes(r) ? rowHtml(r, i) : '')).join('')}</tbody></table>`
        : `<p class="ws-empty-note">${list.length ? 'Every exercise in your programs has a video.' : 'No programs in your library yet.'}</p>`}
      <div class="tv-add"><input class="pb-in tv-add-name" placeholder="Another exercise name" list="tvExerciseNames" aria-label="Exercise name">
        <input class="pb-in tv-add-url" type="url" placeholder="Video link" aria-label="Video link">
        <input class="pb-in tv-add-cue" placeholder="Cue (optional)" aria-label="Coaching cue">
        <button type="button" class="pb-link" data-tv-act="add">Add video</button></div>
      <span class="pb-msg" role="status">${esc(o.message || '')}</span>`;
  }

  root.TechniqueVideos = { rows, html };
})(typeof window !== 'undefined' ? window : globalThis);
