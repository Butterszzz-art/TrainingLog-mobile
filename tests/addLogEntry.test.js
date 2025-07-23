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
      currentSetCount: 0
    };
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
});
