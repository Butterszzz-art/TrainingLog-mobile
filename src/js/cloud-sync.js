/* =============================================================
   CLOUD SYNC
   Keeps the app's on-device data (weights, measurements, cardio,
   macros, programs, templates, mobility, ...) the same on every
   device an account signs in on — phone, iPad, laptop browser.

   The app still reads and writes localStorage as before. This file
   watches the stores listed in STORES, splits each into items (one
   per log entry, or one for a settings-style value), and syncs every
   item on its own through the backend's /api/sync (Firestore, see
   the backend's src/routes/sync.js):

     push  — items that changed or disappeared since the last sync
             (last write wins on the server, by updatedAt)
     pull  — items other devices changed since our cursor

   Workouts are not in here: they have their own route that coaches
   and the leaderboards read (see workout-sync.js).

   Safety:
   - The first sync on a device pulls before it pushes, and the
     server's copy wins, so a fresh install never overwrites real data
     with its defaults.
   - A store whose key is missing entirely (never loaded, or cleared
     on sign-out) is skipped — that is never read as "delete it all".
   - A push that would delete most of a store at once is held back.
   - The server can switch sync off (503 sync.disabled) without an
     app release; so can localStorage.cloudSyncDisabled = '1'.

   Also scopes a few older keys that were stored without the account
   name (today's meals and macro totals) to the signed-in account, so
   two accounts on one device no longer share them.
   ============================================================= */

(function () {
  'use strict';

  const STATE_PREFIX = 'cloudSync_';
  const PUSH_MAX_ITEMS = 100;
  const PUSH_MAX_BYTES = 200 * 1024;
  const ITEM_MAX_BYTES = 190 * 1024;
  const PULL_OVERLAP_MS = 2 * 60 * 1000; // re-read recent writes; see pullAll
  const MASS_DELETE_MIN = 20;
  const MASS_DELETE_SHARE = 0.5;
  const INTERVAL_MS = 30 * 1000;
  const PUSH_DEBOUNCE_MS = 3000;
  const ZERO_ID = '0'.repeat(40);

  // mode: 'list'  — array; each entry syncs on its own. idField names the
  //                 field that identifies an entry (falls back to a hash of
  //                 the entry's content when missing or not unique).
  //       'map'   — object; each top-level key syncs on its own (PRs by
  //                 exercise, metrics by date, settings by name).
  //       'value' — the whole stored string syncs as one item (last edit
  //                 wins). Used for single values and for state objects
  //                 whose parts depend on each other.
  const STORES = [
    { name: 'bodyweightLog',    key: u => `bodyweightLog_${u}`,    mode: 'list', idField: 'date' },
    { name: 'bodyMeasurements', key: u => `bodyMeasurements_${u}`, mode: 'list', idField: 'date' },
    { name: 'cardioLog',        key: u => `cardioLog_${u}`,        mode: 'list' },
    { name: 'crossfitLog',      key: u => `crossfitLog_${u}`,      mode: 'list' },
    { name: 'crossfitWorkouts', key: u => `crossfitWorkouts_${u}`, mode: 'list' },
    { name: 'hyroxLog',         key: u => `hyroxLog_${u}`,         mode: 'list', idField: 'ts' },
    { name: 'macroHistory',     key: u => `macroHistory_${u}`,     mode: 'list', idField: 'date' },
    { name: 'macroTargets',     key: u => `macroTargets_${u}`,     mode: 'value' },
    { name: 'programs',         key: u => `programs_${u}`,         mode: 'list', idField: 'id' },
    { name: 'activeProgram',    key: u => `activeProgram_${u}`,    mode: 'value' },
    { name: 'managedTemplates', key: u => `managedTemplates_${u}`, mode: 'list', idField: 'id' },
    { name: 'mobilityRoutines', key: u => `mobilityRoutines_${u}`, mode: 'list', idField: 'id' },
    { name: 'mobilitySessions', key: u => `mobilitySessions_${u}`, mode: 'list', idField: 'id' },
    // Today's nutrition (scoped per account below).
    { name: 'dailyMacroMeals',    key: u => `dailyMacroMeals_${u}`,    mode: 'value' },
    { name: 'dailyMacroProgress', key: u => `dailyMacroProgress_${u}`, mode: 'value' },
    { name: 'dailyMacroDate',     key: u => `dailyMacroDate_${u}`,     mode: 'value' },
    { name: 'macroResetTime',     key: u => `macroResetTime_${u}`,     mode: 'value' },
    { name: 'macroDayType',       key: u => `macroDayType_${u}`,       mode: 'value' },
    // Logs
    { name: 'sleepLog',        key: u => `sleepLog_${u}`,        mode: 'list', idField: 'date' },
    { name: 'checkIns',        key: u => `checkIns_${u}`,        mode: 'list', idField: 'id' },
    { name: 'plOneRM',         key: u => `plOneRM_${u}`,         mode: 'list' },
    { name: 'injuries',        key: u => `injuries_${u}`,        mode: 'list', idField: 'id' },
    { name: 'rehabLog',        key: u => `rehabLog_${u}`,        mode: 'list', idField: 'id' },
    { name: 'dailyPulse',      key: u => `dailyPulse_${u}`,      mode: 'list', idField: 'date' },
    { name: 'goals',           key: u => `goals_${u}`,           mode: 'list', idField: 'id' },
    { name: 'workoutDates',    key: u => `workoutDates_${u}`,    mode: 'list' },
    { name: 'exercises',       key: u => `exercises_${u}`,       mode: 'list' },
    { name: 'customExercises', key: u => `customExercises_${u}`, mode: 'list', idField: 'name' },
    { name: 'aiChatHistory',   key: u => `aiChatHistory_${u}`,   mode: 'value' },
    // Keyed records
    { name: 'prs',             key: u => `prs_${u}`,             mode: 'map' },
    { name: 'prBoard',         key: u => `prBoard_${u}`,         mode: 'map' },
    { name: 'recoveryMetrics', key: u => `recoveryMetrics_${u}`, mode: 'map' },
    { name: 'settings',        key: u => `settings_${u}`,        mode: 'map' },
    // Profile, targets and plans
    { name: 'userHeight',          key: u => `userHeight_${u}`,          mode: 'value' },
    { name: 'userDivision',        key: u => `userDivision_${u}`,        mode: 'value' },
    { name: 'currentBodyweight',   key: u => `currentBodyweight_${u}`,   mode: 'value' },
    { name: 'weightTrend',         key: u => `weightTrend_${u}`,         mode: 'value' },
    { name: 'macroSettings',       key: u => `macroSettings_${u}`,       mode: 'value' },
    { name: 'macroTargetsAdjustedDate', key: u => `macroTargetsAdjustedDate_${u}`, mode: 'value' },
    { name: 'macroDayContext',     key: u => `macroDayContext_${u}`,     mode: 'value' },
    { name: 'muscleWeeklyTargets', key: u => `muscleWeeklyTargets_${u}`, mode: 'value' },
    { name: 'aiGeneratedProgram',  key: u => `aiGeneratedProgram_${u}`,  mode: 'value' },
    { name: 'programBuilderDraft', key: u => `programBuilderV2Draft:${u}`, mode: 'value' },
    { name: 'plAttempts',          key: u => `plAttempts_${u}`,          mode: 'value' },
    { name: 'reminders',           key: u => `reminders_${u}`,           mode: 'value' },
    { name: 'appTourDone',         key: u => `app_tour_done_${u}`,       mode: 'value' },
    // Coaching / prep engine state: each is one object whose parts belong
    // together, so it syncs whole.
    { name: 'tl_checkins_v1',      key: u => `tl_checkins_v1_${u}`,      mode: 'list', idField: 'date' },
    { name: 'tl_daily_mission_v1', key: u => `tl_daily_mission_v1_${u}`, mode: 'value' },
    { name: 'tl_gamification_v2',  key: u => `tl_gamification_v2_${u}`,  mode: 'value' },
    { name: 'tl_posing_log_v1',    key: u => `tl_posing_log_v1_${u}`,    mode: 'value' },
    { name: 'tl_posing_target_v1', key: u => `tl_posing_target_v1_${u}`, mode: 'value' },
    { name: 'tl_phase_state_v1',   key: u => `tl_phase_state_v1_${u}`,   mode: 'value' },
    // Progress photos: which photos exist, and the current one per slot.
    // The images themselves go through /api/photos (progress-photos.js).
    { name: 'progressPhotos',     key: u => `progressPhotos_${u}`,       mode: 'list', idField: 'id' },
    { name: 'progressPhotoFront', key: u => `progressPhoto_${u}_front`,  mode: 'value' },
    { name: 'progressPhotoSide',  key: u => `progressPhoto_${u}_side`,   mode: 'value' },
    { name: 'progressPhotoBack',  key: u => `progressPhoto_${u}_back`,   mode: 'value' },
  ];

  // Keys the app reads and writes without an account name. While someone is
  // signed in, reads and writes of these go to a per-account key instead
  // (installScopedKeys), and the first account to sign in after this update
  // takes over the old shared value. The first five were scoped first and
  // use `${key}_${user}`; the rest use `${key}@${user}` so they can't
  // collide with newer per-account keys of the same name (programs_ vs
  // the legacy 'programs', for example).
  //
  // sync: how the per-account copy syncs (a STORES mode), or null for
  // per-device caches that only need scoping.
  const SCOPED = [
    ['dailyMacroMeals', '_', null], ['dailyMacroProgress', '_', null], ['dailyMacroDate', '_', null],
    ['macroResetTime', '_', null], ['macroDayType', '_', null], // synced via STORES above
    ['personalDetails', '@', 'value'],
    ['defaultWeightUnit', '@', 'value'],
    ['dailyReadiness_v1', '@', 'map'],
    ['dailySteps', '@', 'value'],
    ['waterTracker_v1', '@', 'value'],
    ['favMeals', '@', 'list', 'name'],
    ['macroInputs', '@', 'value'],
    ['programs', '@', 'list', 'id'],
    ['activeProgram', '@', 'value'],
    ['programTemplates', '@', 'value'],
    ['programAssignments', '@', 'value'],
    ['crossfitWorkouts', '@', 'list'],
    ['crossfitTemplates', '@', 'list'],
    ['plMeetDetails', '@', 'value'],
    ['plCutPlanInputs', '@', 'value'],
    ['athleteArchetype', '@', 'value'],
    ['trainingMode', '@', 'value'],
    ['trainingPreset', '@', 'value'],
    ['restPreset', '@', 'value'],
    ['autoIncrementEnabled', '@', 'value'],
    ['appMode', '@', 'value'],
    ['coachModeEnabled', '@', 'value'],
    ['coachNutritionAssignments_v1', '@', 'value'],
    ['coachCustomExercises_v1', '@', 'list', 'id'],
    ['challengeData_v1', '@', 'value'],
    ['milestoneBadges_v1', '@', 'value'],
    ['tl_performance_mode_v1', '@', 'value'],
    ['lifestyle_schedule', '@', 'list'],
    ['lifestyle_study', '@', 'list'],
    ['lifestyle_todo', '@', 'list'],
    ['lifestyle_habits', '@', 'list'],
    ['lifestyle_habitLog', '@', 'value'],
    ['lifestyle_goals', '@', 'list'],
    // Local copies of workout history (rebuilt from workouts): scoped so
    // one account never sees another's, not synced.
    ['workoutHistory', '@', null],
    ['tl_workout_history_v1', '@', null],
  ];
  const SCOPED_KEYS = new Map(SCOPED.map(([key, sep]) => [key, user => `${key}${sep}${user}`]));
  SCOPED.forEach(([key, sep, mode, idField]) => {
    if (!mode) return;
    // Store names can't hold '@' or start with a digit; strip to [A-Za-z0-9_].
    STORES.push({ name: `g_${key.replace(/[^A-Za-z0-9_]/g, '_')}`, key: u => `${key}${sep}${u}`, mode, idField });
  });


  /* ── Pure helpers (exported for tests) ───────────────────── */

  // FNV-1a, same as workout-sync.js.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + ':' + str.length;
  }

  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }

  function parseList(raw) {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }

  function parseMap(raw) {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Splits one store's raw localStorage string into items.
   * Returns null when the key is missing or unreadable (skip the store),
   * else Map(id -> { data, h }).
   */
  function splitStore(store, raw) {
    if (raw == null) return null;
    const items = new Map();
    if (store.mode === 'value') {
      items.set('value', { data: raw, h: hash(raw) });
      return items;
    }
    if (store.mode === 'map') {
      const obj = parseMap(raw);
      if (!obj) return null;
      Object.keys(obj).forEach(k => {
        if (obj[k] === undefined) return;
        items.set(`k:${k}`, { data: obj[k], h: hash(stableStringify(obj[k])) });
      });
      return items;
    }
    const list = parseList(raw);
    if (!list) return null;
    const seen = new Map(); // content hash -> count, for identical entries
    list.forEach(entry => {
      const json = stableStringify(entry);
      const h = hash(json);
      let id = null;
      const own = store.idField && entry && typeof entry === 'object' ? entry[store.idField] : null;
      if ((typeof own === 'string' && own) || typeof own === 'number') {
        id = `${store.idField}:${own}`;
        if (items.has(id)) id = null; // duplicate id: fall back to content
      }
      if (!id) {
        const n = (seen.get(h) || 0) + 1;
        seen.set(h, n);
        id = n === 1 ? `h:${h}` : `h:${h}#${n}`;
      }
      items.set(id, { data: entry, h });
    });
    return items;
  }

  function hashOf(store, data) {
    return store.mode === 'value' ? hash(String(data)) : hash(stableStringify(data));
  }

  function _dateOf(entry) {
    const d = entry && typeof entry === 'object' ? entry.date : null;
    return typeof d === 'string' ? d : null;
  }

  // Inserts an entry keeping the list's date order when it has one
  // (ascending or descending); otherwise appends.
  function insertByDate(list, entry) {
    const d = _dateOf(entry);
    const dates = list.map(_dateOf);
    if (!d || dates.some(x => x === null) || list.length < 2) { list.push(entry); return; }
    const asc = dates.every((x, i) => i === 0 || dates[i - 1] <= x);
    const desc = dates.every((x, i) => i === 0 || dates[i - 1] >= x);
    if (!asc && !desc) { list.push(entry); return; }
    let i = 0;
    if (asc) while (i < list.length && dates[i] <= d) i++;
    else while (i < list.length && dates[i] >= d) i++;
    list.splice(i, 0, entry);
  }

  /**
   * Applies remote items to one store's raw string.
   * changes: [{ id, data, deleted }]. Returns the new raw string, or
   * null for a 'value' store whose item was deleted (remove the key).
   */
  function applyToStore(store, raw, changes) {
    if (store.mode === 'value') {
      const last = changes[changes.length - 1];
      return last.deleted ? null : String(last.data);
    }
    if (store.mode === 'map') {
      const obj = parseMap(raw) || {};
      changes.forEach(({ id, data, deleted }) => {
        const k = id.slice(2);
        if (deleted) delete obj[k];
        else obj[k] = data;
      });
      return JSON.stringify(obj);
    }
    const list = parseList(raw) || [];
    const current = splitStore(store, JSON.stringify(list)) || new Map();
    const index = new Map([...current.keys()].map((id, i) => [id, i]));
    const removed = new Set();
    const additions = [];
    changes.forEach(({ id, data, deleted }) => {
      const i = index.get(id);
      if (deleted) {
        if (i !== undefined) removed.add(i);
        return;
      }
      if (i !== undefined && !removed.has(i)) list[i] = data;
      else additions.push(data);
    });
    const kept = list.filter((_, i) => !removed.has(i));
    additions.forEach(entry => insertByDate(kept, entry));
    return JSON.stringify(kept);
  }

  /**
   * What to push for one store: changed/new items, and deletions of items
   * we synced before that are gone now (unless that would wipe most of
   * the store at once).
   */
  function diffStore(store, local, shadow, now) {
    const out = [];
    const known = shadow || {};
    local.forEach(({ data, h }, id) => {
      if (!known[id] || known[id].h !== h) out.push({ store: store.name, id, data, h, updatedAt: now });
    });
    const gone = Object.keys(known).filter(id => !local.has(id));
    const total = Object.keys(known).length;
    const massDelete = gone.length >= MASS_DELETE_MIN && gone.length > total * MASS_DELETE_SHARE;
    if (massDelete) {
      console.warn(`[CloudSync] held back deleting ${gone.length} of ${total} ${store.name} entries`);
    } else {
      gone.forEach(id => out.push({ store: store.name, id, deleted: true, updatedAt: now }));
    }
    return { items: out, heldBack: massDelete };
  }

  // Splits push items into requests under the server's count/size limits.
  function chunkItems(items) {
    const chunks = [];
    let cur = [];
    let bytes = 0;
    items.forEach(item => {
      const size = JSON.stringify(item).length + 1;
      if (cur.length && (cur.length >= PUSH_MAX_ITEMS || bytes + size > PUSH_MAX_BYTES)) {
        chunks.push(cur);
        cur = [];
        bytes = 0;
      }
      cur.push(item);
      bytes += size;
    });
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  // Cursor sent to the server: a little behind the one we stored, so a
  // write that committed late (clock differences between servers) is
  // still picked up. Items already applied are skipped by updatedAt.
  function laggedCursor(cursor) {
    const m = /^(\d+)_([a-f0-9]{40})$/.exec(String(cursor || ''));
    if (!m) return null;
    const seq = Math.max(0, Number(m[1]) - PULL_OVERLAP_MS);
    return `${seq}_${ZERO_ID}`;
  }

  /* ── Engine ─────────────────────────────────────────────── */

  function createEngine({ storage, fetchFn, serverUrl, getUser, getToken, now = () => Date.now(), onApplied = () => {} }) {
    const byName = new Map(STORES.map(s => [s.name, s]));
    let running = null;
    let disabled = false;
    const status = { lastSyncedAt: null, lastError: null };

    function loadState(user) {
      try {
        const s = JSON.parse(storage.getItem(STATE_PREFIX + user));
        if (s && s.v === 1) return s;
      } catch { /* start over */ }
      return { v: 1, cursor: null, initialized: false, shadow: {} };
    }
    function saveState(user, state) {
      storage.setItem(STATE_PREFIX + user, JSON.stringify(state));
    }

    async function api(method, path, body) {
      const res = await fetchFn(`${serverUrl()}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        const code = data && data.error && data.error.code;
        // Switched off, or an account that can't sync: stop for this session.
        // 404: a backend without sync yet.
        if (res.status === 404 || code === 'sync.disabled' || code === 'sync.not_migrated' || code === 'sync.firebase_disabled') disabled = true;
        const err = new Error((data && data.error && data.error.message) || `Sync failed (${res.status})`);
        err.code = code;
        throw err;
      }
      return data;
    }

    // Applies remote items to local storage and the shadow.
    // skipDirty: leave items this device changed but hasn't pushed yet.
    function applyRemote(user, state, items, { skipDirty }) {
      const perStore = new Map();
      items.forEach(item => {
        const store = byName.get(item.store);
        if (!store) return;
        const known = (state.shadow[store.name] || {})[item.id];
        // Already have this version (the pull overlap re-reads recent items).
        if (known && (known.u > item.updatedAt ||
            (known.u === item.updatedAt && !item.deleted && known.h === hashOf(store, item.data)))) return;
        if (!perStore.has(store.name)) perStore.set(store.name, []);
        perStore.get(store.name).push(item);
      });
      const touched = [];
      perStore.forEach((list, name) => {
        const store = byName.get(name);
        const key = store.key(user);
        const raw = storage.getItem(key);
        const local = splitStore(store, raw) || new Map();
        const shadow = state.shadow[name] || (state.shadow[name] = {});
        const changes = [];
        list.forEach(item => {
          const mine = local.get(item.id);
          const dirty = mine && (!shadow[item.id] || shadow[item.id].h !== mine.h);
          const remoteH = item.deleted ? null : hashOf(store, item.data);
          if (skipDirty && dirty && remoteH !== mine.h) return;
          if (item.deleted) {
            delete shadow[item.id];
            if (mine) changes.push({ id: item.id, deleted: true });
            return;
          }
          shadow[item.id] = { h: remoteH, u: item.updatedAt };
          if (!mine || mine.h !== remoteH) changes.push({ id: item.id, data: item.data });
        });
        if (!changes.length) return;
        const next = applyToStore(store, raw, changes);
        if (next === null) storage.removeItem(key);
        else storage.setItem(key, next);
        touched.push(name);
      });
      return touched;
    }

    async function pullAll(user, state, opts) {
      const touched = new Set();
      let cursor = state.cursor;
      for (let page = 0; page < 500; page++) {
        const lag = laggedCursor(cursor);
        const res = await api('GET', `/api/sync/pull${lag ? `?cursor=${encodeURIComponent(lag)}` : ''}`);
        applyRemote(user, state, res.items || [], opts).forEach(n => touched.add(n));
        // Never move the stored cursor backwards (the lag re-reads a window).
        if (res.cursor && (!cursor || Number(res.cursor.split('_')[0]) >= Number(cursor.split('_')[0]))) cursor = res.cursor;
        if (!res.hasMore) break;
      }
      state.cursor = cursor;
      return touched;
    }

    async function pushAll(user, state) {
      const touched = new Set();
      const t = now();
      const pending = [];
      STORES.forEach(store => {
        const local = splitStore(store, storage.getItem(store.key(user)));
        if (!local) return;
        diffStore(store, local, state.shadow[store.name], t).items.forEach(i => pending.push(i));
      });
      const sendable = pending.filter(i => {
        if (i.deleted) return true;
        const ok = JSON.stringify(i.data).length <= ITEM_MAX_BYTES;
        if (!ok) console.warn(`[CloudSync] ${i.store} entry too large to sync; skipped`);
        return ok;
      });
      for (const chunk of chunkItems(sendable.map(({ h, ...rest }) => rest))) {
        const res = await api('POST', '/api/sync/push', { items: chunk });
        const rejected = new Set((res.rejected || []).map(r => `${r.store}\n${r.id}`));
        const newer = new Set((res.newer || []).map(r => `${r.store}\n${r.id}`));
        chunk.forEach(item => {
          const k = `${item.store}\n${item.id}`;
          if (rejected.has(k) || newer.has(k)) return;
          const shadow = state.shadow[item.store] || (state.shadow[item.store] = {});
          if (item.deleted) delete shadow[item.id];
          else shadow[item.id] = { h: hashOf(byName.get(item.store), item.data), u: item.updatedAt };
        });
        // The server had something newer: take it.
        applyRemote(user, state, res.newer || [], { skipDirty: false }).forEach(n => touched.add(n));
        saveState(user, state);
      }
      return touched;
    }

    async function syncOnce() {
      if (disabled || running) return running;
      const user = getUser();
      if (!user || !getToken() || !serverUrl()) return null;
      if (storage.getItem('cloudSyncDisabled') === '1') return null;
      running = (async () => {
        const state = loadState(user);
        const touched = new Set();
        try {
          if (!state.initialized) {
            // First sync on this device: take the server's copy first, so a
            // fresh install can't overwrite real data with its defaults.
            (await pullAll(user, state, { skipDirty: false })).forEach(n => touched.add(n));
            state.initialized = true;
            saveState(user, state);
            (await pushAll(user, state)).forEach(n => touched.add(n));
          } else {
            // A store we synced before whose data is gone from this device
            // (storage cleared by the system): forget what we knew about it
            // and read everything again, so it comes back from the server.
            STORES.forEach(store => {
              const known = state.shadow[store.name];
              if (known && Object.keys(known).length && storage.getItem(store.key(user)) === null) {
                delete state.shadow[store.name];
                state.cursor = null;
              }
            });
            (await pushAll(user, state)).forEach(n => touched.add(n));
            (await pullAll(user, state, { skipDirty: true })).forEach(n => touched.add(n));
          }
          saveState(user, state);
          status.lastSyncedAt = now();
          status.lastError = null;
        } catch (err) {
          saveState(user, state);
          status.lastError = err.message;
          if (!disabled) console.warn('[CloudSync] failed:', err.message);
        }
        if (touched.size) onApplied([...touched]);
        return [...touched];
      })();
      try {
        return await running;
      } finally {
        running = null;
      }
    }

    // Entries changed on this device that haven't reached the server yet.
    function pendingCount() {
      const user = getUser();
      if (!user) return 0;
      const state = loadState(user);
      let n = 0;
      STORES.forEach(store => {
        const local = splitStore(store, storage.getItem(store.key(user)));
        if (local) n += diffStore(store, local, state.shadow[store.name], 0).items.length;
      });
      return n;
    }

    return {
      syncOnce,
      isDisabled: () => disabled,
      status: () => ({ ...status, disabled, pending: pendingCount() }),
    };
  }

  // Per-account keys that aren't synced but still hold the account's data
  // or bookkeeping (removed on account deletion along with STORES/SCOPED).
  const OTHER_ACCOUNT_PREFIXES = [
    'workouts_', 'workoutHistory_', 'workoutSyncFp_', STATE_PREFIX, 'weightLog_', 'aiProfile_',
    'aiCoachSeen_', 'friends_', 'friendRequests_', 'friendRequestsSeen_', 'friendsMigrated_',
    'coachLinked_', 'coachSharedAt_', 'activitySync_', 'activitySyncSleep_', 'communityOutbox_',
    'tl_compliance_summary_v1_', 'managedTemplates_', 'nutritionTargets_',
  ];
  const OTHER_ACCOUNT_INFIXES = ['progressPhoto_', 'missionCelebrated_', 'aiPlateauCheck_', 'aiPlateauDismiss_'];

  /**
   * Keys in `keys` that belong to `user`: every synced and scoped key, the
   * known per-account prefixes, and `${prefix}${user}_...` patterns. Exact
   * matches only, so deleting "bob" never touches "a_bob"'s data.
   */
  function accountKeys(keys, user) {
    if (!user) return [];
    const exact = new Set([
      ...STORES.map(s => s.key(user)),
      ...[...SCOPED_KEYS.values()].map(fn => fn(user)),
      ...OTHER_ACCOUNT_PREFIXES.map(p => `${p}${user}`),
    ]);
    return keys.filter(k => exact.has(k) || OTHER_ACCOUNT_INFIXES.some(p => k.startsWith(`${p}${user}_`)));
  }

  /* ── Browser wiring ─────────────────────────────────────── */

  function installScopedKeys(storageProto, localStorageRef, currentUser) {
    const orig = {
      getItem: storageProto.getItem,
      setItem: storageProto.setItem,
      removeItem: storageProto.removeItem,
    };
    const scoped = (self, key) => {
      if (self !== localStorageRef() || !SCOPED_KEYS.has(key)) return key;
      const user = currentUser(orig.getItem.bind(self));
      if (!user) return key;
      const target = SCOPED_KEYS.get(key)(user);
      // One-time move of the old shared value to whoever signs in first.
      if (orig.getItem.call(self, target) === null) {
        const legacy = orig.getItem.call(self, key);
        if (legacy !== null) {
          orig.setItem.call(self, target, legacy);
          orig.removeItem.call(self, key);
        }
      }
      return target;
    };
    storageProto.getItem = function (key) { return orig.getItem.call(this, scoped(this, String(key))); };
    storageProto.setItem = function (key, value) { return orig.setItem.call(this, scoped(this, String(key)), value); };
    storageProto.removeItem = function (key) { return orig.removeItem.call(this, scoped(this, String(key))); };
    return orig;
  }

  // Refreshes whatever screens show synced data. Each call is optional.
  function refreshScreens(stores) {
    const call = name => {
      try { if (typeof window[name] === 'function') window[name](); } catch (err) { console.warn(`[CloudSync] ${name} failed:`, err.message); }
    };
    const has = (...names) => names.some(n => stores.includes(n));
    if (has('bodyweightLog')) { call('renderWeights'); call('renderBwMonthlyHistory'); }
    if (has('bodyMeasurements')) { call('renderMeasurementsHistory'); call('renderMeasurementsChart'); }
    if (has('cardioLog')) call('renderCardio');
    if (has('crossfitLog', 'crossfitWorkouts')) call('renderCrossfitWorkouts');
    if (has('hyroxLog')) call('renderHyroxHistory');
    if (has('macroHistory')) call('renderMacroHistory');
    if (has('macroTargets', 'dailyMacroMeals', 'dailyMacroProgress', 'dailyMacroDate', 'macroDayType')) {
      call('loadMacroTargetsFromLocal'); call('renderMacroSlots'); call('renderDailyMacroProgress'); call('updateMacroUI');
    }
    if (has('managedTemplates')) { call('renderTemplateLibraryList'); call('renderTemplateOptions'); }
    if (has('progressPhotoFront', 'progressPhotoSide', 'progressPhotoBack')) call('reloadProgressPhotos');
    call('renderBodyHub');
    window.dispatchEvent(new CustomEvent('cloudsync:applied', { detail: { stores } }));
  }

  if (typeof window !== 'undefined' && !window.__CLOUD_SYNC_NO_AUTO) {
    const currentUser = get => window.currentUser || get('fitnessAppUser');
    const orig = installScopedKeys(Storage.prototype, () => window.localStorage, currentUser);
    const rawGet = key => orig.getItem.call(window.localStorage, key);

    const engine = createEngine({
      storage: window.localStorage,
      fetchFn: (...args) => fetch(...args),
      serverUrl: () => window.SERVER_URL,
      getUser: () => currentUser(rawGet),
      getToken: () => rawGet('token'),
      onApplied: refreshScreens,
    });

    // Move any shared (pre-account) values to the signed-in account before
    // the first sync reads the account's keys.
    const primeScoped = () => { if (currentUser(rawGet)) SCOPED_KEYS.forEach((_, k) => window.localStorage.getItem(k)); };
    const sync = () => { primeScoped(); return engine.syncOnce(); };

    let pushTimer = null;
    const soon = () => {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(sync, PUSH_DEBOUNCE_MS);
    };
    // Sync shortly after any write to a synced store.
    const watched = key => {
      if (SCOPED_KEYS.has(key)) return true;
      const user = currentUser(rawGet);
      return !!user && STORES.some(s => s.key(user) === key);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      const r = setItem.call(this, key, value);
      if (this === window.localStorage && watched(String(key))) soon();
      return r;
    };

    // After account deletion: remove everything this device holds for the
    // account (the server copy is already gone).
    async function clearAccountData(user) {
      const all = [];
      for (let i = 0; i < window.localStorage.length; i++) all.push(window.localStorage.key(i));
      accountKeys(all, user).forEach(k => orig.removeItem.call(window.localStorage, k));
      if (window.ProgressPhotos) await window.ProgressPhotos.forgetLocal(user).catch(() => {});
    }

    window.cloudSync = { syncNow: sync, isDisabled: engine.isDisabled, status: engine.status, clearAccountData };
    setTimeout(sync, 4000);
    setInterval(() => { if (document.visibilityState !== 'hidden') sync(); }, INTERVAL_MS);
    // Push what was just logged when the app goes to the background, and
    // catch up when it comes back.
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      STORES, SCOPED_KEYS, accountKeys, hash, stableStringify, splitStore, applyToStore, diffStore,
      chunkItems, laggedCursor, insertByDate, createEngine, installScopedKeys,
    };
  }
})();
