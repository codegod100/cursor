"""FastAPI web application for the Hive orchestrator."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from hive.models import CreateJobRequest, HiveJob, RegisterNodeRequest
from hive.orchestrator import orchestrator

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await orchestrator.startup()
    yield


app = FastAPI(
    title="Hive",
    description="Distributed orchestrator: prime-agent queen + cursor-agent workers",
    version="0.1.0",
    lifespan=lifespan,
)


class ExecuteRequest(BaseModel):
    job_id: str
    task_id: str
    prompt: str
    workspace: str = "."


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "service": "hive"}


@app.get("/api/snapshot")
async def snapshot():
    return await orchestrator.snapshot()


@app.get("/api/jobs")
async def list_jobs() -> list[HiveJob]:
    return list(orchestrator.jobs.values())


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> HiveJob:
    job = await orchestrator.get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


@app.post("/api/jobs", status_code=201)
async def create_job(req: CreateJobRequest) -> HiveJob:
    return await orchestrator.create_job(req)


@app.post("/api/nodes", status_code=201)
async def register_node(req: RegisterNodeRequest):
    return await orchestrator.nodes.register(req)


@app.get("/api/nodes")
async def list_nodes():
    return await orchestrator.nodes.list_nodes()


@app.post("/api/internal/execute")
async def internal_execute(req: ExecuteRequest) -> dict:
    """Remote worker dispatch endpoint."""
    result = await orchestrator.execute_local(
        req.job_id, req.task_id, req.prompt, req.workspace
    )
    return {"result": result}


@app.websocket("/ws")
async def websocket_events(ws: WebSocket) -> None:
    await ws.accept()
    queue = orchestrator.subscribe()
    try:
        await ws.send_json((await orchestrator.snapshot()).model_dump(mode="json"))
        while True:
            try:
                snap = await asyncio.wait_for(queue.get(), timeout=30.0)
                await ws.send_json(snap.model_dump(mode="json"))
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        if queue in orchestrator._listeners:
            orchestrator._listeners.remove(queue)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
