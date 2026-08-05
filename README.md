# Friends

A [Lightspeed](https://hexdocs.pm/lightspeed/) Gleam app that signs you in with [OpenBao](https://openbao.org/) at `id.openbao.boxd`, lets you curate Bluesky handles, and exposes a unified Atom feed of their posts.

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

Copy `.env.example` and export the variables (or pass them when running):

| Variable | Description |
| --- | --- |
| `FRIENDS_OIDC_CLIENT_ID` | OpenBao OIDC client id |
| `FRIENDS_OIDC_CLIENT_SECRET` | OpenBao OIDC client secret |
| `FRIENDS_BASE_URL` | Public URL of this app (default `http://localhost:8080`) |
| `FRIENDS_OIDC_REDIRECT_URI` | OAuth callback URL (default `{FRIENDS_BASE_URL}/auth/callback`) |
| `FRIENDS_OIDC_ISSUER` | OpenBao provider issuer (default `https://id.openbao.boxd/v1/identity/oidc/provider/default`) |
| `FRIENDS_SECRET_KEY_BASE` | Cookie signing secret |
| `FRIENDS_PORT` | HTTP port (default `8080`) |
| `FRIENDS_DATA_PATH` | JSON file for handle storage (default `data/handles.json`) |

Register your OpenBao OIDC client with a redirect URI matching `FRIENDS_OIDC_REDIRECT_URI`.

## Run locally

```bash
export FRIENDS_OIDC_CLIENT_ID=your-client-id
export FRIENDS_OIDC_CLIENT_SECRET=your-client-secret
gleam run
```

Open `http://localhost:8080`, sign in, add handles like `bsky.app` or `jay.bsky.social`, then subscribe to `/feed.atom` in your feed reader.

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
