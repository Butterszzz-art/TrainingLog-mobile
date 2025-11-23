# TrainingLog

This project contains a simple fitness tracker.
It now includes a **Community** tab for experimenting with group
workouts. Users can create groups in the browser and post simple
updates. A small leaderboard helper ranks members based on provided
consistency and improvement scores. These features are purely
client-side placeholders.

Recent updates added an offline action queue and a theme selector with
two dark themes. Auto-generated workout suggestions now pre-populate set
inputs based on your last session and a simple progression analysis will
recommend deload weeks when plateaus are detected. Additional helper
modules expose periodization and meal planning utilities.

## Community API

When running the Express server, a small set of community endpoints is
available:

- `POST /community/groups` – create a new group. Include `name`,
  `creatorId` and optional `goal` and `tags` fields and the creator is added
  to the group.
- `GET /community/groups?userId=USER` – list the groups that contain the
  specified user. Additional query params `goal`, `tag` and `search` can be
  used to filter groups.
- `POST /community/groups/:groupId/share` – share a program with the
  group.
- `GET /community/groups/:groupId/progress` – return a summary of member
  progress and a simple leaderboard.
- `POST /community/groups/:groupId/posts` – add a comment to the group
  (use `GET` on the same path to fetch posts).

## Running Tests

Tests are written using [Jest](https://jestjs.io/). Install dependencies and run the test suite with:

```bash
npm install
npm test
```

## Server Configuration

`server.js` exposes a `/config` endpoint that provides the Airtable credentials. Create a `.env` file with the following variables before starting the server. `CORS_ORIGINS` may list allowed origins separated by commas:

```bash
AIRTABLE_TOKEN=yourTokenHere
AIRTABLE_BASE_ID=yourBaseIdHere
CORS_ORIGINS=https://your-site.github.io,https://your-pwa-origin
```

Run the server with:

```bash
npm start
```

## Front-End Configuration

The web app can optionally read Airtable credentials from a local
`config.js` module. Copy `config.example.js` to `config.js` and fill in your
values:
`config.js` contains private credentials. The file is ignored by Git so you
can keep your token out of version control.

The web app reads Airtable credentials from a small `config.js` file at
runtime. Copy `config.example.js` to `config.js` and fill in your values:

```bash
cp config.example.js config.js
# edit config.js and set AIRTABLE_TOKEN and AIRTABLE_BASE_ID
```

The file exports two constants:

```javascript
window.SERVER_URL = 'https://traininglog-backend.onrender.com';
window.airtableConfig = {
  airtableToken: 'yourToken',
  airtableBaseId: 'yourBase'
};
```

You can override the backend URL by setting the `REACT_APP_BACKEND_URL`
environment variable. When no backend is reachable, the page falls back to the
values provided in `config.js`. During development you may want to point it at a
local server by creating an `.env.development` file containing

```ini
REACT_APP_BACKEND_URL=http://localhost:3000
```

## Using the Rest-Pause/Drop-Set logger component

The `RestPauseDropSetLogger` React component renders a small form for capturing
base set data, optional rest–pause bursts, and drop-set follow-ons. Supply a
`ui` object to override the default Tailwind classes and register an `onChange`
handler to receive the normalized payload whenever the user edits the form.

```jsx
import RestPauseDropSetLogger from "./src/js/components/RestPauseDropSetLogger";

function WorkoutCard() {
  return (
    <RestPauseDropSetLogger
      className="max-w-full"
      ui={{
        root: "w-full",
        card: "rounded-xl border bg-zinc-900 text-zinc-100 shadow-sm",
        heading: "text-base font-semibold mb-2",
        grid: "grid grid-cols-1 md:grid-cols-4 gap-2 items-end",
        label: "text-xs text-zinc-400",
        input: "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:outline-none",
        toggleRow: "flex gap-2",
        toggleIdle: "flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs",
        toggleActive: "flex-1 rounded-lg border border-emerald-500 bg-emerald-600/20 text-emerald-300 px-3 py-2 text-xs",
        section: "mt-3 rounded-lg border border-zinc-700 p-3",
        sectionTitleRow: "flex items-center justify-between",
        sectionTitle: "text-sm font-medium",
        sectionAddBtn: "rounded-md border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800",
        subgrid: "grid grid-cols-3 md:grid-cols-6 gap-2 items-end",
        sublabel: "text-[11px] text-zinc-400",
        smallBtn: "rounded-md border border-zinc-700 px-3 py-2 text-xs hover:bg-zinc-800",
        weightBadgeWrap: "col-span-1 md:col-span-1 text-xs text-zinc-400",
        weightBadgeLabel: "opacity-70",
        weightBadgeVal: "font-medium text-zinc-200",
        summaryGrid: "mt-3 grid grid-cols-1 md:grid-cols-3 gap-2",
        summaryCard: "rounded-lg border border-zinc-700 p-3",
        summaryLabel: "text-[11px] uppercase tracking-wide text-zinc-400",
        summaryValue: "text-xl font-semibold",
        segmentTag: "inline-block mr-2 mb-1 rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs",
        code: "rounded-lg border border-zinc-700 p-3 overflow-auto text-[11px] bg-zinc-900",
      }}
      onChange={evt => console.log(evt.value, evt.volume)}
    />
  );
}
```

The `onChange` callback receives `{ value, flattened, volume }`, where
`value` represents the current form selections, `flattened` provides arrays of
segment weights and reps (base set + rest–pause bursts + drop-set sets), and
`volume` is the computed total weight × reps for the combined effort.

