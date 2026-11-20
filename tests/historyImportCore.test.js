const H = require('../src/js/history-import-core.js');

const STRONG = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2025-01-06 18:02:11,"Push, heavy",1h 2m,Bench Press (Barbell),W,40,10,0,0,,,',
  '2025-01-06 18:02:11,"Push, heavy",1h 2m,Bench Press (Barbell),1,100,5,0,0,,,8',
  '2025-01-06 18:02:11,"Push, heavy",1h 2m,Bench Press (Barbell),2,100,5,0,0,,,8.5',
  '2025-01-06 18:02:11,"Push, heavy",1h 2m,Treadmill,1,0,0,2,900,,,',
  '2025-01-09 17:30:00,Pull,55m,Pull Up,1,0,10,0,0,,,',
].join('\n');

const STRONG_SEMI = [
  'Workout #;Date;Workout Name;Duration (sec);Exercise Name;Set Order;Weight (lbs);Reps;RPE;Distance (meters);Seconds;Notes;Workout Notes',
  '1;2025-02-01 09:00:00;Legs;3600;Squat (Barbell);1;225;5;;0;0;;',
  '1;2025-02-01 09:00:00;Legs;3600;Squat (Barbell);D;135;12;;0;0;;',
].join('\n');

const HEVY = [
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"',
  '"Upper A","15 Jan 2025, 08:30","15 Jan 2025, 09:30","","Overhead Press (Barbell)","","","0","warmup","30","8","","",""',
  '"Upper A","15 Jan 2025, 08:30","15 Jan 2025, 09:30","","Overhead Press (Barbell)","","","1","normal","50","6","","","9"',
  '"Upper A","15 Jan 2025, 08:30","15 Jan 2025, 09:30","","Lat Pulldown (Cable)","","","0","normal","60","10","","",""',
].join('\n');

const FITBOD = [
  'Date,Exercise,Reps,Weight(kg),Duration(s),Distance(m),Incline,Resistance,isWarmup,Note,multiplier',
  '2025-03-03 07:10:00 +0000,Deadlift,5,140,0,0,0,0,false,,1',
  '2025-03-03 07:10:00 +0000,Deadlift,3,100,0,0,0,0,true,,1',
].join('\n');

describe('parseCsv', () => {
  test('handles quotes, escaped quotes and CRLF', () => {
    const rows = H.parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });
  test('detects semicolons and tabs', () => {
    expect(H.detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(H.detectDelimiter('a\tb\n1\t2')).toBe('\t');
  });
});

describe('parseDate', () => {
  test.each([
    ['2025-01-06 18:02:11', '2025-01-06'],
    ['15 Jan 2025, 08:30', '2025-01-15'],
    ['Jan 5, 2025', '2025-01-05'],
    ['2025/3/4', '2025-03-04'],
    ['yesterday', null],
  ])('%s', (input, out) => expect(H.parseDate(input)).toBe(out));
});

describe('parseExport', () => {
  test('Strong: groups sets into sessions, tags warm-ups, skips cardio', () => {
    const r = H.parseExport(STRONG, { unit: 'kg' });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('strong');
    expect(r.workouts).toHaveLength(2);
    const [push, pull] = r.workouts;
    expect(push.title).toBe('Push, heavy');
    expect(push.date).toBe('2025-01-06');
    expect(push.id).toMatch(/^imp_[0-9a-f]{16}$/);
    expect(push.imported).toBe(true);
    expect(push.log).toHaveLength(1);
    const bench = push.log[0];
    expect(bench.exercise).toBe('Bench Press (Barbell)');
    expect(bench.repsArray).toEqual([10, 5, 5]);
    expect(bench.weightsArray).toEqual([40, 100, 100]);
    expect(bench.setTypeArray).toEqual(['warmup', 'standard', 'standard']);
    expect(bench.rpeArray).toEqual([null, 8, 8.5]);
    expect(bench.sets).toBe(3);
    expect(pull.log[0].weightsArray).toEqual([0]);
    expect(r.skippedRows).toBe(1);
    expect(r.sets).toBe(4);
    expect(r.firstDate).toBe('2025-01-06');
    expect(r.lastDate).toBe('2025-01-09');
  });

  test('Strong semicolon export in lbs converts to kg and tags drop sets', () => {
    const r = H.parseExport(STRONG_SEMI, { unit: 'kg' });
    expect(r.ok).toBe(true);
    const squat = r.workouts[0].log[0];
    expect(squat.unit).toBe('kg');
    expect(squat.weightsArray).toEqual([102.1, 61.2]);
    expect(squat.setTypeArray).toEqual(['standard', 'dropset']);
    expect(squat.dropsetArray).toEqual([false, true]);
  });

  test('Hevy export', () => {
    const r = H.parseExport(HEVY, { unit: 'lbs' });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('hevy');
    expect(r.workouts).toHaveLength(1);
    const w = r.workouts[0];
    expect(w.title).toBe('Upper A');
    expect(w.date).toBe('2025-01-15');
    expect(w.log.map(e => e.exercise)).toEqual(['Overhead Press (Barbell)', 'Lat Pulldown (Cable)']);
    expect(w.log[0].setTypeArray).toEqual(['warmup', 'standard']);
    expect(w.log[0].weightsArray).toEqual([66.1, 110.2]);
    expect(w.log[0].unit).toBe('lbs');
  });

  test('Fitbod export', () => {
    const r = H.parseExport(FITBOD, { unit: 'kg' });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('fitbod');
    expect(r.workouts[0].log[0].setTypeArray).toEqual(['standard', 'warmup']);
    expect(r.workouts[0].title).toBe('Workout on 2025-03-03');
  });

  test('generic spreadsheet with a unit column', () => {
    const csv = 'Date,Exercise,Sets,Reps,Weight,Unit\n2025-04-01,Squat,1,5,100,kg\n2025-04-01,Squat,1,5,225,lb\n';
    const r = H.parseExport(csv, { unit: 'kg' });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('generic');
    expect(r.workouts[0].log[0].weightsArray).toEqual([100, 102.1]);
  });

  test('generic sheet with a Sets column expands to that many sets', () => {
    const csv = 'Date,Exercise,Sets,Reps,Weight\n2025-04-02,Row,3,8,60\n';
    const e = H.parseExport(csv, { unit: 'kg' }).workouts[0].log[0];
    expect(e.repsArray).toEqual([8, 8, 8]);
    expect(e.weightsArray).toEqual([60, 60, 60]);
    expect(e.sets).toBe(3);
  });

  test('same file twice gives the same ids', () => {
    const a = H.parseExport(STRONG, { unit: 'kg' }).workouts.map(w => w.id);
    const b = H.parseExport(STRONG, { unit: 'kg' }).workouts.map(w => w.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  test('explains files it cannot read', () => {
    expect(H.parseExport('', {}).ok).toBe(false);
    expect(H.parseExport('name,age\nbob,3', {}).error).toMatch(/columns/);
    expect(H.parseExport('Date,Exercise,Reps,Weight\n2025-01-01,Run,0,0', {}).error).toMatch(/No lifting sets/);
  });
});

describe('toImportChunks', () => {
  test('splits into request bodies with ISO dates', () => {
    const workouts = Array.from({ length: 5 }, (_, i) => ({ id: `imp_${i}`, title: 'W', date: `2025-01-0${i + 1}`, log: [] }));
    const chunks = H.toImportChunks(workouts, 'strong', 2);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].source).toBe('strong');
    expect(chunks[0].workouts[0]).toEqual({ date: '2025-01-01T12:00:00.000Z', title: 'W', workout: workouts[0] });
    expect(chunks[2].workouts).toHaveLength(1);
  });
});
