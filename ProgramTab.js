import React, { useEffect, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const loadPrograms = () => JSON.parse(localStorage.getItem('programs') || '[]');
const savePrograms = programs => localStorage.setItem('programs', JSON.stringify(programs));
const getAuthHeaders = () => {
  if (typeof window !== 'undefined' && typeof window.getAuthHeaders === 'function') {
    return window.getAuthHeaders();
  }
  return {};
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
    days: []
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
      }))
    };
    const res = await fetch(`${window.SERVER_URL}/createProgram`, {
      method: 'POST',
        credentials: "include",
      headers: {
        'Content-Type': 'application/json',
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
    if (!shareId) return;
    await fetch(`${window.SERVER_URL}/shareProgram`, {
        credentials: "include",
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
  })), /*#__PURE__*/React.createElement("fieldset", null, /*#__PURE__*/React.createElement("legend", null, "Frequency"), /*#__PURE__*/React.createElement("div", { className: "frequency-grid" }, DAYS.map(d => /*#__PURE__*/React.createElement("label", { key: d }, /*#__PURE__*/React.createElement("input", { type: "checkbox", checked: program.frequency.includes(d), onChange: () => handleFreqToggle(d) }), " ", d)))), /*#__PURE__*/React.createElement("fieldset", null, /*#__PURE__*/React.createElement("legend", null, "Progression Type"), ['linear', 'undulating', 'block'].map(t => /*#__PURE__*/React.createElement("label", { key: t, style: { marginRight: '10px' } }, /*#__PURE__*/React.createElement("input", { type: "radio", name: "progType", value: t, checked: program.progressionType === t, onChange: () => setProgram({ ...program, progressionType: t }) }), " ", t))), /*#__PURE__*/React.createElement("fieldset", null, /*#__PURE__*/React.createElement("legend", null, "Split Mode"), /*#__PURE__*/React.createElement("label", null, /*#__PURE__*/React.createElement("input", { type: "radio", name: "splitMode", value: "synchronous", checked: program.splitMode === 'synchronous', onChange: () => setProgram({ ...program, splitMode: 'synchronous' }) }), " Synchronous"), /*#__PURE__*/React.createElement("label", { style: { marginLeft: '10px' } }, /*#__PURE__*/React.createElement("input", { type: "radio", name: "splitMode", value: "asynchronous", checked: program.splitMode === 'asynchronous', onChange: () => setProgram({ ...program, splitMode: 'asynchronous' }) }), " Asynchronous"))), program.progressionType === 'linear' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
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
