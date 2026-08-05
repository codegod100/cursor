# MotherDuck Web App

A minimal Express web app that queries [MotherDuck](https://motherduck.com) through the [Postgres wire protocol endpoint](https://motherduck.com/docs/key-tasks/authenticating-and-connecting-to-motherduck/postgres-endpoint/). No DuckDB binary is required on the server.

The UI reads from MotherDuck's built-in `sample_data.nyc.taxi` dataset, so it works on any MotherDuck account without extra setup.

## Features

- **Recent trips** — latest 20 taxi pickups from `nyc.taxi`
- **Date-range stats** — passenger count, trip count, and total fare for a selected range
- **Server-side queries** — the MotherDuck token stays on the server

## Prerequisites

- Node.js 18+
- A [MotherDuck](https://app.motherduck.com) account and access token

## Setup

```bash
cd motherduck-app
npm install
echo 'your-motherduck-token' > .motherduck-token
chmod 600 .motherduck-token
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Token on disk

The app reads the MotherDuck token from `.motherduck-token` (gitignored) or from the `MOTHERDUCK_TOKEN` environment variable.

If `MOTHERDUCK_TOKEN` is injected as a Cursor secret, persist it to disk with:

```bash
npm run token:write
```

Check configuration:

```bash
npm run secrets:check
curl http://localhost:3000/api/health
```

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MOTHERDUCK_TOKEN` | No* | — | MotherDuck access token (used as the Postgres password) |
| `MOTHERDUCK_TOKEN_FILE` | No | `.motherduck-token` | Path to a file containing the token |
| `MOTHERDUCK_HOST` | No | `pg.us-east-1-aws.motherduck.com` | Postgres endpoint host |
| `MOTHERDUCK_DB` | No | `sample_data` | Database name |
| `PORT` | No | `3000` | HTTP port |

\*Required via env var or token file.

Create a MotherDuck token in the UI under **Settings → Access Tokens**.

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/trips` | 20 most recent taxi trips |
| `GET /api/stats?start=YYYY-MM-DD&end=YYYY-MM-DD` | Aggregated stats for a date range |

## Architecture

```
Browser  →  Express API routes  →  pg Pool  →  MotherDuck Postgres endpoint
```

Queries use parameterized SQL where user input is involved. The connection pool is created once at startup and reused across requests.

## Customize

Point the app at your own data by changing the SQL in `server.js` and setting `MOTHERDUCK_DB` to your database name.
