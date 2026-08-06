"""Prime-agent Queen orchestrator — decomposes goals and delegates to workers."""

from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone

from hive.config import settings
from hive.models import CreateJobRequest, HiveJob, HiveSnapshot, SubTask, TaskStatus
from hive.nodes import NodeRegistry
from hive.queue import TaskQueue
from hive.workers import WorkerPool


class HiveOrchestrator:
    """Queen bee: prime-agent plans, cursor-agent workers execute in parallel."""

    def __init__(self) -> None:
        self.nodes = NodeRegistry()
        self.workers = WorkerPool(self.nodes)
        self.jobs: dict[str, HiveJob] = {}
        self._lock = asyncio.Lock()
        self._listeners: list[asyncio.Queue[HiveSnapshot]] = []

    async def startup(self) -> None:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        await self.nodes.bootstrap()

    def subscribe(self) -> asyncio.Queue[HiveSnapshot]:
        q: asyncio.Queue[HiveSnapshot] = asyncio.Queue(maxsize=64)
        self._listeners.append(q)
        return q

    async def _broadcast(self) -> None:
        snap = await self.snapshot()
        for q in list(self._listeners):
            try:
                q.put_nowait(snap)
            except asyncio.QueueFull:
                pass

    async def snapshot(self) -> HiveSnapshot:
        nodes = await self.nodes.list_nodes()
        workers = await self.workers.list_workers()
        jobs = list(self.jobs.values())
        active = sum(1 for j in jobs if j.status == TaskStatus.RUNNING)
        capacity = sum(n.max_workers for n in nodes)
        return HiveSnapshot(
            jobs=jobs,
            nodes=nodes,
            workers=workers,
            active_jobs=active,
            parallel_capacity=capacity,
        )

    async def create_job(self, req: CreateJobRequest) -> HiveJob:
        job_id = f"job-{uuid.uuid4().hex[:8]}"
        job = HiveJob(id=job_id, goal=req.goal, workspace=req.workspace)
        async with self._lock:
            self.jobs[job_id] = job
        await self._broadcast()

        asyncio.create_task(self._run_job(job, req.max_workers))
        return job

    async def get_job(self, job_id: str) -> HiveJob | None:
        return self.jobs.get(job_id)

    async def _run_job(self, job: HiveJob, max_workers: int | None) -> None:
        job.status = TaskStatus.RUNNING
        job.updated_at = datetime.now(timezone.utc)
        await self._broadcast()

        try:
            plan = await self._queen_plan(job.goal, job.workspace)
            job.queen_session = plan.get("session")
            job.subtasks = self._parse_plan(plan, job.goal)
            await self._broadcast()

            parallel = max_workers or settings.max_parallel_workers
            queue = TaskQueue(max_parallel=parallel)

            async def handler(task: SubTask) -> str:
                task.assigned_worker = "cursor-agent"
                task.started_at = datetime.now(timezone.utc)
                result = await self.workers.execute_task(job.id, task, job.workspace)
                task.finished_at = datetime.now(timezone.utc)
                return result

            async def on_update(task: SubTask) -> None:
                job.updated_at = datetime.now(timezone.utc)
                await self._broadcast()

            results = await queue.run_dag(job.subtasks, handler, on_update)
            failed = [t for t in results if t.status == TaskStatus.FAILED]
            job.status = TaskStatus.FAILED if failed else TaskStatus.COMPLETED
        except Exception as exc:  # noqa: BLE001
            job.status = TaskStatus.FAILED
            job.metadata["error"] = str(exc)
        finally:
            job.updated_at = datetime.now(timezone.utc)
            await self._broadcast()

    async def _queen_plan(self, goal: str, workspace: str) -> dict:
        """Ask prime-agent to decompose the goal into parallelizable subtasks."""
        prompt = f"""You are the Queen orchestrator of a distributed coding hive.

Decompose this goal into 2-6 parallelizable subtasks for cursor-agent workers.
Return ONLY valid JSON (no markdown fences) with this shape:
{{
  "subtasks": [
    {{
      "id": "task-1",
      "description": "short label",
      "prompt": "detailed instruction for a cursor-agent worker",
      "depends_on": []
    }}
  ]
}}

Rules:
- Independent tasks should have empty depends_on so they run in parallel.
- Use depends_on only when a task truly needs another's output.
- Each prompt must be self-contained for a worker in workspace: {workspace}

Goal: {goal}
"""

        raw = await self._run_prime_agent(prompt, workspace)
        return self._extract_json(raw)

    async def _run_prime_agent(self, prompt: str, workspace: str) -> str:
        env = os.environ.copy()
        if settings.prime_api_key:
            env["PRIME_API_KEY"] = settings.prime_api_key

        cmd = [settings.prime_agent_bin, "-p", "--no-session"]
        if settings.queen_model:
            cmd.extend(["--model", settings.queen_model])
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
            return self._fallback_plan_json(prompt)

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=settings.worker_timeout_sec,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError("prime-agent queen timed out")

        if proc.returncode != 0:
            # Fall back to heuristic planner when prime-agent unavailable
            return self._fallback_plan_json(prompt)

        return stdout.decode(errors="replace").strip()

    def _fallback_plan_json(self, prompt: str) -> str:
        """Heuristic decomposition when prime-agent is not installed."""
        goal_match = re.search(r"Goal:\s*(.+)", prompt, re.DOTALL)
        goal = goal_match.group(1).strip() if goal_match else prompt
        return json.dumps(
            {
                "subtasks": [
                    {
                        "id": "research",
                        "description": "Research and plan",
                        "prompt": f"Research the codebase and produce a plan for: {goal}",
                        "depends_on": [],
                    },
                    {
                        "id": "implement",
                        "description": "Implement changes",
                        "prompt": f"Implement the following goal in the workspace: {goal}",
                        "depends_on": ["research"],
                    },
                    {
                        "id": "verify",
                        "description": "Verify and test",
                        "prompt": f"Run tests and verify the implementation for: {goal}",
                        "depends_on": ["implement"],
                    },
                ]
            }
        )

    @staticmethod
    def _extract_json(raw: str) -> dict:
        raw = raw.strip()
        fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
        if fence:
            raw = fence.group(1)
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            raw = raw[start : end + 1]
        return json.loads(raw)

    def _parse_plan(self, plan: dict, goal: str) -> list[SubTask]:
        items = plan.get("subtasks") or []
        if not items:
            items = [
                {
                    "id": "code",
                    "description": "Implement goal",
                    "prompt": goal,
                    "depends_on": [],
                }
            ]
        return [
            SubTask(
                id=item.get("id", f"task-{i}"),
                description=item.get("description", f"Task {i}"),
                prompt=item.get("prompt", goal),
                depends_on=item.get("depends_on", []),
            )
            for i, item in enumerate(items)
        ]

    async def execute_local(
        self, job_id: str, task_id: str, prompt: str, workspace: str
    ) -> str:
        """Internal endpoint for remote nodes dispatching work here."""
        task = SubTask(id=task_id, description=task_id, prompt=prompt)
        return await self.workers.execute_task(job_id, task, workspace)


orchestrator = HiveOrchestrator()
