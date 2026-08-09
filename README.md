# cursor

Personal Cursor IDE materials: Agent Skills, sticker-icon aesthetic, and related assets.

## Layout

```
.cursor/skills/     # project skills (loaded when this repo is open)
.cursor/mcp.json    # MCP server config (Radicle, local stdio)
mcp/host/           # Shared HTTP host for mcp.boxd.sh
mcp/radicle/        # Radicle MCP server (device keys + patches)
assets/             # reference icons / design exemplars
scripts/            # install helpers
```

## Skills

| Skill | Purpose |
|-------|---------|
| `sticker-icons` | Flat ink/cream blob icons for `.desktop` / app marks |
| `cursor-agent` | Delegate coding tasks to the `cursor-agent` CLI as a subagent |
| `incubation-graduate` | Migrate incubated monorepo subprojects to standalone GitHub repos |
| `rad-patch` | Open or update Radicle patches from local git changes |
| `boxci-github-patch` | Ask boxci to open a Radicle patch from a GitHub commit |

## MCP servers

| Server | Path | Tools |
|--------|------|-------|
| `radicle` | `mcp/radicle/` | `issue_device_key`, `create_patch`, `get_repo_rid`, `set_repo_rid`, `rad_self` |

Build: `cd mcp/radicle && npm install && npm run build`. Requires the `rad` CLI on `PATH`.

### Hosted (boxd)

```bash
bash scripts/setup-boxd.sh
```

Shared MCP host at `https://mcp.boxd.sh` with Radicle at `/radicle/mcp`.

## Global install

Project skills only load in this workspace. To use them everywhere:

```bash
./scripts/install-global.sh
```

This symlinks each skill into `~/.cursor/skills/`.

## Assets

- `assets/terminal-icon.png` — `>_` exemplar
- `assets/cursor-icon.png` — Cursor cube exemplar
