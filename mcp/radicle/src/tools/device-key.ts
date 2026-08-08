import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  defaultRadHome,
  findWorkspaceRoot,
  getSelf,
  identityExists,
  requireRad,
  runRadOrThrow,
  type RadEnv,
} from "../rad.js";
import { loadStoredPassphrase, startNode, storePassphrase } from "../identity.js";

export const issueDeviceKeySchema = z.object({
  env_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Scope RAD_HOME to <workspace>/.radicle/<env_name>. Default: <workspace>/.radicle.",
    ),
  alias: z
    .string()
    .min(1)
    .optional()
    .default("cursor-agent")
    .describe("Radicle node alias for this device identity."),
  passphrase: z
    .string()
    .optional()
    .describe("Key passphrase (generated and stored locally if omitted)."),
  rad_home: z
    .string()
    .optional()
    .describe("Override RAD_HOME path."),
  start_node: z
    .boolean()
    .optional()
    .default(false)
    .describe("Start rad node after issuing the key."),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Re-issue even if an identity already exists (not recommended)."),
});

export type IssueDeviceKeyInput = z.infer<typeof issueDeviceKeySchema>;

export interface IssueDeviceKeyResult {
  did: string;
  alias: string;
  rad_home: string;
  config: string;
  created: boolean;
  node_started: boolean;
  nid?: string;
}

export async function issueDeviceKey(
  input: IssueDeviceKeyInput,
): Promise<IssueDeviceKeyResult> {
  await requireRad();

  const workspace = findWorkspaceRoot();
  const radHome = input.rad_home ?? defaultRadHome(workspace, input.env_name);
  const storedPassphrase = await loadStoredPassphrase(radHome);
  const passphrase = input.passphrase ?? storedPassphrase ?? randomBytes(24).toString("base64url");
  const env: RadEnv = { radHome, passphrase };

  await mkdir(radHome, { recursive: true });

  const exists = await identityExists(env);
  if (exists && !input.force) {
    const self = await getSelf(env);
    let nid: string | undefined;
    if (input.start_node) {
      nid = await startNode(env);
    }
    return {
      did: self.did,
      alias: self.alias,
      rad_home: self.home,
      config: self.config,
      created: false,
      node_started: Boolean(nid),
      nid,
    };
  }

  await runRadOrThrow(["auth", "--alias", input.alias], env);
  await storePassphrase(radHome, passphrase);

  const self = await getSelf(env);
  let nid: string | undefined;
  if (input.start_node) {
    nid = await startNode(env);
  }

  return {
    did: self.did,
    alias: self.alias,
    rad_home: self.home,
    config: self.config,
    created: true,
    node_started: Boolean(nid),
    nid,
  };
}
