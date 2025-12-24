import React, { useEffect, useMemo, useState } from "react";
import { fetchWorkoutHistory } from "../api/workoutHistory";
import { loadLogsFromLocalStorage, WorkoutLog } from "../../resistanceLogs";

// Prototype-only view: swap to API-backed history once the backend endpoint is ready.
type LogHistoryProps = {
  className?: string;
  onSelect?: (log: WorkoutLog) => void;
};

function calculateVolume(log: WorkoutLog) {
  return (log.exercises || []).reduce((total, ex) => {
    const reps = Array.isArray(ex.repsArray) ? ex.repsArray : [];
    const weights = Array.isArray(ex.weightsArray) ? ex.weightsArray : [];
    const exerciseVolume = reps.reduce(
      (sum, rep, idx) => sum + (Number(rep) || 0) * (Number(weights[idx]) || 0),
      0
    );
    return total + exerciseVolume;
  }, 0);
}

export default function LogHistory({ className = "", onSelect }: LogHistoryProps) {
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadHistory = async () => {
      const currentUser =
        typeof window !== "undefined" &&
        typeof (window as Window & { currentUser?: string }).currentUser === "string"
          ? (window as Window & { currentUser?: string }).currentUser
          : "";

      if (currentUser) {
        try {
          const history = await fetchWorkoutHistory(currentUser);
          if (isActive && Array.isArray(history)) {
            const sorted = history
              .slice()
              .sort((a: WorkoutLog, b: WorkoutLog) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setLogs(sorted);
            return;
          }
        } catch (error) {
          console.warn("Failed to fetch workout history, falling back to local data.", error);
        }
      }

      const stored = loadLogsFromLocalStorage();
      const sorted = stored
        .slice()
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      if (isActive) {
        setLogs(sorted);
      }
    };

    loadHistory();
    return () => {
      isActive = false;
    };
  }, []);

  const totalVolume = useMemo(
    () => logs.reduce((sum, log) => sum + calculateVolume(log), 0),
    [logs]
  );

  if (!logs.length) {
    return (
      <div className={`p-4 rounded-xl border bg-white ${className}`}>
        <p className="text-sm text-gray-600">No workouts saved locally yet.</p>
        <p className="text-xs text-gray-500 mt-1">
          This temporary history uses your browser&apos;s storage until the API endpoint is available.
        </p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="rounded-xl border bg-white p-3 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">Prototype history</div>
          <div className="text-lg font-semibold">Saved locally</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Total volume logged</div>
          <div className="text-xl font-bold">{totalVolume}</div>
        </div>
      </div>

      <ul className="space-y-3">
        {logs.map(log => {
          const date = new Date(log.date);
          const dateKey = log.date;
          const isExpanded = expanded === dateKey;
          const volume = calculateVolume(log);

          return (
            <li
              key={dateKey}
              className="rounded-xl border bg-white p-3 shadow-sm hover:shadow transition cursor-pointer"
              onClick={() => {
                setExpanded(isExpanded ? null : dateKey);
                onSelect?.(log);
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{date.toDateString()}</div>
                  <div className="text-xs text-gray-500">{date.toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Volume</div>
                  <div className="text-lg font-bold">{volume}</div>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 space-y-2 text-sm">
                  {(log.exercises || []).map((ex, idx) => (
                    <div key={`${dateKey}-${idx}`} className="rounded-lg border p-2 bg-gray-50">
                      <div className="font-medium">{ex.name || `Exercise ${idx + 1}`}</div>
                      <div className="text-xs text-gray-600">
                        Reps: {(ex.repsArray || []).join(" / ") || "—"}
                      </div>
                      <div className="text-xs text-gray-600">
                        Weights: {(ex.weightsArray || []).join(" / ") || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
