---
name: rad-patch
description: >-
  Take local git changes and open or update a Radicle patch on a given
  repository. Use when the user asks to create a rad patch, propose changes on
  Radicle, push to refs/patches, open/update a Radicle changeset, or contribute
  via Radicle instead of GitHub PRs.
---

# Radicle patch

Open or update a **patch** (Radicle’s contribution unit) from commits in a
Radicle-enabled git repo. Patches are created by pushing to `refs/patches` on
the `rad` remote — not by opening a GitHub PR.

## When to use

- User has local edits or commits and wants them on Radicle
- User says: “create a rad patch”, “open a patch”, “push to radicle”
- Updating an existing patch after review feedback

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| `rad` CLI | Heartwood Radicle CLI (`rad --version`) |
| `git-remote-rad` | Usually bundled with `rad`; must be on `PATH` |
| `rad` remote | `git remote get-url rad` must exist in the target repo |
| Commits | Patch must contain commits **not** already on the base branch (`master` / `main`) |

Clone or init:

```bash
rad clone rad:z42hL2jL4XNk6K8oHQaSWfMgCL7ji/<rid> my-project
# or inside an existing repo:
rad remote add rad <rid>
```

Confirm login / node: `rad auth status` (or `rad node status`).

## Quick path (script)

From a checkout of this repo (or after `./scripts/install-global.sh`):

```bash
.cursor/skills/rad-patch/scripts/create-patch.sh \
  --repo /abs/path/to/rad-repo \
  --title "Fix option parsing" \
  --body "See commit for details." \
  --branch fix/option-parsing \
  --commit "Fix option parsing"
```

| Flag | Purpose |
|------|---------|
| `--repo` | Radicle git repo (default: git root of cwd) |
| `--title` | Patch title (`patch.message` first line) |
| `--body` | Patch description (second `patch.message`) |
| `--branch` | Create/checkout branch before commit |
| `--commit MSG` | Stage all changes, commit, then open patch |
| `--ref` | Commit/branch to push (default `HEAD`) |
| `--patch ID` | Update existing patch (sets upstream if needed) |
| `--base COMMIT` | Stack on another commit (`patch.base`) |
| `--draft` | Open as draft (`patch.draft`) |
| `--no-sync` | Skip seed sync (`no-sync`) |
| `--force` | Force-push amended commits |
| `--dry-run` | Print planned `git push` only |

The script uses `patch.message` push options so **no editor** is required (safe
for agents and CI).

## Manual workflow

### 1. Branch and commit

```bash
cd /path/to/rad-repo
git checkout -b fix/option-parsing
# … edit files …
git add -A && git commit -m "Fix option parsing"
```

### 2. Open patch

```bash
git push rad -o sync \
  -o patch.message="Fix option parsing" \
  -o patch.message="Optional longer description." \
  HEAD:refs/patches
```

Output includes a patch id (40-char hex) and often:

`https://app.radicle.xyz/nodes/…/rad:…/patches/<id>`

### 3. Inspect

```bash
rad patch show <patch-id-prefix>
rad patch list --open
```

### 4. Update after review

After amend or new commits on the same branch (upstream set automatically on open):

```bash
git commit --amend   # or new commits
git push -o sync -o patch.message="Address review" --force
```

If upstream was lost:

```bash
rad patch set <patch-id>
git push -o sync -o patch.message="Update" --force
```

### 5. Draft → ready

```bash
git push rad -o patch.draft -o patch.message="WIP" HEAD:refs/patches
rad patch ready <patch-id>
```

## Agent checklist

1. **Identify target repo** — path or `rad://` / `rad:` id; `cd` there or pass `--repo`.
2. **Ensure `rad` remote** — do not push to `origin` for Radicle patches.
3. **Commit or select ref** — empty patches (no new commits vs base) are rejected.
4. **Title + body** — always pass `--title` / `--body` or `-o patch.message=…` (never rely on `$EDITOR` in non-interactive runs).
5. **Report** — return patch id, `rad patch show` summary, and app URL if printed.
6. **Update vs open** — if continuing work on an existing patch, use `--patch` or `rad patch set` before push.

## Common errors

| Error | Fix |
|-------|-----|
| `patch commits are already included in the base branch` | Branch has no new commits vs `master`/`main`; add commits or rebase |
| `remote rejected` on update | Use `--force` after amend |
| `remote 'rad' missing` | `rad clone` or `rad remote add rad <rid>` |
| Editor hangs | Use `patch.message` options (script does this by default) |

## Related

- [Radicle patch man page](https://github.com/radicle-dev/heartwood/blob/master/rad-patch.1.adoc)
- `rad patch checkout <id>` — review someone else’s patch locally
- Merge (maintainer): `git checkout master && git merge patch/<id> && git push rad master`
