# GitHub Mirror Setup

## Check for existing GitHub remote

```bash
git remote -v | grep github
```

## Manual sync

```bash
git push rad main && git push github main
```

## Automatic sync with post-commit hook

Create `.git/hooks/post-commit`:

```bash
#!/bin/sh
# Auto-push to Radicle and mirror to GitHub after each commit

export PATH="$HOME/.radicle/bin:$PATH"
git push rad main 2>/dev/null || true
git push github main 2>/dev/null || true
```

Make executable: `chmod +x .git/hooks/post-commit`

## New project without GitHub

```bash
git remote add github https://github.com/username/repo.git
git push -u github main
```

Note: Radicle remains the source of truth for patches and issues. GitHub serves as a read-only mirror for discoverability.
