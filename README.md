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

