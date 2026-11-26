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

describe('own rest-day targets', () => {
  const rest = { protein: 180, carbs: 150, fat: 80 };
  test('training day uses the saved targets as they are (no automatic split)', () => {
    const { adjusted, profile } = buildBodybuildingDayTargets(saved, { dayType: 'training', restTargets: rest });
    expect(adjusted).toMatchObject(saved);
    expect(profile.dayType).toBe('training');
  });
  test('any other day uses the rest-day targets', () => {
    const { adjusted, profile } = buildBodybuildingDayTargets(saved, { dayType: 'base', restTargets: rest });
    expect(adjusted).toEqual({ ...rest, calories: 180 * 4 + 150 * 4 + 80 * 9 });
    expect(profile.dayType).toBe('rest');
  });
  test('low carb day adjusts the rest-day numbers', () => {
    expect(buildBodybuildingDayTargets(saved, { dayType: 'base', carbCycle: 'low', restTargets: rest }).adjusted)
      .toMatchObject({ carbs: Math.round(150 * 0.75), fat: Math.round(80 * 1.06) });
  });
  test('high carb day adjusts the training-day numbers', () => {
    expect(buildBodybuildingDayTargets(saved, { dayType: 'training', carbCycle: 'high', restTargets: rest }).adjusted)
      .toMatchObject({ carbs: 300, fat: 63, protein: 180 });
  });
  test('empty rest targets fall back to the old behaviour', () => {
    expect(buildBodybuildingDayTargets(saved, { dayType: 'base', restTargets: { protein: 0, carbs: 0, fat: 0 } }).adjusted)
      .toMatchObject(saved);
  });
});
