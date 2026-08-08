import type {
  BuildkiteCluster,
  BuildkiteConfig,
  BuildkiteOrganization,
  BuildkiteSaveInput,
  BuildkiteVerifyInput,
  SvelteKitActionResult,
} from "./types.js";

const DEFAULT_BASE_URL = "https://radicle.garden";
const DEFAULT_CONTEXT = "garden-broker/buildkite";

export type RadicleGardenClientOptions = {
  baseUrl?: string;
  sessionCookie?: string;
  email?: string;
  password?: string;
};

export class RadicleGardenError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RadicleGardenError";
  }
}

export class RadicleGardenClient {
  private readonly baseUrl: string;
  private sessionCookie: string | undefined;

  constructor(options: RadicleGardenClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.sessionCookie = options.sessionCookie;
    this.email = options.email;
    this.password = options.password;
  }

  private email?: string;
  private password?: string;

  getSessionCookie(): string | undefined {
    return this.sessionCookie;
  }

  setSessionCookie(cookie: string): void {
    this.sessionCookie = cookie;
  }

  async login(email?: string, password?: string): Promise<void> {
    const resolvedEmail = email ?? this.email;
    const resolvedPassword = password ?? this.password;
    if (!resolvedEmail || !resolvedPassword) {
      throw new RadicleGardenError(
        "Email and password are required. Set RADICLE_GARDEN_EMAIL and RADICLE_GARDEN_PASSWORD, or pass them to login().",
      );
    }

    const body = new URLSearchParams({
      email: resolvedEmail,
      password: resolvedPassword,
    });

    const response = await fetch(`${this.baseUrl}/login`, {
      method: "POST",
      headers: this.actionHeaders(`${this.baseUrl}/login`),
      body,
      redirect: "manual",
    });

    this.captureSessionCookie(response);

    const result = (await response.json()) as SvelteKitActionResult;
    if (result.type === "redirect") {
      return;
    }
    if (result.type === "failure") {
      const message = decodeSvelteKitFailure(result.data) ?? "Login failed";
      throw new RadicleGardenError(message, result.status, result.data);
    }
    if (result.type === "success") {
      return;
    }
    throw new RadicleGardenError("Unexpected login response", response.status, result);
  }

  async ensureAuthenticated(): Promise<void> {
    if (this.sessionCookie) return;
    if (this.email && this.password) {
      await this.login();
      return;
    }
    throw new RadicleGardenError(
      "Not authenticated. Set RADICLE_GARDEN_SESSION (browser cookie) or RADICLE_GARDEN_EMAIL + RADICLE_GARDEN_PASSWORD.",
    );
  }

  integrationsPath(rid: string): string {
    return `/repos/${encodeURIComponent(rid)}/integrations`;
  }

  async getBuildkiteConfig(rid: string): Promise<BuildkiteConfig> {
    await this.ensureAuthenticated();
    const path = this.integrationsPath(rid);
    const response = await fetch(`${this.baseUrl}${path}/__data.json?tab=buildkite`, {
      headers: {
        Accept: "application/json",
        Cookie: this.sessionCookie ?? "",
      },
      redirect: "manual",
    });

    if (response.status === 303 || response.status === 302) {
      throw new RadicleGardenError("Session expired or not authenticated. Log in again.", 401);
    }

    const payload = (await response.json()) as SvelteKitActionResult | unknown;
    if (isRedirectPayload(payload)) {
      throw new RadicleGardenError("Session expired or not authenticated. Log in again.", 401, payload);
    }

    const config = extractBuildkiteConfig(payload);
    if (!config) {
      throw new RadicleGardenError(
        "Could not parse Buildkite config from integrations page data",
        500,
        payload,
      );
    }
    return config;
  }

  async saveBuildkite(rid: string, input: BuildkiteSaveInput): Promise<void> {
    await this.ensureAuthenticated();
    const body = new URLSearchParams({
      orgSlug: input.orgSlug,
      clusterId: input.clusterId,
      apiToken: input.apiToken ?? "",
      context: input.context ?? DEFAULT_CONTEXT,
      publicPipeline: input.publicPipeline ? "true" : "false",
    });
    await this.postAction(rid, "saveBuildkite", body);
  }

  async verifyBuildkite(rid: string, input: BuildkiteVerifyInput = {}): Promise<void> {
    await this.ensureAuthenticated();
    const body = new URLSearchParams({
      orgSlug: input.orgSlug ?? "",
      apiToken: input.apiToken ?? "",
    });
    await this.postAction(rid, "verifyBuildkite", body);
  }

  async removeBuildkite(rid: string): Promise<void> {
    await this.ensureAuthenticated();
    await this.postAction(rid, "removeBuildkite", new URLSearchParams());
  }

  private async postAction(
    rid: string,
    action: "saveBuildkite" | "verifyBuildkite" | "removeBuildkite",
    body: URLSearchParams,
  ): Promise<void> {
    const path = this.integrationsPath(rid);
    const url = `${this.baseUrl}${path}?/${action}`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.actionHeaders(`${this.baseUrl}${path}?tab=buildkite`),
      body,
      redirect: "manual",
    });

    this.captureSessionCookie(response);

    const result = (await response.json()) as SvelteKitActionResult;
    if (result.type === "success") return;
    if (result.type === "failure") {
      const message = decodeSvelteKitFailure(result.data) ?? `${action} failed`;
      throw new RadicleGardenError(message, result.status, result.data);
    }
    if (result.type === "redirect" && result.location.includes("/login")) {
      throw new RadicleGardenError("Session expired or not authenticated. Log in again.", 401, result);
    }
    throw new RadicleGardenError(`Unexpected ${action} response`, response.status, result);
  }

  private actionHeaders(referer: string): HeadersInit {
    return {
      Origin: this.baseUrl,
      Referer: referer,
      Accept: "application/json",
      "x-sveltekit-action": "true",
      "Content-Type": "application/x-www-form-urlencoded",
      ...(this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
    };
  }

  private captureSessionCookie(response: Response): void {
    const cookies = getSetCookies(response);
    if (cookies.length === 0) return;

    const jar = parseCookieJar(this.sessionCookie);
    for (const cookie of cookies) {
      const [pair] = cookie.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    this.sessionCookie = serializeCookieJar(jar);
  }
}

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function parseCookieJar(cookieHeader: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!cookieHeader) return jar;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return jar;
}

function serializeCookieJar(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function isRedirectPayload(payload: unknown): payload is { type: "redirect"; location: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "type" in payload &&
    (payload as { type?: string }).type === "redirect"
  );
}

function decodeSvelteKitFailure(data: unknown): string | undefined {
  if (!Array.isArray(data)) return undefined;
  const message = data.find((item) => typeof item === "string" && item.length > 0);
  return typeof message === "string" ? message : undefined;
}

function extractBuildkiteConfig(payload: unknown): BuildkiteConfig | undefined {
  const visited = new Set<unknown>();
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (isBuildkiteConfig(current)) {
      return current;
    }

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      stack.push(value);
    }
  }

  return undefined;
}

function isBuildkiteConfig(value: object): value is BuildkiteConfig {
  const candidate = value as Partial<BuildkiteConfig>;
  return (
    typeof candidate.configured === "boolean" &&
    typeof candidate.orgSlug === "string" &&
    typeof candidate.clusterId === "string" &&
    typeof candidate.context === "string" &&
    typeof candidate.publicPipeline === "boolean"
  );
}

export async function listBuildkiteOrganizations(apiToken: string): Promise<BuildkiteOrganization[]> {
  const response = await fetch("https://api.buildkite.com/v2/organizations", {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!response.ok) {
    throw new RadicleGardenError(`Buildkite organizations request failed (${response.status})`, response.status);
  }
  const data = (await response.json()) as Array<{
    id: string;
    slug: string;
    name: string;
  }>;
  return data.map((org) => ({ id: org.id, slug: org.slug, name: org.name }));
}

export async function listBuildkiteClusters(
  apiToken: string,
  orgSlug: string,
): Promise<BuildkiteCluster[]> {
  const response = await fetch(
    `https://api.buildkite.com/v2/organizations/${encodeURIComponent(orgSlug)}/clusters`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (!response.ok) {
    throw new RadicleGardenError(`Buildkite clusters request failed (${response.status})`, response.status);
  }
  const data = (await response.json()) as Array<{
    id: string;
    name: string;
    description?: string | null;
    default_queue_id?: string | null;
    web_url?: string | null;
  }>;
  return data.map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    description: cluster.description ?? null,
    defaultQueueId: cluster.default_queue_id ?? null,
    webUrl: cluster.web_url ?? null,
  }));
}

export async function verifyBuildkiteToken(apiToken: string, orgSlug: string): Promise<void> {
  const response = await fetch(
    `https://api.buildkite.com/v2/organizations/${encodeURIComponent(orgSlug)}`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new RadicleGardenError(
      "Invalid API token, or it lacks access to this organization",
      400,
    );
  }
  if (response.status === 404) {
    throw new RadicleGardenError(`Organization "${orgSlug}" not found`, 400);
  }
  throw new RadicleGardenError(`Buildkite API returned status ${response.status}`, 502);
}
