# Friends

A [Lightspeed](https://hexdocs.pm/lightspeed/) Gleam app that signs you in with [OpenBao](https://openbao.org/) at `id.openbao.boxd`, lets you curate Bluesky handles, and exposes a unified Atom feed of their posts.

Live at **https://friends.boxd.sh** (SSH: `friends.boxd`).

## Features

- OpenBao OIDC login via `id.openbao.boxd`
- Add and remove Bluesky handles from a personal list
- Unified Atom feed at `/feed.atom` merged from the public Bluesky API
- Lightspeed live-rendered dashboard with Wisp + Mist HTTP server

## Requirements

- Gleam 1.16+
- Erlang/OTP 27+ (required by `gleam_json` 3.x)
- An OpenBao OIDC client registered for this app

## Configuration

Copy `.env.example` to `.env` and set the values:

| Variable | Description |
| --- | --- |
| `FRIENDS_OIDC_CLIENT_ID` | OpenBao OIDC client id |
| `FRIENDS_OIDC_CLIENT_SECRET` | OpenBao OIDC client secret |
| `FRIENDS_BASE_URL` | Public URL of this app (default `https://friends.boxd.sh`) |
| `FRIENDS_OIDC_REDIRECT_URI` | OAuth callback URL (default `{FRIENDS_BASE_URL}/auth/callback`) |
| `FRIENDS_OIDC_ISSUER` | OpenBao provider issuer (default `https://id.openbao.boxd/v1/identity/oidc/provider/default`) |
| `FRIENDS_SECRET_KEY_BASE` | Cookie signing secret |
| `FRIENDS_PORT` | HTTP port (default `8000`, boxd proxy default) |
| `FRIENDS_DATA_PATH` | JSON file for handle storage (default `data/handles.json`) |

Register your OpenBao OIDC client with redirect URI `https://friends.boxd.sh/auth/callback`.

## Run locally

```bash
cp .env.example .env
# edit .env — set FRIENDS_BASE_URL=http://localhost:8000 for local dev
export $(grep -v '^#' .env | xargs)
mise install
gleam run
```

Open `http://localhost:8000`, sign in, add handles like `jay.bsky.social`, then subscribe to `/feed.atom`.

## Deploy to boxd

1. Create the GitHub repo `codegod100/friends` and push this tree:

   ```bash
   gh repo create codegod100/friends --public
   ./scripts/push-friends-repo.sh main
   ```

2. Authenticate the boxd CLI:

   ```bash
   boxd auth login
   ```

3. Copy `.env.example` to `.env`, fill in production secrets, then provision:

   ```bash
   ./scripts/provision-boxd.sh
   ```

The script creates a VM named `friends`, installs Erlang/Gleam via mise, clones the repo, installs a systemd unit, and points the boxd HTTPS proxy at port 8000.

Public URL: **https://friends.boxd.sh**

## Development

```bash
gleam test
gleam build
```

## Architecture

- `src/friends.gleam` — entrypoint and Mist server
- `src/friends/app.gleam` — Lightspeed endpoint and route dispatch
- `src/friends/auth.gleam` — OpenBao OIDC authorization code flow
- `src/friends/store.gleam` — per-user handle persistence
- `src/friends/bluesky.gleam` — Bluesky public API client
- `src/friends/feed.gleam` — Atom feed builder
