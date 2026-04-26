#!/usr/bin/env node
/**
 * generate-icons.js
 * Resizes public/icons/icon-source.png into every size needed for
 * iOS, Android, PWA manifest, and the App Store submission.
 *
 * Usage:
 *   1. Save your 1024×1024 (or larger) app icon as:
 *        public/icons/icon-source.png
 *   2. Install sharp:
 *        npm install sharp --save-dev
 *   3. Run:
 *        node scripts/generate-icons.js
 */

const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');

const SRC  = path.join(__dirname, '..', 'public', 'icons', 'icon-source.png');
const DEST = path.join(__dirname, '..', 'public', 'icons');

// Sizes needed
const SIZES = [
  // PWA manifest
  { size: 72,   name: 'icon-72.png' },
  { size: 96,   name: 'icon-96.png' },
  { size: 128,  name: 'icon-128.png' },
  { size: 144,  name: 'icon-144.png' },
  { size: 152,  name: 'icon-152.png' },
  { size: 180,  name: 'icon-180.png' },   // apple-touch-icon
  { size: 192,  name: 'icon-192.png' },
  { size: 512,  name: 'icon-512.png' },
  { size: 512,  name: 'icon-512-maskable.png' },
  { size: 1024, name: 'icon-1024.png' },  // App Store

  // Favicon sizes
  { size: 16,   name: 'favicon-16.png' },
  { size: 32,   name: 'favicon-32.png' },

  // iOS-specific (Xcode asset catalog)
  { size: 20,   name: 'ios/AppIcon-20@1x.png' },
  { size: 40,   name: 'ios/AppIcon-20@2x.png' },
  { size: 60,   name: 'ios/AppIcon-20@3x.png' },
  { size: 29,   name: 'ios/AppIcon-29@1x.png' },
  { size: 58,   name: 'ios/AppIcon-29@2x.png' },
  { size: 87,   name: 'ios/AppIcon-29@3x.png' },
  { size: 40,   name: 'ios/AppIcon-40@1x.png' },
  { size: 80,   name: 'ios/AppIcon-40@2x.png' },
  { size: 120,  name: 'ios/AppIcon-40@3x.png' },
  { size: 120,  name: 'ios/AppIcon-60@2x.png' },
  { size: 180,  name: 'ios/AppIcon-60@3x.png' },
  { size: 76,   name: 'ios/AppIcon-76@1x.png' },
  { size: 152,  name: 'ios/AppIcon-76@2x.png' },
  { size: 167,  name: 'ios/AppIcon-83.5@2x.png' },
  { size: 1024, name: 'ios/AppIcon-1024.png' },   // App Store submission

  // Android-specific (Capacitor default locations)
  { size: 36,   name: 'android/mipmap-ldpi/ic_launcher.png' },
  { size: 48,   name: 'android/mipmap-mdpi/ic_launcher.png' },
  { size: 72,   name: 'android/mipmap-hdpi/ic_launcher.png' },
  { size: 96,   name: 'android/mipmap-xhdpi/ic_launcher.png' },
  { size: 144,  name: 'android/mipmap-xxhdpi/ic_launcher.png' },
  { size: 192,  name: 'android/mipmap-xxxhdpi/ic_launcher.png' },
];

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`\n❌  Source icon not found: ${SRC}`);
    console.error('    Save your 1024×1024 PNG as public/icons/icon-source.png and re-run.\n');
    process.exit(1);
  }

  // Ensure all sub-directories exist
  const dirs = new Set(SIZES.map(s => path.join(DEST, path.dirname(s.name))));
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

  let ok = 0;
  for (const { size, name } of SIZES) {
    const out = path.join(DEST, name);
    try {
      await sharp(SRC).resize(size, size).png().toFile(out);
      console.log(`✅  ${size}×${size}  →  public/icons/${name}`);
      ok++;
    } catch (err) {
      console.error(`❌  Failed ${name}: ${err.message}`);
    }
  }

  console.log(`\n✨  Done — ${ok}/${SIZES.length} icons generated in public/icons/\n`);
  console.log('Next steps:');
  console.log('  npx cap sync          (copy web assets into ios/ and android/)');
  console.log('  npx cap open ios      (open Xcode)');
  console.log('  npx cap open android  (open Android Studio)\n');
}

main();
