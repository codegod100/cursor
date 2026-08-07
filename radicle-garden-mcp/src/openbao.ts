const DEFAULT_OPENBAO_ADDR = "https://openbao.boxd.sh";
const RADICLE_PASSWORD_ID = "98ef04b8-4a1d-4d60-9044-6b1139aae748";

type OpenbaoKvResponse = {
  data?: { data?: Record<string, string> };
};

export async function openbaoKey(key: string): Promise<string> {
  const token = process.env.OPENBAO_TOKEN;
  if (!token) return "";

  const addr = (process.env.OPENBAO_ADDR ?? DEFAULT_OPENBAO_ADDR).replace(/\/$/, "");
  const response = await fetch(`${addr}/v1/secret/data/ai-api-keys`, {
    headers: { "X-Vault-Token": token },
  });
  if (!response.ok) return "";

  const payload = (await response.json()) as OpenbaoKvResponse;
  return payload.data?.data?.[key] ?? "";
}

export async function openbaoRadiclePassword(): Promise<{ email: string; password: string }> {
  const token = process.env.OPENBAO_TOKEN;
  if (!token) return { email: "", password: "" };

  const addr = (process.env.OPENBAO_ADDR ?? DEFAULT_OPENBAO_ADDR).replace(/\/$/, "");
  const response = await fetch(`${addr}/v1/secret/data/passwords/${RADICLE_PASSWORD_ID}`, {
    headers: { "X-Vault-Token": token },
  });
  if (!response.ok) return { email: "", password: "" };

  const payload = (await response.json()) as OpenbaoKvResponse;
  const data = payload.data?.data ?? {};
  return {
    email: data.username ?? "",
    password: data.password ?? "",
  };
}

/** Populate MCP env vars from OpenBao when Cursor secrets are not set separately. */
export async function hydrateSecretsFromOpenbao(): Promise<void> {
  if (!process.env.OPENBAO_TOKEN) return;

  if (!process.env.BUILDKITE_API_TOKEN) {
    const buildkite = await openbaoKey("BUILDKITE_API_KEY");
    if (buildkite) process.env.BUILDKITE_API_TOKEN = buildkite;
  }

  const radicle = await openbaoRadiclePassword();
  if (!process.env.RADICLE_GARDEN_EMAIL && radicle.email) {
    process.env.RADICLE_GARDEN_EMAIL = radicle.email;
  }
  if (!process.env.RADICLE_GARDEN_PASSWORD && radicle.password) {
    process.env.RADICLE_GARDEN_PASSWORD = radicle.password;
  }
}
