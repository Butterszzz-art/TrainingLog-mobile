/**
 * Jest globalSetup: pin the timezone for every test run.
 *
 * Test files run in a sandbox with a copy of process.env, so a test that
 * sets process.env.TZ itself never reaches Node and keeps the machine's
 * zone (UTC on CI). Setting it here, in the real process before the
 * workers start, makes date-sensitive tests (mealTiming) behave the same
 * on every machine. Europe/Amsterdam matches what those tests expect.
 */
module.exports = () => {
  process.env.TZ = 'Europe/Amsterdam';
};
