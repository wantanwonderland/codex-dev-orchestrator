import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DASHBOARD_HOST, DASHBOARD_PORT } from "./config.js";

const START = "# >>> codex-dev-orchestrator dashboard telemetry >>>";
const END = "# <<< codex-dev-orchestrator dashboard telemetry <<<";

export interface TelemetryStatus {
  managed: boolean;
  configured: boolean;
  path: string;
  reason?: string;
}

export function codexConfigPath(): string {
  return process.env.CODEX_HOME ? join(process.env.CODEX_HOME, "config.toml") : join(homedir(), ".codex", "config.toml");
}

export async function telemetryStatus(path = codexConfigPath()): Promise<TelemetryStatus> {
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const managed = content.includes(START) && content.includes(END);
  const configured = managed || /^\s*\[otel\]\s*$/m.test(content);
  return { managed, configured, path, reason: configured && !managed ? "An unmanaged [otel] table already exists" : undefined };
}

export async function setupTelemetry(path = codexConfigPath(), port = DASHBOARD_PORT): Promise<TelemetryStatus> {
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (content.includes(START) && content.includes(END)) return telemetryStatus(path);
  if (/^\s*\[otel\]\s*$/m.test(content)) {
    throw new Error(`Refusing to replace the existing unmanaged [otel] table in ${path}`);
  }
  const block = `${START}\n[otel]\nenvironment = "local"\nexporter = { otlp-http = { endpoint = "http://${DASHBOARD_HOST}:${port}/v1/logs", protocol = "json" } }\nlog_user_prompt = false\n${END}\n`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${content}${content && !content.endsWith("\n") ? "\n" : ""}${block}`, { mode: 0o600 });
  return telemetryStatus(path);
}
