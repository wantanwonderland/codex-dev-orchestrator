import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { issueBrowserAuthState } from "../src/credentials.js";

describe("credential broker", () => {
  it("runs an argv adapter and creates a short-lived mode-0600 browser state outside the repo", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "cdo-repo-"));
    const secretsRoot = await mkdtemp(join(tmpdir(), "cdo-secrets-"));
    const profileDir = join(secretsRoot, "demo");
    await mkdir(profileDir, { mode: 0o700 });
    const adapter = join(profileDir, "adapter.mjs");
    await writeFile(adapter, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({cookies: [], origins: []}));\n');
    await chmod(adapter, 0o700);
    await writeFile(
      join(profileDir, "profiles.json"),
      JSON.stringify({ local: { environment: "local", allowedHosts: ["localhost"], command: [adapter] } }),
      { mode: 0o600 },
    );

    const issued = await issueBrowserAuthState({ projectRoot, secretsRoot, projectId: "demo", profile: "local", host: "localhost" });
    expect(issued.path.startsWith(projectRoot)).toBe(false);
    expect((await stat(issued.path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(issued.path, "utf8"))).toEqual({ cookies: [], origins: [] });
  });

  it("rejects group-readable credential metadata", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "cdo-repo-"));
    const secretsRoot = await mkdtemp(join(tmpdir(), "cdo-secrets-"));
    const profileDir = join(secretsRoot, "demo");
    await mkdir(profileDir, { mode: 0o755 });
    await writeFile(join(profileDir, "profiles.json"), "{}", { mode: 0o644 });
    await expect(issueBrowserAuthState({ projectRoot, secretsRoot, projectId: "demo", profile: "local", host: "localhost" })).rejects.toThrow(/mode 0700/);
  });

  it("rejects a secrets directory inside the worktree", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "cdo-repo-"));
    await expect(
      issueBrowserAuthState({
        projectRoot,
        secretsRoot: join(projectRoot, "secrets"),
        projectId: "demo",
        profile: "local",
        host: "localhost",
      }),
    ).rejects.toThrow(/outside the project worktree/);
  });
});
