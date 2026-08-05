import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const defaultAddrFile = path.join(appRoot, ".openbao-addr");

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

function readAddressFile() {
  const configured = process.env.OPENBAO_ADDR_FILE;
  const filePath = configured
    ? path.isAbsolute(configured)
      ? configured
      : path.resolve(appRoot, configured)
    : defaultAddrFile;

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const value = fs.readFileSync(filePath, "utf8").trim();
  return value.length > 0 ? value : null;
}

function getEnvironmentId() {
  return (
    process.env.CURSOR_ENVIRONMENT_ID ??
    decodeJwtPayload(process.env.OIDC)?.environment_id ??
    null
  );
}

export function getOpenBaoAddresses() {
  const configured = [
    process.env.OPENBAO_ADDR,
    process.env.BAO_ADDR,
    process.env.VAULT_ADDR,
    readAddressFile(),
  ].filter(Boolean);

  return [...new Set(configured)];
}

async function getFreshOpenBaoOidcToken() {
  const socket =
    process.env.CURSOR_AGENT_SOCKET ?? "/run/cursor/api.sock";

  try {
    const { stdout } = await execFileAsync("curl", [
      "-s",
      "--unix-socket",
      socket,
      "-X",
      "POST",
      "http://localhost/v1/tokens/oidc",
      "-H",
      "Content-Type: application/json",
      "-d",
      '{"aud":"openbao"}',
    ]);
    const payload = JSON.parse(stdout);
    return payload.token ?? null;
  } catch {
    return null;
  }
}

async function getAuthTokens() {
  const tokens = [];
  if (process.env.OPENBAO_TOKEN) {
    tokens.push(process.env.OPENBAO_TOKEN);
  }
  if (process.env.OIDC) {
    tokens.push(process.env.OIDC);
  }

  const freshOidc = await getFreshOpenBaoOidcToken();
  if (freshOidc) {
    tokens.push(freshOidc);
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

export function isOpenBaoFetchConfigured() {
  return Boolean(process.env.OPENBAO_TOKEN && getOpenBaoAddresses().length > 0);
}

export function getOpenBaoDiagnostics() {
  const addresses = getOpenBaoAddresses();
  const environmentId = getEnvironmentId();
  const mount = process.env.OPENBAO_MOUNT ?? DEFAULT_MOUNT;

  return {
    openbaoTokenPresent: Boolean(process.env.OPENBAO_TOKEN),
    openbaoAddressConfigured: addresses.length > 0,
    openbaoAddresses: addresses,
    openbaoMount: mount,
    environmentId,
    candidatePaths: buildCandidatePaths(DEFAULT_SECRET_NAME, mount),
  };
}

export async function fetchSecretFromOpenBao(secretName = DEFAULT_SECRET_NAME) {
  if (!process.env.OPENBAO_TOKEN) {
    return null;
  }

  const addresses = getOpenBaoAddresses();
  const tokens = await getAuthTokens();
  const mount = process.env.OPENBAO_MOUNT ?? DEFAULT_MOUNT;
  const paths = buildCandidatePaths(secretName, mount);

  if (addresses.length === 0) {
    throw new Error(
      "OPENBAO_ADDR is not set. Add OPENBAO_ADDR as a Cursor secret, put it in .openbao-addr, " +
        "or set BAO_ADDR / VAULT_ADDR so the app can read MOTHERDUCK_TOKEN from OpenBao."
    );
  }

  for (const address of addresses) {
    for (const token of tokens) {
      for (const secretPath of paths) {
        const value = await readSecretAtPath(address, token, secretPath);
        if (value) {
          return value;
        }
      }
    }
  }

  throw new Error(
    `Could not read ${secretName} from OpenBao at ${addresses.join(", ")}. ` +
      `Checked paths: ${paths.join(", ")}.`
  );
}
