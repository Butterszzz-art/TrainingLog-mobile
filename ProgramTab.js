import React, { useEffect, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HISTORY_KEYS = ['workoutHistory', 'resistanceLogs', 'tl_workout_history_v1'];
const loadPrograms = () => JSON.parse(localStorage.getItem('programs') || '[]');
const savePrograms = programs => localStorage.setItem('programs', JSON.stringify(programs));

const parseArrayFromStorage = key => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
};
const loadWorkoutHistory = () => HISTORY_KEYS.flatMap(parseArrayFromStorage);
const buildVarietyRecommendations = frequency => {
  if (typeof window === 'undefined' || !window.exerciseVarietyEngine || typeof window.exerciseVarietyEngine.buildProgramVarietyRecommendations !== 'function') {
    return null;
  }
  const recommendations = window.exerciseVarietyEngine.buildProgramVarietyRecommendations(loadWorkoutHistory());
  const suggestions = Object.entries(recommendations.suggestedVarietyExercises || {}).flatMap(([muscle, list]) => (Array.isArray(list) ? list : []).map(name => ({
    muscle,
    name
  })));
  return {
    ...recommendations,
    autoInsertedExercises: suggestions.map((item, idx) => ({
      day: frequency[idx % Math.max(1, frequency.length)] || null,
      muscle: item.muscle,
      exercise: item.name
    }))
  };
};

const getAuthHeaders = () => {
  if (typeof localStorage === 'undefined') {
    return {};
import React, { useMemo, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_TO_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const GOAL_LIBRARY = {
  strength: { label: "Strength", sets: 4, reps: 5, intensity: 0.82 },
  hypertrophy: { label: "Hypertrophy", sets: 4, reps: 10, intensity: 0.7 },
  endurance: { label: "Endurance", sets: 3, reps: 15, intensity: 0.6 }
};

const PERIODISATION_LIBRARY = {
  linear: {
    label: "Linear",
    pattern: [
      { volume: 1.08, intensity: 0.92, focus: "Foundation" },
      { volume: 1.04, intensity: 0.96, focus: "Build" },
      { volume: 1.0, intensity: 1.0, focus: "Build" },
      { volume: 0.95, intensity: 1.04, focus: "Peak" },
      { volume: 0.78, intensity: 0.86, focus: "Deload" }
    ]
  },
  undulating: {
    label: "Undulating",
    pattern: [
      { volume: 1.08, intensity: 0.9, focus: "Volume" },
      { volume: 0.96, intensity: 1.04, focus: "Intensity" },
      { volume: 1.02, intensity: 0.96, focus: "Power" },
      { volume: 0.88, intensity: 1.08, focus: "Top set" },
      { volume: 0.8, intensity: 0.86, focus: "Deload" }
    ]
  },
  block: {
    label: "Block",
    pattern: [
      { volume: 1.15, intensity: 0.88, focus: "Accumulation" },
      { volume: 1.1, intensity: 0.92, focus: "Accumulation" },
      { volume: 0.96, intensity: 1.02, focus: "Intensification" },
      { volume: 0.88, intensity: 1.07, focus: "Realisation" },
      { volume: 0.76, intensity: 0.84, focus: "Deload" }
    ]
  },
  conjugate: {
    label: "Conjugate",
    pattern: [
      { volume: 1.0, intensity: 1.04, focus: "Max effort" },
      { volume: 1.12, intensity: 0.9, focus: "Dynamic effort" },
      { volume: 1.06, intensity: 0.95, focus: "Repeated effort" },
      { volume: 0.94, intensity: 1.06, focus: "Variation peak" },
      { volume: 0.8, intensity: 0.86, focus: "Deload" }
    ]
  }
};

const loadPrograms = () => JSON.parse(localStorage.getItem("programs") || "[]");
const savePrograms = (programs) => localStorage.setItem("programs", JSON.stringify(programs));

const getAuthHeaders = () => {
  if (typeof localStorage === "undefined") return {};
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};
function CalendarPreview({
  startDate,
  frequency,
  onSelect
}) {
  const start = startDate ? new Date(startDate) : new Date();
  const weeks = [];
  for (let w = 0; w < 4; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      days.push(date);
    }
    weeks.push(days);
  }
  return React.createElement('table', {
    className: 'calendar-preview'
  }, weeks.map((week, wi) => React.createElement('tr', {
    key: wi
  }, week.map((day, di) => React.createElement('td', {
    key: di,
    onClick: () => onSelect(day)
  }, day.getDate())))));
}

function normalizeDate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().split("T")[0];
}

function nextDateForWeekday(anchorDate, weekdayLabel) {
  const date = new Date(anchorDate);
  const target = DAY_TO_INDEX[weekdayLabel];
  const diff = (target - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return date;
}

function generatePeriodisedWeeks({ goalKey, schemeKey, weeks, baseLoad }) {
  const goal = GOAL_LIBRARY[goalKey] || GOAL_LIBRARY.strength;
  const scheme = PERIODISATION_LIBRARY[schemeKey] || PERIODISATION_LIBRARY.linear;

  return Array.from({ length: weeks }, (_, index) => {
    const slot = scheme.pattern[index % scheme.pattern.length];
    const targetSets = Math.max(2, Math.round(goal.sets * slot.volume));
    const totalVolume = targetSets * goal.reps;
    const intensityPct = Math.round(goal.intensity * slot.intensity * 100);
    const suggestedLoad = Math.round(baseLoad * goal.intensity * slot.intensity * 10) / 10;

    return {
      week: index + 1,
      focus: slot.focus,
      sets: targetSets,
      reps: goal.reps,
      intensityPct,
      totalVolume,
      suggestedLoad
    };
  });
}

function generateSessions(startDate, frequency, generatedWeeks, goalKey, schemeKey, baseLoad) {
  if (!startDate || !Array.isArray(frequency) || !frequency.length) return [];

  const firstStart = new Date(startDate);
  const sessions = [];

  generatedWeeks.forEach((weekInfo, weekIndex) => {
    const weekStart = new Date(firstStart);
    weekStart.setDate(firstStart.getDate() + weekIndex * 7);

    frequency.forEach((weekday, dayIndex) => {
      const date = nextDateForWeekday(weekStart, weekday);
      if (date < weekStart) {
        date.setDate(date.getDate() + 7);
      }

      sessions.push({
        id: `${weekInfo.week}-${weekday}`,
        date: normalizeDate(date),
        dayName: `${weekday} · W${weekInfo.week}`,
        title: `${GOAL_LIBRARY[goalKey].label} ${PERIODISATION_LIBRARY[schemeKey].label}`,
        focus: weekInfo.focus,
        sets: weekInfo.sets,
        reps: weekInfo.reps,
        load: weekInfo.suggestedLoad,
        intensityPct: weekInfo.intensityPct,
        volume: weekInfo.totalVolume,
        goal: goalKey,
        sequence: dayIndex + 1,
        baseline1RM: baseLoad
      });
    });
  });

  return sessions.sort((a, b) => a.date.localeCompare(b.date));
}

function syncProgramToExistingScheduling(programName, sessions) {
  const currentUser = window.currentUser || localStorage.getItem("username") || localStorage.getItem("Username");
  if (!currentUser || !Array.isArray(sessions) || !sessions.length) return;

  const workoutsKey = `workouts_${currentUser}`;
  const workouts = JSON.parse(localStorage.getItem(workoutsKey) || "[]");
  const existingDates = new Set(workouts.map((w) => w && w.date));

  sessions.forEach((session) => {
    if (existingDates.has(session.date)) return;
    workouts.push({
      id: `program-${Date.now()}-${session.id}`,
      date: session.date,
      title: `${programName} · ${session.dayName}`,
      notes: `${session.focus} week • ${session.intensityPct}% intensity target`,
      log: [
        {
          exercise: "Primary Lift",
          sets: session.sets,
          repGoal: session.reps,
          goal: session.load,
          unit: "kg",
          weightsArray: Array(session.sets).fill(session.load),
          repsArray: Array(session.sets).fill(session.reps)
        }
      ]
    });
    existingDates.add(session.date);
  });

  localStorage.setItem(workoutsKey, JSON.stringify(workouts));

  const reminderKey = `programReminders_${currentUser}`;
  const reminders = JSON.parse(localStorage.getItem(reminderKey) || "[]");
  const reminderSeen = new Set(reminders.map((r) => `${r.date}:${r.type}`));
  sessions.forEach((session) => {
    const token = `${session.date}:program-workout`;
    if (reminderSeen.has(token)) return;
    reminders.push({
      id: `rem-${session.id}`,
      date: session.date,
      type: "program-workout",
      title: `${programName} session scheduled`
    });
    reminderSeen.add(token);
  });
  localStorage.setItem(reminderKey, JSON.stringify(reminders));

  if (typeof window.updateTrainingCalendar === "function") window.updateTrainingCalendar();
  if (typeof window.scheduleStreakReminderJob === "function") window.scheduleStreakReminderJob();
}

function CalendarPreview({ sessions }) {
  return React.createElement(
    "div",
    { className: "wizard-preview" },
    React.createElement("h4", null, "Generated Weekly Targets"),
    React.createElement(
      "table",
      { className: "calendar-preview" },
      React.createElement(
        "thead",
        null,
        React.createElement(
          "tr",
          null,
          ["Week", "Focus", "Sets×Reps", "Intensity", "Load", "Volume"].map((col) =>
            React.createElement("th", { key: col }, col)
          )
        )
      ),
      React.createElement(
        "tbody",
        null,
        sessions.map((item) =>
          React.createElement(
            "tr",
            { key: item.week },
            React.createElement("td", null, `W${item.week}`),
            React.createElement("td", null, item.focus),
            React.createElement("td", null, `${item.sets}×${item.reps}`),
            React.createElement("td", null, `${item.intensityPct}%`),
            React.createElement("td", null, `${item.suggestedLoad} kg`),
            React.createElement("td", null, item.totalVolume)
          )
        )
      )
    )
  );
}

export default function ProgramTab() {
  const [programs, setPrograms] = useState(loadPrograms());
  const [showDrawer, setShowDrawer] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareId, setShareId] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [program, setProgram] = useState({
    name: '',
    startDate: '',
    frequency: [],
    progressionType: 'linear',
    splitMode: 'synchronous',
    progressionSettings: {
      linear: {
        increment: 2.5,
        unit: 'kg',
        interval: 'workout'
      },
      undulating: {
        light: 60,
        medium: 75,
        heavy: 90
      },
      block: {
        blockLength: 3,
        loadPercent: 85,
        deloadPercent: 60
      }
    },
    days: [],
    autoInsertVariety: false
  });
  const handleFreqToggle = day => {
    setProgram(prev => {
      let freq = prev.frequency.includes(day) ? prev.frequency.filter(d => d !== day) : [...prev.frequency, day];
      // update days list
      let days = prev.days.filter(d => freq.includes(d.original));
      freq.forEach(d => {
        if (!days.find(x => x.original === d)) {
          days.push({
            name: d,
            original: d,
            order: days.length + 1
          });
        }
      });
      return {
        ...prev,
        frequency: freq,
        days
      };
    });
  };
  const renameDay = (idx, name) => {
    setProgram(prev => {
      const days = [...prev.days];
      days[idx] = {
        ...days[idx],
        name
      };
      return {
        ...prev,
        days
      };
    });
  };
  const handleDrop = idx => {
    setProgram(prev => {
      const days = [...prev.days];
      const [itm] = days.splice(dragIndex, 1);
      days.splice(idx, 0, itm);
      return {
        ...prev,
        days: days.map((d, i) => ({
          ...d,
          order: i + 1
        }))
      };
    });
  };
  const save = async () => {

  const [program, setProgram] = useState({
    name: "",
    startDate: "",
    frequency: [],
    progressionType: "linear",
    splitMode: "synchronous",
    days: [],
    wizard: {
      goal: "strength",
      scheme: "linear",
      weeks: 8,
      baseLoad: 100
    },
    generatedWeeks: [],
    generatedSessions: []
  });

  const generatedWeeksPreview = useMemo(
    () =>
      generatePeriodisedWeeks({
        goalKey: program.wizard.goal,
        schemeKey: program.wizard.scheme,
        weeks: Number(program.wizard.weeks) || 8,
        baseLoad: Number(program.wizard.baseLoad) || 100
      }),
    [program.wizard]
  );

  const handleFreqToggle = (day) => {
    setProgram((prev) => {
      const freq = prev.frequency.includes(day)
        ? prev.frequency.filter((d) => d !== day)
        : [...prev.frequency, day];

      const days = prev.days.filter((d) => freq.includes(d.original));
      freq.forEach((d) => {
        if (!days.find((x) => x.original === d)) {
          days.push({ name: d, original: d, order: days.length + 1 });
        }
      });
      return { ...prev, frequency: freq, days };
    });
  };

  const runWizard = () => {
    const generatedSessions = generateSessions(
      program.startDate,
      program.frequency,
      generatedWeeksPreview,
      program.wizard.goal,
      program.wizard.scheme,
      Number(program.wizard.baseLoad) || 100
    );

    setProgram((prev) => ({
      ...prev,
      progressionType: prev.wizard.scheme,
      generatedWeeks: generatedWeeksPreview,
      generatedSessions,
      days: generatedSessions.map((session, index) => ({
        name: `${session.dayName} · ${session.focus} (${session.sets}x${session.reps} @ ${session.intensityPct}%)`,
        original: session.dayName,
        order: index + 1,
        session
      }))
    }));
  };

  const save = async () => {
    if (!program.name || !program.startDate || !program.frequency.length) {
      alert("Please set program name, start date, and frequency before saving.");
      return;
    }

    const payload = {
      name: program.name,
      startDate: program.startDate,
      frequency: program.frequency,
      progressionType: program.progressionType,
      splitMode: program.splitMode,
      progressionSettings: program.progressionSettings[program.progressionType],
      days: program.days.map((d, i) => ({
        name: d.name,
        order: i + 1
      })),
      varietySettings: {
        autoInsertSuggestions: program.autoInsertVariety
      }
    };
    const recommendations = buildVarietyRecommendations(program.frequency);
    if (recommendations) {
      payload.recommendations = recommendations;
      if (program.autoInsertVariety) {
        payload.autoInsertedExercises = recommendations.autoInsertedExercises;
      }
      payload.schedule = {
        recommendedDeloadWeeks: recommendations?.deloadPlan?.recommendedDeloadWeeks || []
      };
    }
      wizard: program.wizard,
      generatedWeeks: program.generatedWeeks,
      sessions: program.generatedSessions,
      days: program.days.map((d, i) => ({ name: d.name, order: i + 1 }))
    };

    const res = await fetch(`${window.SERVER_URL}/createProgram`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.id) {
      const newPrograms = [...programs, {
        ...payload,
        id: json.id
      }];
      setPrograms(newPrograms);
      savePrograms(newPrograms);
      setShowDrawer(false);
    }
  };
  const doShare = async username => {

    const json = await res.json();
    if (json.id) {
      const savedProgram = { ...payload, id: json.id };
      const newPrograms = [...programs, savedProgram];
      setPrograms(newPrograms);
      savePrograms(newPrograms);
      syncProgramToExistingScheduling(program.name, payload.sessions);
      setShowDrawer(false);
    }
  };

  const doShare = async (username) => {
    if (!shareId) return;
    await fetch(`${window.SERVER_URL}/shareProgram`, {
      credentials: "include",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        programId: shareId,
        recipientUsername: username
      })
    });
    setShowShare(false);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "program-tab-react"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowDrawer(true)
  }, "New Program"), /*#__PURE__*/React.createElement("div", {
    className: "program-list"
  }, programs.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    className: "program-row"
  }, p.name, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShareId(p.id);
      setShowShare(true);
    }
  }, "Share Program")))), showDrawer && /*#__PURE__*/React.createElement("div", {
    className: "drawer"
  }, /*#__PURE__*/React.createElement("h3", null, "Create Program"), /*#__PURE__*/React.createElement("label", null, "Name ", /*#__PURE__*/React.createElement("input", {
    value: program.name,
    onChange: e => setProgram({
      ...program,
      name: e.target.value
    })
  })), /*#__PURE__*/React.createElement("label", null, "Start Date ", /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: program.startDate,
    onChange: e => setProgram({
      ...program,
      startDate: e.target.value
    })
  })), /*#__PURE__*/React.createElement("fieldset", null, /*#__PURE__*/React.createElement("legend", null, "Frequency"), /*#__PURE__*/React.createElement("div", { className: "frequency-grid" }, DAYS.map(d => /*#__PURE__*/React.createElement("label", { key: d }, /*#__PURE__*/React.createElement("input", { type: "checkbox", checked: program.frequency.includes(d), onChange: () => handleFreqToggle(d) }), " ", d)))), /*#__PURE__*/React.createElement("fieldset", null, /*#__PURE__*/React.createElement("legend", null, "Progression Type"), ['linear', 'undulating', 'block'].map(t => /*#__PURE__*/React.createElement("label", { key: t, style: { marginRight: '10px' } }, /*#__PURE__*/React.createElement("input", { type: "radio", name: "progType", value: t, checked: program.progressionType === t, onChange: () => setProgram({ ...program, progressionType: t }) }), " ", t))), /*#__PURE__*/React.createElement("fieldset", null, /*#__PURE__*/React.createElement("legend", null, "Split Mode"), /*#__PURE__*/React.createElement("label", null, /*#__PURE__*/React.createElement("input", { type: "radio", name: "splitMode", value: "synchronous", checked: program.splitMode === 'synchronous', onChange: () => setProgram({ ...program, splitMode: 'synchronous' }) }), " Synchronous"), /*#__PURE__*/React.createElement("label", { style: { marginLeft: '10px' } }, /*#__PURE__*/React.createElement("input", { type: "radio", name: "splitMode", value: "asynchronous", checked: program.splitMode === 'asynchronous', onChange: () => setProgram({ ...program, splitMode: 'asynchronous' }) }), " Asynchronous"))), /*#__PURE__*/React.createElement("label", { style: { display: 'block', marginTop: '10px' } }, /*#__PURE__*/React.createElement("input", { type: "checkbox", checked: program.autoInsertVariety, onChange: e => setProgram({
      ...program,
      autoInsertVariety: e.target.checked
    }) }), " Auto-insert variety suggestions and deload schedule"), program.progressionType === 'linear' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    title: "Amount to add each interval"
  }, "Increment ", /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: program.progressionSettings.linear.increment,
    onChange: e => setProgram({
      ...program,
      progressionSettings: {
        ...program.progressionSettings,
        linear: {
          ...program.progressionSettings.linear,
          increment: Number(e.target.value)
        }
      }
    })
  })), /*#__PURE__*/React.createElement("select", {
    value: program.progressionSettings.linear.unit,
    onChange: e => setProgram({
      ...program,
      progressionSettings: {
        ...program.progressionSettings,
        linear: {
          ...program.progressionSettings.linear,
          unit: e.target.value
        }
      }
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: "kg"
  }, "kg"), /*#__PURE__*/React.createElement("option", {
    value: "lbs"
  }, "lbs")), /*#__PURE__*/React.createElement("select", {
    value: program.progressionSettings.linear.interval,
    onChange: e => setProgram({
      ...program,
      progressionSettings: {
        ...program.progressionSettings,
        linear: {
          ...program.progressionSettings.linear,
          interval: e.target.value
        }
      }
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: "workout"
  }, "per workout"), /*#__PURE__*/React.createElement("option", {
    value: "week"
  }, "per week"))), program.progressionType === 'undulating' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Day"), /*#__PURE__*/React.createElement("th", null, "% Intensity"))), /*#__PURE__*/React.createElement("tbody", null, ['Light', 'Medium', 'Heavy'].map(k => /*#__PURE__*/React.createElement("tr", {
    key: k
  }, /*#__PURE__*/React.createElement("td", null, k), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: program.progressionSettings.undulating[k.toLowerCase()],
    onChange: e => setProgram({
      ...program,
      progressionSettings: {
        ...program.progressionSettings,
        undulating: {
          ...program.progressionSettings.undulating,
          [k.toLowerCase()]: Number(e.target.value)
        }
      }
    })
  }))))))), program.progressionType === 'block' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", null, "Block Length (weeks) ", /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: program.progressionSettings.block.blockLength,
    onChange: e => setProgram({
      ...program,
      progressionSettings: {
        ...program.progressionSettings,
        block: {
          ...program.progressionSettings.block,
          blockLength: Number(e.target.value)
        }
      }
    })
  })), /*#__PURE__*/React.createElement("label", null, "Load % ", /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: program.progressionSettings.block.loadPercent,
    onChange: e => setProgram({
      ...program,
      progressionSettings: {
        ...program.progressionSettings,
        block: {
          ...program.progressionSettings.block,
          loadPercent: Number(e.target.value)
        }
      }
    })
  })), /*#__PURE__*/React.createElement("label", null, "Deload % ", /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: program.progressionSettings.block.deloadPercent,
    onChange: e => setProgram({
      ...program,
      progressionSettings: {
        ...program.progressionSettings,
        block: {
          ...program.progressionSettings.block,
          deloadPercent: Number(e.target.value)
        }
      }
    })
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowAdvanced(!showAdvanced)
  }, "Advanced Progression Rules"), showAdvanced && /*#__PURE__*/React.createElement("div", {
    className: "advanced"
  }, "Type specific details above."), /*#__PURE__*/React.createElement("div", {
    className: "day-order"
  }, program.days.map((d, idx) => /*#__PURE__*/React.createElement("div", {
    key: idx,
    className: "day-card",
    draggable: true,
    onDragStart: () => setDragIndex(idx),
    onDragOver: e => e.preventDefault(),
    onDrop: () => handleDrop(idx)
  }, /*#__PURE__*/React.createElement("input", {
    value: d.name,
    onChange: e => renameDay(idx, e.target.value)
  })))), /*#__PURE__*/React.createElement(CalendarPreview, {
    startDate: program.startDate,
    frequency: program.frequency,
    onSelect: day => {
      const idx = program.days.findIndex(d => d.original === day);
      if (idx >= 0) {
        document.getElementsByClassName('day-card')[idx]?.scrollIntoView({
          behavior: 'smooth'
        });
      }
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '10px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: save
  }, "Save Program"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShareId(null);
      setShowShare(true);
    }
  }, "Share Program"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowDrawer(false)
  }, "Close")), showShare && /*#__PURE__*/React.createElement("div", {
    className: "share-modal"
  }, /*#__PURE__*/React.createElement("input", {
    id: "shareUser",
    placeholder: "Username"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const user = document.getElementById('shareUser').value;
      doShare(user);
    }
  }, "Send"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowShare(false)
  }, "Cancel")));
}
const root = createRoot(document.getElementById('programTabReactRoot'));
root.render(/*#__PURE__*/React.createElement(ProgramTab, null));

  return React.createElement(
    "div",
    { className: "program-tab-react" },
    React.createElement("button", { onClick: () => setShowDrawer(true) }, "New Program"),
    React.createElement(
      "div",
      { className: "program-list" },
      programs.map((p) =>
        React.createElement(
          "div",
          { key: p.id, className: "program-row" },
          p.name,
          React.createElement(
            "button",
            {
              onClick: () => {
                setShareId(p.id);
                setShowShare(true);
              }
            },
            "Share Program"
          )
        )
      )
    ),
    showDrawer &&
      React.createElement(
        "div",
        { className: "drawer" },
        React.createElement("h3", null, "Create Program"),
        React.createElement(
          "label",
          null,
          "Name ",
          React.createElement("input", {
            value: program.name,
            onChange: (e) => setProgram({ ...program, name: e.target.value })
          })
        ),
        React.createElement(
          "label",
          null,
          "Start Date ",
          React.createElement("input", {
            type: "date",
            value: program.startDate,
            onChange: (e) => setProgram({ ...program, startDate: e.target.value })
          })
        ),
        React.createElement(
          "fieldset",
          null,
          React.createElement("legend", null, "Frequency"),
          React.createElement(
            "div",
            { className: "frequency-grid" },
            DAYS.map((d) =>
              React.createElement(
                "label",
                { key: d },
                React.createElement("input", {
                  type: "checkbox",
                  checked: program.frequency.includes(d),
                  onChange: () => handleFreqToggle(d)
                }),
                " ",
                d
              )
            )
          )
        ),
        React.createElement(
          "fieldset",
          null,
          React.createElement("legend", null, "Periodisation Wizard"),
          React.createElement(
            "label",
            null,
            "Goal ",
            React.createElement(
              "select",
              {
                value: program.wizard.goal,
                onChange: (e) => setProgram({ ...program, wizard: { ...program.wizard, goal: e.target.value } })
              },
              Object.entries(GOAL_LIBRARY).map(([key, g]) =>
                React.createElement("option", { key, value: key }, g.label)
              )
            )
          ),
          React.createElement(
            "label",
            null,
            "Scheme ",
            React.createElement(
              "select",
              {
                value: program.wizard.scheme,
                onChange: (e) => setProgram({ ...program, wizard: { ...program.wizard, scheme: e.target.value } })
              },
              Object.entries(PERIODISATION_LIBRARY).map(([key, v]) =>
                React.createElement("option", { key, value: key }, v.label)
              )
            )
          ),
          React.createElement(
            "label",
            null,
            "Program Length (weeks) ",
            React.createElement("input", {
              type: "number",
              min: 1,
              max: 24,
              value: program.wizard.weeks,
              onChange: (e) =>
                setProgram({ ...program, wizard: { ...program.wizard, weeks: Number(e.target.value) || 1 } })
            })
          ),
          React.createElement(
            "label",
            null,
            "Baseline 1RM / Load (kg) ",
            React.createElement("input", {
              type: "number",
              min: 1,
              value: program.wizard.baseLoad,
              onChange: (e) =>
                setProgram({ ...program, wizard: { ...program.wizard, baseLoad: Number(e.target.value) || 1 } })
            })
          ),
          React.createElement("button", { type: "button", onClick: runWizard }, "Auto-generate Schedule")
        ),
        generatedWeeksPreview.length > 0 && React.createElement(CalendarPreview, { sessions: generatedWeeksPreview }),
        React.createElement(
          "div",
          { className: "day-order" },
          program.days.map((d, idx) => React.createElement("div", { key: idx, className: "day-card" }, d.name))
        ),
        React.createElement(
          "div",
          { style: { marginTop: "10px" } },
          React.createElement("button", { onClick: save }, "Save Program"),
          React.createElement(
            "button",
            {
              onClick: () => {
                setShareId(null);
                setShowShare(true);
              }
            },
            "Share Program"
          ),
          React.createElement("button", { onClick: () => setShowDrawer(false) }, "Close")
        )
      ),
    showShare &&
      React.createElement(
        "div",
        { className: "share-modal" },
        React.createElement("input", { id: "shareUser", placeholder: "Username" }),
        React.createElement(
          "button",
          {
            onClick: () => {
              const user = document.getElementById("shareUser").value;
              doShare(user);
            }
          },
          "Send"
        ),
        React.createElement("button", { onClick: () => setShowShare(false) }, "Cancel")
      )
  );
}

const rootNode = document.getElementById("programTabReactRoot");
if (rootNode) {
  const root = createRoot(rootNode);
  root.render(React.createElement(ProgramTab));
}
