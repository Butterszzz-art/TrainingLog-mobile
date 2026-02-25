const {
  computeOneRepMax,
  updatePRs,
  calculateMonotony,
  calculateStrain
} = require('../progressUtils');
const { computeOneRepMax, calculate1RM, calculateWorkoutMetrics, updatePRs } = require('../progressUtils');
const { calculateWorkoutVolume } = require('../calculateWorkoutVolume');

test('computeOneRepMax calculates epley estimate', () => {
  const orm = computeOneRepMax([100], [5]);
  expect(orm).toBeCloseTo(100 * (1 + 5 / 30));
});

test('updatePRs updates record when higher', () => {
  const user = 'testUser';
  global.localStorage = { getItem: jest.fn(()=>null), setItem: jest.fn() };
  const workout = { log: [{ exercise:'Bench', weightsArray:[100], repsArray:[5] }] };
  const prs = updatePRs(user, workout, calculateWorkoutVolume);
  expect(prs.Bench.oneRM).toBeGreaterThan(0);
});

test('calculateMonotony returns mean divided by standard deviation', () => {
  const dailyLoads = [100, 200, 100, 200, 100, 200, 100];
  const monotony = calculateMonotony(dailyLoads);
  expect(monotony).toBeCloseTo(2.8868, 3);
});

test('calculateStrain multiplies monotony and weekly load', () => {
  expect(calculateStrain(2, 1500)).toBe(3000);

test('calculate1RM supports brzycki method', () => {
  const orm = calculate1RM(5, 100, 'brzycki');
  expect(orm).toBeCloseTo(100 * (36 / (37 - 5)));
});

test('calculateWorkoutMetrics returns volume, intensity, and estimated 1RM', () => {
  const metrics = calculateWorkoutMetrics({
    log: [{ repsArray: [5, 8], weightsArray: [100, 80] }]
  });
  expect(metrics.sessionVolume).toBe(1140);
  expect(metrics.averageIntensity).toBeGreaterThan(0);
  expect(metrics.estimated1RM).toBeGreaterThan(100);
});
