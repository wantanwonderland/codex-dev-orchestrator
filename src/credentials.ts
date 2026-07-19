import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

const ProfileSchema = z.object({
  environment: z.string().min(1),
  allowedHosts: z.array(z.string().min(1)).min(1),
  command: z.array(z.string().min(1)).min(1),
});
const ProfilesSchema = z.record(ProfileSchema);
const BrowserStateSchema = z.object({ cookies: z.array(z.unknown()), origins: z.array(z.unknown()) }).passthrough();

export interface IssueAuthInput {
  projectRoot: string;
  projectId: string;
  profile: string;
  host: string;
  secretsRoot?: string;
}

export async function issueBrowserAuthState(input: IssueAuthInput): Promise<{ path: string; environment: string }> {
  const projectRoot = resolve(input.projectRoot);
  const secretsRoot = resolve(input.secretsRoot ?? join(homedir(), ".codex", "workflow-secrets"));
  if (isWithin(projectRoot, secretsRoot)) {
    throw new Error("The workflow secrets directory must be outside the project worktree");
  }
  const projectSecrets = join(secretsRoot, input.projectId);
  const profileFile = join(projectSecrets, "profiles.json");
  await requireMode(projectSecrets, 0o700, "credential project directory");
  await requireMode(profileFile, 0o600, "credential profile file");
  const profiles = ProfilesSchema.parse(JSON.parse(await readFile(profileFile, "utf8")));
  const profile = profiles[input.profile];
  if (!profile) throw new Error(`Unknown credential profile: ${input.profile}`);
  if (!profile.allowedHosts.includes(input.host)) throw new Error(`Host ${input.host} is not allowed for profile ${input.profile}`);
  const [program, ...args] = profile.command;
  if (!isAbsolute(program)) throw new Error("Credential adapter command must use an absolute executable path");
  const output = await runAdapter(program, args, projectSecrets);
  const state = BrowserStateSchema.parse(JSON.parse(output));
  const outputDir = join(projectSecrets, "auth-states");
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const path = join(outputDir, `${input.profile}-${randomUUID()}.json`);
  await writeFile(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  return { path, environment: profile.environment };
}

async function requireMode(path: string, required: number, label: string): Promise<void> {
  const actual = (await stat(path)).mode & 0o777;
  if (actual !== required) throw new Error(`${label} must use mode 0${required.toString(8)}, found 0${actual.toString(8)}`);
}

export async function deleteBrowserAuthState(path: string, secretsRoot?: string): Promise<void> {
  const root = resolve(secretsRoot ?? join(homedir(), ".codex", "workflow-secrets"));
  const target = resolve(path);
  if (!isWithin(root, target)) throw new Error("Refusing to delete auth state outside the secrets root");
  await unlink(target);
}

function isWithin(parent: string, child: string): boolean {
  const result = relative(parent, child);
  return result === "" || (!result.startsWith("..") && !isAbsolute(result));
}

async function runAdapter(program: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, env: { PATH: process.env.PATH ?? "" }, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 2_000_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Credential adapter failed with exit ${code}; stderr was redacted`));
      else resolvePromise(stdout);
    });
  });
}
