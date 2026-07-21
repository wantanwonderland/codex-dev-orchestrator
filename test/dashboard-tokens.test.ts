import Sqlite from "better-sqlite3";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DashboardDatabase } from "../src/dashboard/database.js";
import { importCodexTokenHistory } from "../src/dashboard/tokens.js";

function tokenLine(id: string, at: string, total: number, last: number): string {
  return JSON.stringify({ timestamp: at, type: "event_msg", payload: { type: "token_count", info: {
    total_token_usage: { input_tokens: total - 10, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: total },
    last_token_usage: { input_tokens: last - 10, cached_input_tokens: 5, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: last },
  } } });
}

async function rollout(path: string, id: string, cwd: string, totals: Array<[number, number]>, parent?: string, corrupt = false, embeddedParentMeta = false): Promise<void> {
  const lines = [JSON.stringify({ timestamp: "2026-07-21T00:00:00.000Z", type: "session_meta", payload: { id, parent_thread_id: parent, cwd, thread_source: parent ? "subagent" : "user" } })];
  if (parent && embeddedParentMeta) lines.push(JSON.stringify({ timestamp: "2026-07-20T00:00:00.000Z", type: "session_meta", payload: { id: parent, cwd, thread_source: "user" } }));
  totals.forEach(([total, last], index) => lines.push(tokenLine(id, `2026-07-21T00:00:0${index + 1}.000Z`, total, last)));
  if (corrupt) lines.push("{broken");
  await writeFile(path, `${lines.join("\n")}\n`);
}

describe("Codex token import", () => {
  it("subtracts a child historical prefix and classifies fallback coverage idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-tokens-"));
    const sessions = join(root, "sessions");
    await mkdir(sessions);
    const project = join(root, "project");
    await mkdir(project);
    const parentPath = join(sessions, "parent.jsonl");
    const childPath = join(sessions, "child.jsonl");
    const copiedChildPath = join(sessions, "copied-child.jsonl");
    const freshChildPath = join(sessions, "fresh-child.jsonl");
    const partialPath = join(sessions, "partial.jsonl");
    await rollout(parentPath, "parent", project, [[50, 50], [100, 50]]);
    await rollout(childPath, "child", project, [[130, 30], [180, 50]], "parent");
    await rollout(copiedChildPath, "copied-child", project, [[50, 50], [100, 50], [180, 80]], "parent", false, true);
    // Current Codex child counters start at the child's first charged request. That request may include inherited context,
    // but it is real child usage and must not be subtracted unless cumulative parent snapshots were actually copied.
    await rollout(freshChildPath, "fresh-child", project, [[80, 80], [180, 100]], "parent");
    await rollout(partialPath, "partial", project, [[20, 20]], undefined, true);

    const statePath = join(root, "state.sqlite");
    const state = new Sqlite(statePath);
    state.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, cwd TEXT, source TEXT, model TEXT, agent_role TEXT, agent_path TEXT, created_at_ms INTEGER, updated_at_ms INTEGER, tokens_used INTEGER); CREATE TABLE thread_spawn_edges(parent_thread_id TEXT, child_thread_id TEXT);");
    const insert = state.prepare("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?,?)");
    insert.run("parent", parentPath, project, "user", "gpt-test", null, null, 1, 2, 100);
    insert.run("child", childPath, project, "subagent", "gpt-test", null, "/root/worker", 1, 2, 180);
    insert.run("copied-child", copiedChildPath, project, "subagent", "gpt-test", "worker", null, 1, 2, 180);
    insert.run("fresh-child", freshChildPath, project, "subagent", "gpt-test", "worker", null, 1, 2, 180);
    insert.run("partial", partialPath, project, "user", "gpt-test", null, null, 1, 2, 20);
    insert.run("backfill", null, project, "user", "gpt-test", null, null, 1, 2, 50);
    insert.run("offline", null, project, "user", "gpt-test", null, null, 1, 2, 0);
    state.prepare("INSERT INTO thread_spawn_edges VALUES (?,?)").run("parent", "child");
    state.prepare("INSERT INTO thread_spawn_edges VALUES (?,?)").run("parent", "copied-child");
    state.prepare("INSERT INTO thread_spawn_edges VALUES (?,?)").run("parent", "fresh-child");
    state.close();

    const databasePath = join(root, "dashboard.sqlite");
    let database = new DashboardDatabase({ databasePath });
    const registered = database.registerRoot(root);
    database.replaceProjectSnapshot({ project: { id: "project", rootId: registered.id, path: project, canonicalPath: project, gitCommonDir: null, name: "project", projectKey: null, defaultBranch: null }, locations: [{ rootId: registered.id, path: project }], workflows: [], tasks: [{ workflowId: "wf", taskKey: "assignment", source: "assignment", kind: "executor-report", status: "running", role: "executor", stage: "implementation", operationKey: "work", agentId: "/root/worker", fileName: "report.md", updatedAt: null }], history: [] });

    const first = await importCodexTokenHistory(database, { statePath, sessionsPath: sessions });
    const child = database.listSessions().find((session) => session.id === "child");
    expect(child).toMatchObject({ coverage: "exact", rawTotalTokens: 180, inheritedPrefixTokens: 100, totalTokens: 80, role: "executor", agentPath: "/root/worker" });
    expect(database.listSessions().find((session) => session.id === "copied-child")).toMatchObject({ coverage: "exact", inheritedPrefixTokens: 100, totalTokens: 80 });
    expect(database.listSessions().find((session) => session.id === "fresh-child")).toMatchObject({ coverage: "exact", inheritedPrefixTokens: 0, totalTokens: 180 });
    expect(database.listSessions().find((session) => session.id === "backfill")).toMatchObject({ coverage: "backfilled", totalTokens: 50 });
    expect(database.listSessions().find((session) => session.id === "partial")?.coverage).toBe("partial");
    expect(database.listSessions().find((session) => session.id === "offline")?.coverage).toBe("offline");
    expect(first.totals).toMatchObject({ totalTokens: 510, allocatedTokens: 510, coverage: { exact: 4, backfilled: 1, partial: 1, offline: 1 } });

    const second = await importCodexTokenHistory(database, { statePath, sessionsPath: sessions });
    expect(second.totals.totalTokens).toBe(510);
    expect(second.filesRead).toBe(0);
    expect(database.listSessions()).toHaveLength(7);
    await appendFile(childPath, `${tokenLine("child", "2026-07-21T00:00:09.000Z", 230, 50)}\n`);
    const appended = await importCodexTokenHistory(database, { statePath, sessionsPath: sessions });
    expect(appended.filesRead).toBe(1);
    expect(database.listSessions().find((session) => session.id === "child")).toMatchObject({ inheritedPrefixTokens: 100, totalTokens: 130 });
    expect(appended.totals.totalTokens).toBe(560);

    const childFingerprint = database.getSourceFingerprint(childPath)!;
    database.setSourceFingerprint(childPath, childFingerprint.value, "parent");
    const healedOwner = await importCodexTokenHistory(database, { statePath, sessionsPath: sessions });
    expect(healedOwner.filesRead).toBe(1);
    expect(database.getSourceFingerprint(childPath)?.sessionId).toBe("child");
    expect(healedOwner.totals.totalTokens).toBe(560);

    // Legacy/import-recovery databases can contain ordinal gaps; appends must advance from MAX(ordinal), not row count.
    const childSnapshots = database.listTokenSnapshots("child");
    const finalSnapshot = childSnapshots.at(-1)!;
    database.replaceSession(database.getSession("child")!, [
      childSnapshots[0]!,
      { ...finalSnapshot, ordinal: finalSnapshot.ordinal + 3 },
    ]);

    const fingerprintBeforePartialWrite = database.getSourceFingerprint(childPath)?.value;
    const completeBeforePartial = `${tokenLine("child", "2026-07-21T00:00:10.000Z", 280, 50)}\n`;
    const trailingLine = `${tokenLine("child", "2026-07-21T00:00:11.000Z", 330, 50)}\n`;
    const trailingSplitAt = Math.floor(trailingLine.length / 2);
    await appendFile(childPath, completeBeforePartial + trailingLine.slice(0, trailingSplitAt));
    const partialWrite = await importCodexTokenHistory(database, { statePath, sessionsPath: sessions });
    expect(partialWrite.filesRead).toBe(1);
    expect(database.getSourceFingerprint(childPath)?.value).toBe(fingerprintBeforePartialWrite);
    expect(database.listSessions().find((session) => session.id === "child")?.totalTokens).toBe(130);

    await appendFile(childPath, trailingLine.slice(trailingSplitAt));
    const completedWrite = await importCodexTokenHistory(database, { statePath, sessionsPath: sessions });
    expect(completedWrite.filesRead).toBe(1);
    expect(database.getSourceFingerprint(childPath)?.value).not.toBe(fingerprintBeforePartialWrite);
    expect(database.listSessions().find((session) => session.id === "child")).toMatchObject({ inheritedPrefixTokens: 100, totalTokens: 230 });
    expect(database.listTokenSnapshots("child").at(-1)?.ordinal).toBe(finalSnapshot.ordinal + 5);
    expect(completedWrite.totals.totalTokens).toBe(660);
    database.close();
    database = new DashboardDatabase({ databasePath });
    const afterRestart = await importCodexTokenHistory(database, { statePath, sessionsPath: sessions });
    expect(afterRestart.filesRead).toBe(0);
    expect(afterRestart.totals.totalTokens).toBe(660);
    database.close();
  });

  it("continues from rollout files when the Codex state database is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "cdo-dashboard-rollout-only-"));
    const sessions = join(root, "sessions");
    await mkdir(sessions);
    await rollout(join(sessions, "only.jsonl"), "only", root, [[40, 40]]);
    const database = new DashboardDatabase({ databasePath: join(root, "dashboard.sqlite") });
    const result = await importCodexTokenHistory(database, { statePath: join(root, "missing.sqlite"), sessionsPath: sessions });
    expect(result.sessionsImported).toBe(1);
    expect(result.issues.some((issue) => issue.path.endsWith("missing.sqlite"))).toBe(true);
    expect(database.listSessions()[0]).toMatchObject({ id: "only", coverage: "exact", totalTokens: 40 });
    database.close();
  });
});
