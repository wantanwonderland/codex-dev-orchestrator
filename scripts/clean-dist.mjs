#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, "dist");
if (dirname(target) !== root || target === root) throw new Error("Refusing unsafe build cleanup target");
await rm(target, { recursive: true, force: true });
