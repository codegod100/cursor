# Hive systemd units (user)

Long-running Hive webapp supervised by **systemd user units**.

| Unit | Role |
|------|------|
| `hive-prep.service` | `uv sync`, write `~/.config/hive/runtime.env` |
| `hive.service` | FastAPI on `:8000` (boxd default proxy port) |
| `hive.target` | Start both |

Public URL: **https://hive.boxd.sh** (after `boxd machine proxy set-port hive 8000`).

## Install (boxd or local)

```bash
bash scripts/install-systemd.sh
loginctl enable-linger "$USER"   # once, survive logout
systemctl --user start hive.target
```

## Deploy on push

See `scripts/setup-boxd.sh` and `.github/workflows/deploy-boxd.yml`.
