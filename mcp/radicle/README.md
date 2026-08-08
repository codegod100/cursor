# Radicle MCP server

MCP tools for [Radicle](https://radicle.xyz) patches. Issues signing credentials automatically and opens patches — no merge, no env secrets.

## Tools

| Tool | Purpose |
|------|---------|
| `create_patch` | Open or update a patch on a repo with a `rad` remote (auto-issues creds) |
| `issue_device_key` | Explicitly create/load identity (optional — `create_patch` does this for you) |

## Prerequisites

| Tool | Purpose |
|------|---------|
| `rad` | Heartwood Radicle CLI |
| `git-remote-rad` | Usually bundled with `rad` |
| `git` ≥ 2.34 | Patch pushes |

Install Radicle: https://radicle.xyz

The target repo needs a `rad` remote (`rad remote add rad <rid>` or `rad clone`).

## Setup

```bash
cd mcp/radicle
npm install
npm run build
```

Cursor loads the server from [`.cursor/mcp.json`](../../.cursor/mcp.json).

### HTTP mode (mcp.boxd.sh)

```bash
cd mcp/host && npm install && npm start
```

Radicle MCP: `https://mcp.boxd.sh/radicle/mcp`

## Identity (automatic)

`create_patch` calls `resolveRadEnv()` internally. If no profile exists at `<workspace>/.radicle`, the MCP runs `rad auth` and stores the passphrase in `<rad_home>/.mcp-passphrase`. No `RAD_HOME` / `RAD_PASSPHRASE` env secrets needed.

Opening patches does **not** require delegate status — anyone with a Radicle identity can propose. Delegates only matter for merging to canonical branches.

## `create_patch`

| Argument | Purpose |
|----------|---------|
| `title` | Patch title (required) |
| `repo` | Repo path (default: git root) |
| `body` | Patch description |
| `branch` | Branch to create/checkout |
| `commit` | Stage all, commit, then push |
| `patch_id` | Update existing patch |
| `draft` | Open as draft |
| `dry_run` | Print planned git push |

Returns `patch_id`, `patch_url`, and `did` when a new identity was issued.

## Example

```text
create_patch { title: "Fix parsing", commit: "Fix parsing" }
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `CURSOR_WORKSPACE` | Workspace root for default `.radicle` path |
| `RAD_HOME` | Optional override |
| `RAD_PASSPHRASE` | Optional override |
