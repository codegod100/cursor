"""Cursor-agent worker pool — forks processes to write code."""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone

from hive.config import settings
from hive.models import SubTask, TaskStatus, WorkerInfo
from hive.nodes import NodeRegistry


class WorkerPool:
    """Manages parallel cursor-agent subprocess workers."""

    def __init__(self, nodes: NodeRegistry) -> None:
        self._nodes = nodes
        self._workers: dict[str, WorkerInfo] = {}
        self._lock = asyncio.Lock()

    async def list_workers(self) -> list[WorkerInfo]:
        async with self._lock:
            return list(self._workers.values())

    async def execute_task(
        self,
        job_id: str,
        task: SubTask,
        workspace: str,
    ) -> str:
        node = await self._nodes.pick_node()
        worker_id = f"w-{uuid.uuid4().hex[:8]}"
        worker = WorkerInfo(
            id=worker_id,
            node_id=node.id,
            job_id=job_id,
            task_id=task.id,
            status=TaskStatus.RUNNING,
            started_at=datetime.now(timezone.utc),
        )
        async with self._lock:
            self._workers[worker_id] = worker
        await self._nodes.heartbeat(node.id, node.active_workers + 1)

        try:
            if node.id != self._nodes.local_id:
                result = await self._nodes.dispatch_remote(
                    node, job_id, task.id, task.prompt, workspace
                )
            else:
                result = await self._run_cursor_agent(task.prompt, workspace)
            worker.status = TaskStatus.COMPLETED
            return result
        except Exception:
            worker.status = TaskStatus.FAILED
            raise
        finally:
            await self._nodes.heartbeat(node.id, max(0, node.active_workers - 1))

    async def _run_cursor_agent(self, prompt: str, workspace: str) -> str:
        """Spawn cursor-agent in print mode to implement a code task."""
        env = os.environ.copy()
        if settings.cursor_api_key:
            env["CURSOR_API_KEY"] = settings.cursor_api_key

        cmd = [
            settings.cursor_agent_bin,
            "--print",
            "--output-format",
            "text",
            "--force",
            "--trust",
        ]
        if settings.worker_model:
            cmd.extend(["--model", settings.worker_model])
        cmd.append(prompt)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=workspace,
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            raise RuntimeError(
                f"{settings.cursor_agent_bin} not found — install via nix or Cursor CLI"
            ) from None

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=settings.worker_timeout_sec,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(f"cursor-agent timed out after {settings.worker_timeout_sec}s")

        if proc.returncode != 0:
            err = stderr.decode(errors="replace").strip() or stdout.decode(errors="replace")
            raise RuntimeError(f"cursor-agent failed ({proc.returncode}): {err[:2000]}")

        return stdout.decode(errors="replace").strip()

    async def run_via_cursor_agents_cli(
        self, command: str, task_input: str, workspace: str
    ) -> str:
        """Optional path: invoke the forked cursor-agents TypeScript orchestrator."""
        env = os.environ.copy()
        if settings.cursor_api_key:
            env["CURSOR_API_KEY"] = settings.cursor_api_key

        cmd = ["npx", "tsx", "vendor/cursor-agents/src/main.ts", command, task_input]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=workspace,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=settings.worker_timeout_sec,
        )
        if proc.returncode != 0:
            raise RuntimeError(stderr.decode(errors="replace")[:2000])
        return stdout.decode(errors="replace").strip()
