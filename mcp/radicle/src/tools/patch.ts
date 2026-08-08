import { z } from "zod";
import { resolveRadEnv } from "../identity.js";
import {
  branchExists,
  requireRad,
  requireRadRemote,
  resolveRepoPath,
  runGit,
  runGitOrThrow,
  runRadOrThrow,
  workingTreeClean,
  RadError,
} from "../rad.js";

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
    .describe("Scope identity to <workspace>/.radicle/<env_name> (auto-created if missing)."),
  rad_home: z.string().optional().describe("Override RAD_HOME for signing."),
  passphrase: z.string().optional().describe("Override key passphrase (rarely needed)."),
});

export type CreatePatchInput = z.infer<typeof createPatchSchema>;

export interface CreatePatchResult {
  stdout: string;
  stderr: string;
  patch_id?: string;
  patch_url?: string;
  identity_issued?: boolean;
  did?: string;
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

export async function createPatch(input: CreatePatchInput): Promise<CreatePatchResult> {
  await requireRad();

  const radEnv = await resolveRadEnv({
    env_name: input.env_name,
    rad_home: input.rad_home,
    passphrase: input.passphrase,
  });

  const repo = await resolveRepoPath(input.repo);
  await requireRadRemote(repo, radEnv);

  let ref = input.ref ?? "HEAD";
  const title = input.title || input.commit;
  if (!title) {
    throw new Error("title required (or use commit with a message that becomes the title)");
  }

  if (input.branch) {
    if (await branchExists(repo, input.branch, radEnv)) {
      await runGitOrThrow(["checkout", input.branch], radEnv, { cwd: repo });
    } else {
      await runGitOrThrow(["checkout", "-b", input.branch], radEnv, { cwd: repo });
    }
  }

  if (input.commit) {
    if (await workingTreeClean(repo, radEnv)) {
      throw new Error("working tree clean — omit commit or make changes first");
    }
    await runGitOrThrow(["add", "-A"], radEnv, { cwd: repo });
    await runGitOrThrow(["commit", "-m", input.commit], radEnv, { cwd: repo });
    ref = "HEAD";
  }

  if (input.patch_id) {
    await runRadOrThrow(["patch", "set", input.patch_id], radEnv, { cwd: repo });
  }

  const pushArgs = ["push"];
  if (input.force) {
    pushArgs.push("--force");
  }
  if (input.sync) {
    pushArgs.push("-o", "sync");
  } else {
    pushArgs.push("-o", "no-sync");
  }
  if (input.draft) {
    pushArgs.push("-o", "patch.draft");
  }
  if (input.base) {
    pushArgs.push("-o", `patch.base=${input.base}`);
  }
  pushArgs.push("-o", `patch.message=${title}`);
  if (input.body) {
    pushArgs.push("-o", `patch.message=${input.body}`);
  }
  pushArgs.push("rad");

  if (input.patch_id) {
    pushArgs.push(ref);
  } else {
    pushArgs.push(`${ref}:refs/patches`);
  }

  if (input.dry_run) {
    return {
      stdout: `repo: ${repo}\ncmd: git ${pushArgs.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n[dry-run]`,
      stderr: "",
      identity_issued: radEnv.identity_issued,
    };
  }

  const result = await runGit(pushArgs, radEnv, { cwd: repo });
  if (result.exitCode !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new RadError(detail ? `patch push failed: ${detail}` : "patch push failed", result);
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  let did: string | undefined;
  if (radEnv.identity_issued) {
    did = (await runRadOrThrow(["self", "--did"], radEnv)).stdout.trim();
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    patch_id: extractPatchId(combined),
    patch_url: extractPatchUrl(combined),
    identity_issued: radEnv.identity_issued,
    did,
  };
}
