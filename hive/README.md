# Hive

Distributed agent orchestration webapp. A **prime-agent** queen decomposes goals into parallel subtasks; **cursor-agent** workers (forked subprocesses) execute code changes across a distributed node pool.

```
┌──────────────────────────────────────────────────────────────┐
│                     Hive Web UI (:8787)                       │
│              WebSocket live updates · job dashboard           │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                   FastAPI Orchestrator                        │
│  DAG scheduler · node registry · parallel worker dispatch     │
└──────────────┬─────────────────────────────┬─────────────────┘
               │                             │
    ┌──────────▼──────────┐       ┌──────────▼──────────────┐
    │    prime-agent      │       │    cursor-agent workers  │
    │    (Queen)          │       │    (forked per task)     │
    │  plan · delegate    │       │  parallel code writing   │
    └─────────────────────┘       └──────────────────────────┘
               │                             │
    from codegod100/agentic         from nix-ai-tools / Cursor
```

## Components

| Layer | Tool | Role |
|-------|------|------|
| Queen | [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) via [codegod100/agentic](https://github.com/codegod100/agentic) | Decompose goals into a dependency DAG |
| Workers | [cursor-agent](https://cursor.com) | Fork subprocesses to write code in parallel |
| Workflows | [cursor-agents](https://github.com/cocolwy/cursor-agents) (fork to `codegod100/cursor-agents`) | Multi-agent `/code` pipelines for complex tasks |
| Coordinator | Hive (this repo) | Web UI, queue, node registry, distributed dispatch |

## Deploy to hive.boxd.sh

```bash
# One-time: authenticate boxd, then provision the golden VM
boxd auth login
bash scripts/setup-boxd.sh

# Or from the cursor monorepo:
cd hive && bash scripts/setup-boxd.sh
```

This creates the `hive` boxd machine, clones the repo to `/home/boxd/hive`, installs systemd units, serves on **https://hive.boxd.sh**, and wires deploy-on-push via `hooks.hive.boxd.sh`.

Pushes to `main` trigger `scripts/deploy-boxd.sh` on the VM. Tail the log:

```bash
boxd machine exec hive -- sudo tail -f /var/log/golden-deploy.log
```

Set secrets centrally (injected into workers):

```bash
boxd env set CURSOR_API_KEY sk-… --secret
boxd env set PRIME_API_KEY … --secret
```

## Quick start

### Nix (recommended)

```bash
git clone https://github.com/codegod100/hive.git
cd hive
nix run .#hive
# → http://localhost:8787
```

### Python

```bash
uv sync
cp .env.example .env
# set PRIME_API_KEY and/or CURSOR_API_KEY

# prime-agent from agentic flake:
nix run github:codegod100/agentic#prime-agent -- --version

uv run hive
```

### Vendor cursor-agents (optional)

```bash
./scripts/vendor-cursor-agents.sh
```

This clones `codegod100/cursor-agents` if the fork exists, otherwise falls back to upstream.

## Distributed setup

Run multiple Hive instances and register remote worker nodes:

```bash
# Coordinator
HIVE_REMOTE_NODES=http://worker-1:8787,http://worker-2:8787 uv run hive

# Worker nodes (each on a different host)
uv run hive --port 8787
```

Workers self-register via `POST /api/nodes` or are pre-configured in `HIVE_REMOTE_NODES`. The coordinator dispatches code tasks to the least-loaded node via `POST /api/internal/execute`.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web dashboard |
| `/api/jobs` | POST | Launch a new swarm `{ goal, workspace, max_workers }` |
| `/api/jobs/{id}` | GET | Job status and subtask results |
| `/api/nodes` | GET/POST | List or register worker nodes |
| `/api/snapshot` | GET | Full hive state |
| `/ws` | WebSocket | Live state updates |

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRIME_AGENT_BIN` | `prime-agent` | Queen orchestrator binary |
| `PRIME_API_KEY` | — | Prime Inference API key |
| `CURSOR_AGENT_BIN` | `cursor-agent` | Worker binary |
| `CURSOR_API_KEY` | — | Cursor API key for workers |
| `HIVE_MAX_PARALLEL_WORKERS` | `4` | Local parallel limit |
| `HIVE_REMOTE_NODES` | — | Comma-separated remote node URLs |
| `HIVE_PORT` | `8787` | Server port |

## Architecture notes

- **Parallel**: Independent subtasks (empty `depends_on`) run concurrently up to `max_workers`.
- **Distributed**: Node registry tracks capacity; remote dispatch forwards tasks to peer Hive instances.
- **Resilient**: Falls back to heuristic planning when prime-agent is unavailable.
- **Fork model**: Each worker task spawns a fresh `cursor-agent --print` subprocess (no shared PTY state).

## Related repos

- [codegod100/agentic](https://github.com/codegod100/agentic) — Nix package for prime-agent
- [codegod100/manager](https://github.com/codegod100/manager) — Desktop GUI for interactive cursor-agent sessions
- [codegod100/toolage](https://github.com/codegod100/toolage) — Cursor cloud automation
- [codegod100/cursor-agents](https://github.com/codegod100/cursor-agents) — Fork of multi-agent workflow library (create with `gh repo fork cocolwy/cursor-agents --org codegod100`)

## License

MIT
