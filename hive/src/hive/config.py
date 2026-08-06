"""Configuration for the Hive orchestrator."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    prime_agent_bin: str = "prime-agent"
    prime_api_key: str | None = None

    cursor_agent_bin: str = "cursor-agent"
    cursor_api_key: str | None = None

    max_parallel_workers: int = 4
    worker_timeout_sec: int = 600
    queen_model: str | None = None
    worker_model: str = "composer-2.5"

    host: str = "0.0.0.0"
    port: int = 8787
    data_dir: Path = Path(".hive")

    remote_nodes: str = ""

    @property
    def remote_node_urls(self) -> list[str]:
        return [u.strip() for u in self.remote_nodes.split(",") if u.strip()]


settings = Settings()
