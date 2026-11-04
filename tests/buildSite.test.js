// The website build (scripts/build-site.js): web pages in, everything
// private or repo-only out.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-site-'));
const has = rel => fs.existsSync(path.join(out, rel));

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-site.js'], { env: { ...process.env, SITE_OUT: out } });
});
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

test('ships the app and every web-only page', () => {
  for (const rel of ['index.html', 'sw.js', 'manifest.json', 'config.js', 'coach/index.html', 'intake/index.html',
    'invite/index.html', 'pricing.html', 'payment-success.html', 'privacy.html', 'terms.html',
    'delete-account.html', '.well-known/apple-app-site-association', 'googleb5d7a5969f2ff1db.html']) {
    expect([rel, has(rel)]).toEqual([rel, true]);
  }
});

test('leaves out secrets, server code and repo-only files', () => {
  for (const rel of ['.env.production', '.env.development', '.git', '.github', 'package.json', 'codemagic.yaml',
    'capacitor.config.json', 'src/routes', 'tests', 'scripts', 'docs', 'android', 'native', 'plugins',
    'README.md', 'firebase.json', 'resistanceLogs.ts']) {
    expect([rel, has(rel)]).toEqual([rel, false]);
  }
});

test('every page the service worker caches is in the build', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  const listed = [...sw.matchAll(/'(\/[^'*]+\.(?:html|js|css|json|png|svg|ico))'/g)].map(m => m[1].slice(1));
  expect(listed.length).toBeGreaterThan(10);
  expect(listed.filter(rel => !has(rel))).toEqual([]);
});
