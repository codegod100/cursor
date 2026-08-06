"""Domain models for Hive orchestration."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AgentRole(str, Enum):
    QUEEN = "queen"
    WORKER = "worker"


class TaskStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class NodeStatus(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    BUSY = "busy"


class HiveNode(BaseModel):
    id: str
    url: str
    role: AgentRole = AgentRole.WORKER
    status: NodeStatus = NodeStatus.ONLINE
    max_workers: int = 2
    active_workers: int = 0
    last_seen: datetime = Field(default_factory=utcnow)
    labels: dict[str, str] = Field(default_factory=dict)


class SubTask(BaseModel):
    id: str
    description: str
    prompt: str
    depends_on: list[str] = Field(default_factory=list)
    status: TaskStatus = TaskStatus.PENDING
    assigned_worker: str | None = None
    result: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class HiveJob(BaseModel):
    id: str
    goal: str
    workspace: str
    status: TaskStatus = TaskStatus.PENDING
    subtasks: list[SubTask] = Field(default_factory=list)
    queen_session: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkerInfo(BaseModel):
    id: str
    node_id: str
    job_id: str | None = None
    task_id: str | None = None
    status: TaskStatus = TaskStatus.PENDING
    pid: int | None = None
    started_at: datetime | None = None


class CreateJobRequest(BaseModel):
    goal: str
    workspace: str = "."
    max_workers: int | None = None


class RegisterNodeRequest(BaseModel):
    url: str
    max_workers: int = 2
    labels: dict[str, str] = Field(default_factory=dict)


class HiveSnapshot(BaseModel):
    jobs: list[HiveJob]
    nodes: list[HiveNode]
    workers: list[WorkerInfo]
    active_jobs: int
    parallel_capacity: int
