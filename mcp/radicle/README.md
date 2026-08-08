# Radicle MCP server

MCP tools for [Radicle](https://radicle.xyz) device identities and patches. Thin wrapper over the Heartwood `rad` CLI and the [`rad-patch`](../../.cursor/skills/rad-patch/) skill scripts.

## Prerequisites

| Tool | Purpose |
|------|---------|
| `rad` | Heartwood Radicle CLI |
| `git-remote-rad` | Usually bundled with `rad` |
| `git` ≥ 2.34 | Patch pushes |
| `bash` | Runs `create-patch.sh` |

Install Radicle: https://radicle.xyz

## Setup

```bash
cd mcp/radicle
npm install
npm run build
```

Cursor loads the server from [`.cursor/mcp.json`](../../.cursor/mcp.json). Rebuild after TypeScript changes.

### HTTP mode (boxd / remote)

```bash
cd mcp/radicle
npm run start:http
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RADICLE_MCP_PORT` | `8000` | Listen port |
| `RADICLE_MCP_HOST` | `0.0.0.0` | Bind address |
| `RADICLE_MCP_ALLOWED_HOSTS` | `radicle.boxd.sh,localhost` | DNS rebinding allowlist |

Endpoints: `GET /health`, `POST /mcp` (Streamable HTTP, stateless).

### Deploy to radicle.boxd.sh

From a machine with `boxd` and `gh` authenticated:

```bash
bash scripts/setup-boxd.sh
# optional: RAD_PASSPHRASE=… for the VM's rad identity
```

This provisions the `radicle` boxd VM, installs the Radicle CLI + Node deps, and runs the MCP over HTTP at `https://radicle.boxd.sh/mcp`.

## Tools

### `issue_device_key`

Create a Radicle device identity scoped to an environment via `RAD_HOME`.

| Argument | Description |
|----------|-------------|
| `alias` | Node alias (required) |
| `env_name` | Scope keys to `<workspace>/.radicle/<env_name>` |
| `rad_home` | Override `RAD_HOME` path |
| `passphrase` | Key passphrase (generated if omitted) |
| `start_node` | Start `rad node --daemon` after auth |
| `force` | Re-issue even if identity exists |

Returns `did`, `env_setup` (`RAD_HOME`, `RAD_PASSPHRASE`), and a `delegate_hint` for adding the device to a repo.

**Cloud Agent:** store `RAD_HOME` and `RAD_PASSPHRASE` as environment secrets, then call `rad id update --delegate <did>` from a maintainer machine.

### `create_patch`

Open or update a patch on a repo with a `rad` remote. Wraps `.cursor/skills/rad-patch/scripts/create-patch.sh`.

| Argument | Description |
|----------|-------------|
| `title` | Patch title (required) |
| `repo` | Repo path (default: git root) |
| `body` | Patch description |
| `branch` | Branch to create/checkout |
| `commit` | Stage, commit, then push |
| `patch_id` | Update existing patch |
| `draft` | Open as draft |
| `env_name` / `rad_home` | Identity for signing |

### `get_repo_rid`

Return the Repository ID (RID) for a git repo.

| Argument | Description |
|----------|-------------|
| `repo` | Repo path (default: git root) |
| `env_name` / `rad_home` | Identity context |

Returns `rid`, `remote_url`, `payload` (name/description/branch), and `identity` document.

### `set_repo_rid`

Publish a new repo on Radicle or link to an existing RID.

| Argument | Description |
|----------|-------------|
| `rid` | Link to existing RID (`rad init --existing`). Omit to create new. |
| `name` / `description` | Metadata for new repos |
| `public` / `private` | Visibility for new repos |
| `set_upstream` | Track `rad/<default-branch>` (default true) |
| `seed_first` | Run `rad seed` before linking (default true) |
| `repo` | Repo path (default: git root) |

### `rad_self`

Show DID, alias, and config paths for the identity at `RAD_HOME`.

## Example flow

```text
1. issue_device_key { alias: "cloud-agent", env_name: "ci" }
2. Add returned DID as repo delegate (maintainer)
3. create_patch { title: "Fix parsing", env_name: "ci", commit: "Fix parsing" }
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `RAD_HOME` | Radicle home (keys, node, storage) |
| `RAD_PASSPHRASE` | Bypass ssh-agent for headless signing |
| `CURSOR_WORKSPACE` | Workspace root for default paths |
| `RAD_PATCH_SCRIPT` | Override path to `create-patch.sh` |
