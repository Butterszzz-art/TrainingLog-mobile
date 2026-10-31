const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// Adjust tab: each macro's number is a box you can type in. Typing sets that
// macro (the slider follows) and the calories become 4P + 9F + 4C, without
// taking grams from the other macros the way dragging does.
describe('typeMacro (typing a macro on the Adjust tab)', () => {
  let context;
  let doc;

  beforeEach(() => {
    const html = fs.readFileSync('index.html', 'utf8');
    const start = html.indexOf('function _updateSliderDisplay()');
    const end = html.indexOf('function saveSliderMacros', start);
    const dom = new JSDOM(`<!DOCTYPE html>
      <span id="macroTotalCals">0</span><span id="calTarget">0</span>
      <input type="range" id="proteinSlider" min="0" max="200" value="150">
      <input type="range" id="fatSlider" min="0" max="80" value="70">
      <input type="range" id="carbSlider" min="0" max="320" value="300">
      <input type="number" id="proteinVal"><input type="number" id="fatVal"><input type="number" id="carbVal">`);
    doc = dom.window.document;
    context = { document: doc, window: {}, macroRanges: { tdee: 2430 } };
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    context._updateSliderDisplay();
  });

  const type = (box, slider, value) => {
    doc.getElementById(box).value = value;
    context.typeMacro(slider);
  };

  test('the boxes show the slider values', () => {
    expect(doc.getElementById('proteinVal').value).toBe('150');
    expect(doc.getElementById('fatVal').value).toBe('70');
    expect(doc.getElementById('carbVal').value).toBe('300');
  });

  test('typing sets the macro and recalculates calories, leaving the others alone', () => {
    type('proteinVal', 'proteinSlider', '180');
    expect(doc.getElementById('proteinSlider').value).toBe('180');
    expect(doc.getElementById('fatSlider').value).toBe('70');
    expect(doc.getElementById('carbSlider').value).toBe('300');
    // 180*4 + 70*9 + 300*4 = 720 + 630 + 1200
    expect(doc.getElementById('macroTotalCals').textContent).toBe('2550');
    expect(context.macroRanges.tdee).toBe(2550);
  });

  test('a value above the slider range raises the slider max', () => {
    type('carbVal', 'carbSlider', '450');
    expect(doc.getElementById('carbSlider').max).toBe('450');
    expect(doc.getElementById('carbSlider').value).toBe('450');
    expect(doc.getElementById('macroTotalCals').textContent).toBe(String(150 * 4 + 70 * 9 + 450 * 4));
  });

  test('an empty box (mid-typing) or a negative number changes nothing', () => {
    type('fatVal', 'fatSlider', '');
    expect(doc.getElementById('fatSlider').value).toBe('70');
    type('fatVal', 'fatSlider', '-5');
    expect(doc.getElementById('fatSlider').value).toBe('70');
  });

  test('decimals are rounded and silly numbers capped', () => {
    type('fatVal', 'fatSlider', '62.6');
    expect(doc.getElementById('fatSlider').value).toBe('63');
    type('proteinVal', 'proteinSlider', '99999');
    expect(doc.getElementById('proteinSlider').value).toBe('1500');
  });
});
