import React, { useEffect, useMemo, useState } from "react";

export type RestPauseBurst = { reps: number; restSec?: number };
export type DropSet = { weight: number; reps: number };
export type BaseSet = { weight: number; reps: number };

export type EnrichedSet = {
  exercise: string;
  base: BaseSet;
  restPauseEnabled: boolean;
  restPause?: { bursts: RestPauseBurst[] };
  dropSetEnabled: boolean;
  drops?: DropSet[];
};

export type EnrichedSetChange = {
  value: EnrichedSet;
  flattened: { repsArray: number[]; weightsArray: number[] };
  volume: number;
};

function clampInt(n: any, min = 0, max = 9999): number {
  const v = Number.isFinite(+n) ? Math.max(min, Math.min(max, Math.floor(+n))) : 0;
  return v;
}

function toFlattenedArrays(set: EnrichedSet) {
  const repsArray: number[] = [];
  const weightsArray: number[] = [];

  repsArray.push(set.base.reps || 0);
  weightsArray.push(set.base.weight || 0);

  if (set.restPauseEnabled && set.restPause?.bursts?.length) {
    for (const b of set.restPause.bursts) {
      repsArray.push(clampInt(b.reps));
      weightsArray.push(set.base.weight || 0);
    }
  }

  if (set.dropSetEnabled && set.drops?.length) {
    for (const d of set.drops) {
      repsArray.push(clampInt(d.reps));
      weightsArray.push(d.weight || 0);
    }
  }

  return { repsArray, weightsArray };
}

function calcVolume(flat: { repsArray: number[]; weightsArray: number[] }) {
  let total = 0;
  for (let i = 0; i < flat.repsArray.length; i++) {
    const reps = flat.repsArray[i] || 0;
    const w = flat.weightsArray[i] || 0;
    total += reps * w;
  }
  return total;
}

type RestPauseDropSetLoggerUI = {
  root: string;
  card: string;
  heading: string;
  grid: string;
  label: string;
  input: string;
  toggleRow: string;
  toggleIdle: string;
  toggleActive: string;
  section: string;
  sectionTitleRow: string;
  sectionTitle: string;
  sectionAddBtn: string;
  subgrid: string;
  sublabel: string;
  smallBtn: string;
  weightBadgeWrap: string;
  weightBadgeLabel: string;
  weightBadgeVal: string;
  emptyHint: string;
  summaryGrid: string;
  summaryCard: string;
  summaryLabel: string;
  summaryValue: string;
  segmentTag: string;
  code: string;
};

const DEFAULT_UI: RestPauseDropSetLoggerUI = {
  root: "w-full max-w-3xl mx-auto p-4",
  card: "rounded-2xl shadow p-4 border bg-white",
  heading: "text-xl font-semibold mb-3",
  grid: "grid grid-cols-1 sm:grid-cols-4 gap-3 items-end",
  label: "text-sm",
  input: "mt-1 w-full rounded-xl border px-3 py-2",
  toggleRow: "flex gap-2",
  toggleIdle: "flex-1 rounded-xl border px-3 py-2 text-sm bg-gray-50",
  toggleActive: "flex-1 rounded-xl border px-3 py-2 text-sm bg-black text-white",
  section: "mt-4 rounded-xl border p-3",
  sectionTitleRow: "flex items-center justify-between",
  sectionTitle: "font-medium",
  sectionAddBtn: "rounded-lg border px-3 py-1 text-sm",
  subgrid: "grid grid-cols-3 sm:grid-cols-6 gap-2 items-end",
  sublabel: "text-xs",
  smallBtn: "rounded-lg border px-3 py-2 text-sm",
  weightBadgeWrap: "col-span-1 sm:col-span-1 text-sm text-gray-700",
  weightBadgeLabel: "opacity-70",
  weightBadgeVal: "font-medium",
  emptyHint: "text-sm text-gray-600 mt-2",
  summaryGrid: "mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3",
  summaryCard: "rounded-xl border p-3",
  summaryLabel: "text-xs uppercase tracking-wide text-gray-500",
  summaryValue: "text-2xl font-semibold",
  segmentTag: "inline-block mr-2 mb-1 rounded-lg bg-gray-50 border px-2 py-1",
  code: "rounded-xl border p-3 overflow-auto text-xs bg-gray-50",
};

const cx = (...classes: Array<string | undefined | false | null>) => classes.filter(Boolean).join(" ");

type RestPauseDropSetLoggerProps = {
  initialExercise?: string;
  initialWeight?: number;
  initialReps?: number;
  onChange?: (evt: EnrichedSetChange) => void;
  className?: string;
  ui?: Partial<RestPauseDropSetLoggerUI>;
};

export default function RestPauseDropSetLogger({
  initialExercise = "Bench Press",
  initialWeight = 60,
  initialReps = 8,
  onChange,
  className,
  ui: uiOverrides,
}: RestPauseDropSetLoggerProps) {
  const [exercise, setExercise] = useState(initialExercise);
  const [baseWeight, setBaseWeight] = useState(initialWeight);
  const [baseReps, setBaseReps] = useState(initialReps);

  const [rpEnabled, setRpEnabled] = useState(false);
  const [rpBursts, setRpBursts] = useState<RestPauseBurst[]>([]);

  const [dsEnabled, setDsEnabled] = useState(false);
  const [drops, setDrops] = useState<DropSet[]>([]);

  const styles = useMemo<RestPauseDropSetLoggerUI>(
    () => ({ ...DEFAULT_UI, ...(uiOverrides || {}) }),
    [uiOverrides]
  );

  const enriched: EnrichedSet = useMemo(
    () => ({
      exercise,
      base: { weight: clampInt(baseWeight, 0, 10000), reps: clampInt(baseReps) },
      restPauseEnabled: rpEnabled,
      restPause: rpEnabled
        ? {
            bursts: rpBursts.map(b => ({ reps: clampInt(b.reps), restSec: clampInt(b.restSec || 0) })),
          }
        : undefined,
      dropSetEnabled: dsEnabled,
      drops: dsEnabled
        ? drops.map(d => ({ weight: clampInt(d.weight, 0, 10000), reps: clampInt(d.reps) }))
        : undefined,
    }),
    [exercise, baseWeight, baseReps, rpEnabled, rpBursts, dsEnabled, drops]
  );

  const flattened = useMemo(() => toFlattenedArrays(enriched), [enriched]);
  const volume = useMemo(() => calcVolume(flattened), [flattened]);

  useEffect(() => {
    onChange?.({ value: enriched, flattened, volume });
  }, [enriched, flattened, volume, onChange]);

  const addRpBurst = () => setRpBursts(prev => [...prev, { reps: 2, restSec: 15 }]);
  const removeRpBurst = (idx: number) => setRpBursts(prev => prev.filter((_, i) => i !== idx));
  const updateRpBurst = (idx: number, patch: Partial<RestPauseBurst>) =>
    setRpBursts(prev => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));

  const addDrop = () => setDrops(prev => [...prev, { weight: Math.max(0, baseWeight - 10), reps: 6 }]);
  const removeDrop = (idx: number) => setDrops(prev => prev.filter((_, i) => i !== idx));
  const updateDrop = (idx: number, patch: Partial<DropSet>) =>
    setDrops(prev => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));

  const dropWeightBadgeClass = uiOverrides?.weightBadgeWrap
    ? styles.weightBadgeWrap
    : cx("hidden sm:block", styles.weightBadgeWrap);

  return (
    <div className={cx(styles.root, className)}>
      <div className={styles.card}>
        <h2 className={styles.heading}>Set Logger</h2>

        <div className={styles.grid}>
          <div>
            <label className={styles.label}>Exercise</label>
            <input
              className={styles.input}
              value={exercise}
              onChange={e => setExercise(e.target.value)}
              placeholder="Exercise name"
            />
          </div>
          <div>
            <label className={styles.label}>Weight</label>
            <input
              type="number"
              inputMode="numeric"
              className={styles.input}
              value={baseWeight}
              onChange={e => setBaseWeight(clampInt(e.target.value, 0, 10000))}
            />
          </div>
          <div>
            <label className={styles.label}>Reps</label>
            <input
              type="number"
              inputMode="numeric"
              className={styles.input}
              value={baseReps}
              onChange={e => setBaseReps(clampInt(e.target.value))}
            />
          </div>

          <div className={styles.toggleRow}>
            <button
              type="button"
              onClick={() => setRpEnabled(v => !v)}
              className={rpEnabled ? styles.toggleActive : styles.toggleIdle}
              title="Add extra bursts at the same weight"
            >
              Rest-Pause
            </button>
            <button
              type="button"
              onClick={() => setDsEnabled(v => !v)}
              className={dsEnabled ? styles.toggleActive : styles.toggleIdle}
              title="Add follow-on sets with reduced weight"
            >
              Drop Set
            </button>
          </div>
        </div>

        {rpEnabled && (
          <div className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h3 className={styles.sectionTitle}>Rest-Pause Bursts</h3>
              <button type="button" className={styles.sectionAddBtn} onClick={addRpBurst}>
                + Add burst
              </button>
            </div>

            {rpBursts.length === 0 && (
              <p className={styles.emptyHint}>No bursts yet. Add 1–3 mini-sets after your main set.</p>
            )}

            <div className="mt-2 space-y-2">
              {rpBursts.map((b, i) => (
                <div key={`rp-${i}`} className={styles.subgrid}>
                  <div className="col-span-2 sm:col-span-2">
                    <label className={styles.sublabel}>Burst Reps</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      className={styles.input}
                      value={b.reps}
                      onChange={e => updateRpBurst(i, { reps: clampInt(e.target.value) })}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-2">
                    <label className={styles.sublabel}>Rest (sec)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      className={styles.input}
                      value={b.restSec ?? 15}
                      onChange={e => updateRpBurst(i, { restSec: clampInt(e.target.value) })}
                    />
                  </div>
                  <div className={styles.weightBadgeWrap}>
                    <div className={styles.weightBadgeLabel}>Weight</div>
                    <div className={styles.weightBadgeVal}>{baseWeight}</div>
                  </div>
                  <div className="col-span-1 sm:col-span-1 flex justify-end">
                    <button type="button" className={styles.smallBtn} onClick={() => removeRpBurst(i)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {dsEnabled && (
          <div className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h3 className={styles.sectionTitle}>Drop Sets</h3>
              <button type="button" className={styles.sectionAddBtn} onClick={addDrop}>
                + Add drop
              </button>
            </div>

            {drops.length === 0 && (
              <p className={styles.emptyHint}>No drops yet. Add one or more follow-on sets with lighter weight.</p>
            )}

            <div className="mt-2 space-y-2">
              {drops.map((d, i) => (
                <div key={`drop-${i}`} className={styles.subgrid}>
                  <div className="col-span-2 sm:col-span-2">
                    <label className={styles.sublabel}>Weight</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      className={styles.input}
                      value={d.weight}
                      onChange={e => updateDrop(i, { weight: clampInt(e.target.value, 0, 10000) })}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-2">
                    <label className={styles.sublabel}>Reps</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      className={styles.input}
                      value={d.reps}
                      onChange={e => updateDrop(i, { reps: clampInt(e.target.value) })}
                    />
                  </div>
                  <div className={dropWeightBadgeClass}>
                    <div className={styles.weightBadgeLabel}>From</div>
                    <div className={styles.weightBadgeVal}>{baseWeight}</div>
                  </div>
                  <div className="col-span-1 sm:col-span-1 flex justify-end">
                    <button type="button" className={styles.smallBtn} onClick={() => removeDrop(i)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={styles.summaryGrid}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Total Volume</div>
            <div className={styles.summaryValue}>{volume}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Segments</div>
            <div className="text-sm">
              {flattened.repsArray.map((r, i) => (
                <span key={`seg-${i}`} className={styles.segmentTag}>
                  {flattened.weightsArray[i]}×{r}
                </span>
              ))}
            </div>
          </div>
          <pre className={styles.code}>
            {JSON.stringify({ exercise, normalized: { ...enriched, flattened, volume } }, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
