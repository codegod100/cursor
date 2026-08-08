# Radicle Command Reference

Accurate reference for `rad` CLI commands and their real flags (verified against rad 1.9.1). Use this instead of running `rad <cmd> --help`.

## Multiline text and quoting (read first)

Any flag that takes prose — `--description`, `--message`, `-m`, `--title` — accepts a multiline value. Use a quoted heredoc so shell expansion and special characters are safe:

```bash
rad issue open --title "Issue title" --description "$(cat <<'EOF'
First paragraph of the description.

- bullet one
- bullet two
EOF
)" --labels discussion
```

Notes:
- Quote the heredoc delimiter (`'EOF'`) to disable variable/backtick expansion inside the body.
- `--labels` and `--assignees` take space-separated values: `--labels "bug ux"`.
- For commands that accept `-m`/`--message` multiple times (patches), each occurrence becomes a separate line; the first is the title. See patch sections below.
- Most write commands accept `--no-announce` to skip gossiping the change, and `-q`/`--quiet` to suppress output.

## Issue Commands

`rad issue` global flags (also valid on subcommands): `-r, --repo <RID>`, `--no-announce`, `-q, --quiet`, `--header`, `-v`.

### Open

```bash
rad issue open                                    # opens $EDITOR
rad issue open --title "T" --description "D"       # -t / -d short forms
rad issue open -t "T" -d "D" --labels "bug ux"     # space-separated labels
rad issue open -t "T" -d "D" --assignees <DID>     # space-separated DIDs
```

Flags: `-t/--title`, `-d/--description`, `--labels <LABELS>`, `--assignees <DID>`.

### List

```bash
rad issue list                 # open issues (default)
rad issue list --all           # all states
rad issue list --closed        # only closed
rad issue list --solved        # only solved
rad issue list --assigned      # assigned to me
rad issue list --assigned <DID> # assigned to a specific DID
```

Note: there is NO `--state` flag — use the boolean flags `--open`/`--closed`/`--solved`/`--all`.

### Show / Edit / Delete

```bash
rad issue show <ISSUE_ID>
rad issue edit <ISSUE_ID> --title "new" --description "new"   # -t / -d
rad issue delete <ISSUE_ID>
```

### Comment

```bash
rad issue comment <ISSUE_ID> --message "text"               # -m
rad issue comment <ISSUE_ID> -m "reply" --reply-to <COMMENT_ID>
rad issue comment <ISSUE_ID> -m "fix typo" --edit <COMMENT_ID>
```

### State

```bash
rad issue state <ISSUE_ID> --closed
rad issue state <ISSUE_ID> --open
rad issue state <ISSUE_ID> --solved
```

### Labels and assignees

Use `--add` / `--delete` (NOT `--remove`); both may be repeated:

```bash
rad issue label <ISSUE_ID> --add bug --add ux
rad issue label <ISSUE_ID> --delete bug          # -a / -d short forms
rad issue assign <ISSUE_ID> --add <DID>
rad issue assign <ISSUE_ID> --delete <DID>
```

### React

```bash
rad issue react <ISSUE_ID> --emoji 👍            # react to issue or comment
```

## Patch Commands

Patches are created with `git push`, not a `rad patch open` command. `rad patch` subcommands manage existing patches. Global flags: `--repo <RID>`, `--announce`/`--no-announce`, `-q`, `-v`.

### Create a patch (git push)

Recommended: commit and push as usual (write the commit message however you
like — that's the user's choice), then set the patch description explicitly with
`rad patch edit`. What matters is that the description gets set; it's a separate
Radicle object, independent of the commit message. `-m` is a normal CLI arg, so a
heredoc with newlines/backticks/quotes works (first line = title, rest = body):

```bash
git commit                               # commit message is up to the user
git push rad HEAD:refs/patches           # opens the patch
rad patch edit <PATCH_ID> -m "$(cat <<'EOF'
Patch title

Body paragraph explaining the change.
- point one
- point two
EOF
)"
```

Alternative — let the commit message be the description. The patch derives its
title (first line) and body (rest) from the commit message on push:

```bash
git commit -F- <<'EOF'
Patch title

Body paragraph explaining the change.
EOF
git push rad HEAD:refs/patches        # non-tty: uses the commit message verbatim
```

In an interactive terminal this opens an editor pre-filled with the commit
message; in a non-tty shell it's used directly.

Other push options (booleans and the single-line `patch.message`):

```bash
git push rad -o patch.draft HEAD:refs/patches          # open as draft
git push rad -o patch.base=<commit> HEAD:refs/patches  # set base commit
git push rad -o no-sync HEAD:refs/patches              # don't announce after push
```

**Push options must never contain a newline.** Git's push-option protocol
rejects any value with an embedded `\n`. A `patch.message` value is therefore
always a single line; repeat `-o patch.message=...` to add lines and they join
top-to-bottom, each its own paragraph. For any multiline title/body, do not build
a `patch.message` option — push to open the patch, then set the prose with
`rad patch edit -m "$(cat <<'EOF' ... EOF)"` (a normal CLI arg, newlines allowed).

Supported push options: `patch.message=<text>` (repeatable, single line each), `patch.draft`, `patch.base=<rev>`, `patch.branch[=<name>]`, `sync`, `no-sync`, `hints`.

```bash
# Update an existing patch: push more commits to the same branch
git push rad                          # force not needed for fast-forward
git push --force rad                  # after rebase/amend
```

### List

```bash
rad patch list                # open patches (default)
rad patch list --all          # incl. draft, merged, archived
rad patch list --merged
rad patch list --draft
rad patch list --archived
rad patch list --authored             # patches you authored
rad patch list --author <DID>         # by a specific author (repeatable)
```

Note: there is NO `--state` flag — use `--open`/`--merged`/`--draft`/`--archived`/`--all`.

### Show / Diff

```bash
rad patch show <PATCH_ID>
rad patch show <PATCH_ID> --patch       # -p: include the diff
rad patch diff <PATCH_ID>
rad patch diff <PATCH_ID> --revision <REVISION>   # -r
```

### Checkout

```bash
rad patch checkout <PATCH_ID>
rad patch checkout <PATCH_ID> --revision <REV>
rad patch checkout <PATCH_ID> --name <BRANCH>     # custom branch name
rad patch checkout <PATCH_ID> --force             # -f, overwrite existing branch
```

### Review

```bash
rad patch review <PATCH_ID> --accept
rad patch review <PATCH_ID> --reject
rad patch review <PATCH_ID> --accept -m "LGTM"    # -m repeatable -> newlines
rad patch review <PATCH_ID> --accept --no-message # skip the message prompt
rad patch review <PATCH_ID> -r <REVISION> --accept
```

### Comment (on a revision)

Note: the positional arg is a REVISION_ID, not the patch ID. Get it from `rad patch show`.

```bash
rad patch comment <REVISION_ID> -m "comment"
rad patch comment <REVISION_ID> -m "reply" --reply-to <COMMENT_ID>
rad patch comment <REVISION_ID> -m "edited" --edit <COMMENT_ID>
rad patch comment <REVISION_ID> --react <COMMENT_ID> --emoji 👍
rad patch comment <REVISION_ID> --redact <COMMENT_ID>
```

### Edit / Update metadata

`-m` is a normal CLI arg (not a git push option), so multiline heredocs work.
First line = title, rest = description:

```bash
rad patch edit <PATCH_ID> -m "$(cat <<'EOF'
New title

New description, with `backticks` and "quotes" handled safely.
EOF
)"
rad patch edit <PATCH_ID> --revision <REV_ID> -m "..."  # edit a revision
rad patch update <PATCH_ID> -m "msg" --base <REVSPEC>   # update base commit
```

### Labels and assignees

Use `--add` / `--delete` (repeatable):

```bash
rad patch label <PATCH_ID> --add bug --add ux        # -a
rad patch label <PATCH_ID> --delete bug              # -d
rad patch assign <PATCH_ID> --add <DID>
rad patch assign <PATCH_ID> --delete <DID>
```

### Lifecycle

```bash
rad patch ready <PATCH_ID>             # draft -> open
rad patch ready <PATCH_ID> --undo      # open -> draft
rad patch archive <PATCH_ID>
rad patch archive <PATCH_ID> --undo    # unarchive (-> open)
rad patch set <PATCH_ID> --remote <REF> # set upstream branch for a patch
rad patch delete <PATCH_ID>
```

### Merge a patch

```bash
rad patch checkout <PATCH_ID>          # or: git merge the patch branch
git checkout main
git merge <patch-branch>
git push rad main                      # pushing to main marks the patch merged
```

## Identity Commands

### rad auth

```bash
rad auth                                          # interactive
rad auth --alias "name" --stdin                   # read passphrase from stdin
echo "" | rad auth --alias "name" --stdin         # no passphrase
RAD_PASSPHRASE="pass" rad auth --alias "name"     # passphrase via env
```

### rad self

`rad self` with no flags prints everything (DID, Node ID, alias, etc.).
There is NO `--nid` flag; the individual flags are:

```bash
rad self                  # DID, Node ID, alias, home, key
rad self --did            # DID only
rad self --alias          # node alias
rad self --home           # Radicle home path
rad self --config         # config file location
rad self --ssh-key        # public key (OpenSSH format)
rad self --ssh-fingerprint
```

## Repository Commands

### rad init

```bash
rad init [PATH]
rad init --name "name" --description "desc" --default-branch main
rad init --public            # or --private
rad init --scope all         # follow scope: all | followed
rad init --no-confirm        # skip confirmation
rad init --no-seed           # don't seed after init
rad init -u                  # --set-upstream
rad init --existing rad:<RID> # adopt an existing RID
```

### rad clone

```bash
rad clone rad:<RID>
rad clone rad:<RID> ./dir                 # target path is positional
rad clone rad:<RID> --scope followed      # all | followed
rad clone rad:<RID> --seed <NID>          # -s, clone from a specific seed (repeatable)
rad clone rad:<RID> --timeout 30s
rad clone rad:<RID> --bare
```

### rad ls / rad .

```bash
rad ls               # local repos
rad ls --seeded
rad ls --all
rad .                # RID of current repo
```

### rad seed / unseed / publish

```bash
rad seed rad:<RID>
rad seed rad:<RID> --scope followed
rad unseed rad:<RID>
rad publish          # make current private repo public
```

## Node and Sync

### rad node

Subcommands: `start`, `stop`, `status`, `connect`, `routing`, `config`, `logs`, `events`, `inventory`, `debug`.

```bash
rad node start
rad node stop
rad node status
rad node connect <NID>@<host>:<port>   # @addr:port optional
rad node routing
rad node logs
```

### rad sync

`--fetch` and `--announce` default to true; passing one alone disables the other.

```bash
rad sync                  # fetch + announce for current repo
rad sync --fetch          # -f, fetch only
rad sync --announce       # -a, announce only
rad sync --seed <NID>     # sync with a specific node (repeatable)
rad sync --replicas 5     # -r, target N seeds
rad sync --inventory      # -i, announce inventory (standalone; ignores RID)
rad sync status           # sync status of a repository
```

### rad inbox

`clear` and `show` are subcommands, NOT flags (there is no `--clear`):

```bash
rad inbox                 # list (current repo, or --all)
rad inbox show <ID>       # show a notification (marks it read)
rad inbox clear           # clear all (or pass specific IDs)
```

## Remotes and Identity Management

### rad remote

Remove is `rm`, not `remove`:

```bash
rad remote add <NID>
rad remote add <NID> --name alice    # -n; default name is <alias>@<NID>
rad remote rm <name>
rad remote list                      # --all / --tracked / --untracked
```

### rad id

`rad id` manages the repository identity document via *proposals*. `rad id update`
proposes a revision; with a single delegate it applies immediately, otherwise other
delegates `accept`/`reject`. A proposal is adopted by plain majority of delegates
(delegates.len() / 2 + 1, hardcoded) — this quorum is separate from `--threshold`
below. Subcommands: `update`, `accept`, `reject`, `edit`, `list`, `show`, `redact`.

There is NO `--name` flag. Useful `update` options: `--allow`/`--disallow` (private
repo access), `--delegate`/`--rescind` (add/remove a delegate), `--threshold`,
`--visibility private|public`, plus `--title`/`--description` for the proposal.

`--threshold` does NOT control how many delegates must approve an identity
proposal (that's the fixed majority rule above). It sets the number of delegate
signatures required for a ref (e.g. the default branch) to be considered
*canonical* — i.e. the git ref quorum used to determine canonical repository
state, not identity-document approval.

```bash
rad id update --title "Grant access" --allow <DID>
rad id update --title "Revoke" --disallow <DID>
rad id update --title "Add delegate" --delegate <DID>
rad id update --title "Go public" --visibility public
rad id list                # list proposed revisions (NOT delegates)
rad id show <REVISION_ID>
```

## Configuration and Utilities

`rad config` subcommands: `show` (default), `init`, `edit`, `schema`.
`rad inspect` takes `[RID|PATH]` and a flag selecting what to show.

```bash
rad config                  # show config as JSON (= rad config show)
rad config edit             # open config in editor
rad inspect                 # inspect current repo (or pass RID|PATH)
rad inspect --identity      # also: --delegates / --history / --payload / --policy
rad path                    # Radicle home path
rad stats                   # repo/node metrics
```

## Public Seed Nodes

Radicle Foundation seeds (host `radicle.network`, port `58776`):

- `iris.radicle.network`
- `rosa.radicle.network`

These ship as preferred seeds in the default config. Seeds are referenced as
`<NID>@<host>:<port>`; see/edit them under `preferredSeeds` via `rad config edit`.

## Environment Variables

- `RAD_HOME` — override Radicle home directory
- `RAD_PASSPHRASE` — provide passphrase non-interactively
- `RAD_DEBUG` — enable debug logging
