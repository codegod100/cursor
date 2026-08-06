"""Distributed task queue with dependency-aware parallel scheduling."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Awaitable, Callable

from hive.models import SubTask, TaskStatus


TaskHandler = Callable[[SubTask], Awaitable[str]]


class TaskQueue:
    """Priority-free DAG scheduler that runs ready tasks in parallel."""

    def __init__(self, max_parallel: int) -> None:
        self.max_parallel = max_parallel
        self._semaphore = asyncio.Semaphore(max_parallel)

    async def run_dag(
        self,
        tasks: list[SubTask],
        handler: TaskHandler,
        on_update: Callable[[SubTask], Awaitable[None]] | None = None,
    ) -> list[SubTask]:
        task_map = {t.id: t for t in tasks}
        completed: set[str] = set()
        failed: set[str] = set()
        lock = asyncio.Lock()

        async def notify(task: SubTask) -> None:
            if on_update:
                await on_update(task)

        async def run_one(task: SubTask) -> None:
            async with self._semaphore:
                task.status = TaskStatus.RUNNING
                await notify(task)
                try:
                    result = await handler(task)
                    task.result = result
                    task.status = TaskStatus.COMPLETED
                except Exception as exc:  # noqa: BLE001 — surface worker errors
                    task.error = str(exc)
                    task.status = TaskStatus.FAILED
                    async with lock:
                        failed.add(task.id)
                finally:
                    await notify(task)
                    async with lock:
                        completed.add(task.id)

        pending = set(task_map)
        in_flight: set[asyncio.Task[None]] = set()

        while pending or in_flight:
            ready = [
                t
                for tid, t in task_map.items()
                if tid in pending
                and all(dep in completed for dep in t.depends_on)
                and not any(dep in failed for dep in t.depends_on)
            ]

            for task in ready:
                pending.discard(task.id)
                in_flight.add(asyncio.create_task(run_one(task)))

            if not in_flight and pending:
                # Unresolvable dependencies or all deps failed
                for tid in list(pending):
                    task_map[tid].status = TaskStatus.CANCELLED
                    task_map[tid].error = "blocked by failed or missing dependencies"
                    pending.discard(tid)
                break

            if in_flight:
                done, in_flight = await asyncio.wait(
                    in_flight, return_when=asyncio.FIRST_COMPLETED
                )
                del done

        return list(task_map.values())

    @staticmethod
    def group_independent(tasks: list[SubTask]) -> list[list[SubTask]]:
        """Partition tasks into waves of parallelizable work."""
        waves: list[list[SubTask]] = []
        remaining = {t.id: t for t in tasks}
        completed: set[str] = set()

        while remaining:
            wave = [
                t
                for t in remaining.values()
                if all(dep in completed for dep in t.depends_on)
            ]
            if not wave:
                break
            waves.append(wave)
            for t in wave:
                completed.add(t.id)
                del remaining[t.id]
        return waves
