import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface RadEnv {
  radHome: string;
  passphrase?: string;
}

export interface RadRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class RadError extends Error {
  constructor(
    message: string,
    readonly result?: RadRunResult,
  ) {
    super(message);
    this.name = "RadError";
  }
}

export async function requireRad(): Promise<void> {
  try {
    await execFileAsync("rad", ["--version"]);
  } catch {
    throw new RadError(
      "rad CLI not found on PATH. Install Radicle Heartwood: https://radicle.xyz",
    );
  }
}

export async function runRad(
  args: string[],
  env: RadEnv,
  options?: { cwd?: string },
): Promise<RadRunResult> {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    RAD_HOME: env.radHome,
    GIT_TERMINAL_PROMPT: "0",
  };
  if (env.passphrase !== undefined) {
    childEnv.RAD_PASSPHRASE = env.passphrase;
  }

  try {
    const { stdout, stderr } = await execFileAsync("rad", args, {
      cwd: options?.cwd,
      env: childEnv,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 0 };
  } catch (error: unknown) {
    const err = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number;
      message?: string;
    };
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? err.message ?? "";
    const exitCode = typeof err.code === "number" ? err.code : 1;
    return { stdout, stderr, exitCode };
  }
}

export async function runRadOrThrow(
  args: string[],
  env: RadEnv,
  options?: { cwd?: string },
): Promise<RadRunResult> {
  const result = await runRad(args, env, options);
  if (result.exitCode !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new RadError(
      detail ? `rad ${args.join(" ")} failed: ${detail}` : `rad ${args.join(" ")} failed`,
      result,
    );
  }
  return result;
}

export async function identityExists(env: RadEnv): Promise<boolean> {
  const result = await runRad(["self", "--did"], env);
  return result.exitCode === 0 && result.stdout.trim().startsWith("did:key:");
}

export async function getSelf(env: RadEnv): Promise<{
  did: string;
  alias: string;
  home: string;
  config: string;
}> {
  const [did, alias, home, config] = await Promise.all([
    runRadOrThrow(["self", "--did"], env),
    runRadOrThrow(["self", "--alias"], env),
    runRadOrThrow(["self", "--home"], env),
    runRadOrThrow(["self", "--config"], env),
  ]);
  return {
    did: did.stdout.trim(),
    alias: alias.stdout.trim(),
    home: home.stdout.trim(),
    config: config.stdout.trim(),
  };
}

export function defaultRadHome(workspaceRoot: string, envName?: string): string {
  if (envName) {
    return path.join(workspaceRoot, ".radicle", envName);
  }
  return path.join(workspaceRoot, ".radicle");
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function findWorkspaceRoot(): string {
  return process.env.CURSOR_WORKSPACE ?? process.cwd();
}

export function findCreatePatchScript(): string {
  const fromEnv = process.env.RAD_PATCH_SCRIPT;
  if (fromEnv) {
    return fromEnv;
  }
  const workspace = findWorkspaceRoot();
  return path.join(
    workspace,
    ".cursor",
    "skills",
    "rad-patch",
    "scripts",
    "create-patch.sh",
  );
}
