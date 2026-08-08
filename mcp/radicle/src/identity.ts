import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  defaultRadHome,
  findWorkspaceRoot,
  identityExists,
  requireRad,
  runRad,
  runRadOrThrow,
  RadError,
  type RadEnv,
} from "./rad.js";

const passphraseCache = new Map<string, string>();

const PASSPHRASE_FILE = ".mcp-passphrase";
const DEFAULT_ALIAS = "cursor-agent";

export interface ResolveRadEnvInput {
  env_name?: string;
  rad_home?: string;
  passphrase?: string;
  alias?: string;
}

export interface ResolvedRadEnv extends RadEnv {
  identity_issued?: boolean;
  delegate_hint?: string;
}

function passphrasePath(radHome: string): string {
  return path.join(radHome, PASSPHRASE_FILE);
}

export async function loadStoredPassphrase(radHome: string): Promise<string | undefined> {
  const cached = passphraseCache.get(radHome);
  if (cached) {
    return cached;
  }
  try {
    const value = (await readFile(passphrasePath(radHome), "utf8")).trim();
    if (value) {
      passphraseCache.set(radHome, value);
      return value;
    }
  } catch {
    // no stored passphrase yet
  }
  return undefined;
}

export async function storePassphrase(radHome: string, passphrase: string): Promise<void> {
  passphraseCache.set(radHome, passphrase);
  const file = passphrasePath(radHome);
  await writeFile(file, `${passphrase}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}

export function resolveRadHome(input: ResolveRadEnvInput = {}): string {
  const workspace = findWorkspaceRoot();
  return (
    input.rad_home ??
    (input.env_name
      ? defaultRadHome(workspace, input.env_name)
      : (process.env.RAD_HOME ?? defaultRadHome(workspace)))
  );
}

/** Resolve RAD_HOME + passphrase, auto-issuing a device key when none exists. */
export async function resolveRadEnv(input: ResolveRadEnvInput = {}): Promise<ResolvedRadEnv> {
  await requireRad();
  const radHome = resolveRadHome(input);
  let passphrase =
    input.passphrase ?? process.env.RAD_PASSPHRASE ?? (await loadStoredPassphrase(radHome));

  const env: RadEnv = { radHome, passphrase };
  if (await identityExists(env)) {
    return { radHome, passphrase };
  }

  await mkdir(radHome, { recursive: true });
  passphrase = passphrase ?? randomBytes(24).toString("base64url");
  const issueEnv: RadEnv = { radHome, passphrase };
  const alias = input.alias ?? DEFAULT_ALIAS;

  await runRadOrThrow(["auth", "--alias", alias], issueEnv);
  await storePassphrase(radHome, passphrase);

  const did = (await runRadOrThrow(["self", "--did"], issueEnv)).stdout.trim();
  return {
    radHome,
    passphrase,
    identity_issued: true,
    delegate_hint: `Add this device as a repo delegate: rad id update --title "Add ${alias}" --delegate ${did}`,
  };
}

export async function startNode(env: RadEnv): Promise<string | undefined> {
  let result = await runRad(["node", "start"], env);
  if (result.exitCode !== 0) {
    result = await runRad(["node", "start", "--daemon"], env);
  }
  if (result.exitCode !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new RadError(detail ? `rad node start failed: ${detail}` : "rad node start failed", result);
  }
  const status = await runRadOrThrow(["node", "status", "--only", "nid"], env);
  return status.stdout.trim() || undefined;
}
