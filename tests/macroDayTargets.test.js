/**
 * @jest-environment node
 */
const { buildBodybuildingDayTargets } = require('../src/utils/macroEngine.js');

const saved = { protein: 180, carbs: 250, fat: 70 };

describe('day targets keep the saved (slider) targets unless a day type is picked', () => {
  test('no day type, normal carbs → exactly the saved targets', () => {
    const { adjusted } = buildBodybuildingDayTargets(saved, { dayType: 'base', carbCycle: 'normal' });
    expect(adjusted).toEqual({ protein: 180, carbs: 250, fat: 70, calories: 180 * 4 + 250 * 4 + 70 * 9 });
  });
  test('missing strategy also keeps them', () => {
    expect(buildBodybuildingDayTargets(saved).adjusted).toMatchObject(saved);
  });
  test('training day split still applies when chosen', () => {
    const { adjusted } = buildBodybuildingDayTargets(saved, { dayType: 'training' });
    expect(adjusted).toMatchObject({ protein: 189, carbs: 280, fat: 64 });
  });
  test('rest day split only when chosen', () => {
    expect(buildBodybuildingDayTargets(saved, { dayType: 'rest' }).adjusted).toMatchObject({ carbs: 205, fat: 77 });
  });
  test('refeed on a normal day', () => {
    expect(buildBodybuildingDayTargets(saved, { dayType: 'base', isRefeedDay: true }).adjusted).toMatchObject({ protein: 180, carbs: 338 });
  });
});
