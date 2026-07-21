import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface DashboardRateLimit {
  name: string;
  used: number;
  resetAt: string;
  trend: number;
  status: "normal" | "warning" | "critical";
  windowMinutes?: number;
}

interface WindowValue { usedPercent?: number; resetsAt?: number; windowDurationMins?: number }
interface Snapshot { limitId?: string; limitName?: string; primary?: WindowValue; secondary?: WindowValue }

let cached: { at: number; value: { available: boolean; limits: DashboardRateLimit[]; reason?: string } } | undefined;
let pending: Promise<{ available: boolean; limits: DashboardRateLimit[]; reason?: string }> | undefined;

export async function queryCodexRateLimits(timeoutMs = 3_000): Promise<{ available: boolean; limits: DashboardRateLimit[]; reason?: string }> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  if (pending) return pending;
  pending = query(timeoutMs).then((value) => {
    cached = { at: Date.now(), value };
    return value;
  }).finally(() => { pending = undefined; });
  return pending;
}

function query(timeoutMs: number): Promise<{ available: boolean; limits: DashboardRateLimit[]; reason?: string }> {
  return new Promise((resolve) => {
    const child = spawn("codex", ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"] });
    let settled = false;
    const finish = (value: { available: boolean; limits: DashboardRateLimit[]; reason?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ available: false, limits: [], reason: "Codex rate-limit query timed out" }), timeoutMs);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message: { id?: number; result?: { rateLimits?: Snapshot; rateLimitsByLimitId?: Record<string, Snapshot> }; error?: unknown };
      try { message = JSON.parse(line) as typeof message; } catch { return; }
      if (message.id === 1 && message.result) {
        child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
        child.stdin.write(`${JSON.stringify({ method: "account/rateLimits/read", id: 2, params: {} })}\n`);
      }
      if (message.id === 2) {
        if (!message.result) return finish({ available: false, limits: [], reason: "Codex did not return rate limits" });
        const snapshots = message.result.rateLimitsByLimitId
          ? Object.entries(message.result.rateLimitsByLimitId)
          : [[message.result.rateLimits?.limitId ?? "codex", message.result.rateLimits ?? {}] as const];
        const limits = snapshots.flatMap(([id, snapshot]) => {
          const values: DashboardRateLimit[] = [];
          for (const [label, window] of [["Primary", snapshot.primary], ["Secondary", snapshot.secondary]] as const) {
            if (!window || window.usedPercent === undefined) continue;
            const used = window.usedPercent;
            values.push({
              name: `${snapshot.limitName ?? id} ${label}`,
              used,
              resetAt: window.resetsAt ? new Date(window.resetsAt * 1_000).toISOString() : "",
              trend: 0,
              status: used >= 90 ? "critical" : used >= 75 ? "warning" : "normal",
              windowMinutes: window.windowDurationMins,
            });
          }
          return values;
        });
        finish({ available: true, limits });
      }
    });
    child.once("error", (error) => finish({ available: false, limits: [], reason: error.message }));
    child.once("exit", (code) => {
      if (!settled) finish({ available: false, limits: [], reason: `Codex app-server exited with ${code}` });
    });
    child.stdin.write(`${JSON.stringify({
      method: "initialize",
      id: 1,
      params: { clientInfo: { name: "cdo-dashboard", title: "CDO Dashboard", version: "0.6.0" }, capabilities: null },
    })}\n`);
  });
}
