---
name: incubation-graduate
description: >-
  Graduate an incubated project from a monorepo subdirectory into its own
  GitHub repository. Use when the user asks to migrate, graduate, spin out,
  or publish an incubated project to its own repo (e.g. hive/ → codegod100/hive),
  create a standalone repo from a monorepo folder, or move a project out of
  codegod100/cursor or similar incubators.
---

# Incubation Graduate

Move a project incubated as a subdirectory (e.g. `hive/`) into a dedicated
GitHub repo under `codegod100/<name>`. Based on the hive migration workflow.

## When to use

- Project has matured in a monorepo (`cursor`, `blank`, etc.) and needs its own repo
- User says: "migrate to its own repo", "graduate", "spin out", "publish as standalone"
- CI, secrets, and deploy hooks should target the new repo root — not `subdir/**`

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| `GH_TOKEN` | Fine-grained or PAT with `repo` + Actions secrets write. OpenBao: `secret/data/ai-api-keys` → `GH_TOKEN` |
| `OPENBAO_TOKEN` | Optional; used to read keys for secret sync |
| Project path | e.g. `hive/` relative to monorepo root |
| Target repo | `codegod100/<project>` — create if missing |

Cloud-agent `gh` often lacks `createRepository` / `actions:write`. Use the scripts
below (GitHub API + `GH_TOKEN`) instead of `gh repo create` / `gh secret set`.

## Workflow

### 1. Prepare the standalone tree

In the incubated subdirectory, fix anything that assumes monorepo layout:

| Check | Action |
|-------|--------|
| GitHub Actions `paths:` filters | Remove `project/**` — workflows run at repo root |
| `cd project && …` in workflows | Drop the `cd`; scripts run from checkout root |
| `REPO_URL` / clone defaults | Point to `https://github.com/codegod100/<project>.git` |
| `scripts/publish-repo.sh` | Delete — obsolete after graduation |
| `scripts/sync-*-gh-secret.sh` | Default repo arg → `codegod100/<project>` |
| README | Remove "monorepo" / `cd project` instructions; link to new repo URL |
| `.venv/`, `.git/` | Exclude from export |

Copy to a clean export dir (no `.venv`, no nested `.git`):

```bash
proj=hive
tmpdir=$(mktemp -d)
tar -C "$proj" -cf - --exclude=.venv --exclude=.git . | tar -C "$tmpdir" -xf -
```

### 2. Create the GitHub repository

```bash
.cursor/skills/incubation-graduate/scripts/create-gh-repo.sh \
  codegod100/hive "Distributed hive orchestrator"
```

Idempotent: no-op if the repo already exists.

### 3. Push initial `main`

```bash
cd "$tmpdir"
git init -b main
git config user.email "…" && git config user.name "…"
git add -A && git commit -m "feat: initial standalone import from incubator"
# Use GH_TOKEN in remote URL when gh auth lacks push scope:
git remote add origin "https://x-access-token:${GH_TOKEN}@github.com/codegod100/hive.git"
git push -u origin main
```

### 4. Sync GitHub Actions secrets

Map OpenBao keys → repo secrets (customize per project):

| Secret | OpenBao key (typical) |
|--------|------------------------|
| `BOXD_TOKEN` | `BOXD_API_KEY` |
| `CURSOR_API_KEY` | `CURSOR_API_KEY` |
| `GH_TOKEN` | `GH_TOKEN` |
| `PRIME_API_KEY` | `PRIME_API_KEY` or `OPENCODE_API_KEY` |

```bash
.cursor/skills/incubation-graduate/scripts/sync-gh-secrets.sh \
  codegod100/hive BOXD_TOKEN CURSOR_API_KEY GH_TOKEN PRIME_API_KEY
```

Keys are read from `OPENBAO_ADDR` + `OPENBAO_TOKEN` → `secret/data/ai-api-keys`.
Override mapping with env: `SECRET_MAP='BOXD_TOKEN=BOXD_API_KEY,CUSTOM=OTHER_KEY'`.

### 5. Clean up the incubator

On a branch in the monorepo (e.g. `cursor/<project>-graduate-8452`):

```bash
git rm -rf hive/
git commit -m "chore: graduate hive to github.com/codegod100/hive"
git push
```

Close the incubator PR with a link to the new repo. Do **not** leave a stale
`project/` tree in the monorepo.

### 6. Post-graduation checks

```bash
# Repo exists and CI runs
curl -fsS "https://api.github.com/repos/codegod100/hive" | jq .html_url

# Secrets present (names only)
GH_TOKEN=… curl -fsS -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/codegod100/hive/actions/secrets" | jq '.secrets[].name'

# Deploy / provision workflow targets repo root (no subdir)
grep -r 'cd hive' .github/ && echo "FIX: remove monorepo cd" || true
```

## One-shot orchestrator

When `GH_TOKEN` and `OPENBAO_TOKEN` are set:

```bash
.cursor/skills/incubation-graduate/scripts/graduate-project.sh \
  --project hive \
  --org codegod100 \
  --description "Distributed hive orchestrator" \
  --secrets BOXD_TOKEN,CURSOR_API_KEY,GH_TOKEN,PRIME_API_KEY
```

Dry-run: add `--dry-run`. Skips monorepo cleanup (step 5) — run that manually on
the incubator branch after review.

## Boxd / deploy follow-up

If the project uses boxd (see `boxd-setup-deploy` skill):

1. Ensure `BOXD_TOKEN` secret is valid (expired keys fail silently at provision)
2. Run `scripts/setup-boxd.sh` from the **new** repo root
3. Deploy webhook lives at `hooks.<vm>.boxd.sh` — register via `enable-deploy.sh`
4. Workflow `deploy-boxd.yml` only verifies the hook; push deploy runs on-VM

## Naming conventions

| Item | Pattern |
|------|---------|
| Incubator branch | `cursor/<project>-graduate-8452` |
| Target repo | `codegod100/<project>` |
| VM name (boxd) | often same as project (`hive`) |
| Public URL | `https://<project>.boxd.sh` |

## Anti-patterns

- Leaving `project/` in the monorepo after migration
- Workflows with `paths: project/**` in the standalone repo
- Using cloud-agent `gh secret set` without checking for HTTP 403
- Copying `.venv/` or committing nested `.git/`
- Forgetting to rotate/sync secrets on the **new** repo (old repo secrets stay behind)

## Related

- `boxd-setup-deploy` — wire deploy-on-push after graduation
- `boxd-setup-golden` — provision golden VM for `*.boxd.sh`
- [codegod100/hive](https://github.com/codegod100/hive) — reference graduation
