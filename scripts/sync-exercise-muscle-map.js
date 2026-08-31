#!/usr/bin/env node
/**
 * Regenerates the AUTO-GENERATED block inside exerciseMuscleMap.js from
 * data/free-exercise-db.min.json (see data/free-exercise-db.SOURCE.md).
 *
 * Why this exists: the hand-curated `exerciseMuscleMap` only covers ~200
 * exercise names, so anything logged outside that list (custom names,
 * different phrasing) fell back to 'other' and dropped out of the total
 * volume / muscle-group breakdown. This script folds in the ~800+ exercise
 * names from free-exercise-db as a second, lower-priority table so far more
 * logged exercises resolve to a real muscle group. Hand-curated entries in
 * `exerciseMuscleMap` always win on conflicts — this script skips any name
 * already present there (case-insensitively).
 *
 * Run: node scripts/sync-exercise-muscle-map.js
 */
const fs = require('fs');
const path = require('path');

const TARGET_FILE = path.join(__dirname, '..', 'exerciseMuscleMap.js');
const DATA_FILE = path.join(__dirname, '..', 'data', 'free-exercise-db.min.json');
const START_MARKER = '// === AUTO-GENERATED: BEGIN (scripts/sync-exercise-muscle-map.js) ===';
const END_MARKER = '// === AUTO-GENERATED: END ===';

// free-exercise-db's primaryMuscles vocabulary -> this app's fine muscle-group
// taxonomy (the same one exerciseMuscleMap.js's hand-curated entries use).
// `null` means "skip" — no bucket in this app's taxonomy fits well.
const PRIMARY_MUSCLE_TO_GROUP = {
  abdominals: 'abs',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'back',
  'lower back': 'back',
  'middle back': 'back',
  neck: null,
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps'
};

function loadHandCuratedNames() {
  const src = fs.readFileSync(TARGET_FILE, 'utf8');
  // Pull names out of the hand-curated `exerciseMuscleMap` object literal by
  // requiring the file itself (safe — it's our own source-controlled file).
  const { exerciseMuscleMap } = require(TARGET_FILE);
  return new Set(Object.keys(exerciseMuscleMap).map((k) => k.toLowerCase()));
}

function buildGeneratedMap() {
  const dataset = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const curated = loadHandCuratedNames();
  const seen = new Set();
  const entries = [];
  const unmapped = new Set();

  dataset.forEach((ex) => {
    const name = (ex.name || '').trim();
    if (!name) return;
    const lower = name.toLowerCase();
    if (curated.has(lower) || seen.has(lower)) return;

    const primary = (ex.primaryMuscles || [])[0];
    if (!primary) return;
    if (!(primary in PRIMARY_MUSCLE_TO_GROUP)) {
      unmapped.add(primary);
      return;
    }
    const group = PRIMARY_MUSCLE_TO_GROUP[primary];
    if (!group) return; // explicitly skipped (e.g. neck)

    seen.add(lower);
    entries.push([name, group]);
  });

  if (unmapped.size) {
    console.warn('Unmapped primaryMuscles values (add to PRIMARY_MUSCLE_TO_GROUP):', [...unmapped]);
  }

  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries;
}

function renderBlock(entries) {
  const lines = entries.map(([name, group]) => `  ${JSON.stringify(name)}: ${JSON.stringify(group)},`);
  return [
    START_MARKER,
    '// Generated from data/free-exercise-db.min.json — DO NOT EDIT BY HAND.',
    '// Re-run `node scripts/sync-exercise-muscle-map.js` to refresh.',
    '// Hand-curated names above always take priority over this block.',
    'const generatedExerciseMuscleMap = {',
    ...lines,
    '};',
    END_MARKER
  ].join('\n');
}

function main() {
  const entries = buildGeneratedMap();
  const block = renderBlock(entries);

  const src = fs.readFileSync(TARGET_FILE, 'utf8');
  const startIdx = src.indexOf(START_MARKER);
  const endIdx = src.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Could not find AUTO-GENERATED markers in ${TARGET_FILE}. Expected both:\n  ${START_MARKER}\n  ${END_MARKER}`
    );
  }
  const before = src.slice(0, startIdx);
  const after = src.slice(endIdx + END_MARKER.length);
  fs.writeFileSync(TARGET_FILE, before + block + after);

  console.log(`Wrote ${entries.length} generated exercise -> muscle-group entries into ${path.basename(TARGET_FILE)}.`);
}

main();
