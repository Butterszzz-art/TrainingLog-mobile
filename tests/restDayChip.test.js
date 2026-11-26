/**
 * @jest-environment node
 */
// Today's setup has a Rest day chip next to Training day; the two are one
// or the other, and Rest day picks the rest-day macros.
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');

function extract(start, end) {
  const i = html.indexOf(start);
  const j = html.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`markers not found: ${start}`);
  return html.slice(i, j);
}

function settingsFor(training, rest) {
  const nodes = {
    trainingDayToggle: { checked: training },
    restDayToggle: { checked: rest },
    carbCycleSelect: { value: 'normal' },
    refeedDayToggle: { checked: false },
  };
  const ctx = { document: { getElementById: id => nodes[id] || null } };
  vm.createContext(ctx);
  vm.runInContext(`${extract('function getMacroCyclingSettings()', 'function getCoachNutritionPlanStore()')}
    this.out = getMacroCyclingSettings();`, ctx);
  return ctx.out;
}

test('the Rest day chip sits next to Training day', () => {
  const block = extract('id="trainingDayCard"', 'id="refeedDayCard"');
  expect(block).toMatch(/id="restDayToggle"/);
  expect(block).toMatch(/>Rest day</);
});

test('day type follows the chips', () => {
  expect(settingsFor(true, false).dayType).toBe('training');
  expect(settingsFor(false, true).dayType).toBe('rest');
  expect(settingsFor(false, false).dayType).toBe('base');
});

test('ticking one chip unticks the other', () => {
  const listener = extract('["carbCycleSelect", "refeedDayToggle"', 'persistMacroDayContext({ dayTypeSetByHand');
  expect(listener).toMatch(/"restDayToggle"/);
  expect(listener).toMatch(/id === 'trainingDayToggle' \? 'restDayToggle' : id === 'restDayToggle' \? 'trainingDayToggle'/);
});
