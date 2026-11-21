// Runs in Europe/Amsterdam: Jest's globalSetup (tests/setup/timezone.js) pins the zone.
const T = require('../src/js/app-time');

const iso = ms => new Date(ms).toISOString();

describe('AppTime', () => {
  test('follows the phone zone', () => {
    expect(T.zone()).toBe('Europe/Amsterdam');
    expect(T.deviceZone()).toBe('Europe/Amsterdam');
  });

  test("today is the lifter's own day, not UTC's", () => {
    // 00:30 in Amsterdam on 17 Nov is still the 16th in UTC.
    const ms = Date.UTC(2026, 10, 16, 23, 30);
    expect(T.dateKey(ms)).toBe('2026-11-17');
    expect(new Date(ms).toISOString().slice(0, 10)).toBe('2026-11-16');
  });

  test('dateKey in other countries', () => {
    const ms = Date.UTC(2026, 10, 21, 15, 0); // 15:00 UTC, 21 Nov
    expect(T.dateKey(ms, 'Asia/Tokyo')).toBe('2026-11-22');       // 00:00 +9
    expect(T.dateKey(ms, 'Australia/Sydney')).toBe('2026-11-22'); // 02:00 +11
    expect(T.dateKey(ms, 'America/New_York')).toBe('2026-11-21'); // 10:00 −5
    expect(T.dateKey(ms, 'Pacific/Honolulu')).toBe('2026-11-21');
    expect(T.parts(ms, 'Asia/Kolkata')).toMatchObject({ hour: 20, minute: 30, weekday: 6 });
  });

  test('at() turns a wall-clock time on a day into the right moment', () => {
    expect(iso(T.at('2026-11-21', '00:00', 'Asia/Tokyo'))).toBe('2026-11-20T15:00:00.000Z');
    expect(iso(T.at('2026-11-21', '08:15', 'America/New_York'))).toBe('2026-11-21T13:15:00.000Z');
    expect(iso(T.at('2026-11-21', '08:15'))).toBe('2026-11-21T07:15:00.000Z');
    // Clocks jump 02:00 → 03:00 in Amsterdam on 29 Mar: 02:30 doesn't exist.
    expect(iso(T.at('2026-03-29', '02:30', 'Europe/Amsterdam'))).toBe('2026-03-29T01:30:00.000Z');
    expect(T.at('2026-11-21', '24:00')).toBeNull();
    expect(T.at('nope', '10:00')).toBeNull();
  });

  test('dayRange is local midnight to midnight, 23 or 25 hours on a DST change', () => {
    const r = T.dayRange('2026-11-21', 'America/New_York');
    expect(iso(r.start)).toBe('2026-11-21T05:00:00.000Z');
    expect(r.end - r.start).toBe(24 * 3600e3);
    const spring = T.dayRange('2026-03-08', 'America/New_York');
    expect(spring.end - spring.start).toBe(23 * 3600e3);
    const autumn = T.dayRange('2026-10-25');
    expect(autumn.end - autumn.start).toBe(25 * 3600e3);
  });

  test('addDays is calendar maths', () => {
    expect(T.addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(T.addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('labels', () => {
    const nov = Date.UTC(2026, 10, 21);
    expect(T.offsetLabel(nov, 'Asia/Kolkata')).toBe('GMT+5:30');
    expect(T.offsetLabel(nov, 'America/New_York')).toBe('GMT−5');
    expect(T.zoneLabel('America/Argentina/Buenos_Aires', nov)).toBe('Buenos Aires (GMT−3)');
    expect(T.zoneLabel('UTC', nov)).toBe('UTC (GMT+0)');
    expect(T.zoneLabel(undefined, nov)).toBe('Amsterdam (GMT+1)');
    expect(T.hhmm(Date.UTC(2026, 10, 21, 7, 5))).toBe('08:05');
  });

  test('check() reports a day change once', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(Date.UTC(2026, 10, 21, 22, 59));
    T.check(); // baseline
    expect(T.check()).toBe(false);
    now.mockReturnValue(Date.UTC(2026, 10, 21, 23, 1)); // past midnight in Amsterdam
    expect(T.check()).toBe(true);
    expect(T.check()).toBe(false);
    now.mockRestore();
  });

  test('isValidZone', () => {
    expect(T.isValidZone('Asia/Tokyo')).toBe(true);
    expect(T.isValidZone('Mars/Olympus')).toBe(false);
    expect(T.isValidZone('')).toBe(false);
  });
});
