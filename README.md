# cursor

Personal Cursor IDE materials: Agent Skills, sticker-icon aesthetic, and related assets.

## Layout

```
.cursor/skills/     # project skills (loaded when this repo is open)
.cursor/mcp.json    # MCP server config (Radicle)
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

## MCP servers

| Server | Path | Tools |
|--------|------|-------|
| `radicle` | `mcp/radicle/` | `issue_device_key`, `create_patch`, `get_repo_rid`, `set_repo_rid`, `rad_self` |

Build: `cd mcp/radicle && npm install && npm run build`. Requires the `rad` CLI on `PATH`.

### Hosted (boxd)

```bash
bash scripts/setup-boxd.sh
```

Serves Streamable HTTP MCP at `https://radicle.boxd.sh/mcp` (port 8000 on the VM).

## Global install

Project skills only load in this workspace. To use them everywhere:

```bash
./scripts/install-global.sh
```

This symlinks each skill into `~/.cursor/skills/`.

## Assets

- `assets/terminal-icon.png` — `>_` exemplar
- `assets/cursor-icon.png` — Cursor cube exemplar
