import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";
import {
  requireRad,
  runRad,
  runRadOrThrow,
} from "../rad.js";
import { resolveRadEnv } from "../identity.js";

const execFileAsync = promisify(execFile);

const ridSchema = z
  .string()
  .min(1)
  .describe("Repository ID (RID), e.g. rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5 or bare id.");

export const getRepoRidSchema = z.object({
  repo: z
    .string()
    .optional()
    .describe("Absolute path to the git repo (default: git root of cwd)."),
  env_name: z.string().optional().describe("RAD_HOME at <workspace>/.radicle/<env_name>."),
  rad_home: z.string().optional().describe("Override RAD_HOME path."),
  passphrase: z.string().optional().describe("RAD_PASSPHRASE if the key is encrypted."),
});

export const setRepoRidSchema = z.object({
  repo: z
    .string()
    .optional()
    .describe("Absolute path to the git repo (default: git root of cwd)."),
  rid: ridSchema.optional().describe(
    "Link to an existing RID. Omit to publish the repo as new on Radicle (rad init).",
  ),
  name: z.string().optional().describe("Repository name for rad init (default: directory name)."),
  description: z.string().optional().describe("Repository description for rad init."),
  default_branch: z
    .string()
    .optional()
    .describe("Default branch for rad init (default: current HEAD branch)."),
  public: z.boolean().optional().default(true).describe("Publish as public (rad init --public)."),
  private: z.boolean().optional().default(false).describe("Publish as private (rad init --private)."),
  set_upstream: z
    .boolean()
    .optional()
    .default(true)
    .describe("Set default branch upstream to rad/<branch> (-u)."),
  setup_signing: z
    .boolean()
    .optional()
    .default(false)
    .describe("Configure Radicle commit signing in the repo."),
  seed_first: z
    .boolean()
    .optional()
    .default(true)
    .describe("When linking an existing RID, run rad seed before rad init --existing."),
  env_name: z.string().optional(),
  rad_home: z.string().optional(),
  passphrase: z.string().optional(),
});

export type GetRepoRidInput = z.infer<typeof getRepoRidSchema>;
export type SetRepoRidInput = z.infer<typeof setRepoRidSchema>;

export interface GetRepoRidResult {
  repo: string;
  rid?: string;
  remote_url?: string;
  initialized: boolean;
  payload?: unknown;
  identity?: unknown;
}

export interface SetRepoRidResult {
  repo: string;
  rid: string;
  mode: "created" | "linked";
  stdout: string;
  stderr: string;
}

function resolveRadEnvInput(input: {
  env_name?: string;
  rad_home?: string;
  passphrase?: string;
}) {
  return {
    env_name: input.env_name,
    rad_home: input.rad_home,
    passphrase: input.passphrase,
  };
}

export async function resolveRepoPath(repo?: string): Promise<string> {
  if (repo) {
    return path.resolve(repo);
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

function normalizeRid(rid: string): string {
  return rid.startsWith("rad:") ? rid : `rad:${rid}`;
}

function parseRid(text: string): string | undefined {
  const match = text.match(/rad:[A-Za-z0-9]+/);
  return match?.[0];
}

async function getGitRemoteRad(repo: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repo, "remote", "get-url", "rad"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export async function getRepoRid(input: GetRepoRidInput): Promise<GetRepoRidResult> {
  await requireRad();
  const env = await resolveRadEnv(resolveRadEnvInput(input));
  const repo = await resolveRepoPath(input.repo);

  const dot = await runRad(["."], env, { cwd: repo });
  const rid = dot.exitCode === 0 ? parseRid(dot.stdout) ?? dot.stdout.trim() : undefined;
  const remoteUrl = await getGitRemoteRad(repo);

  let payload: unknown;
  const payloadResult = await runRad(["inspect", "--payload"], env, { cwd: repo });
  if (payloadResult.exitCode === 0) {
    payload = tryParseJson(payloadResult.stdout) ?? payloadResult.stdout.trim();
  }

  let identity: unknown;
  const identityResult = await runRad(["inspect", "--identity"], env, { cwd: repo });
  if (identityResult.exitCode === 0) {
    identity = tryParseJson(identityResult.stdout) ?? identityResult.stdout.trim();
  }

  return {
    repo,
    rid: rid || remoteUrl,
    remote_url: remoteUrl,
    initialized: Boolean(rid || remoteUrl),
    payload,
    identity,
  };
}

export async function setRepoRid(input: SetRepoRidInput): Promise<SetRepoRidResult> {
  await requireRad();
  const env = await resolveRadEnv(resolveRadEnvInput(input));
  const repo = await resolveRepoPath(input.repo);

  if (input.public && input.private) {
    throw new Error("set public and private are mutually exclusive");
  }

  const args = ["init", "--no-confirm"];

  if (input.rid) {
    const rid = normalizeRid(input.rid);
    if (input.seed_first) {
      await runRadOrThrow(["seed", rid], env, { cwd: repo });
    }
    args.push("--existing", rid);
  } else {
    if (input.name) args.push("--name", input.name);
    if (input.description) args.push("--description", input.description);
    if (input.default_branch) args.push("--default-branch", input.default_branch);
    if (input.private) {
      args.push("--private");
    } else if (input.public) {
      args.push("--public");
    }
  }

  if (input.set_upstream) args.push("-u");
  if (input.setup_signing) args.push("--setup-signing");

  const result = await runRadOrThrow(args, env, { cwd: repo });
  const combined = `${result.stdout}\n${result.stderr}`;
  const rid =
    parseRid(combined) ??
    (input.rid ? normalizeRid(input.rid) : undefined);

  if (!rid) {
    const after = await getRepoRid({ ...input, repo });
    if (!after.rid) {
      throw new Error("rad init completed but RID could not be determined");
    }
    return {
      repo,
      rid: after.rid,
      mode: input.rid ? "linked" : "created",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    repo,
    rid,
    mode: input.rid ? "linked" : "created",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
