# radicle-garden-mcp

MCP server for [radicle.garden](https://radicle.garden) with reverse-engineered Buildkite integration APIs, plus Buildkite org/cluster discovery so you don't have to copy UUIDs from the Buildkite UI.

> **Unofficial.** This talks to the same SvelteKit form actions the dashboard uses. It may break if radicle.garden changes its web API.

## Quick start

```bash
cd radicle-garden-mcp
npm install
npm run build
```

### Cursor MCP config (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "radicle-garden": {
      "command": "node",
      "args": ["/absolute/path/to/radicle-garden-mcp/dist/index.js"],
      "env": {
        "RADICLE_GARDEN_EMAIL": "you@example.com",
        "RADICLE_GARDEN_PASSWORD": "your-password",
        "BUILDKITE_API_TOKEN": "bkua_..."
      }
    }
  }
}
```

Or paste a browser session cookie instead of email/password:

```json
"RADICLE_GARDEN_SESSION": "session=...; other=..."
```

Get it from DevTools → Application → Cookies → `radicle.garden` after logging in.

### Cloud Agent / OpenBao shortcut

If `OPENBAO_TOKEN` is already a Cursor environment secret (as in `codegod100/cursor`), the MCP **auto-hydrates** on startup:

| Cursor secret (optional) | OpenBao source |
|--------------------------|----------------|
| `BUILDKITE_API_TOKEN` | `secret/data/ai-api-keys` → `BUILDKITE_API_KEY` |
| `RADICLE_GARDEN_EMAIL` | `secret/data/passwords` (radicle.garden) → `username` |
| `RADICLE_GARDEN_PASSWORD` | same entry → `password` |

You only need dedicated Cursor secrets if you want values persisted without OpenBao at runtime.

To print values for manual paste into the Cursor Secrets UI:

```bash
OPENBAO_TOKEN=... ./scripts/print-radicle-mcp-secrets.sh
```

Cursor has no public API to write environment secrets programmatically.

### One-shot setup

Ask Cursor:

> Use `setup_buildkite_integration` for repo `rad:z…` and pick the "Production" cluster.

## MCP tools

| Tool | Description |
|------|-------------|
| `radicle_login` | Email/password login; returns session cookie |
| `radicle_get_buildkite_config` | Read saved config for a repo |
| `radicle_save_buildkite` | Save org slug, cluster ID, token |
| `radicle_verify_buildkite` | Verify token + org (dashboard Verify button) |
| `radicle_remove_buildkite` | Remove integration |
| `buildkite_list_organizations` | List orgs for a Buildkite token |
| `buildkite_list_clusters` | List clusters (with UUIDs) for an org |
| `setup_buildkite_integration` | Discover + save in one call |

## Reverse-engineered HTTP API

radicle.garden is a **SvelteKit** app. Integrations are **not** a separate REST API — they're SvelteKit **form actions** on:

```
/repos/{rid}/integrations
```

### Authentication

- **Session cookie** from a normal browser login (`Set-Cookie` on successful `POST /login`).
- Programmatic login:

```bash
curl -s -X POST 'https://radicle.garden/login' \
  -H 'Origin: https://radicle.garden' \
  -H 'Accept: application/json' \
  -H 'x-sveltekit-action: true' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'email=you@example.com&password=secret' \
  -c cookies.txt -D -
```

Failed login returns:

```json
{"type":"failure","status":401,"data":"[{\"email\":1,\"errors\":2},\"you@example.com\",{\"general\":3},\"That's the wrong username or password\"]"}
```

### Required headers for all actions

| Header | Value |
|--------|-------|
| `Origin` | `https://radicle.garden` |
| `Referer` | Page URL (e.g. integrations page) |
| `Accept` | `application/json` |
| `x-sveltekit-action` | `true` |
| `Content-Type` | `application/x-www-form-urlencoded` |
| `Cookie` | Session cookie |

Without `Origin`, SvelteKit returns **403** `Cross-site POST form submissions are forbidden`.

### Read config — `GET /repos/{rid}/integrations/__data.json?tab=buildkite`

Returns SvelteKit page data (nested). Look for:

```json
{
  "configured": true,
  "orgSlug": "my-org",
  "clusterId": "42f1a7da-812d-4430-93bc-1cc7c33a6bcf",
  "context": "garden-broker/buildkite",
  "publicPipeline": false
}
```

The API token is **never** returned to the client.

Unauthenticated → `{"type":"redirect","location":"/login"}`.

### Save — `POST /repos/{rid}/integrations?/saveBuildkite`

Form fields:

| Field | Required | Notes |
|-------|----------|-------|
| `orgSlug` | yes | Buildkite org slug |
| `clusterId` | yes | Buildkite cluster UUID |
| `apiToken` | new configs | Blank on update = keep stored token |
| `context` | yes | Default: `garden-broker/buildkite` |
| `publicPipeline` | no | `true` or `false` |

Success: `{"type":"success", ...}`  
Failure: `{"type":"failure","status":400,"data":"[{\"error\":1},\"message here\"]"}`

### Verify — `POST /repos/{rid}/integrations?/verifyBuildkite`

| Field | Notes |
|-------|-------|
| `orgSlug` | Optional if already saved |
| `apiToken` | Optional if already saved |

Server checks `GET https://api.buildkite.com/v2/organizations/{orgSlug}` with the token.

### Remove — `POST /repos/{rid}/integrations?/removeBuildkite`

No body fields. Deletes config and removes the `buildkite` repo trigger.

### Buildkite token scopes

Radicle's adapter needs:

- `read_pipelines`, `write_pipelines`
- `read_builds`, `write_builds`

For discovery via this MCP, also add:

- `read_organizations` (list orgs)
- `read_clusters` (list cluster UUIDs)

## Environment variables

| Variable | Purpose |
|----------|---------|
| `RADICLE_GARDEN_EMAIL` | Login email |
| `RADICLE_GARDEN_PASSWORD` | Login password |
| `RADICLE_GARDEN_SESSION` | Browser session cookie (alternative to email/password) |
| `RADICLE_GARDEN_BASE_URL` | Override base URL (default `https://radicle.garden`) |
| `BUILDKITE_API_TOKEN` | Default token for Buildkite discovery tools |

## Repo requirement

Your Radicle repo still needs a pipeline file (e.g. `.buildkite/pipeline.yml`) at the commit you want CI for. The dashboard integration only wires Radicle → Buildkite; it doesn't define build steps.
