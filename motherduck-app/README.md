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

The app reads `MOTHERDUCK_TOKEN` from the environment at startup.

### Local development

Set `MOTHERDUCK_TOKEN` in `.env`.

### Cursor Cloud Agents

Cursor injects dashboard secrets directly as environment variables. There is no fetchable OpenBao HTTP API inside the Cloud Agent VM.

1. Open your environment in the [Cloud Agents dashboard](https://cursor.com/dashboard/cloud-agents).
2. Add `MOTHERDUCK_TOKEN` as a **Runtime Secret** (or Environment Variable).
3. Scope it to this environment if you use environment-scoped secrets.
4. Restart the Cloud Agent so the new secret is injected.

`OPENBAO_TOKEN` may also be injected, but it is not a substitute for `MOTHERDUCK_TOKEN`. The app only talks to a self-hosted OpenBao server when `OPENBAO_ADDR` is set.

Check configuration with:

```bash
npm run secrets:check
curl http://localhost:3000/api/health
```

### Self-hosted OpenBao (optional)

If you run your own OpenBao server, set `OPENBAO_ADDR`, `OPENBAO_TOKEN`, and optionally `OPENBAO_MOUNT`. The loader tries:

- `secret/data/MOTHERDUCK_TOKEN`
- `secret/data/<environment-id>/MOTHERDUCK_TOKEN`

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MOTHERDUCK_TOKEN` | Yes | — | MotherDuck access token (used as the Postgres password) |
| `OPENBAO_TOKEN` | Self-hosted OpenBao | — | Token for reading secrets from your OpenBao server |
| `OPENBAO_ADDR` | Self-hosted OpenBao | — | OpenBao server URL (for example `https://openbao.example.com:8200`) |
| `OPENBAO_MOUNT` | No | `secret` | KV mount name |
| `MOTHERDUCK_HOST` | No | `pg.us-east-1-aws.motherduck.com` | Postgres endpoint host (use EU host for EU orgs) |
| `MOTHERDUCK_DB` | No | `sample_data` | Database name |
| `PORT` | No | `3000` | HTTP port |

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
