const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/js/profiles.js'), 'utf8');
const PHOTO = 'data:image/jpeg;base64,/9j/AAAA';

// Loads profiles.js into a fresh page with a fake /api/profiles/lookup.
function setup(profiles, { user = 'me_user', stored = null } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  w.localStorage.setItem('token', 'tok');
  w.localStorage.setItem('fitnessAppUser', user);
  if (stored) w.localStorage.setItem('pcProfiles_v1', JSON.stringify(stored));
  w.SERVER_URL = 'https://api.test';
  const calls = [];
  w.fetch = async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method, body, headers: opts.headers });
    const out = {};
    (body?.usernames || []).forEach(k => {
      const p = profiles[k];
      if (!p) { out[k] = { username: k, hidden: true }; return; }
      out[k] = { ...p };
      if (p.avatar && body.have?.[k] === p.avatarVersion) delete out[k].avatar;
    });
    return { ok: true, status: 200, json: async () => ({ success: true, profiles: out }) };
  };
  w.eval(SRC);
  return { w, doc: w.document, calls };
}

const tick = (ms = 120) => new Promise(r => setTimeout(r, ms));

describe('Profiles helpers', () => {
  const { w } = setup({});
  test('profileKey normalises valid usernames and rejects the rest', () => {
    expect(w.Profiles.profileKey('Alice_1')).toBe('alice_1');
    expect(w.Profiles.profileKey('Jane Doe')).toBeNull();
    expect(w.Profiles.profileKey('..')).toBeNull();
    expect(w.Profiles.profileKey('')).toBeNull();
  });
  test('initialsFor', () => {
    expect(w.Profiles.initialsFor('alice')).toBe('A');
    expect(w.Profiles.initialsFor('Alice Walker', 2)).toBe('AW');
    expect(w.Profiles.initialsFor('', 2)).toBe('?');
  });
});

describe('avatar filling', () => {
  test('swaps initials for the photo after one batched lookup', async () => {
    const { doc, calls } = setup({
      alice: { username: 'Alice', displayName: 'Alice W', bio: '', avatarVersion: 'v1', avatar: PHOTO },
    });
    doc.body.innerHTML = '<div class="a" data-avatar-user="Alice">A</div><div class="b" data-avatar-user="bob">B</div><div class="c" data-avatar-user="Not A Username">N</div>';
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/api/profiles/lookup');
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    expect(calls[0].body.usernames.sort()).toEqual(['alice', 'bob']);

    const a = doc.querySelector('.a');
    expect(a.classList.contains('has-photo')).toBe(true);
    expect(a.querySelector('img.pc-avatar-img').getAttribute('src')).toBe(PHOTO);
    expect(doc.querySelector('.b').textContent).toBe('B'); // hidden / no profile keeps initials
    expect(doc.querySelector('.c').textContent).toBe('N');
  });

  test('re-renders use the cache, and stale refreshes send the cached version', async () => {
    const { w, doc, calls } = setup({
      alice: { username: 'alice', displayName: '', bio: '', avatarVersion: 'v1', avatar: PHOTO },
    });
    doc.body.innerHTML = '<div class="a" data-avatar-user="alice">A</div>';
    await tick();
    doc.body.innerHTML = '<div class="a2" data-avatar-user="alice">A</div>';
    await tick();
    expect(calls).toHaveLength(1);
    expect(doc.querySelector('.a2 img')).not.toBeNull(); // painted straight from cache

    // Next app launch, cache entry now older than the refresh window.
    const stored = JSON.parse(w.localStorage.getItem('pcProfiles_v1'));
    expect(stored.alice.avatarVersion).toBe('v1');
    stored.alice.at = 0;
    const next = setup({ alice: { username: 'alice', displayName: '', bio: '', avatarVersion: 'v1', avatar: PHOTO } }, { stored });
    next.doc.body.innerHTML = '<div class="a3" data-avatar-user="alice">A</div>';
    await tick(0); // observer callback, before the batched lookup fires
    expect(next.doc.querySelector('.a3 img')).not.toBeNull(); // stale photo shown right away
    await tick();
    expect(next.calls).toHaveLength(1);
    expect(next.calls[0].body.have).toEqual({ alice: 'v1' });
    expect(next.doc.querySelector('.a3 img').getAttribute('src')).toBe(PHOTO); // kept cached photo
  });

  test('a photo that goes away restores the original initials', async () => {
    const { w, doc } = setup({
      alice: { username: 'alice', displayName: '', bio: '', avatarVersion: 'v1', avatar: PHOTO },
    });
    doc.body.innerHTML = '<div class="a" data-avatar-user="alice">AL</div>';
    await tick();
    expect(doc.querySelector('.a img')).not.toBeNull();
    w.Profiles.openProfileCard('alice');
    await tick();
    const hide = [...doc.querySelectorAll('#pcProfileSheet button')].find(b => b.textContent === 'Hide their photo');
    hide.click();
    await tick();
    expect(doc.querySelector('.a img')).toBeNull();
    expect(doc.querySelector('.a').textContent).toBe('AL');
    expect(doc.querySelector('.a').classList.contains('has-photo')).toBe(false);
  });

  test('lookup failures leave initials alone', async () => {
    const { w, doc } = setup({});
    w.fetch = async () => { throw new Error('offline'); };
    doc.body.innerHTML = '<div class="a" data-avatar-user="alice">A</div>';
    await tick();
    expect(doc.querySelector('.a').textContent).toBe('A');
  });
});

describe('profile card', () => {
  test('tapping a data-avatar-open avatar shows name + bio as text, with report', async () => {
    const { doc } = setup({
      alice: { username: 'Alice', displayName: 'Alice <b>W</b>', bio: '<img src=x onerror=alert(1)>', avatarVersion: null },
    });
    doc.body.innerHTML = '<div class="row"><div class="a" data-avatar-user="alice" data-avatar-open>A</div></div>';
    let rowClicked = false;
    doc.querySelector('.row').addEventListener('click', () => { rowClicked = true; });
    await tick();
    doc.querySelector('.a').click();
    await tick();

    const sheet = doc.getElementById('pcProfileSheet');
    expect(sheet).not.toBeNull();
    expect(rowClicked).toBe(false);
    expect(sheet.querySelector('.pc-profile-display').textContent).toBe('Alice <b>W</b>');
    expect(sheet.querySelector('.pc-profile-handle').textContent).toBe('@Alice');
    expect(sheet.querySelector('.pc-profile-bio').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(sheet.querySelector('img[onerror]')).toBeNull();
    expect([...sheet.querySelectorAll('button')].some(b => b.textContent === 'Report profile')).toBe(true);
  });

  test('private profiles show no bio or report actions', async () => {
    const { w, doc } = setup({});
    w.Profiles.openProfileCard('bob');
    await tick();
    const sheet = doc.getElementById('pcProfileSheet');
    expect(sheet.querySelector('.pc-profile-private').textContent).toMatch(/private/);
    expect(sheet.querySelector('.pc-profile-bio')).toBeNull();
  });

  test('report sends the chosen reason', async () => {
    const { w, doc, calls } = setup({
      alice: { username: 'alice', displayName: '', bio: 'hi', avatarVersion: null },
    });
    w.Profiles.openProfileCard('alice');
    await tick();
    [...doc.querySelectorAll('#pcProfileSheet button')].find(b => b.textContent === 'Report profile').click();
    const radio = doc.querySelector('#pcProfileSheet input[value="spam"]');
    radio.checked = true;
    radio.dispatchEvent(new w.Event('change'));
    [...doc.querySelectorAll('#pcProfileSheet button')].find(b => b.textContent === 'Send report').click();
    await tick();
    const report = calls.find(c => c.url.endsWith('/api/profiles/alice/report'));
    expect(report.method).toBe('POST');
    expect(report.body).toEqual({ reason: 'spam', note: '' });
  });
});
