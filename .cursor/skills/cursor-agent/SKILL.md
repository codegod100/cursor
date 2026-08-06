---
name: cursor-agent
description: >-
  Delegate coding tasks to the cursor-agent CLI (Cursor's agent) running as a
  subagent and return its final result. Use when asked to run a task in Cursor,
  spawn a subagent to implement, plan, review, refactor, investigate, or fix
  code in a workspace, or fan out parallel work to cursor-agent workers.
---

# cursor-agent delegation

Run a task through the `cursor-agent` CLI as a subagent and wait for it to
finish. Non-interactive (`--print`) mode has Cursor's full toolset — read,
write, and shell — so it edits real files in the target workspace, in place.

Concrete command:

```bash
cursor-agent --print --output-format json \\
  [--workspace /abs/path/to/repo] \\
  [--model MODEL] [--mode plan|ask] \\
  [--timeout 1800] [--force] [--trust] \\
  "instruction to delegate"
```

Convenience wrapper `scripts/delegate.sh` (from a checkout of this repo, or after
`./scripts/install-global.sh`):

```bash
.cursor/skills/cursor-agent/scripts/delegate.sh "instruction" --workspace DIR
```

## Result

With `--output-format json` the CLI emits a single JSON object on stdout:

```json
{
  "type": "result", "subtype": "success", "is_error": false,
  "result": "the agent's final text",
  "session_id": "...", "request_id": "...",
  "duration_ms": 1234,
  "usage": { "inputTokens": 0, "outputTokens": 0 }
}
```

- The agent's substantive answer / summary is under `result`.
- A task is only done when the run exits 0 **and** `is_error` is `false`. Surface
  `result` to the user; on failure report the process exit code and stderr.
- `output-format text` prints the final text alone; `stream-json` emits one JSON
  object per event for live progress.

## Options

| Flag | Meaning |
|------|---------|
| `--mode plan` | read-only planning / analysis; makes no edits |
| `--mode ask` | read-only Q&A / explanation |
| `--model <id>` | e.g. `auto`, `gpt-5.3-codex` (omit for default); `cursor-agent models` lists |
| `--workspace <dir>` | repo to operate in (default: current dir) |
| `--force` | allow all shell commands without approval (yolo) |
| `--trust` | trust the workspace without prompting |
| `--timeout <s>` | upper bound (default 1800) enforced by the wrapper |

## Notes

- Requires the `cursor-agent` binary on `PATH` and a valid login
  (`cursor-agent status`). Confirm before delegating if a call fails.
- The subagent edits files in the real workspace — delegate only to repos where
  those changes belong.
- For parallel fan-out, spawn one `cursor-agent` per file / concern and combine
  the returned `result` texts.
