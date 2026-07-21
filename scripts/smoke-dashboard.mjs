#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const home = await mkdtemp(join(tmpdir(), "cdo-dashboard-smoke-"));
const port = await availablePort();
const child = spawn(process.execPath, [join(root, "dist", "cli.js"), "dashboard", "serve", "--no-open", "--port", String(port)], {
  env: { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), CDO_DASHBOARD_HOME: join(home, ".cdo") },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let lastProbeError = "";
child.stdout.on("data", (chunk) => { output += String(chunk); });
child.stderr.on("data", (chunk) => { output += String(chunk); });
try {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok && (await response.json()).version === "0.3.0") {
        const status = spawnSync(process.execPath, [join(root, "dist", "cli.js"), "dashboard", "status", "--port", String(port)], { env: { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), CDO_DASHBOARD_HOME: join(home, ".cdo") }, encoding: "utf8" });
        if (status.status !== 0 || !JSON.parse(status.stdout).running) throw new Error(`Custom-port status failed\n${status.stderr || status.stdout}`);
        console.log("packaged dashboard smoke test OK (native SQLite and static UI)");
        process.exitCode = 0;
        break;
      }
    } catch (error) { lastProbeError = error instanceof Error ? error.message : String(error); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (process.exitCode === undefined) throw new Error(`Dashboard did not become healthy\n${lastProbeError}\n${output}`);
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
