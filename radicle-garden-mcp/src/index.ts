#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listBuildkiteClusters,
  listBuildkiteOrganizations,
  RadicleGardenClient,
  RadicleGardenError,
  verifyBuildkiteToken,
} from "./client.js";
import { hydrateSecretsFromOpenbao } from "./openbao.js";

function jsonText(value: unknown): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorText(error: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const message =
    error instanceof RadicleGardenError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function createClient(): RadicleGardenClient {
  return new RadicleGardenClient({
    baseUrl: process.env.RADICLE_GARDEN_BASE_URL,
    sessionCookie: process.env.RADICLE_GARDEN_SESSION,
    email: process.env.RADICLE_GARDEN_EMAIL,
    password: process.env.RADICLE_GARDEN_PASSWORD,
  });
}

const server = new McpServer({
  name: "radicle-garden",
  version: "0.1.0",
});

const ridSchema = z
  .string()
  .describe("Radicle repository id, e.g. rad:z3G4JeCL1UaS7TwoQHgY2VidbX2Ai");

server.tool(
  "radicle_login",
  "Authenticate to radicle.garden using email/password and store the session cookie in-memory for subsequent calls in this MCP process.",
  {
    email: z.string().optional().describe("Defaults to RADICLE_GARDEN_EMAIL"),
    password: z.string().optional().describe("Defaults to RADICLE_GARDEN_PASSWORD"),
  },
  async ({ email, password }) => {
    try {
      const client = createClient();
      await client.login(email, password);
      const cookie = client.getSessionCookie();
      return jsonText({
        ok: true,
        message: "Logged in. Export RADICLE_GARDEN_SESSION to persist across restarts.",
        sessionCookie: cookie,
      });
    } catch (error) {
      return errorText(error);
    }
  },
);

server.tool(
  "radicle_get_buildkite_config",
  "Read the saved Buildkite integration for a repo (never returns the API token).",
  { rid: ridSchema },
  async ({ rid }) => {
    try {
      const client = createClient();
      const config = await client.getBuildkiteConfig(rid);
      return jsonText(config);
    } catch (error) {
      return errorText(error);
    }
  },
);

server.tool(
  "radicle_save_buildkite",
  "Save Buildkite integration settings for a repo on radicle.garden.",
  {
    rid: ridSchema,
    orgSlug: z.string().describe("Buildkite organization slug"),
    clusterId: z.string().describe("Buildkite cluster UUID"),
    apiToken: z
      .string()
      .optional()
      .describe("Required for new configs; omit to keep the stored token on update"),
    context: z
      .string()
      .optional()
      .describe('Integration context key (default: "garden-broker/buildkite")'),
    publicPipeline: z.boolean().optional().describe("Whether created pipelines are public"),
  },
  async ({ rid, orgSlug, clusterId, apiToken, context, publicPipeline }) => {
    try {
      const client = createClient();
      await client.saveBuildkite(rid, {
        orgSlug,
        clusterId,
        apiToken,
        context,
        publicPipeline,
      });
      return jsonText({ ok: true, rid, orgSlug, clusterId, context: context ?? "garden-broker/buildkite" });
    } catch (error) {
      return errorText(error);
    }
  },
);

server.tool(
  "radicle_verify_buildkite",
  "Verify Buildkite org slug + API token via radicle.garden (same check as the dashboard Verify button).",
  {
    rid: ridSchema,
    orgSlug: z.string().optional(),
    apiToken: z.string().optional(),
  },
  async ({ rid, orgSlug, apiToken }) => {
    try {
      const client = createClient();
      await client.verifyBuildkite(rid, { orgSlug, apiToken });
      return jsonText({ ok: true, rid, orgSlug: orgSlug ?? "(stored)" });
    } catch (error) {
      return errorText(error);
    }
  },
);

server.tool(
  "radicle_remove_buildkite",
  "Disable and delete the Buildkite integration for a repo.",
  { rid: ridSchema },
  async ({ rid }) => {
    try {
      const client = createClient();
      await client.removeBuildkite(rid);
      return jsonText({ ok: true, rid });
    } catch (error) {
      return errorText(error);
    }
  },
);

server.tool(
  "buildkite_list_organizations",
  "List Buildkite organizations accessible to an API token.",
  {
    apiToken: z
      .string()
      .optional()
      .describe("Defaults to BUILDKITE_API_TOKEN env var"),
  },
  async ({ apiToken }) => {
    try {
      const token = apiToken ?? process.env.BUILDKITE_API_TOKEN;
      if (!token) {
        throw new RadicleGardenError("apiToken is required (or set BUILDKITE_API_TOKEN)");
      }
      const orgs = await listBuildkiteOrganizations(token);
      return jsonText(orgs);
    } catch (error) {
      return errorText(error);
    }
  },
);

server.tool(
  "buildkite_list_clusters",
  "List Buildkite clusters for an organization (returns cluster UUIDs).",
  {
    orgSlug: z.string(),
    apiToken: z.string().optional().describe("Defaults to BUILDKITE_API_TOKEN env var"),
  },
  async ({ orgSlug, apiToken }) => {
    try {
      const token = apiToken ?? process.env.BUILDKITE_API_TOKEN;
      if (!token) {
        throw new RadicleGardenError("apiToken is required (or set BUILDKITE_API_TOKEN)");
      }
      const clusters = await listBuildkiteClusters(token, orgSlug);
      return jsonText(clusters);
    } catch (error) {
      return errorText(error);
    }
  },
);

server.tool(
  "setup_buildkite_integration",
  "Discover Buildkite org + clusters, then save the integration to radicle.garden in one step.",
  {
    rid: ridSchema,
    apiToken: z.string().optional().describe("Defaults to BUILDKITE_API_TOKEN env var"),
    orgSlug: z
      .string()
      .optional()
      .describe("Skip discovery when you already know the org slug"),
    clusterName: z
      .string()
      .optional()
      .describe("Pick a cluster by name (case-insensitive); defaults to the first cluster"),
    publicPipeline: z.boolean().optional(),
  },
  async ({ rid, apiToken, orgSlug, clusterName, publicPipeline }) => {
    try {
      const token = apiToken ?? process.env.BUILDKITE_API_TOKEN;
      if (!token) {
        throw new RadicleGardenError("apiToken is required (or set BUILDKITE_API_TOKEN)");
      }

      let resolvedOrgSlug = orgSlug;
      if (!resolvedOrgSlug) {
        const orgs = await listBuildkiteOrganizations(token);
        if (orgs.length === 0) {
          throw new RadicleGardenError("No Buildkite organizations found for this token");
        }
        if (orgs.length > 1) {
          return jsonText({
            needsInput: true,
            message: "Multiple organizations found — pass orgSlug explicitly.",
            organizations: orgs,
          });
        }
        resolvedOrgSlug = orgs[0].slug;
      }

      await verifyBuildkiteToken(token, resolvedOrgSlug);

      const clusters = await listBuildkiteClusters(token, resolvedOrgSlug);
      if (clusters.length === 0) {
        throw new RadicleGardenError(`No clusters found in organization "${resolvedOrgSlug}"`);
      }

      let cluster: (typeof clusters)[number] | undefined = clusters[0];
      if (clusterName) {
        const wanted = clusterName.toLowerCase();
        cluster =
          clusters.find((item) => item.name.toLowerCase() === wanted) ??
          clusters.find((item) => item.name.toLowerCase().includes(wanted));
        if (!cluster) {
          throw new RadicleGardenError(
            `No cluster matching "${clusterName}". Available: ${clusters.map((c) => c.name).join(", ")}`,
          );
        }
      }
      if (!cluster) {
        throw new RadicleGardenError(`No clusters found in organization "${resolvedOrgSlug}"`);
      }

      const client = createClient();
      await client.saveBuildkite(rid, {
        orgSlug: resolvedOrgSlug,
        clusterId: cluster.id,
        apiToken: token,
        publicPipeline,
      });

      return jsonText({
        ok: true,
        rid,
        orgSlug: resolvedOrgSlug,
        cluster: { id: cluster.id, name: cluster.name },
        publicPipeline: publicPipeline ?? false,
      });
    } catch (error) {
      return errorText(error);
    }
  },
);

async function main(): Promise<void> {
  await hydrateSecretsFromOpenbao();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
