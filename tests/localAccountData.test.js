const { clearLocalStorage, clearLocalAccountData } = require('../src/js/local-account-data');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    get length() { return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i] ?? null,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    clear: () => { Object.keys(data).forEach((k) => delete data[k]); },
    keys: () => Object.keys(data).sort(),
  };
}

describe('clearLocalStorage', () => {
  test("removes the account's own keys and the unscoped ones, keeps another account's", () => {
    const storage = memoryStorage({
      tl_checkins_v1_ana: '[]',
      tl_phase_state_v1_ana: '{}',
      bodyweightLog_Ana: '[]',
      'programBuilderV2Draft:ana': '{}',
      personalDetails: '{}',
      token: 'x',
      tl_checkins_v1_bob: '[]',
      bodyweightLog_bob: '[]',
      theme: 'dark',
    });

    clearLocalStorage(storage, 'ana');

    expect(storage.keys()).toEqual(['bodyweightLog_bob', 'theme', 'tl_checkins_v1_bob']);
  });

  test('a username that is a suffix of another does not match it', () => {
    const storage = memoryStorage({ tl_checkins_v1_bob: '[]', tl_checkins_v1_ob: '[]' });
    clearLocalStorage(storage, 'ob');
    expect(storage.keys()).toEqual(['tl_checkins_v1_bob']);
  });
});

describe('clearLocalAccountData', () => {
  afterEach(() => {
    delete global.localStorage;
    delete global.sessionStorage;
    delete global.posingMediaStore;
  });

  test("also deletes the user's progress photos", async () => {
    global.localStorage = memoryStorage({ bodyweightLog_ana: '[]' });
    global.sessionStorage = memoryStorage({ tmp: '1' });
    const deleteUserPhotos = jest.fn().mockResolvedValue(3);
    global.posingMediaStore = { isAvailable: () => true, deleteUserPhotos };

    const result = await clearLocalAccountData('ana');

    expect(deleteUserPhotos).toHaveBeenCalledWith('ana');
    expect(result.removedPhotos).toBe(3);
    expect(global.localStorage.keys()).toEqual([]);
    expect(global.sessionStorage.keys()).toEqual([]);
  });
});
