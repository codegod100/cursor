#!/usr/bin/env node
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRadicleServer } from "./server.js";

const PORT = Number.parseInt(process.env.RADICLE_MCP_PORT ?? "8000", 10);
const HOST = process.env.RADICLE_MCP_HOST ?? "0.0.0.0";
const ALLOWED_HOSTS = (process.env.RADICLE_MCP_ALLOWED_HOSTS ?? "radicle.boxd.sh,localhost")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const app = createMcpExpressApp({ host: HOST, allowedHosts: ALLOWED_HOSTS });

app.get("/", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "radicle-mcp",
    mcp: "/mcp",
    health: "/health",
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createRadicleServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("MCP request error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.listen(PORT, HOST, () => {
  console.log(`radicle-mcp listening on http://${HOST}:${PORT}/mcp`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
