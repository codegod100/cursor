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

export const issueDeviceKeySchema = z.object({
  env_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Environment label used to scope RAD_HOME under <workspace>/.radicle/<env_name>. Omit to use <workspace>/.radicle.",
    ),
  alias: z
    .string()
    .min(1)
    .describe("Radicle node alias for this device identity."),
  passphrase: z
    .string()
    .optional()
    .describe(
      "Passphrase for the Ed25519 keypair. Generated if omitted. Store as RAD_PASSPHRASE in env secrets.",
    ),
  rad_home: z
    .string()
    .optional()
    .describe("Override RAD_HOME path instead of the default workspace location."),
  start_node: z
    .boolean()
    .optional()
    .default(false)
    .describe("Start rad node in the background after issuing the key."),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Re-issue even if an identity already exists at rad_home (not recommended)."),
});

export type IssueDeviceKeyInput = z.infer<typeof issueDeviceKeySchema>;

export interface IssueDeviceKeyResult {
  did: string;
  alias: string;
  rad_home: string;
  config: string;
  passphrase?: string;
  created: boolean;
  node_started: boolean;
  nid?: string;
  env_setup: {
    RAD_HOME: string;
    RAD_PASSPHRASE?: string;
  };
  delegate_hint: string;
}

export async function issueDeviceKey(
  input: IssueDeviceKeyInput,
): Promise<IssueDeviceKeyResult> {
  await requireRad();

  const workspace = findWorkspaceRoot();
  const radHome =
    input.rad_home ?? defaultRadHome(workspace, input.env_name);
  const passphrase = input.passphrase ?? randomBytes(24).toString("base64url");
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
      passphrase: input.passphrase,
      created: false,
      node_started: Boolean(nid),
      nid,
      env_setup: {
        RAD_HOME: self.home,
        ...(input.passphrase ? { RAD_PASSPHRASE: input.passphrase } : {}),
      },
      delegate_hint: `Add this device as a repo delegate: rad id update --title "Add ${self.alias}" --delegate ${self.did}`,
    };
  }

  await runRadOrThrow(["auth", "--alias", input.alias], env);

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
    passphrase,
    created: true,
    node_started: Boolean(nid),
    nid,
    env_setup: {
      RAD_HOME: self.home,
      RAD_PASSPHRASE: passphrase,
    },
    delegate_hint: `Add this device as a repo delegate: rad id update --title "Add ${self.alias}" --delegate ${self.did}`,
  };
}

async function startNode(env: RadEnv): Promise<string | undefined> {
  await runRadOrThrow(["node", "start", "--daemon"], env);
  const status = await runRadOrThrow(["node", "status", "--only", "nid"], env);
  const nid = status.stdout.trim();
  return nid || undefined;
}
