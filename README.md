# Friends

A [Lightspeed](https://hexdocs.pm/lightspeed/) Gleam app that signs you in with [Pocket ID](https://pocket-id.org/) at `id.openbao.boxd.sh`, lets you curate Bluesky handles, and exposes a unified Atom feed of their posts.

Live at **https://friends.boxd.sh** (SSH: `friends.boxd`).

## Features

- Pocket ID OIDC login via `id.openbao.boxd.sh`
- Add and remove Bluesky handles from a personal list
- Unified Atom feed at `/feed.atom` merged from the public Bluesky API
- Lightspeed live-rendered dashboard with Wisp + Mist HTTP server

## Requirements

- Gleam 1.16+
- Erlang/OTP 27+ (required by `gleam_json` 3.x)
- A Pocket ID OIDC client registered for this app

## Configuration

Copy `.env.example` to `.env` and set the values:

| Variable | Description |
| --- | --- |
| `FRIENDS_OIDC_CLIENT_ID` | Pocket ID OIDC client id |
| `FRIENDS_OIDC_CLIENT_SECRET` | Pocket ID OIDC client secret |
| `FRIENDS_BASE_URL` | Public URL of this app (default `https://friends.boxd.sh`) |
| `FRIENDS_OIDC_REDIRECT_URI` | OAuth callback URL (default `{FRIENDS_BASE_URL}/auth/callback`) |
| `FRIENDS_OIDC_ISSUER` | Pocket ID issuer (default `https://id.openbao.boxd.sh`) |
| `FRIENDS_SECRET_KEY_BASE` | Cookie signing secret |
| `FRIENDS_PORT` | HTTP port (default `8000`, boxd proxy default) |
| `FRIENDS_DATA_PATH` | JSON file for handle storage (default `data/handles.json`) |

Production secrets also live in OpenBao at `secret/friends/production`.

## Run locally

```bash
cp .env.example .env
# edit .env — set FRIENDS_BASE_URL=http://localhost:8000 for local dev
set -a && source .env && set +a
mise install
gleam run
```

Open `http://localhost:8000`, sign in, add handles like `jay.bsky.social`, then subscribe to `/feed.atom`.

## Deploy to boxd

```bash
boxd auth login
./scripts/provision-boxd.sh
```

Public URL: **https://friends.boxd.sh**

## Development

```bash
gleam test
gleam build
```

## Architecture

- `src/friends.gleam` — entrypoint and Mist server
- `src/friends/app.gleam` — Lightspeed endpoint and route dispatch
- `src/friends/auth.gleam` — Pocket ID OIDC authorization code flow
- `src/friends/store.gleam` — per-user handle persistence
- `src/friends/bluesky.gleam` — Bluesky public API client
- `src/friends/feed.gleam` — Atom feed builder
