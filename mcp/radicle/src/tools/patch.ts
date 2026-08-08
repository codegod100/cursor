import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import { z } from "zod";
import {
  findCreatePatchScript,
  findWorkspaceRoot,
  requireRad,
} from "../rad.js";
import { resolveRadEnv } from "../identity.js";

const execFileAsync = promisify(execFile);

export const createPatchSchema = z.object({
  repo: z
    .string()
    .optional()
    .describe("Absolute path to the Radicle git repo (default: git root of cwd)."),
  title: z.string().min(1).describe("Patch title (first patch.message line)."),
  body: z.string().optional().describe("Patch description (second patch.message line)."),
  branch: z.string().optional().describe("Create or checkout this branch before pushing."),
  ref: z.string().optional().default("HEAD").describe("Commit or ref to push."),
  patch_id: z
    .string()
    .optional()
    .describe("Existing patch id to update instead of opening a new patch."),
  base: z.string().optional().describe("Stack on another commit (patch.base push option)."),
  draft: z.boolean().optional().default(false).describe("Open as draft."),
  sync: z.boolean().optional().default(true).describe("Sync with seeds after push."),
  force: z.boolean().optional().default(false).describe("Force-push amended commits."),
  commit: z
    .string()
    .optional()
    .describe("Stage all changes, commit with this message, then open the patch."),
  dry_run: z.boolean().optional().default(false).describe("Print planned git push only."),
  env_name: z
    .string()
    .optional()
    .describe("Use RAD_HOME from <workspace>/.radicle/<env_name> for this push."),
  rad_home: z.string().optional().describe("Override RAD_HOME for the patch push."),
  passphrase: z
    .string()
    .optional()
    .describe("RAD_PASSPHRASE for signing (falls back to process env)."),
});

export type CreatePatchInput = z.infer<typeof createPatchSchema>;

export interface CreatePatchResult {
  stdout: string;
  stderr: string;
  patch_id?: string;
  patch_url?: string;
}

function extractPatchId(text: string): string | undefined {
  const patchMatch = text.match(/Patch[[:space:]]+([0-9a-f]{7,40})/i);
  if (patchMatch) return patchMatch[1];
  const urlMatch = text.match(/patches\/([0-9a-f]{7,40})/i);
  if (urlMatch) return urlMatch[1];
  return undefined;
}

function extractPatchUrl(text: string): string | undefined {
  const match = text.match(/(https:\/\/app\.radicle\.xyz[^\s]+)/);
  return match?.[1];
}

function resolveRadEnvInput(input: CreatePatchInput) {
  return {
    env_name: input.env_name,
    rad_home: input.rad_home,
    passphrase: input.passphrase,
  };
}

export async function createPatch(input: CreatePatchInput): Promise<CreatePatchResult> {
  await requireRad();

  const script = findCreatePatchScript();
  try {
    await access(script, constants.X_OK);
  } catch {
    throw new Error(`create-patch script not found or not executable: ${script}`);
  }

  const radEnv = await resolveRadEnv(resolveRadEnvInput(input));
  const args = [script];

  if (input.repo) args.push("--repo", input.repo);
  args.push("--title", input.title);
  if (input.body) args.push("--body", input.body);
  if (input.branch) args.push("--branch", input.branch);
  if (input.ref && input.ref !== "HEAD") args.push("--ref", input.ref);
  if (input.patch_id) args.push("--patch", input.patch_id);
  if (input.base) args.push("--base", input.base);
  if (input.draft) args.push("--draft");
  if (!input.sync) args.push("--no-sync");
  if (input.force) args.push("--force");
  if (input.commit) args.push("--commit", input.commit);
  if (input.dry_run) args.push("--dry-run");

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    RAD_HOME: radEnv.radHome,
    GIT_TERMINAL_PROMPT: "0",
  };
  if (radEnv.passphrase !== undefined) {
    childEnv.RAD_PASSPHRASE = radEnv.passphrase;
  }

  const { stdout, stderr } = await execFileAsync("bash", args, {
    env: childEnv,
    cwd: input.repo ?? findWorkspaceRoot(),
    maxBuffer: 10 * 1024 * 1024,
  });

  const combined = `${stdout}\n${stderr}`;
  return {
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    patch_id: extractPatchId(combined),
    patch_url: extractPatchUrl(combined),
  };
}
