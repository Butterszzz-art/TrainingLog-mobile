/**
 * AppTime — the app's clock and calendar day, in the lifter's time zone.
 *
 * Before this, "today" was worked out in a mix of ways: the food log, check-
 * ins, posing, PRs and more used new Date().toISOString(), which is UTC's
 * date, so the app's day rolled over at UTC midnight (10am in Sydney, 7pm in
 * New York) instead of the user's own midnight.
 *
 * The zone is the phone's current one, re-read on every call, so flying
 * from London to Tokyo moves the app's clock and day with the phone. (There's
 * deliberately no "pin a zone" setting: dozens of modules do calendar maths
 * with the device's local Date, and a pinned zone would split the app's idea
 * of "today" between them.)
 *
 * Everything that turns "now" into a calendar day or a time of day should go
 * through here: AppTime.today(), AppTime.dateKey(ms), AppTime.hour(),
 * AppTime.hhmm(ms), AppTime.at(dateKey, 'HH:MM').
 *
 * When the zone or the app's day changes (travel, or midnight with the app
 * open) an 'apptime:change' event fires on window with
 * { zone, previousZone, today, previousToday }.
 */
(function (global) {
  'use strict';

  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;

  const pad = n => String(n).padStart(2, '0');

  function isValidZone(zone) {
    if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch (_e) {
      return false;
    }
  }

  // ── Which zone ──────────────────────────────────────────────────────
  function deviceZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (_e) {
      return '';
    }
  }

  // The zone the app's clock is in right now ('' when unknown: device local).
  function zone() {
    return deviceZone();
  }

  // Formatters are slow to build; keep one per zone.
  const _fmts = new Map();
  function formatter(z) {
    const key = z || '';
    let f = _fmts.get(key);
    if (!f) {
      const opts = { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' };
      if (z) opts.timeZone = z;
      f = new Intl.DateTimeFormat('en-US', opts);
      _fmts.set(key, f);
    }
    return f;
  }

  const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // Wall-clock parts of a moment in a zone: { year, month (1-12), day, hour,
  // minute, second, weekday (0 = Sunday) }.
  function parts(when, z) {
    const ms = when == null ? Date.now() : when instanceof Date ? when.getTime() : Number(when);
    const d = new Date(Number.isFinite(ms) ? ms : Date.now());
    const useZone = z === undefined ? zone() : z;
    if (!useZone || useZone === deviceZone()) {
      return {
        year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
        hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), weekday: d.getDay(),
      };
    }
    try {
      const out = {};
      formatter(useZone).formatToParts(d).forEach(p => { out[p.type] = p.value; });
      return {
        year: Number(out.year), month: Number(out.month), day: Number(out.day),
        hour: Number(out.hour) % 24, minute: Number(out.minute), second: Number(out.second),
        weekday: WEEKDAYS[out.weekday] ?? d.getDay(),
      };
    } catch (_e) {
      return parts(d, '');
    }
  }

  // ── Days and times ──────────────────────────────────────────────────
  // "YYYY-MM-DD" for a moment (default now) in the app's zone.
  function dateKey(when, z) {
    const p = parts(when, z);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  }

  function today() {
    return dateKey();
  }

  // The app day `n` days from `key` (calendar maths, no zone involved).
  function addDays(key, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return key;
    const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (Number(n) || 0)));
    return t.toISOString().slice(0, 10);
  }

  function hour(when) {
    return parts(when).hour;
  }

  // "HH:MM" wall clock in the app's zone.
  function hhmm(when) {
    const p = parts(when);
    return `${pad(p.hour)}:${pad(p.minute)}`;
  }

  // Offset of `z` from UTC at a moment, in minutes (e.g. +60 for Amsterdam
  // in winter).
  function offsetMinutes(when, z) {
    const ms = when == null ? Date.now() : when instanceof Date ? when.getTime() : Number(when);
    const p = parts(ms, z === undefined ? zone() : z);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - (ms - (ms % 1000))) / MIN);
  }

  // Epoch ms for wall-clock "HH:MM" on app day `key` in the app's zone.
  // Times that don't exist (skipped by a DST jump) land just after the gap;
  // repeated ones take the first.
  function at(key, time, z) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time == null ? '00:00' : time));
    if (!dm || !tm) return null;
    const h = Number(tm[1]);
    const mi = Number(tm[2]);
    if (h > 23 || mi > 59) return null;
    const useZone = z === undefined ? zone() : z;
    if (!useZone || useZone === deviceZone()) {
      return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), h, mi).getTime();
    }
    const guess = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), h, mi);
    // Two passes settle the offset, including across a DST change.
    let ms = guess - offsetMinutes(guess, useZone) * MIN;
    ms = guess - offsetMinutes(ms, useZone) * MIN;
    return ms;
  }

  // { start, end } epoch ms of app day `key`.
  function dayRange(key, z) {
    const start = at(key, '00:00', z);
    const end = at(addDays(key, 1), '00:00', z);
    if (start == null || end == null) return null;
    return { start, end };
  }

  // ── Labels and the zone list ────────────────────────────────────────
  function offsetLabel(when, z) {
    const off = offsetMinutes(when, z);
    const sign = off < 0 ? '−' : '+';
    const a = Math.abs(off);
    return `GMT${sign}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
  }

  // "Tokyo" from "Asia/Tokyo", "Buenos Aires" from "America/Argentina/Buenos_Aires".
  function cityName(z) {
    if (!z) return 'Local time';
    if (z === 'UTC' || z === 'Etc/UTC') return 'UTC';
    return z.split('/').pop().replace(/_/g, ' ');
  }

  function regionName(z) {
    const first = String(z || '').split('/')[0];
    return first === z ? '' : first.replace(/_/g, ' ');
  }

  function zoneLabel(z, when) {
    const useZone = z === undefined ? zone() : z;
    return `${cityName(useZone)} (${offsetLabel(when, useZone)})`;
  }

  // A readable clock string for `when` (default now) in the app's zone.
  function formatTime(when, opts) {
    const ms = when == null ? Date.now() : when instanceof Date ? when.getTime() : Number(when);
    const z = zone();
    try {
      return new Date(ms).toLocaleTimeString([], Object.assign({ hour: 'numeric', minute: '2-digit' }, z ? { timeZone: z } : {}, opts || {}));
    } catch (_e) {
      return hhmm(ms);
    }
  }

  // ── Noticing changes ──────────────────────────
  let _last = null;

  function snapshot() {
    return { zone: zone(), today: today() };
  }

  function emitIfChanged() {
    const now = snapshot();
    const prev = _last;
    _last = now;
    if (!prev || (prev.zone === now.zone && prev.today === now.today)) return false;
    const detail = { zone: now.zone, previousZone: prev.zone, today: now.today, previousToday: prev.today };
    try {
      if (global.dispatchEvent && typeof global.CustomEvent === 'function') {
        global.dispatchEvent(new global.CustomEvent('apptime:change', { detail }));
      }
    } catch (_e) { /* ignore */ }
    return true;
  }

  let _watching = false;
  function watch() {
    if (_watching || typeof global.addEventListener !== 'function') return;
    _watching = true;
    _last = snapshot();
    const check = () => emitIfChanged();
    global.addEventListener('focus', check);
    global.addEventListener('pageshow', check);
    if (global.document && global.document.addEventListener) {
      global.document.addEventListener('visibilitychange', () => {
        if (global.document.visibilityState === 'visible') check();
      });
    }
    // Native resume (Capacitor App plugin), when present.
    try {
      const AppPlugin = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.App;
      if (AppPlugin && AppPlugin.addListener) {
        AppPlugin.addListener('appStateChange', st => { if (st && st.isActive) check(); });
      }
    } catch (_e) { /* ignore */ }
    // Midnight, or a zone change, while the app stays open.
    setInterval(check, MIN);
  }

  const api = {
    DAY,
    isValidZone, deviceZone, zone,
    parts, dateKey, today, addDays, hour, hhmm, at, dayRange,
    offsetMinutes, offsetLabel, cityName, zoneLabel, formatTime,
    watch, check: emitIfChanged,
  };

  global.AppTime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') watch();
})(typeof window !== 'undefined' ? window : globalThis);
