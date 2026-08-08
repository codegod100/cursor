import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRadicleServer } from "./server.js";

async function handleMcpPost(req: Request, res: Response) {
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
    console.error("radicle MCP request error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

function methodNotAllowed(_req: Request, res: Response) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
}

/** Express router for Radicle MCP (mount at /radicle on the shared host). */
export function createRadicleRouter(): Router {
  const router = createRouter();

  router.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "radicle",
      mcp: "mcp",
      health: "health",
    });
  });

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "radicle" });
  });

  router.post("/mcp", handleMcpPost);
  router.get("/mcp", methodNotAllowed);
  router.delete("/mcp", methodNotAllowed);

  return router;
}
