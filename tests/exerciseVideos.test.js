// Coach technique videos per exercise: name matching and the ▶ buttons
// (src/js/exercise-videos.js), and the dashboard card (coach/technique-videos.js).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const EV = require('../src/js/exercise-videos.js');

const vid = (exerciseName, extra = {}) => ({ id: EV.norm(exerciseName).replace(/ /g, '-'), exerciseName, videoUrl: 'https://youtu.be/' + exerciseName.length, notes: '', ...extra });
const videos = [vid('Hack squat'), vid('Chin-up'), vid('Romanian deadlift'), vid('Romanian deadlift (dumbbells while learning the hinge)'), vid('Leg press'), vid('Cable lateral raise', { notes: 'Lead with the elbow' })];

describe('find', () => {
  test('exact name, any case or spacing', () => {
    expect(EV.find('  cable LATERAL raise ', videos).notes).toBe('Lead with the elbow');
  });

  test('program names with details still find the base movement', () => {
    expect(EV.find('Hack squat (or Smith squat), deep', videos).exerciseName).toBe('Hack squat');
    expect(EV.find('Cable lateral raise, cable behind the body', videos).exerciseName).toBe('Cable lateral raise');
    expect(EV.find('Chin-up or neutral-grip lat pulldown', videos).exerciseName).toBe('Chin-up');
    expect(EV.find('Leg press, feet mid-low, deep', videos).exerciseName).toBe('Leg press');
  });

  test('the most specific video wins', () => {
    expect(EV.find('Romanian deadlift (dumbbells while learning the hinge)', videos).exerciseName).toBe('Romanian deadlift (dumbbells while learning the hinge)');
    expect(EV.find('Romanian deadlift', videos).exerciseName).toBe('Romanian deadlift');
  });

  test('no false matches', () => {
    expect(EV.find('Leg extension, seat reclined', videos)).toBeNull();
    expect(EV.find('Incline dumbbell curl', [vid('Curl')])).toBeNull();
    expect(EV.find('Squat', videos)).toBeNull();
    expect(EV.find('', videos)).toBeNull();
    expect(EV.find('Hack squat', [{ exerciseName: 'Hack squat', videoUrl: '' }])).toBeNull();
  });
});

describe('▶ buttons', () => {
  function setup() {
    const dom = new JSDOM('<!doctype html><body><div class="row" id="row"></div></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
    const w = dom.window;
    w.exerciseVideosCache = videos;
    w.eval(fs.readFileSync(path.join(__dirname, '../src/js/exercise-videos.js'), 'utf8'));
    w.CoachVideos = { openPlayer: jest.fn() };
    return w;
  }

  test('a button only for exercises with a video, name escaped', () => {
    const w = setup();
    expect(w.ExerciseVideos.button('Leg extension')).toBe('');
    const html = w.ExerciseVideos.button('Hack squat (or "Smith"), deep');
    expect(html).toContain('data-ex-video="Hack squat (or &quot;Smith&quot;), deep"');
    expect(html).toContain('aria-label="Watch how to do');
  });

  test('tapping ▶ plays the video in the app player and not the row underneath', () => {
    const w = setup();
    const row = w.document.getElementById('row');
    const rowTap = jest.fn();
    row.addEventListener('click', rowTap);
    row.innerHTML = 'Cable lateral raise ' + w.ExerciseVideos.button('Cable lateral raise, cable behind the body');
    row.querySelector('[data-ex-video]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(w.CoachVideos.openPlayer).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cable lateral raise technique', message: 'Lead with the elbow', category: 'technique' }));
    expect(rowTap).not.toHaveBeenCalled();
    row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(rowTap).toHaveBeenCalledTimes(1);
  });

  test('without the player it opens the link', () => {
    const w = setup();
    delete w.CoachVideos;
    w.open = jest.fn();
    expect(w.ExerciseVideos.play('Leg press')).toBe(true);
    expect(w.open).toHaveBeenCalledWith(videos[4].videoUrl, '_blank', 'noopener');
    expect(w.ExerciseVideos.play('Leg extension')).toBe(false);
  });
});

describe('dashboard: technique videos card', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  ['src/js/program-model.js', 'src/js/exercise-videos.js', 'coach/technique-videos.js'].forEach(f => w.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
  const ex = name => ({ name, sets: 2, repsMin: 6, repsMax: 10, rir: 2 });
  const programs = [
    { schema: 'pocketcoach.program/2', name: 'Block A', weeks: [
      { days: [{ weekday: 1, label: 'Lower A', exercises: [ex('Hack squat (or Smith squat), deep'), ex('Leg extension, seat reclined')] }] },
      { days: [{ weekday: 1, label: 'Lower A', exercises: [ex('Hack squat (or Smith squat), deep'), ex('Seated leg curl')] }] },
    ] },
    { schema: 'pocketcoach.program/2', name: 'Block B', weeks: [{ days: [{ weekday: 2, label: 'Upper', exercises: [ex('Cable lateral raise')] }] }] },
  ];
  const saved = [vid('Hack squat'), vid('Cable lateral raise'), vid('Face pull')];

  test('one row per exercise across weeks and programs; inherited, own, missing and orphan videos', () => {
    const rows = w.TechniqueVideos.rows(programs, saved);
    const by = Object.fromEntries(rows.map(r => [r.name, r]));
    expect(rows.map(r => r.name).sort()).toEqual(['Cable lateral raise', 'Face pull', 'Hack squat', 'Hack squat (or Smith squat), deep', 'Leg extension, seat reclined', 'Seated leg curl']);
    expect(by['Hack squat (or Smith squat), deep']).toMatchObject({ own: false, programs: ['Block A'] });
    expect(by['Hack squat (or Smith squat), deep'].video.exerciseName).toBe('Hack squat');
    expect(by['Cable lateral raise']).toMatchObject({ own: true, programs: ['Block B'] });
    expect(by['Leg extension, seat reclined'].video).toBeNull();
    expect(by['Face pull']).toMatchObject({ own: true, programs: [] });
    expect(rows[0].video).toBeNull(); // missing ones first
  });

  test('shows only missing videos by default; the count; inherited rows say which video', () => {
    const rows = w.TechniqueVideos.rows(programs, saved);
    const body = w.document.body;
    body.innerHTML = w.TechniqueVideos.html(rows, { filter: 'missing' });
    expect(body.querySelector('.pb-stats').textContent).toBe('6 exercises · 2 without a video');
    expect([...body.querySelectorAll('.tv-name')].map(td => td.firstChild.textContent)).toEqual(['Leg extension, seat reclined', 'Seated leg curl']);
    body.innerHTML = w.TechniqueVideos.html(rows, { filter: 'all' });
    expect(body.textContent).toMatch(/▶ Uses “Hack squat”/);
    expect(body.querySelectorAll('[data-tv-act="delete"]').length).toBe(3);
    expect(body.textContent).toContain('Covers Hack squat (or Smith squat), deep');
  });
});
