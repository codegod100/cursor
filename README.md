# cursor

Personal Cursor IDE materials: Agent Skills, sticker-icon aesthetic, and related assets.

## Layout

```
.cursor/skills/     # project skills (loaded when this repo is open)
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

## Global install

Project skills only load in this workspace. To use them everywhere:

```bash
./scripts/install-global.sh
```

This symlinks each skill into `~/.cursor/skills/`.

## Assets

- `assets/terminal-icon.png` — `>_` exemplar
- `assets/cursor-icon.png` — Cursor cube exemplar
