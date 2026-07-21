import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";

const runtimeRootCache = new Map<string, string>();

export function canonicalRuntimeProjectRoot(start: string): string {
  const current = resolve(start);
  const cached = runtimeRootCache.get(current);
  if (cached) return cached;
  try {
    const commonDirectory = git(current, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const absoluteCommonDirectory = isAbsolute(commonDirectory) ? commonDirectory : resolve(current, commonDirectory);
    const root = dirname(absoluteCommonDirectory);
    runtimeRootCache.set(current, root);
    return root;
  } catch {
    runtimeRootCache.set(current, current);
    return current;
  }
}

export function workflowRuntimeRoot(projectRoot: string): string {
  return join(canonicalRuntimeProjectRoot(projectRoot), ".codex", "workflow-runtime");
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
