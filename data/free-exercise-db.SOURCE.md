# free-exercise-db.min.json

Source: https://github.com/yuhonas/free-exercise-db (dist/exercises.json)
License: Unlicense (public domain) — see the source repo's LICENSE file.
Pulled: 2026-08-31

This is a trimmed copy of the upstream dataset — only `name`, `category`,
`primaryMuscles`, `secondaryMuscles`, and `equipment` are kept (instructions
and image paths are dropped; we don't display them).

Used by [scripts/sync-exercise-muscle-map.js](../scripts/sync-exercise-muscle-map.js)
to generate the `generatedExerciseMuscleMap` block in
[exerciseMuscleMap.js](../exerciseMuscleMap.js). To refresh: re-download
`dist/exercises.json` from upstream, trim it to the fields above, overwrite
this file, then re-run the sync script.
