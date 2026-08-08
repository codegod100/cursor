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
