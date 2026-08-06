"""Distributed node registry for remote worker pools."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

import httpx

from hive.config import settings
from hive.models import HiveNode, NodeStatus, RegisterNodeRequest


class NodeRegistry:
    """Tracks local and remote worker nodes for distributed execution."""

    def __init__(self) -> None:
        self._nodes: dict[str, HiveNode] = {}
        self._lock = asyncio.Lock()
        self._local_id = f"local-{uuid.uuid4().hex[:8]}"

    async def bootstrap(self) -> None:
        async with self._lock:
            self._nodes[self._local_id] = HiveNode(
                id=self._local_id,
                url=f"http://{settings.host}:{settings.port}",
                max_workers=settings.max_parallel_workers,
                labels={"type": "coordinator"},
            )
            for url in settings.remote_node_urls:
                node_id = f"remote-{uuid.uuid4().hex[:8]}"
                self._nodes[node_id] = HiveNode(
                    id=node_id,
                    url=url.rstrip("/"),
                    max_workers=2,
                    labels={"type": "remote"},
                )

    @property
    def local_id(self) -> str:
        return self._local_id

    async def register(self, req: RegisterNodeRequest) -> HiveNode:
        node = HiveNode(
            id=f"node-{uuid.uuid4().hex[:8]}",
            url=req.url.rstrip("/"),
            max_workers=req.max_workers,
            labels=req.labels,
        )
        async with self._lock:
            self._nodes[node.id] = node
        return node

    async def heartbeat(self, node_id: str, active_workers: int) -> HiveNode | None:
        async with self._lock:
            node = self._nodes.get(node_id)
            if not node:
                return None
            node.active_workers = active_workers
            node.last_seen = datetime.now(timezone.utc)
            node.status = NodeStatus.BUSY if active_workers > 0 else NodeStatus.ONLINE
            return node

    async def list_nodes(self) -> list[HiveNode]:
        async with self._lock:
            return list(self._nodes.values())

    async def pick_node(self) -> HiveNode:
        """Least-loaded node selection for distributed dispatch."""
        async with self._lock:
            candidates = [
                n
                for n in self._nodes.values()
                if n.status != NodeStatus.OFFLINE
                and n.active_workers < n.max_workers
            ]
            if not candidates:
                return self._nodes[self._local_id]
            return min(
                candidates,
                key=lambda n: n.active_workers / max(n.max_workers, 1),
            )

    async def dispatch_remote(
        self, node: HiveNode, job_id: str, task_id: str, prompt: str, workspace: str
    ) -> str:
        """Forward a code task to a remote hive worker node."""
        async with httpx.AsyncClient(timeout=settings.worker_timeout_sec) as client:
            resp = await client.post(
                f"{node.url}/api/internal/execute",
                json={
                    "job_id": job_id,
                    "task_id": task_id,
                    "prompt": prompt,
                    "workspace": workspace,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("result", "")
