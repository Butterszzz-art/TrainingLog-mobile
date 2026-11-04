#!/usr/bin/env node
// Builds the pocketcoachcoms.org website into _site/ for Firebase Hosting
// (firebase.json, .github/workflows/deploy-site.yml).
//
// The site is the same files GitHub Pages used to serve from the repo root,
// minus everything that isn't part of the website: native projects, build
// and server code, tests, docs and repo-only files. Unlike the iOS bundle
// (codemagic.yaml), the web-only pages stay in: /coach, /intake, /invite,
// pricing.html, payment-success.html and /.well-known.
//
//   node scripts/build-site.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.SITE_OUT ? path.resolve(process.env.SITE_OUT) : path.join(ROOT, '_site');

// Top-level names that never go online.
const SKIP_TOP = new Set([
  '_site', 'node_modules', '.git', '.github', '.claude', '.clone', 'www',
  'android', 'ios', 'native', 'plugins', 'scripts', 'tests', 'docs',
  'codemagic.yaml', 'capacitor.config.json', 'package.json', 'package-lock.json',
  'babel.config.json', 'firebase.json', '.firebaserc', '.gitignore', 'server.js',
]);
// Anywhere in the tree.
const SKIP_ANY = [
  /^\.env/,                 // env files
  /\.md$/i,                 // notes and docs
  /\.ts$/,                  // TypeScript sources (the .js copies are served)
  /^firebase-debug.*\.log$/,
];
// Paths (relative, forward slashes) that are server code.
const SKIP_PATHS = new Set(['src/routes']);
// Dotfiles that the site does need.
const KEEP_DOT = new Set(['.well-known', '.nojekyll']);

function skip(rel, name, isTop) {
  if (isTop && SKIP_TOP.has(name)) return true;
  if (SKIP_PATHS.has(rel)) return true;
  if (name.startsWith('.') && !KEEP_DOT.has(name)) return true;
  return SKIP_ANY.some(re => re.test(name));
}

function copyDir(fromRel) {
  const from = path.join(ROOT, fromRel);
  let files = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const rel = fromRel ? fromRel + '/' + entry.name : entry.name;
    if (skip(rel, entry.name, !fromRel)) continue;
    if (entry.isDirectory()) {
      files += copyDir(rel);
    } else if (entry.isFile()) {
      const dest = path.join(OUT, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), dest);
      files += 1;
    }
  }
  return files;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
const count = copyDir('');
for (const must of ['index.html', 'sw.js', 'coach/index.html', 'invite/index.html', '.well-known/apple-app-site-association']) {
  if (!fs.existsSync(path.join(OUT, must))) {
    console.error('build-site: missing ' + must);
    process.exit(1);
  }
}
console.log('build-site: ' + count + ' files → _site/');
