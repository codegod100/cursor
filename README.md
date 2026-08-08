# cursor

Personal Cursor IDE materials: Agent Skills, sticker-icon aesthetic, and related assets.

## Layout

```
.cursor/skills/     # project skills (loaded when this repo is open)
.buildkite/         # Buildkite pipeline (CI → open rad patch)
radicle-garden-mcp/ # MCP for radicle.garden Buildkite integration setup
assets/             # reference icons / design exemplars
scripts/            # install helpers + buildkite-open-rad-patch.sh
```

## Skills

| Skill | Purpose |
|-------|---------|
| `sticker-icons` | Flat ink/cream blob icons for `.desktop` / app marks |
| `cursor-agent` | Delegate coding tasks to the `cursor-agent` CLI as a subagent |
| `incubation-graduate` | Migrate incubated monorepo subprojects to standalone GitHub repos |
| `rad-patch` | Open or update Radicle patches from local git changes |

## Buildkite → Radicle patch

Push a branch to your **rad** remote → Buildkite CI runs → on success a patch is opened on that repo.

1. Copy `.buildkite/pipeline.yml` into your rad-enabled repo (or use this repo on rad).
2. Wire Buildkite on [radicle.garden](https://radicle.garden) (see `radicle-garden-mcp/`).
3. Push a wip branch, not `refs/patches`:

   ```bash
   git push rad my-feature:refs/heads/wip/my-feature
   ```

Details: `.cursor/skills/rad-patch/SKILL.md` (Buildkite section).

## Global install

Project skills only load in this workspace. To use them everywhere:

```bash
./scripts/install-global.sh
```

This symlinks each skill into `~/.cursor/skills/`.

## Assets

- `assets/terminal-icon.png` — `>_` exemplar
- `assets/cursor-icon.png` — Cursor cube exemplar
