#!/usr/bin/env node
import { access, constants, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "dist", "cli.js");
const demo = await mkdtemp(join(tmpdir(), "cdo-smoke-"));

await access(cli, constants.X_OK);

function run(program, args, expect = 0) {
  const result = spawnSync(program, args, { cwd: demo, encoding: "utf8" });
  if (result.status !== expect) {
    throw new Error(`${program} ${args.join(" ")} returned ${result.status}, expected ${expect}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

try {
  run("git", ["init", "-b", "main"]);
  run("git", ["config", "user.name", "CDO Smoke"]);
  run("git", ["config", "user.email", "cdo-smoke@example.invalid"]);
  await writeFile(join(demo, ".keep"), "\n");
  run("git", ["add", ".keep"]);
  run("git", ["commit", "-m", "init"]);
  run(process.execPath, [cli, "init", "--project-id", "demo-project", "--default-branch", "main"]);
  run(process.execPath, [cli, "doctor"]);
  run(process.execPath, [cli, "start", "Build a customer-visible account settings page", "--id", "account-settings", "--tier", "large"]);
  run(process.execPath, [cli, "validate-artifacts", "account-settings"]);
  run(process.execPath, [cli, "approve-plan", "account-settings", "--by", "smoke-test"]);
  run(process.execPath, [cli, "transition", "account-settings", "executing"]);
  run(process.execPath, [cli, "acquire-writer", "account-settings", "--role", "executor", "--session", "parent-session"]);
  const conflict = run(process.execPath, [cli, "acquire-writer", "account-settings", "--role", "fixer", "--session", "other-session"], 1);
  if (!conflict.includes("held by executor/parent-session")) throw new Error("Writer conflict was not explained");
  run(process.execPath, [cli, "release-writer", "account-settings", "--session", "parent-session"]);
  run(process.execPath, [cli, "transition", "account-settings", "reviewing"]);
  const gate = run(process.execPath, [cli, "gate", "account-settings"], 2);
  if (!gate.includes("passed whole-phase review") || !gate.includes("passed live browser report")) {
    throw new Error("Completion gate did not require review and browser proof");
  }
  console.log("disposable repository smoke test OK");
} finally {
  await rm(demo, { recursive: true, force: true });
}
