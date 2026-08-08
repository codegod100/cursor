import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RadError } from "./rad.js";
import { createPatch, createPatchSchema } from "./tools/patch.js";
import { issueDeviceKey, issueDeviceKeySchema } from "./tools/device-key.js";

export function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function errorResult(error: unknown) {
  const message =
    error instanceof RadError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

export function createRadicleServer(): McpServer {
  const server = new McpServer({
    name: "radicle",
    version: "0.2.0",
  });

  server.registerTool(
    "issue_device_key",
    {
      title: "Issue Radicle device key",
      description:
        "Create or load a Radicle signing identity at <workspace>/.radicle. Usually unnecessary — create_patch auto-issues credentials. Use this to pick alias/env_name or start the node.",
      inputSchema: issueDeviceKeySchema.shape,
    },
    async (input) => {
      try {
        const parsed = issueDeviceKeySchema.parse(input);
        const result = await issueDeviceKey(parsed);
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "create_patch",
    {
      title: "Create or update Radicle patch",
      description:
        "Open or update a Radicle patch (refs/patches on the rad remote). Auto-issues signing credentials when needed. Does not merge — proposal only. Requires a rad remote and commits not already on the base branch.",
      inputSchema: createPatchSchema.shape,
    },
    async (input) => {
      try {
        const parsed = createPatchSchema.parse(input);
        const result = await createPatch(parsed);
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
