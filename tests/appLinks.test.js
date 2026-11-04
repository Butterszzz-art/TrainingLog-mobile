// Invite links and the Apple Universal Links file (src/js/app-links.js,
// .well-known/apple-app-site-association).
const fs = require('fs');
const { parseLink, inviteUrl, cleanCode, readPending, REF_KEY } = require('../src/js/app-links.js');

describe('parseLink', () => {
  test('reads the code from every link form', () => {
    expect(parseLink('https://pocketcoachcoms.org/invite/?ref=ABC123')).toEqual({ ref: 'ABC123', signup: true });
    expect(parseLink('https://pocketcoachcoms.org/#signup?ref=ABC123')).toEqual({ ref: 'ABC123', signup: true });
    expect(parseLink('https://pocketcoachcoms.org/?ref=abc_1-2')).toEqual({ ref: 'abc_1-2', signup: true });
  });

  test('plain app and site URLs are not invites', () => {
    expect(parseLink('capacitor://localhost/index.html')).toEqual({ ref: '', signup: false });
    expect(parseLink('https://pocketcoachcoms.org/#home')).toEqual({ ref: '', signup: false });
    expect(parseLink('')).toEqual({ ref: '', signup: false });
  });

  test('an invite without a code still opens sign-up', () => {
    expect(parseLink('https://pocketcoachcoms.org/invite/')).toEqual({ ref: '', signup: true });
    expect(parseLink('https://pocketcoachcoms.org/#signup')).toEqual({ ref: '', signup: true });
  });

  test('rejects codes that are not plain tokens', () => {
    expect(parseLink('https://pocketcoachcoms.org/invite/?ref=<script>').ref).toBe('');
    expect(cleanCode('a'.repeat(41))).toBe('');
    expect(cleanCode(' X9 ')).toBe('X9');
  });
});

test('inviteUrl builds the shareable link', () => {
  expect(inviteUrl('ABC123')).toBe('https://pocketcoachcoms.org/invite/?ref=ABC123');
  expect(inviteUrl('bad code')).toBe('https://pocketcoachcoms.org/');
});

test('a saved code expires after 30 days', () => {
  const data = {};
  const store = { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: k => { delete data[k]; } };
  const now = Date.UTC(2026, 10, 4);
  store.setItem(REF_KEY, JSON.stringify({ code: 'ABC', at: now - 1000 }));
  expect(readPending(store, now)).toBe('ABC');
  store.setItem(REF_KEY, JSON.stringify({ code: 'ABC', at: now - 31 * 864e5 }));
  expect(readPending(store, now)).toBe('');
  expect(data[REF_KEY]).toBeUndefined();
});

describe('apple-app-site-association', () => {
  const aasa = JSON.parse(fs.readFileSync('.well-known/apple-app-site-association', 'utf8'));
  const detail = aasa.applinks.details[0];

  test('points at the Pocket Coach app', () => {
    expect(detail.appIDs).toEqual(['WD37WHSYG7.org.pocketcoachcoms.app']);
  });

  test('web-only pages are excluded and come before the app paths', () => {
    const paths = detail.components.map(c => c['/']);
    for (const p of ['/coach/*', '/intake/*', '/pricing.html', '/payment-success.html']) {
      const c = detail.components.find(x => x['/'] === p);
      expect(c && c.exclude).toBe(true);
      expect(paths.indexOf(p)).toBeLessThan(paths.indexOf('/invite/*'));
    }
  });

  test('the invite page exists for browsers without the app', () => {
    expect(fs.existsSync('invite/index.html')).toBe(true);
  });
});
