#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
const { default: mermaid } = await import("mermaid");
const readme = await readFile(join(root, "README.md"), "utf8");
for (const forbidden of ["/path/to/", "<workflow-id>", "adjust as needed", "[TODO:"]) {
  if (readme.includes(forbidden)) throw new Error(`README contains forbidden placeholder: ${forbidden}`);
}
const diagrams = [...readme.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((match) => match[1]);
if (diagrams.length < 3) throw new Error("README must contain architecture, sequence, and state diagrams");
for (const diagram of diagrams) await mermaid.parse(diagram);

const help = spawnSync(process.execPath, [join(root, "dist", "cli.js"), "--help"], { encoding: "utf8" });
if (help.status !== 0) throw new Error(help.stderr);
for (const command of ["init", "start", "approve-plan", "status", "acquire-writer", "release-writer", "risk", "validate-artifacts", "gate", "auth-state", "delete-auth-state", "publish-checkpoint", "merge-pr", "doctor"]) {
  if (!help.stdout.includes(command)) throw new Error(`README command is missing from CLI: ${command}`);
}
console.log(`README validation OK (${diagrams.length} Mermaid diagrams and CLI command contract)`);
