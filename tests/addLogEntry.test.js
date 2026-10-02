const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

describe('addLogEntry', () => {
  function loadAddLogEntry(context) {
    const html = fs.readFileSync('index.html', 'utf8');
    const start = html.indexOf('function addLogEntry()');
    const end = html.indexOf('function renderWorkouts', start);
    const code = html.slice(start, end);
    vm.runInContext(code, context);
    return context.addLogEntry;
  }

  let context;
  let dom;
  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html>
      <input id="exercise">
      <input id="sets">
      <input id="goal">
      <input id="repGoal">
      <input id="weightUnit">
      <input id="entryDate">
      <div id="setInputsContainer"></div>
      <input id="reps_0">
      <input id="weight_0">
      <input id="dropset_0" type="checkbox">
      <input id="restPause_0" type="checkbox">`);

    context = {
      document: dom.window.document,
      localStorage: {
        store: {},
        getItem(key) { return this.store[key] || null; },
        setItem(key, val) { this.store[key] = String(val); },
        clear() { this.store = {}; }
      },
      currentUser: 'u1',
      calculateWorkoutVolume: () => 0,
      updatePRs: () => {},
      updateGoalProgress: () => {},
      renderPRs: () => {},
      analyzeProgress: () => [],
      renderMilestones: () => {},
      renderGoalBar: () => {},
      showCoachInsights: () => {},
      saveUserExercise: () => {},
      trackWorkoutDate: () => {},
      renderWorkouts: () => {},
      updateTrainingCalendar: () => {},
      showToast: () => {},
      updateAddButtonState: () => {},
      alert: () => {},
      currentSetCount: 0,
      // addLogEntry() now resolves the active user via
      // `window.coachLoggingClient || getActiveUsername() || currentUser`
      // (coach-logging-on-behalf-of-client support) and stamps each set
      // with `createDefaultAdvancedSet()` — both added after this test's
      // sandbox was written, so calling addLogEntry() threw a bare
      // ReferenceError before either was stubbed here.
      getActiveUsername: () => 'u1',
      createDefaultAdvancedSet: () => ({}),
      // addLogEntry() announces each saved entry with a tl:set-logged
      // CustomEvent (performance mode auto-starts the rest timer from it).
      CustomEvent: dom.window.CustomEvent
    };
    context.window = context; // so `window.coachLoggingClient` resolves (to undefined, falling through to getActiveUsername())
    vm.createContext(context);
    context.addLogEntry = loadAddLogEntry(context);
  });

  test('creates new workout when date differs from last', () => {
    const doc = context.document;
    doc.getElementById('exercise').value = 'Bench';
    doc.getElementById('sets').value = '1';
    doc.getElementById('goal').value = '100';
    doc.getElementById('repGoal').value = '5';
    doc.getElementById('weightUnit').value = 'kg';
    doc.getElementById('reps_0').value = '5';
    doc.getElementById('weight_0').value = '100';

    doc.getElementById('entryDate').value = '2024-01-01';
    context.addLogEntry();
    let workouts = JSON.parse(context.localStorage.getItem('workouts_u1'));
    expect(workouts.length).toBe(1);

    doc.getElementById('entryDate').value = '2024-01-02';
    doc.getElementById('exercise').value = 'Bench';
    doc.getElementById('sets').value = '1';
    doc.getElementById('reps_0').value = '5';
    doc.getElementById('weight_0').value = '100';
    context.addLogEntry();
    workouts = JSON.parse(context.localStorage.getItem('workouts_u1'));
    expect(workouts.length).toBe(2);
  });

  test('dispatches tl:set-logged after a successful save', () => {
    const doc = context.document;
    const events = [];
    doc.addEventListener('tl:set-logged', (e) => events.push(e.detail));
    doc.getElementById('exercise').value = 'Bench';
    doc.getElementById('sets').value = '1';
    doc.getElementById('weightUnit').value = 'kg';
    doc.getElementById('reps_0').value = '5';
    doc.getElementById('weight_0').value = '100';
    doc.getElementById('entryDate').value = '2024-01-01';
    context.addLogEntry();
    expect(events).toEqual([{ exercise: 'Bench', sets: 1, date: '2024-01-01' }]);
  });

  function fillOneSet(doc) {
    doc.getElementById('exercise').value = 'Bench';
    doc.getElementById('sets').value = '1';
    doc.getElementById('weightUnit').value = 'kg';
    doc.getElementById('reps_0').value = '5';
    doc.getElementById('weight_0').value = '100';
  }

  function localToday() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  test('a stale pre-filled log date (app left open overnight) logs to today', () => {
    const doc = context.document;
    const input = doc.getElementById('entryDate');
    // Pre-filled when the app was opened yesterday, never touched since.
    input.value = '2024-01-01';
    input.dataset.autoDate = '2024-01-01';
    fillOneSet(doc);
    context.addLogEntry();
    const workouts = JSON.parse(context.localStorage.getItem('workouts_u1'));
    expect(workouts.map(w => w.date)).toEqual([localToday()]);
    // Re-armed with today's local date for the next set.
    expect(input.value).toBe(localToday());
    expect(input.dataset.autoDate).toBe(localToday());
  });

  test('a date the lifter picked is still honoured', () => {
    const doc = context.document;
    const input = doc.getElementById('entryDate');
    input.value = '2024-01-01';
    input.dataset.autoDate = '2024-01-01';
    input.value = '2023-12-31';
    delete input.dataset.autoDate; // what the input's oninput does
    fillOneSet(doc);
    context.addLogEntry();
    const workouts = JSON.parse(context.localStorage.getItem('workouts_u1'));
    expect(workouts.map(w => w.date)).toEqual(['2023-12-31']);
  });

  test('sets logged on the same local day share one workout', () => {
    const doc = context.document;
    doc.getElementById('entryDate').value = '';
    fillOneSet(doc);
    context.addLogEntry();
    fillOneSet(doc);
    doc.getElementById('exercise').value = 'Squat';
    context.addLogEntry();
    const workouts = JSON.parse(context.localStorage.getItem('workouts_u1'));
    expect(workouts).toHaveLength(1);
    expect(workouts[0].date).toBe(localToday());
    expect(workouts[0].log.map(e => e.exercise)).toEqual(['Bench', 'Squat']);
  });

  test('does not dispatch tl:set-logged when validation fails', () => {
    const doc = context.document;
    const events = [];
    doc.addEventListener('tl:set-logged', (e) => events.push(e.detail));
    doc.getElementById('exercise').value = '';
    doc.getElementById('sets').value = '1';
    context.addLogEntry();
    expect(events).toEqual([]);
  });
});
