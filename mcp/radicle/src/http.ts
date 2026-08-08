#!/usr/bin/env node
/** @deprecated Use mcp/host for HTTP. Kept for local single-service dev. */
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createRadicleRouter } from "./mount.js";

const PORT = Number.parseInt(process.env.RADICLE_MCP_PORT ?? "8000", 10);
const HOST = process.env.RADICLE_MCP_HOST ?? "0.0.0.0";
const BASE = process.env.RADICLE_MCP_BASE_PATH ?? "/radicle";
const ALLOWED_HOSTS = (process.env.RADICLE_MCP_ALLOWED_HOSTS ?? "mcp.boxd.sh,localhost")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const app = createMcpExpressApp({ host: HOST, allowedHosts: ALLOWED_HOSTS });

app.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "radicle-mcp", base: BASE });
});

app.use(BASE, createRadicleRouter());

app.listen(PORT, HOST, () => {
  console.log(`radicle-mcp listening on http://${HOST}:${PORT}${BASE}/mcp`);
});
