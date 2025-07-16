const { computeOneRepMax, updatePRs } = require('../progressUtils');
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
