const { photoId, dataUrlBytes, isStale, PHOTO_MAX_BYTES } = require('../src/js/meal-photos');
const { clearLocalAccountData } = require('../src/js/local-account-data');

describe('meal photo ids', () => {
  test('one photo per user, day and meal; the username is case-insensitive', () => {
    expect(photoId('Ana', '2026-10-29', 'lunch')).toBe('ana|2026-10-29|lunch');
    expect(photoId(' ana ', '2026-10-29', 'lunch')).toBe(photoId('ANA', '2026-10-29', 'lunch'));
  });

  test('no id without a user, a valid date or a meal', () => {
    expect(photoId('', '2026-10-29', 'lunch')).toBeNull();
    expect(photoId('ana', '29/10/2026', 'lunch')).toBeNull();
    expect(photoId('ana', '2026-10-29', '')).toBeNull();
  });
});

describe('dataUrlBytes', () => {
  test('decoded size of a base64 data URL', () => {
    const b64 = Buffer.from('hello world').toString('base64'); // 11 bytes, one "="
    expect(dataUrlBytes(`data:image/jpeg;base64,${b64}`)).toBe(11);
    expect(dataUrlBytes(`data:image/jpeg;base64,${Buffer.from('abcd').toString('base64')}`)).toBe(4);
  });

  test('anything that is not a data URL counts as empty', () => {
    expect(dataUrlBytes('')).toBe(0);
    expect(dataUrlBytes(null)).toBe(0);
  });

  test('the size limit stays under the server upload limit (150 KB)', () => {
    expect(PHOTO_MAX_BYTES).toBeLessThanOrEqual(150 * 1024);
  });
});

describe('isStale (pruning old photos with the food log)', () => {
  test('photos older than the kept days are stale', () => {
    expect(isStale('2026-07-30', '2026-10-29', 90)).toBe(true);
    expect(isStale('2026-07-31', '2026-10-29', 90)).toBe(false);
    expect(isStale('2026-10-29', '2026-10-29')).toBe(false);
  });

  test('an unreadable "today" never deletes anything', () => {
    expect(isStale('2020-01-01', 'not-a-date')).toBe(false);
  });
});

describe('deleting the account', () => {
  afterEach(() => { delete global.mealPhotos; });

  test('also removes meal photos from the device', async () => {
    const deleteUserPhotos = jest.fn().mockResolvedValue(2);
    global.mealPhotos = { isAvailable: () => true, deleteUserPhotos };
    const result = await clearLocalAccountData('ana');
    expect(deleteUserPhotos).toHaveBeenCalledWith('ana');
    expect(result.removedPhotos).toBe(2);
  });
});
