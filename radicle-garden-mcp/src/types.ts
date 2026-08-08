export type SvelteKitActionResult =
  | { type: "success"; status?: number; data?: unknown }
  | { type: "failure"; status: number; data?: unknown }
  | { type: "redirect"; location: string }
  | { type: "error"; error?: { message?: string } };

export type BuildkiteConfig = {
  configured: boolean;
  orgSlug: string;
  clusterId: string;
  context: string;
  publicPipeline: boolean;
};

export type BuildkiteSaveInput = {
  orgSlug: string;
  clusterId: string;
  apiToken?: string;
  context?: string;
  publicPipeline?: boolean;
};

export type BuildkiteVerifyInput = {
  orgSlug?: string;
  apiToken?: string;
};

export type BuildkiteOrganization = {
  id: string;
  slug: string;
  name: string;
};

export type BuildkiteCluster = {
  id: string;
  name: string;
  description: string | null;
  defaultQueueId: string | null;
  webUrl: string | null;
};
