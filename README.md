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

## Backend

The production API is the Express app in the separate `traininglog-backend`
repository, deployed as the Firebase Cloud Function `api`
(`https://us-central1-pocketcoach-280c4.cloudfunctions.net/api`). This repo has
no server of its own: the web app, the native apps, `coach/` and `intake/` all
call that URL (see `config.js` and `src/config/constants.js`).

Never put API tokens or credentials in this repository. Server secrets live in
the backend's Secret Manager; the front end only needs the public backend URL.

To point a local build at a local backend, create `.env.development` containing

```ini
REACT_APP_BACKEND_URL=http://localhost:3000
```

The AI coach chat route (`src/routes/coach.js`, `src/coach/`) is kept here with
its tests until it is moved into the backend; the production backend does not
serve it yet.

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

