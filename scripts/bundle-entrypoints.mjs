#!/usr/bin/env node
import { build } from "esbuild";
import { chmod, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const name of ["cli", "mcp", "hook"]) {
  await build({
    entryPoints: [join(root, "src", `${name}.ts`)],
    outfile: join(root, "dist", `${name}.js`),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    sourcemap: true,
    packages: "bundle",
    external: ["better-sqlite3"],
    banner: { js: 'import { createRequire as __cdoCreateRequire } from "node:module"; const require = __cdoCreateRequire(import.meta.url);' },
    legalComments: "none",
  });
}
await chmod(join(root, "dist", "cli.js"), 0o755);
await cp(join(root, "web", "dist"), join(root, "dist", "dashboard-web"), { recursive: true });
