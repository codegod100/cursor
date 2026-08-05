const DEFAULT_MOUNT = "secret";
const DEFAULT_SECRET_NAME = "MOTHERDUCK_TOKEN";

function getOpenBaoAddress() {
  return (
    process.env.OPENBAO_ADDR ??
    process.env.BAO_ADDR ??
    process.env.VAULT_ADDR ??
    null
  );
}

function buildCandidatePaths(secretName, mount) {
  const environmentId = process.env.CURSOR_ENVIRONMENT_ID;
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
    const body = await response.text();
    throw new Error(`OpenBao read failed for ${path}: HTTP ${response.status} ${body}`);
  }

  const payload = await response.json();
  return extractSecretValue(payload, DEFAULT_SECRET_NAME);
}

export async function fetchSecretFromOpenBao(secretName = DEFAULT_SECRET_NAME) {
  const address = getOpenBaoAddress();
  const token = process.env.OPENBAO_TOKEN;

  if (!token) {
    return null;
  }

  if (!address) {
    throw new Error(
      "OPENBAO_TOKEN is set but OPENBAO_ADDR is missing. Add OPENBAO_ADDR as an environment secret."
    );
  }

  const mount = process.env.OPENBAO_MOUNT ?? DEFAULT_MOUNT;
  const paths = buildCandidatePaths(secretName, mount);

  for (const path of paths) {
    const value = await readSecretAtPath(address, token, path);
    if (value) {
      return value;
    }
  }

  throw new Error(
    `Secret ${secretName} was not found in OpenBao. Tried: ${paths.join(", ")}`
  );
}
