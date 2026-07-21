import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { dashboardHome } from "./config.js";

const LABEL = "com.wantan.codex-dev-orchestrator.dashboard";

function userDomain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Unable to determine the current macOS user ID");
  return `gui/${uid}`;
}

export function launchAgentPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function installDashboardService(): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Background service installation currently supports macOS launchd; use cdo dashboard --no-open elsewhere");
  const modulePath = fileURLToPath(import.meta.url);
  const cliPath = basename(modulePath) === "cli.js" ? modulePath : fileURLToPath(new URL("../cli.js", import.meta.url));
  await access(cliPath);
  const path = launchAgentPath();
  const logDir = join(dashboardHome(), "logs");
  await mkdir(dirname(path), { recursive: true });
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(cliPath)}</string><string>dashboard</string><string>serve</string><string>--no-open</string></array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>${xml(join(logDir, "dashboard.log"))}</string>\n<key>StandardErrorPath</key><string>${xml(join(logDir, "dashboard.error.log"))}</string>\n</dict></plist>\n`;
  await writeFile(path, plist, { mode: 0o600 });
  await run("launchctl", ["bootout", userDomain(), path]).catch(() => undefined);
  await run("launchctl", ["bootstrap", userDomain(), path]);
  return path;
}

export async function uninstallDashboardService(): Promise<void> {
  const path = launchAgentPath();
  if (process.platform === "darwin") await run("launchctl", ["bootout", userDomain(), path]).catch(() => undefined);
  await rm(path, { force: true });
}

export async function dashboardServiceStatus(): Promise<{ installed: boolean; path: string }> {
  const path = launchAgentPath();
  try {
    await readFile(path);
    return { installed: true, path };
  } catch {
    return { installed: false, path };
  }
}
