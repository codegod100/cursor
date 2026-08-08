---
name: radicle
description: >-
  Work with Radicle — a peer-to-peer code collaboration protocol. Use when the
  user asks to initialize a Radicle repo, clone from Radicle, create or review
  patches, manage issues, start the node, seed or sync repositories, or mentions
  RIDs, DIDs, patches, seeding, or peer-to-peer collaboration. For opening
  patches from local changes, prefer the rad-patch skill or create_patch MCP tool.
---

# Radicle

Radicle is a decentralized, peer-to-peer code collaboration protocol built on
Git. It enables sovereign code hosting using cryptographic identities and a
gossip-based network.

Upstream inspiration: [rad-skill](https://radicle.network/nodes/iris.radicle.network/rad%3AzvBj4kByGeQSrSy2c4H7fyK42cS8)
(`rad:zvBj4kByGeQSrSy2c4H7fyK42cS8`) — a Claude Code plugin marketplace for
Radicle.

## Cursor integration

| Layer | Path | Purpose |
|-------|------|---------|
| MCP `create_patch` | `mcp/radicle/` | Open or update patches (auto-issues device key) |
| MCP `issue_device_key` | `mcp/radicle/` | Explicitly create/load signing identity |
| `rad-patch` skill | `.cursor/skills/rad-patch/` | Scriptable patch workflow with `patch.message` push options |
| This skill | `.cursor/skills/radicle/` | General Radicle CLI knowledge and workflows |

Prefer MCP `create_patch` or the `rad-patch` script for non-interactive patch
opens — they set `patch.message` push options so no editor is required.

## Core concepts

- **RID** (Repository ID): Globally unique URN, e.g. `rad:z31hE1wco9132nedN3mm5qJjyotna`
- **NID** (Node ID): Device identifier on the network
- **DID** (Decentralized Identifier): Self-sovereign identity, e.g. `did:key:z6Mkhp7VU...`
- **Delegates**: Maintainers who can sign and manage repository metadata
- **Seeding**: Hosting/replicating a repository across the network
- **Patches**: Git-based collaborative objects (like pull requests) with revision history

## Quick reference

| Task | Command |
|------|---------|
| Check identity | `rad self` |
| Current repo RID | `rad .` |
| Node status | `rad node status` |
| Initialize repo | `rad init --name "name" --description "desc" --public --no-confirm` |
| Clone | `rad clone rad:<RID>` |
| Create patch | `git push rad HEAD:refs/patches` (set description with `rad patch edit`) |
| Update patch | `git push --force` (on patch branch) |
| List patches | `rad patch list` (also `--all`/`--merged`/`--draft`/`--archived`) |
| Show patch | `rad patch show <PATCH_ID>` (`--patch` to include diff) |
| Checkout patch | `rad patch checkout <PATCH_ID>` |
| Review patch | `rad patch review <PATCH_ID> --accept` / `--reject` |
| Merge patch | `git checkout main && git merge <branch> && git push rad main` |
| List issues | `rad issue list` (also `--all`/`--closed`/`--solved`/`--assigned`) |
| Open issue | `rad issue open --title "title" --description "desc" --labels "bug ux"` |
| Show issue | `rad issue show <ISSUE_ID>` |
| Comment on issue | `rad issue comment <ISSUE_ID> --message "text"` |
| Close issue | `rad issue state <ISSUE_ID> --closed` (also `--open`/`--solved`) |
| Label issue | `rad issue label <ISSUE_ID> --add <label>` / `--delete <label>` |
| Start node | `rad node start` |
| Sync | `rad sync --announce` |
| Fetch updates | `rad sync --fetch` |
| Add remote | `rad remote add <NID> --name <alias>` |
| Seed repo | `rad seed rad:<RID>` |

## Multiline text (heredoc)

Prose flags (`--description`, `--message`, `-m`, `--title`) take multiline values
via a quoted heredoc — no editor needed. Quote the delimiter (`'EOF'`) so `$`
and backticks stay literal:

```bash
rad issue open --title "Title" --labels discussion --description "$(cat <<'EOF'
First paragraph.

- point one
EOF
)"
```

Patches are the exception: push options must not contain newlines. Push to open
the patch, then set the description with `rad patch edit`:

```bash
git push rad HEAD:refs/patches
rad patch edit <PATCH_ID> -m "$(cat <<'EOF'
Patch title

Body, independent of the commit message.
EOF
)"
```

## Flag gotchas

- List filters are boolean flags, not `--state`: `rad issue list --closed`, `rad patch list --merged`.
- Add/remove is `--add`/`--delete` (not `--remove`) for `issue label`, `issue assign`, `patch label`, `patch assign`.
- `rad issue open` takes `--labels` and `--assignees` (space-separated) at creation time.
- `rad patch comment` takes a REVISION_ID, not a patch ID.

See `references/commands.md` for the full verified flag list.

## Key workflows

### Contribute to a project

1. `rad clone rad:<RID>`
2. `git checkout -b feature-branch`
3. Make changes, commit
4. Open patch via MCP `create_patch`, `rad-patch` script, or `git push rad HEAD:refs/patches`
5. Address feedback: `git push --force`

### Review and merge

1. `rad patch list` to see open patches
2. `rad patch show <ID>` or `rad patch checkout <ID>`
3. `git checkout main && git merge <branch>`
4. `git push rad main` (marks patch as merged)

### Private repository

1. `rad init --private`
2. `rad id update --allow <DID>` to grant access
3. `rad id update --disallow <DID>` to revoke

### Mirror to GitHub

If the repo has a GitHub remote, push to both: `git push rad main && git push github main`. See `references/github-mirror.md` for automation setup.

## Troubleshooting

**Node not running**: Run `rad node start`, then `rad node status` to verify.

**Sync issues**: Run `rad sync --fetch` then `rad sync status`.

**Identity problems**: Run `rad self` to check, `rad auth` to re-authenticate.

**Node status symbols**: `✓` connected, `!` attempted, `✗` disconnected, `↗` outbound, `↘` inbound.

**NAT/firewall**: "Not configured to listen for inbound connections" is normal. The node still connects outbound and participates fully.

## Prerequisites

```bash
rad --version          # Check installation
rad self               # Check identity
rad node status        # Check node
```

Install: https://radicle.xyz/install or `curl -sSLf https://radicle.xyz/install | sh`

In this workspace, `bash scripts/prep.sh` installs the CLI and builds the MCP server.

If no identity: `rad auth --alias "name"` with `RAD_PASSPHRASE` set, or use MCP `issue_device_key`.
