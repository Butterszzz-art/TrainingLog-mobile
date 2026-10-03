// Quick-log stepper state (src/js/session-queue.js).
const { JSDOM } = require('jsdom');

function loadQuickLog() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>');
  global.document = dom.window.document;
  global.window = global; // the module's `global` falls back to globalThis
  document.body.innerHTML = `
    <input id="exercise">
    <input id="sets" type="hidden">
    <input id="weightUnit" value="kg">
    <div id="quickLogPanel" hidden>
      <span id="qlWeightVal"></span><span id="qlRepsVal"></span>
      <div id="setInputsContainer"></div>
    </div>`;
  const row = i => `<div class="set-input-row"><input id="reps_${i}"><input id="weight_${i}"></div>`;
  // The app's own generateSetInputs()/addLogEntry() live in index.html;
  // these stand-ins keep just what quick log relies on.
  window.generateSetInputs = n => {
    document.getElementById('setInputsContainer').innerHTML = Array.from({ length: n }, (_, i) => row(i)).join('');
  };
  window.logged = [];
  window.addLogEntry = () => {
    window.logged.push({
      exercise: document.getElementById('exercise').value,
      reps: Number(document.getElementById('reps_0').value),
      weight: Number(document.getElementById('weight_0').value),
    });
    document.getElementById('exercise').value = ''; // success signal
  };
  let api;
  jest.isolateModules(() => { api = require('../src/js/session-queue'); });
  return api;
}

afterEach(() => { delete global.document; delete global.window; });

const typeExercise = (api, name) => {
  document.getElementById('exercise').value = name;
  api.initQuickLog(name);
};

describe('quick log', () => {
  test("a new exercise doesn't inherit the previous exercise's reps and weight", () => {
    const api = loadQuickLog();
    typeExercise(api, 'Bench Press');
    api.quickLogStep('reps', 2);   // 10 reps
    api.quickLogStep('weight', 4); // 30 kg
    api.quickLogSet();
    expect(window.logged).toEqual([{ exercise: 'Bench Press', reps: 10, weight: 30 }]);

    typeExercise(api, 'Goblet Squat');
    expect(document.getElementById('qlRepsVal').textContent).toBe('8');
    expect(document.getElementById('qlWeightVal').textContent).toContain('20');
  });

  test('values stay sticky across sets of the same exercise', () => {
    const api = loadQuickLog();
    typeExercise(api, 'Bench Press');
    api.quickLogStep('reps', 2);
    api.quickLogSet();
    api.quickLogSet();
    expect(window.logged.map(l => l.reps)).toEqual([10, 10]);
  });

  test('going back to one row keeps what was typed into row 0', () => {
    const api = loadQuickLog();
    typeExercise(api, 'Goblet Squat');
    // "+ Add another set", type into row 0, then remove the extra row.
    window.generateSetInputs(2);
    document.getElementById('reps_0').value = '12';
    document.getElementById('weight_0').value = '32';
    window.generateSetInputs(1);
    document.getElementById('reps_0').value = '12';
    document.getElementById('weight_0').value = '32';
    api.syncQuickLogFromRow0();
    api.quickLogSet();
    expect(window.logged).toEqual([{ exercise: 'Goblet Squat', reps: 12, weight: 32 }]);
  });
});
