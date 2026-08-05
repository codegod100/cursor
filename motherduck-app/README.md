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
```

Put your MotherDuck token on disk:

```bash
echo 'your-token-here' > .motherduck-token
chmod 600 .motherduck-token
```

Or set `MOTHERDUCK_TOKEN` in `.env`.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Secrets

The app loads the MotherDuck token in this order:

1. `MOTHERDUCK_TOKEN` environment variable
2. Token file (default: `.motherduck-token`)
3. OpenBao KV fetch using `OPENBAO_TOKEN` + `OPENBAO_ADDR`, then writes the token to disk

### OpenBao (Cursor dashboard)

If `MOTHERDUCK_TOKEN` is stored in OpenBao:

1. `OPENBAO_TOKEN` is injected automatically in Cloud Agents
2. Also add `OPENBAO_ADDR` as a Cursor secret, **or** create `motherduck-app/.openbao-addr` containing your OpenBao URL
3. On startup the app fetches `secret/data/MOTHERDUCK_TOKEN` (and an environment-scoped path when available) and saves it to `.motherduck-token`

Fetch manually:

```bash
npm run secrets:fetch
npm run secrets:check
curl http://localhost:3000/api/health
```

### Local development

Set `MOTHERDUCK_TOKEN` in `.env`, or put the token in `.motherduck-token`.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MOTHERDUCK_TOKEN` | No* | — | MotherDuck access token (used as the Postgres password) |
| `MOTHERDUCK_TOKEN_FILE` | No | `.motherduck-token` | Path to a file containing the token |
| `OPENBAO_TOKEN` | OpenBao path | — | Token for reading secrets from OpenBao |
| `OPENBAO_ADDR` | OpenBao path | — | OpenBao server URL (or use `.openbao-addr` file) |
| `OPENBAO_MOUNT` | No | `secret` | KV mount name |
| `MOTHERDUCK_HOST` | No | `pg.us-east-1-aws.motherduck.com` | Postgres endpoint host (use EU host for EU orgs) |
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
