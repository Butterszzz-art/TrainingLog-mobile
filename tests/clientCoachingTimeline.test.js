// Your Coach (src/js/client-coaching.js): where the client is in a coach's
// multi-week program, and the coach's repeat / pause weeks reaching the
// program the client follows.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SCRIPTS = ['src/js/program-timeline.js', 'src/js/programBuilderV2Core.js', 'src/js/client-coaching.js'].map(read);

const set = w => ({ reps: 8, rir: 2, restSec: 120, weight: w });
const day = (name, w) => ({ name, exercises: [{ name: 'Bench Press', sets: [set(w), set(w)] }] });
// Library shape as the server sends it (coachShare.toClientProgram).
const program = {
  id: 'coach-coachy-p1', title: 'Off-season', frequency: ['Mon', 'Wed', 'Fri'],
  days: [day('A', 80), day('B', 80), day('C', 80)],
  weeks: [1, 2, 3, 4, 5].map(n => ({ week: n, label: 'Week ' + n, phase: n <= 3 ? 'Accumulation' : 'Intensification', deload: n === 3, days: [day('A', 80 + n), day('B', 80 + n), day('C', 80 + n)] })),
  blocks: [{ name: 'Accumulation', goal: 'Volume up', fromWeek: 1, toWeek: 3 }, { name: 'Intensification', goal: '', fromWeek: 4, toWeek: 5 }],
  durationWeeks: 5,
};

function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// The Monday `weeksAgo` weeks before this week's Monday.
function mondayWeeksAgo(weeksAgo) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow) - 7 * weeksAgo);
  return iso(d);
}

async function setup({ schedule, stored }) {
  const dom = new JSDOM('<!doctype html><body><div id="yourCoachSection"></div></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  w.localStorage.setItem('fitnessAppUser', 'ana');
  w.localStorage.setItem('token', 't');
  Object.entries(stored || {}).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
  const toasts = [];
  w.showToast = msg => toasts.push(msg);
  w.showConfirm = async () => true;
  w.SERVER_URL = 'https://api.test';
  const assignment = { coachUid: 'c1', coachUsername: 'coachy', currentProgram: 'Off-season', currentProgramId: 'p1', program, programSchedule: schedule || null };
  const replies = {
    '/api/client/coach-invites': { invites: [{ coachUid: 'c1', coachUsername: 'coachy', status: 'active' }] },
    '/api/client/coach-assignment': { assignments: [assignment] },
  };
  w.fetch = async url => {
    const p = String(url).replace('https://api.test', '').split('?')[0];
    const body = replies[p] || {};
    return { ok: true, status: 200, json: async () => ({ success: true, ...body }) };
  };
  SCRIPTS.forEach(s => w.eval(s));
  await w.renderYourCoachSection();
  await new Promise(r => setTimeout(r, 0));
  const $ = sel => w.document.querySelector(sel);
  return { w, $, toasts, text: () => ($('.yc-position') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim() };
}

test('before starting: weeks and mesocycles, a strip per week', async () => {
  const { $, text } = await setup({});
  expect(text()).toMatch(/5 weeks · 2 mesocycles/);
  expect($('.yc-strip').children).toHaveLength(5);
  expect([...$('.yc-legend').children].map(x => x.textContent)).toEqual(['Accumulation', 'Intensification']);
});

test('following the program: mesocycle, week in it, weeks to go, the coach\'s next change', async () => {
  const start = mondayWeeksAgo(1); // this is the 2nd week
  const { $, text } = await setup({
    schedule: { programId: 'p1', startDate: '', changes: [{ id: 'p', kind: 'pause', afterWeek: 3, note: 'Holiday' }, { id: 'r', kind: 'repeat', afterWeek: 1 }] },
    stored: {
      programs_ana: [{ id: 'imp-1', name: 'Off-season', frequency: ['Mon', 'Wed', 'Fri'], days: program.days, weeks: program.weeks, source: { type: 'coach-program', coachUid: 'c1', programId: 'p1' } }],
      activeProgram_ana: { programId: 'imp-1', startDate: start },
    },
  });
  // W1, W1 again, W2, W3 (deload), pause, W4, W5 → this week is "week 1 again".
  expect(text()).toMatch(/Accumulation · week 2 of 4 · Repeat week/);
  expect(text()).toMatch(/Week 2 of 7 · 5 weeks to go/);
  expect(text()).toMatch(/Goal: Volume up/);
  expect(text()).toMatch(/Coming up: a week off from .* · Holiday/);
  const segs = [...$('.yc-strip').children];
  expect(segs).toHaveLength(7);
  expect(segs[1].className).toContain('is-now');
  expect(segs[0].className).toContain('is-done');
  expect(segs[3].className).toContain('is-deload');
  expect(segs[4].className).toContain('is-pause');
});

test('the coach\'s changes and start date reach the program the client follows', async () => {
  const start = mondayWeeksAgo(2);
  const { w, toasts } = await setup({
    schedule: { programId: 'p1', startDate: start, changes: [{ id: 'p', kind: 'pause', afterWeek: 2 }] },
    stored: {
      programs_ana: [{ id: 'imp-1', name: 'Off-season', frequency: ['Mon', 'Wed', 'Fri'], days: program.days, weeks: program.weeks, source: { type: 'library', id: 'coach-coachy-p1' } }],
      activeProgram_ana: { programId: 'imp-1', startDate: mondayWeeksAgo(1) },
    },
  });
  const followed = JSON.parse(w.localStorage.getItem('programs_ana'))[0];
  expect(followed.timeline).toEqual({ startDate: start, changes: [{ id: 'p', kind: 'pause', afterWeek: 2, note: '' }] });
  expect(JSON.parse(w.localStorage.getItem('activeProgram_ana')).startDate).toBe(start);
  expect(toasts.join(' ')).toMatch(/coachy updated the weeks of Off-season/);
});

test('a schedule for another program is ignored', async () => {
  const { text } = await setup({ schedule: { programId: 'old', startDate: '2020-01-06', changes: [{ id: 'p', kind: 'pause', afterWeek: 1 }] } });
  expect(text()).toMatch(/5 weeks · 2 mesocycles/);
});
