#!/usr/bin/env node
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createRadicleRouter } from "../../radicle/dist/mount.js";

const PORT = Number.parseInt(process.env.MCP_HOST_PORT ?? "8000", 10);
const HOST = process.env.MCP_HOST_BIND ?? "0.0.0.0";
const ALLOWED_HOSTS = (process.env.MCP_HOST_ALLOWED_HOSTS ?? "mcp.boxd.sh,localhost")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const app = createMcpExpressApp({ host: HOST, allowedHosts: ALLOWED_HOSTS });

app.get("/", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    host: "mcp.boxd.sh",
    services: {
      radicle: {
        base: "/radicle",
        mcp: "/radicle/mcp",
        health: "/radicle/health",
      },
    },
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, host: "mcp.boxd.sh" });
});

app.use("/radicle", createRadicleRouter());

app.listen(PORT, HOST, () => {
  console.log(`mcp host listening on http://${HOST}:${PORT}`);
  console.log(`  radicle MCP: http://${HOST}:${PORT}/radicle/mcp`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
