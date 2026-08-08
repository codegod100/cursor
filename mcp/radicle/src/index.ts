#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RadError } from "./rad.js";
import { createPatch, createPatchSchema } from "./tools/patch.js";
import { issueDeviceKey, issueDeviceKeySchema } from "./tools/device-key.js";

const server = new McpServer({
  name: "radicle",
  version: "0.1.0",
});

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
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

server.registerTool(
  "issue_device_key",
  {
    title: "Issue Radicle device key",
    description:
      "Create or load a Radicle device identity (Ed25519 keypair) scoped to an environment via RAD_HOME. Returns DID, alias, and env vars (RAD_HOME, RAD_PASSPHRASE) for Cloud Agent secrets. Each device needs its own DID; add it as a repo delegate before pushing patches.",
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
      "Open or update a Radicle patch by pushing local commits to refs/patches on the rad remote. Uses patch.message push options (no editor). Requires a rad remote and commits not already on the base branch.",
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

server.registerTool(
  "rad_self",
  {
    title: "Show Radicle identity",
    description: "Return DID, alias, and paths for the Radicle identity at RAD_HOME.",
    inputSchema: {
      env_name: z
        .string()
        .optional()
        .describe("Use RAD_HOME at <workspace>/.radicle/<env_name>."),
      rad_home: z.string().optional().describe("Override RAD_HOME path."),
      passphrase: z.string().optional().describe("RAD_PASSPHRASE if the key is encrypted."),
    },
  },
  async (input) => {
    try {
      const { defaultRadHome, findWorkspaceRoot, getSelf, requireRad } =
        await import("./rad.js");
      await requireRad();
      const workspace = findWorkspaceRoot();
      const radHome =
        input.rad_home ??
        (input.env_name
          ? defaultRadHome(workspace, input.env_name)
          : process.env.RAD_HOME ?? defaultRadHome(workspace));
      const result = await getSelf({
        radHome,
        passphrase: input.passphrase ?? process.env.RAD_PASSPHRASE,
      });
      return textResult(result);
    } catch (error) {
      return errorResult(error);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
