#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const path = join(root, ".codex-plugin", "plugin.json");
const manifest = JSON.parse(await readFile(path, "utf8"));
const base = String(manifest.version).split("+")[0];
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
manifest.version = `${base}+codex.local-${stamp}`;
await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Plugin cachebuster updated to ${manifest.version}`);
