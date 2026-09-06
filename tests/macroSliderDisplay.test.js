const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// Regression test for the "Adjust Macros" panel duplicating "kcal", e.g.
// "3480 / 3475 kcal / 3475 kcal". The markup is a single source of truth:
//   <p class="macro-total">Total Calories: <span id="macroTotalCals">0</span>
//     / <span id="calTarget">0</span> kcal</p>
// _updateSliderDisplay() must only write the numeric total into
// #macroTotalCals and the numeric target into #calTarget, letting the
// static " / ... kcal" markup supply the rest of the sentence exactly once.
describe('_updateSliderDisplay', () => {
  function loadUpdateSliderDisplay(context) {
    const html = fs.readFileSync('index.html', 'utf8');
    const start = html.indexOf('function _updateSliderDisplay()');
    const end = html.indexOf('function saveSliderMacros', start);
    const code = html.slice(start, end);
    vm.runInContext(code, context);
    return context._updateSliderDisplay;
  }

  let context;
  let dom;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html>
      <p class="macro-total">Total Calories: <span id="macroTotalCals">0</span> / <span id="calTarget">0</span> kcal</p>
      <input id="proteinSlider" value="150">
      <input id="fatSlider" value="70">
      <input id="carbSlider" value="300">
      <span id="proteinVal"></span>
      <span id="fatVal"></span>
      <span id="carbVal"></span>`);

    context = {
      document: dom.window.document,
      macroRanges: { tdee: 3475 },
    };
    vm.createContext(context);
    context._updateSliderDisplay = loadUpdateSliderDisplay(context);
  });

  test('writes the numeric total and target once each, with no duplicated "kcal"', () => {
    context._updateSliderDisplay();

    const doc = context.document;
    // protein*4 + fat*9 + carbs*4 = 150*4 + 70*9 + 300*4 = 600 + 630 + 1200 = 2430
    expect(doc.getElementById('macroTotalCals').textContent).toBe('2430');
    expect(doc.getElementById('calTarget').textContent).toBe('3475');

    const line = doc.querySelector('.macro-total').textContent.replace(/\s+/g, ' ').trim();
    expect(line).toBe('Total Calories: 2430 / 3475 kcal');
    expect(line.match(/kcal/g).length).toBe(1);
  });
});
