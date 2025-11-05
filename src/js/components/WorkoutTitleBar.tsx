import React, { useMemo, useState, useEffect, useId } from "react";

export type WorkoutTitleBarChange = {
  // The title that should be saved/displayed by the parent
  effectiveTitle: string;
  // Raw custom input, empty string means "use default"
  customTitle: string;
  // Whether the custom title is enabled
  enabled: boolean;
};

type UI = {
  root: string;
  row: string;
  label: string;
  toggleWrap: string;
  checkbox: string;
  input: string;
};

const defaultUI: UI = {
  root: "w-full",
  row: "mb-3 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end",
  label: "text-sm",
  toggleWrap: "flex items-center gap-2 text-sm",
  checkbox: "h-4 w-4",
  input: "mt-1 w-full rounded-xl border px-3 py-2",
};

export default function WorkoutTitleBar({
  className = "",
  ui,
  // Controls
  showControls = true,
  initialEnabled,
  initialTitle = "",
  dateLocale,
  dateForDefault, // optional fixed date for the default title
  onChange,
}: {
  className?: string;
  ui?: Partial<UI>;
  showControls?: boolean;         // hide the UI yet still compute a title
  initialEnabled?: boolean;       // if undefined, inferred from initialTitle
  initialTitle?: string;          // prefill custom title
  dateLocale?: string;            // e.g. "en-GB", "nl-NL"
  dateForDefault?: Date;          // default falls back to "new Date()"
  onChange?: (evt: WorkoutTitleBarChange) => void;
}) {
  const UI = { ...defaultUI, ...(ui || {}) };

  const [enabled, setEnabled] = useState<boolean>(
    initialEnabled ?? Boolean((initialTitle || "").trim())
  );
  const [customTitle, setCustomTitle] = useState<string>(initialTitle);
  const checkboxId = useId();

  const defaultTitle = useMemo(() => {
    const d = dateForDefault ?? new Date();
    const dateStr = d.toLocaleDateString(dateLocale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return `Workout on ${dateStr}`;
  }, [dateForDefault, dateLocale]);

  const effectiveTitle = useMemo(() => {
    const t = (customTitle || "").trim();
    return enabled && t ? t : defaultTitle;
  }, [enabled, customTitle, defaultTitle]);

  useEffect(() => {
    onChange?.({ effectiveTitle, customTitle, enabled });
  }, [effectiveTitle, customTitle, enabled, onChange]);

  if (!showControls) {
    return null;
  }

  return (
    <div className={`${UI.root} ${className}`}>
      <div className={UI.row}>
        <div className="sm:col-span-1">
          <label className={UI.label}>Custom workout name</label>
          <div className={UI.toggleWrap}>
            <input
              id={checkboxId}
              type="checkbox"
              className={UI.checkbox}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <label htmlFor={checkboxId}>Enable</label>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className={UI.label}>Title</label>
          <input
            className={UI.input}
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder={defaultTitle}
            disabled={!enabled}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Utility: if you only want the title without rendering the component
 */
export function getEffectiveWorkoutTitle(opts?: {
  customTitle?: string;
  enabled?: boolean;
  date?: Date;
  locale?: string;
}) {
  const d = opts?.date ?? new Date();
  const dateStr = d.toLocaleDateString(opts?.locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const fallback = `Workout on ${dateStr}`;
  const t = (opts?.customTitle || "").trim();
  return opts?.enabled && t ? t : fallback;
}
