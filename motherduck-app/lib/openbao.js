const DEFAULT_MOUNT = "secret";
const DEFAULT_SECRET_NAME = "MOTHERDUCK_TOKEN";

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getEnvironmentId() {
  return (
    process.env.CURSOR_ENVIRONMENT_ID ??
    decodeJwtPayload(process.env.OIDC)?.environment_id ??
    null
  );
}

function getCandidateAddresses() {
  const configured = [
    process.env.OPENBAO_ADDR,
    process.env.BAO_ADDR,
    process.env.VAULT_ADDR,
  ].filter(Boolean);

  if (configured.length > 0) {
    return configured;
  }

  return [];
}

function getAuthTokens() {
  const tokens = [];
  if (process.env.OPENBAO_TOKEN) {
    tokens.push(process.env.OPENBAO_TOKEN);
  }
  if (process.env.OIDC) {
    tokens.push(process.env.OIDC);
  }
  return [...new Set(tokens)];
}

function buildCandidatePaths(secretName, mount) {
  const environmentId = getEnvironmentId();
  const paths = [`${mount}/data/${secretName}`];

  if (environmentId) {
    paths.push(`${mount}/data/${environmentId}/${secretName}`);
  }

  return paths;
}

function extractSecretValue(payload, secretName) {
  const data = payload?.data?.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  for (const key of [secretName, "value", "token", "secret"]) {
    if (typeof data[key] === "string" && data[key].length > 0) {
      return data[key];
    }
  }

  const values = Object.values(data).filter((value) => typeof value === "string");
  return values[0] ?? null;
}

async function readSecretAtPath(address, token, path) {
  const response = await fetch(`${address.replace(/\/$/, "")}/v1/${path}`, {
    headers: {
      "X-Vault-Token": token,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return extractSecretValue(payload, DEFAULT_SECRET_NAME);
}

export function isOpenBaoConfigured() {
  return Boolean(process.env.OPENBAO_TOKEN);
}

export async function fetchSecretFromOpenBao(secretName = DEFAULT_SECRET_NAME) {
  if (!process.env.OPENBAO_TOKEN) {
    return null;
  }

  const addresses = getCandidateAddresses();
  const tokens = getAuthTokens();
  const mount = process.env.OPENBAO_MOUNT ?? DEFAULT_MOUNT;
  const paths = buildCandidatePaths(secretName, mount);

  if (addresses.length === 0) {
    throw new Error(
      "OPENBAO_TOKEN is available, but no OpenBao server address is configured. Set OPENBAO_ADDR (or BAO_ADDR / VAULT_ADDR) if your secrets are not injected directly as MOTHERDUCK_TOKEN."
    );
  }

  for (const address of addresses) {
    for (const token of tokens) {
      for (const path of paths) {
        const value = await readSecretAtPath(address, token, path);
        if (value) {
          return value;
        }
      }
    }
  }

  throw new Error(
    `Could not read ${secretName} from OpenBao. Checked ${addresses.length} address(es) and ${paths.length} path(s).`
  );
}
