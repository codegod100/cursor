"""CLI entry point."""

from __future__ import annotations

import argparse

import uvicorn

from hive.config import settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Hive distributed agent orchestrator")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    uvicorn.run(
        "hive.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        factory=False,
    )


if __name__ == "__main__":
    main()
