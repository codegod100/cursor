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
cp .env.example .env
# Edit .env and set MOTHERDUCK_TOKEN, or configure OpenBao (see below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Secrets

The app accepts `MOTHERDUCK_TOKEN` in two ways:

1. **Direct env var** — set `MOTHERDUCK_TOKEN` in `.env` for local development.
2. **OpenBao** — on startup, if `MOTHERDUCK_TOKEN` is unset and `OPENBAO_TOKEN` is present, the server reads `MOTHERDUCK_TOKEN` from OpenBao before connecting.

For OpenBao in Cursor Cloud Agents:

- `OPENBAO_TOKEN` is injected automatically when OpenBao is enabled for your environment.
- Add `MOTHERDUCK_TOKEN` in the Cursor dashboard (stored in OpenBao).
- Also add `OPENBAO_ADDR` as an environment secret with your OpenBao server URL if it is not injected automatically.

The loader tries these KV paths:

- `secret/data/MOTHERDUCK_TOKEN`
- `secret/data/<environment-id>/MOTHERDUCK_TOKEN` when `CURSOR_ENVIRONMENT_ID` is set

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MOTHERDUCK_TOKEN` | Yes* | — | MotherDuck access token (used as the Postgres password) |
| `OPENBAO_TOKEN` | OpenBao path | — | Token for reading secrets from OpenBao |
| `OPENBAO_ADDR` | OpenBao path | — | OpenBao server URL (for example `https://openbao.example.com:8200`) |
| `OPENBAO_MOUNT` | No | `secret` | KV mount name |
| `MOTHERDUCK_HOST` | No | `pg.us-east-1-aws.motherduck.com` | Postgres endpoint host (use EU host for EU orgs) |
| `MOTHERDUCK_DB` | No | `sample_data` | Database name |
| `PORT` | No | `3000` | HTTP port |

\*Required either directly or via OpenBao.

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
