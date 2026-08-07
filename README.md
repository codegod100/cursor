# cursor

Personal Cursor IDE materials: Agent Skills, sticker-icon aesthetic, and related assets.

## Layout

```
.cursor/skills/     # project skills (loaded when this repo is open)
assets/             # reference icons / design exemplars
scripts/            # install helpers
erl-irc/            # incubated: IRC wire protocol over streams + erl_dist
```

## Skills

| Skill | Purpose |
|-------|---------|
| `sticker-icons` | Flat ink/cream blob icons for `.desktop` / app marks |
| `cursor-agent` | Delegate coding tasks to the `cursor-agent` CLI as a subagent |
| `incubation-graduate` | Migrate incubated monorepo subprojects to standalone GitHub repos |

## Incubated projects

| Path | Purpose |
|------|---------|
| [`erl-irc/`](erl-irc/) | IRC as a transport-agnostic wire protocol; carriers include CRLF byte streams and [`erl_dist`](https://docs.rs/erl_dist) over TCP or QUIC |

## Global install

Project skills only load in this workspace. To use them everywhere:

```bash
./scripts/install-global.sh
```

This symlinks each skill into `~/.cursor/skills/`.

## Assets

- `assets/terminal-icon.png` — `>_` exemplar
- `assets/cursor-icon.png` — Cursor cube exemplar
